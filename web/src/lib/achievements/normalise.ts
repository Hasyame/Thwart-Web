import type { CampaignRun, Play, PlayHero } from '../records';
import type { CampaignState } from '../campaign/types';
import { isFne, splitFne } from '../fearNoEvil';
import { PLAY_MODES, type DifficultyLevel, type PlayFact, type RunFact, type Seat } from './types';

/**
 * This client's records, turned into the facts the derivation reads.
 *
 * docs/spec/achievements/algorithm.md §2, applied to the web's own storage
 * shape. Deterministic given the record, the run and the template; the
 * campaign resolution is handed in as a function so this stays free of
 * the card index and the templates, and so a test can stand one in.
 */

/** The level a difficulty string names. data-model.md §2: never Standard by default. */
export function levelOf(difficulty: string | null | undefined): DifficultyLevel {
  const folded = (difficulty ?? '').trim().toLowerCase().replace(/[-\s]+/g, '_');
  if (folded.startsWith('expert')) {
    return 'expert';
  }
  if (folded.startsWith('standard')) {
    return 'standard';
  }
  return 'unknown';
}

/**
 * The scenario key of a play. `resolveCampaign` answers for a campaign play
 * with the card-set code its run's template names, or null.
 */
export function scenarioKeyOf(
  play: Pick<Play, 'scenarioCode' | 'campaignRunId'>,
  resolveCampaign: (play: Pick<Play, 'scenarioCode' | 'campaignRunId'>) => string | null,
): string {
  if (play.campaignRunId !== null && play.campaignRunId !== undefined) {
    return resolveCampaign(play) ?? `campaign:${play.scenarioCode}`;
  }
  if (isFne(play.scenarioCode)) {
    return splitFne(play.scenarioCode).job;
  }
  return play.scenarioCode;
}

const aspectSet = (aspect: string): string[] =>
  [...new Set(aspect.split(',').map((a) => a.trim().toLowerCase()).filter((a) => a !== ''))].sort();

/** The seats, exactly one of them the owner's. */
export function seatsOf(play: Pick<Play, 'roster' | 'heroCode' | 'aspects'>): Seat[] {
  const roster: readonly PlayHero[] =
    play.roster.length > 0 ? play.roster : [{ code: play.heroCode, name: '', aspect: play.aspects, isOwner: true }];
  const flagged = roster.findIndex((seat) => seat.isOwner === true);
  const owner = flagged < 0 ? 0 : flagged;
  return roster.map((seat, i) => ({ heroCode: seat.code, aspects: aspectSet(seat.aspect), isOwner: i === owner }));
}

/** A play as a fact, or null for a tombstone. */
export function factOf(
  play: Play,
  resolveCampaign: (play: Pick<Play, 'scenarioCode' | 'campaignRunId'>) => string | null,
): PlayFact | null {
  if (play.deletedAt !== null && play.deletedAt !== undefined) {
    return null;
  }
  const seats = seatsOf(play);
  const players = typeof play.players === 'number' && Number.isFinite(play.players)
    ? Math.max(1, Math.min(4, Math.round(play.players)))
    : seats.length;
  return {
    id: play.id,
    playedAt: play.playedAt,
    scenarioKey: scenarioKeyOf(play, resolveCampaign),
    level: levelOf(play.difficulty),
    won: play.won === true,
    players,
    seats,
    campaignRunId: play.campaignRunId ?? null,
    mode: typeof play.mode === 'string' && PLAY_MODES.includes(play.mode) ? play.mode : null,
  };
}

/** A run as a fact; `state` is the engine's fold of its log, or null when unreadable. */
export function runFactOf(
  run: Pick<CampaignRun, 'id' | 'templateId' | 'difficulty' | 'finished'>,
  state: Pick<CampaignState, 'campaignLost'> | null,
): RunFact {
  return {
    id: run.id,
    templateId: run.templateId,
    level: levelOf(run.difficulty),
    finished: run.finished,
    lost: state?.campaignLost === true,
  };
}
