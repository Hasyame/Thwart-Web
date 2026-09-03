import type { Table } from 'dexie';
import { db } from '../db';
import type {
  CampaignEvent,
  CampaignRun,
  ExcludedModularSet,
  ExcludedScenario,
  FavouriteCard,
  OwnedPack,
  Play,
  RandomizerHistoryRow,
  SavedDeck,
} from '../records';

/**
 * Which local table is which sync collection, and what a row looks like on the
 * wire.
 *
 * **The collection names are the Android app's**, from `SyncCollection` in
 * `SyncStateEntity.kt`. They are the contract between the two clients: the
 * server stores whatever key it is given and never parses a body, so a name
 * spelled differently here would not fail — it would quietly create a second
 * set of records that the phone never sees.
 *
 * Two local tables are deliberately absent:
 *
 *   `appSettings` — the Android app does not sync it either. Its enum has nine
 *   collections and settings is not one of them, so syncing it here would push
 *   rows no other client reads.
 *
 *   `pausedGames` — a game put down mid-play describes the table in front of
 *   one person. Doc 01 keeps it out of sync for exactly that reason, and a
 *   second device pulling somebody else's half-finished board would be worse
 *   than useless.
 */

export type CollectionName =
  | 'owned_packs'
  | 'excluded_modular_sets'
  | 'excluded_scenarios'
  | 'favourite_cards'
  | 'saved_decks'
  | 'campaign_runs'
  | 'campaign_events'
  | 'plays'
  | 'randomizer_history';

/** A local row, as it travels. */
export interface Mapping<Row> {
  readonly name: CollectionName;
  /** The Dexie table it lives in. */
  readonly table: () => Table<Row, string>;
  /** The record id: a UUID, or a natural key like a pack code. */
  readonly idOf: (row: Row) => string;
  /**
   * The body the server stores.
   *
   * Everything the row holds unless something is deliberately left out, and
   * the reasons for leaving something out are written beside it.
   */
  readonly bodyOf: (row: Row) => Record<string, unknown>;
  /** Turns a pulled body back into a row. */
  readonly rowOf: (id: string, body: Record<string, unknown>) => Row;
  /**
   * When the row last changed, as an ISO string.
   *
   * Only ever used to display "edited 2 hours ago" and to break ties during
   * first-sign-in adoption. The server orders by revision and never by this:
   * device clocks lie, and a phone a day fast would win every conflict.
   */
  readonly updatedAt: (row: Row) => string;
  /**
   * True when this collection is append-only.
   *
   * Only `campaign_events` is. Its ids are generated once and never reused, so
   * the same event pushed twice is the same row, undo is an appended
   * revocation, and a conflict is not resolved so much as impossible.
   */
  readonly appendOnly?: boolean;
}

const iso = (millis: number | null | undefined): string =>
  new Date(typeof millis === 'number' && Number.isFinite(millis) ? millis : 0).toISOString();

/** Everything on the row, which is the default and needs no argument. */
const whole = <Row extends object>(row: Row): Record<string, unknown> => ({
  ...(row as Record<string, unknown>),
});

export const OWNED_PACKS: Mapping<OwnedPack> = {
  name: 'owned_packs',
  table: () => db.ownedPacks,
  idOf: (row) => row.packCode,
  bodyOf: whole,
  rowOf: (id, body) => ({ packCode: id, quantity: Number(body.quantity ?? 1) }),
  updatedAt: () => new Date(0).toISOString(),
};

export const EXCLUDED_MODULAR_SETS: Mapping<ExcludedModularSet> = {
  name: 'excluded_modular_sets',
  table: () => db.excludedModularSets,
  idOf: (row) => row.setCode,
  bodyOf: whole,
  rowOf: (id) => ({ setCode: id }),
  updatedAt: () => new Date(0).toISOString(),
};

export const EXCLUDED_SCENARIOS: Mapping<ExcludedScenario> = {
  name: 'excluded_scenarios',
  table: () => db.excludedScenarios,
  idOf: (row) => row.scenarioCode,
  bodyOf: whole,
  rowOf: (id) => ({ scenarioCode: id }),
  updatedAt: () => new Date(0).toISOString(),
};

