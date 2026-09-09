import { db } from './db';
import type { Play } from './records';

/**
 * The one way to ask about recorded games.
 *
 * Both screens read through here: the history list and the statistics. The
 * brief that asked for them said it plainly — two code paths reading the same
 * records will drift — and there is a sharper reason than tidiness. Every query
 * has to exclude tombstoned plays, and a query that forgets shows deleted games
 * as though they had been played. One place that knows the rule is one place to
 * get it right.
 *
 * Nothing here aggregates. Statistics are computed from the rows this returns
 * (see plays.ts); the specification for what those figures mean lives in
 * `docs/spec/statistics.md` and is shared with the Android app.
 */

/** A play that happened and has not been deleted. */
export const isLive = (play: Play): boolean => play.deletedAt === null || play.deletedAt === undefined;

/**
 * What a history view is asking for.
 *
 * Every field is optional and an absent one means "no restriction". Filters are
 * applied in memory *after* the index has narrowed by date, because IndexedDB
 * can only use one index per query and `[deletedAt+playedAt]` is the one worth
 * using: it is the only one that both hides tombstones and orders by date.
 */
export interface PlayFilter {
  /** Inclusive, epoch millis. */
  readonly from?: number;
  /** Inclusive, epoch millis. */
  readonly to?: number;
  /**
   * Hero identifiers, matched against every seat of the game.
   *
   * A list rather than one code, because the same hero is spelled two ways in
   * the history: a play recorded now carries the card code, one recorded before
   * that carries the set code. Filtering on a single spelling silently hides
   * half of somebody's games with that hero.
   */
  readonly heroes?: readonly string[];
  /** A single aspect, matched against every seat and the play's own list. */
  readonly aspect?: string;
  readonly scenario?: string;
  readonly result?: 'won' | 'lost';
  /** A specific run, or `any` for "belonged to some campaign". */
  readonly campaign?: string | 'any' | 'none';
}

const EMPTY: PlayFilter = {};

const seatText = (play: Play): string =>
  play.roster.map((seat) => `${seat.code} ${seat.name} ${seat.aspect}`).join(' ');

/** Whether one play satisfies a filter. Pure, so it can be tested directly. */
export function matches(play: Play, filter: PlayFilter): boolean {
  if (!isLive(play)) {
    return false;
  }
  if (filter.from !== undefined && play.playedAt < filter.from) {
    return false;
  }
  if (filter.to !== undefined && play.playedAt > filter.to) {
    return false;
  }
  if (filter.result !== undefined && play.won !== (filter.result === 'won')) {
    return false;
  }
  if (filter.scenario !== undefined && play.scenarioCode !== filter.scenario) {
    return false;
  }
  if (filter.campaign !== undefined) {
    // `campaignRunId` is a campaign game whenever it is not null, empty string
    // included. docs/spec/statistics.md §2.7: the two clients must agree, and
    // Android's test is `IS NOT NULL` and nothing else.
    const inCampaign = play.campaignRunId !== null;
    if (filter.campaign === 'any' && !inCampaign) {
      return false;
    }
    if (filter.campaign === 'none' && inCampaign) {
      return false;
    }
    if (
      filter.campaign !== 'any' &&
      filter.campaign !== 'none' &&
      play.campaignRunId !== filter.campaign
    ) {
      return false;
    }
  }
  if (filter.heroes !== undefined && filter.heroes.length > 0) {
    const seats = play.roster.length > 0 ? play.roster.map((s) => s.code) : [play.heroCode];
    if (!seats.some((code) => filter.heroes?.includes(code))) {
      return false;
    }
  }
  if (filter.aspect !== undefined) {
    // Split on commas, because a seat may hold two: see the specification's
    // note on dual-aspect decks in §3.2.
    const listed = `${seatText(play)} ${play.aspects}`
      .split(/[\s,]+/)
      .map((word) => word.trim())
      .filter((word) => word !== '');
    if (!listed.includes(filter.aspect)) {
      return false;
    }
  }
  return true;
}

/**
 * One page of history, newest first.
 *
 * Paged rather than loaded whole. A heavy user has thousands of games, and the
 * page only ever shows a screenful: reading them all to render twenty is the
 * kind of thing that is invisible in testing and unusable in year three.
 *
 * The date range narrows through the index; everything else is a predicate over
 * what comes back. That means a very selective filter over a very long history
 * walks more rows than it returns, which is the trade IndexedDB offers — one
 * index per query — and is why `from`/`to` are the ones the index serves.
 */
export async function page(
  filter: PlayFilter = EMPTY,
  offset = 0,
  limit = 25,
): Promise<readonly Play[]> {
  const out: Play[] = [];
  let skipped = 0;

  await livePlays(filter).until(() => out.length >= limit).each((play) => {
    if (!matches(play, filter)) {
      return;
    }
    if (skipped < offset) {
      skipped += 1;
      return;
    }
    if (out.length < limit) {
      out.push(play);
    }
  });

  return out;
}

/** How many live plays match, for "showing 20 of 413". */
export async function count(filter: PlayFilter = EMPTY): Promise<number> {
  let total = 0;
  await livePlays(filter).each((play) => {
    if (matches(play, filter)) {
      total += 1;
    }
  });
  return total;
}

/**
 * Every matching play, for the statistics.
 *
 * Statistics are an aggregate over the whole history by definition, so this one
 * does read everything. It is the reason the aggregates are cached rather than
 * recomputed on every route change.
 */
export async function all(filter: PlayFilter = EMPTY): Promise<readonly Play[]> {
  const out: Play[] = [];
  await livePlays(filter).each((play) => {
    if (matches(play, filter)) {
      out.push(play);
    }
  });
  return out;
}

/**
 * The rows an index can hand over, newest first.
 *
 * `deletedAt` is `null` on a live play, and IndexedDB will not index `null`, so
 * the compound `[deletedAt+playedAt]` cannot be used to select live rows —
 * a null key is simply absent from the index. Ordering by `playedAt` and
 * filtering in the predicate is what is left, and it is why `isLive` is checked
 * inside `matches` rather than trusted to the store.
 */
function livePlays(filter: PlayFilter) {
  const table = db.plays.orderBy('playedAt');
  const bounded =
    filter.from !== undefined || filter.to !== undefined
      ? db.plays
          .where('playedAt')
          .between(filter.from ?? -Infinity, filter.to ?? Infinity, true, true)
          .reverse()
      : table.reverse();
  return bounded;
}
