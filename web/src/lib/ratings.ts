import { isFne } from './fearNoEvil';
import type { CampaignRun, Play, Rating } from './records';
import type { CampaignEvent } from './campaign/types';
import type { CardSet, IndexRow } from './types';
import { db } from './db';
import { replayOf } from './replay';
import { seatsOf } from './plays';
import { templateOf } from './campaign/store';
import { fold } from './campaign/engine';
import { encounterSetsOf, trackedSetCode } from './campaign/encounter';

/**
 * Difficulty ratings, on the client.
 *
 * What is rated is a *subject* — a scenario, a modular set paired with the
 * scenario it was played with, or a campaign — identified by a key that is
 * also the record's id, so one current rating per player per subject is the
 * shape of the data rather than a rule anyone enforces. The server checks each
 * rating against the play or run it cites before storing it; this module only
 * builds them honestly. docs/spec/ratings-and-modular-sets.md §2.
 */

export const MIN_SCORE = 0;
export const MAX_SCORE = 5;
export const SCORES = [0, 1, 2, 3, 4, 5] as const;

export type SubjectKind = 'scenario' | 'modular' | 'campaign';

export interface RatingSubject {
  /** The record id: `scenario:rhino`, `modular:bomb_scare@rhino`, `campaign:gmw`. */
  readonly key: string;
  readonly kind: SubjectKind;
  /** The set or template the subject is about. */
  readonly code: string;
  /** For a modular set: the scenario it was paired with. */
  readonly pairedWith?: string;
}

export const scenarioSubject = (setCode: string): RatingSubject => ({
  key: `scenario:${setCode}`,
  kind: 'scenario',
  code: setCode,
});

export const modularSubject = (setCode: string, scenarioCode: string): RatingSubject => ({
  key: `modular:${setCode}@${scenarioCode}`,
  kind: 'modular',
  code: setCode,
  pairedWith: scenarioCode,
});

export const campaignSubject = (templateId: string): RatingSubject => ({
  key: `campaign:${templateId}`,
  kind: 'campaign',
  code: templateId,
});

/** The bare per-set view the summary endpoint serves; not a subject anyone rates. */
export const modularOverallKey = (setCode: string): string => `modular:${setCode}`;

/**
 * What a campaign's scenario was laid out as, by card set.
 *
 * A play from a campaign records the template's own scenario id — `s1_musee`
 * — which is not a card set, and a rating is of a card set (spec §2.3). The
 * template knows what was on the table. The villain follows from `baseSetup`
 * — or from the folded state, for a scenario that draws one from a pool as
 * the campaign goes — and the set follows from the villain, by the same
 * `trackedSetCode` the campaign tracker itself uses. The modular sets are
 * whatever the template shuffles in that the card database calls a modular
 * set: a template lists the villain's own set and the standard set in the
 * same breath, and neither is rated as a pairing.
 *
 * Null when the run is gone, its template unreadable, or the scenario's set
 * unresolvable, in which case the play is rated by what it says itself.
 */
export interface CampaignLayout {
  readonly scenarioCode: string;
  readonly modularSetCodes: readonly string[];
}

export function campaignLayoutOf(
  play: Play,
  run: CampaignRun,
  events: readonly CampaignEvent[],
  index: readonly IndexRow[],
  sets: readonly CardSet[],
): CampaignLayout | null {
  const template = templateOf(run);
  const scenario = template?.scenarios?.find((s) => s.id === play.scenarioCode) ?? null;
  if (template === null || scenario === null) {
    return null;
  }
  const setCode = trackedSetCode(scenario, fold(template, events), index);
  if (setCode === null) {
    return null;
  }
  const modular = new Set(sets.filter((s) => s.type === 'modular').map((s) => s.code));
  return {
    scenarioCode: setCode,
    modularSetCodes: [...new Set(encounterSetsOf(scenario).filter((code) => modular.has(code)))],
  };
}

/**
 * What a completed game can be rated on: its scenario, then each modular set
 * that was on the table, paired with that scenario.
 *
 * A one-off game is read back through `replayOf`, which already knows how to
 * turn a play into what was laid out — the modular sets out of the field or
 * the notes line — so a rating and a replay agree about what the game was. A
 * campaign's scenario comes with its `layout`, resolved above, since the
 * replay has no reason to know a campaign's ids.
 */
export function subjectsOfPlay(
  play: Play,
  sets: readonly CardSet[],
  layout: CampaignLayout | null = null,
): readonly RatingSubject[] {
  const laid = replayOf(play, [], sets).session;
  const scenario = layout?.scenarioCode ?? laid.scenarioCode ?? play.scenarioCode;
  // Fear No Evil played on its own names no set either: nothing to rate.
  if (scenario === '' || isFne(scenario)) {
    return [];
  }
  const modularSetCodes = layout === null ? (laid.modularSetCodes ?? []) : layout.modularSetCodes;
  return [
    scenarioSubject(scenario),
    ...modularSetCodes.map((code) => modularSubject(code, scenario)),
  ];
}

function contextOf(play: Play, pairedWith?: string): Rating['context'] {
  return {
    players: play.players,
    heroes: seatsOf(play).map((seat) => ({ code: seat.code, aspect: seat.aspect })),
    mode: play.difficulty,
    standardSet: play.standardSet,
    ...(pairedWith === undefined ? {} : { scenario: pairedWith }),
  };
}

/** A rating of a scenario or a modular set, given after this game. */
export function ratingOfPlay(subject: RatingSubject, score: number, play: Play): Rating {
  return {
    subject: subject.key,
    score: clamp(score),
    ratedAt: Date.now(),
    evidence: { playId: play.id },
    context: contextOf(play, subject.pairedWith),
  };
}

/** A rating of a whole campaign, given once its run is finished. */
export function ratingOfRun(run: CampaignRun, score: number, players: number): Rating {
  return {
    subject: campaignSubject(run.templateId).key,
    score: clamp(score),
    ratedAt: Date.now(),
    evidence: { runId: run.id },
    context: {
      players,
      heroes: [],
      mode: run.difficulty,
      standardSet: run.standardSet,
    },
  };
}

const clamp = (score: number): number =>
  Math.max(MIN_SCORE, Math.min(MAX_SCORE, Math.round(score)));

/**
 * Stores a rating, replacing the player's previous one for the subject.
 *
 * A put on a table keyed by subject: rating again is the same row with a
 * newer `ratedAt`, which is also what wins the merge. The sync engine picks
 * the change up by digest, and the server decides whether it may keep it.
 */
export async function rate(rating: Rating): Promise<void> {
  await db.ratings.put(rating);
}

/** Takes a rating back. The sync engine tombstones it; the server subtracts it. */
export async function unrate(subject: string): Promise<void> {
  await db.ratings.delete(subject);
}