export const FAVOURITE_CARDS: Mapping<FavouriteCard> = {
  name: 'favourite_cards',
  table: () => db.favouriteCards,
  idOf: (row) => row.cardCode,
  bodyOf: whole,
  rowOf: (id, body) => ({ cardCode: id, addedAt: Number(body.addedAt ?? 0) }),
  updatedAt: (row) => iso(row.addedAt),
};

export const SAVED_DECKS: Mapping<SavedDeck> = {
  name: 'saved_decks',
  table: () => db.decks,
  idOf: (row) => row.id,
  bodyOf: whole,
  rowOf: (id, body) => ({ ...(body as unknown as SavedDeck), id }),
  updatedAt: (row) => iso(row.lastSyncedAt),
};

export const CAMPAIGN_RUNS: Mapping<CampaignRun> = {
  name: 'campaign_runs',
  table: () => db.campaignRuns,
  idOf: (row) => row.id,
  /*
   * The three timer columns are left out of the body entirely.
   *
   * A running clock is a fact about the device in front of somebody, not about
   * the campaign: syncing it would have a phone pull a `timerRunningSince` from
   * a tablet that is mid-game and start counting a session nobody is playing.
   * Doc 01 §2.5 excludes them, and doc 02 §4 repeats it.
   */
  bodyOf: ({ timerAccumulatedMillis: _a, timerRunningSince: _b, timerScenarioId: _c, ...rest }) =>
    rest,
  rowOf: (id, body) => ({
    ...(body as unknown as CampaignRun),
    id,
    // A run arriving from elsewhere has no clock here yet.
    timerAccumulatedMillis: 0,
    timerRunningSince: null,
    timerScenarioId: null,
  }),
  updatedAt: (row) => iso(row.createdAt),
};

export const CAMPAIGN_EVENTS: Mapping<CampaignEvent> = {
  name: 'campaign_events',
  table: () => db.campaignEvents,
  idOf: (row) => row.id,
  bodyOf: whole,
  rowOf: (id, body) => ({ ...(body as unknown as CampaignEvent), id }),
  updatedAt: (row) => iso(row.timestamp),
  // Written once, never rewritten, never deleted. Union merge, and its own
  // timestamp is the only time it has.
  appendOnly: true,
};

export const PLAYS: Mapping<Play> = {
  name: 'plays',
  table: () => db.plays,
  idOf: (row) => row.id,
  bodyOf: whole,
  rowOf: (id, body) => ({ ...(body as unknown as Play), id }),
  updatedAt: (row) => iso(row.playedAt),
};

export const RANDOMIZER_HISTORY: Mapping<RandomizerHistoryRow> = {
  name: 'randomizer_history',
  table: () => db.randomizerHistory,
  idOf: (row) => row.id,
  bodyOf: whole,
  rowOf: (id, body) => ({ ...(body as unknown as RandomizerHistoryRow), id }),
  updatedAt: (row) => iso(row.createdAt),
};

/**
 * Every collection, in the order a first sync should apply them.
 *
 * Runs before their events, so a campaign never exists as a pile of events
 * belonging to nothing — which is only cosmetic while a sync is in flight, but
 * a screen can render mid-way through one.
 */
export const COLLECTIONS = [
  OWNED_PACKS,
  EXCLUDED_MODULAR_SETS,
  EXCLUDED_SCENARIOS,
  FAVOURITE_CARDS,
  SAVED_DECKS,
  CAMPAIGN_RUNS,
  CAMPAIGN_EVENTS,
  PLAYS,
  RANDOMIZER_HISTORY,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- one list of
  // differently-typed mappings; each is used only through its own row type.
] as unknown as readonly Mapping<any>[];

export const collectionByName = (name: string): Mapping<unknown> | undefined =>
  (COLLECTIONS as readonly Mapping<unknown>[]).find((mapping) => mapping.name === name);
