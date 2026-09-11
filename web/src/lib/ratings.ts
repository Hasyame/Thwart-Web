import type { CampaignRun, Play, Rating } from './records';
import type { CardSet } from './types';
import { db } from './db';
import { replayOf, type CampaignLayout } from './replay';
import { seatsOf } from './plays';

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
 * What a completed game can be rated on: its scenario, then each modular set
 * that was on the table, paired with that scenario.
 *
 * Resolved through `replayOf`, which already knows how to turn a play back
 * into what was laid out — a campaign's scenario id into its card set, the
 * modular sets out of the field, the notes line or the template. So a rating
 * and a replay always agree about what the game was.
 */
export function subjectsOfPlay(
  play: Play,
  sets: readonly CardSet[],
  layout: CampaignLayout | null = null,
): readonly RatingSubject[] {
  const laid = replayOf(play, [], sets, layout).session;
  const scenario = laid.scenarioCode ?? play.scenarioCode;
  if (scenario === '') {
    return [];
  }
  return [
    scenarioSubject(scenario),
    ...(laid.modularSetCodes ?? []).map((code) => modularSubject(code, scenario)),
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
