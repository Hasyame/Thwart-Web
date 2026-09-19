import type { Table } from 'dexie';
import { db, SETTINGS_KEY, type StoredSettings } from '../db';
import { completePlay, playWire } from '../playShape';
import type {
  CampaignEvent,
  CampaignRun,
  DeckFolder,
  ExcludedModularSet,
  ExcludedScenario,
  FavouriteCard,
  FavouritePlay,
  OwnedPack,
  Play,
  RandomizerHistoryRow,
  Rating,
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
 * appSettings travels as the five-key `settings` record defined in doc 02.
 * Device-only preferences are kept outside that record.
 *
 *   `pausedGames` — a game put down mid-play describes the table in front of
 *   one person. Doc 01 keeps it out of sync for exactly that reason, and a
 *   second device pulling somebody else's half-finished board would be worse
 *   than useless.
 */

export type CollectionName =
  | 'settings'
  | 'owned_packs'
  | 'excluded_modular_sets'
  | 'excluded_scenarios'
  | 'favourite_cards'
  | 'favourite_plays'
  | 'deck_folders'
  | 'ratings'
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

/**
 * Starred games. The same shape as favourite cards, keyed by the play.
 *
 * The phone does not know this collection yet. What it does with a record it
 * cannot name is defer it and hold its cursor short of it — its own comment
 * says so — so the star is kept safe on the server, and reaches the phone the
 * moment a build that knows the name pulls. Until then the phone re-pulls from
 * that point each sync, which at these sizes is a few kilobytes.
 */
export const FAVOURITE_PLAYS: Mapping<FavouritePlay> = {
  name: 'favourite_plays',
  table: () => db.favouritePlays,
  idOf: (row) => row.playId,
  bodyOf: whole,
  rowOf: (id, body) => ({ playId: id, addedAt: Number(body.addedAt ?? 0) }),
  updatedAt: (row) => iso(row.addedAt),
};

/**
 * Difficulty ratings. The id is the subject key, and the server checks each
 * one against the play or run its body cites before storing it; the ports
 * drop a record the server answers `rejected` for. `updatedAt` is `ratedAt`,
 * which is also what the merge compares.
 */
/** Folders on the shelf of decks. Whole records; the later `updatedAt` wins. */
export const DECK_FOLDERS: Mapping<DeckFolder> = {
  name: 'deck_folders',
  table: () => db.deckFolders,
  idOf: (row) => row.id,
  bodyOf: whole,
  rowOf: (id, body) => ({ ...(body as unknown as DeckFolder), id }),
  updatedAt: (row) => iso(row.updatedAt),
};

export const RATINGS: Mapping<Rating> = {
  name: 'ratings',
  table: () => db.ratings,
  idOf: (row) => row.subject,
  bodyOf: whole,
  rowOf: (id, body) => ({ ...(body as unknown as Rating), subject: id }),
  updatedAt: (row) => iso(row.ratedAt),
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
  // The known fields and every unknown one this client carried, put back:
  // a device one release behind must not strip what a newer one recorded.
  bodyOf: (row) => playWire(row),
  /*
    Filled in, not spread.

    Android's kotlinx omits every property equal to its default as well as
    every null, so a body arrives missing most of PlayEntity's optional fields.
    Spreading that produced rows whose type said "complete" and whose data was
    not: `roster` was absent and iterating it threw inside the statistics,
    which blanked the page. See lib/playShape.ts.
  */
  rowOf: (id, body) => completePlay(body, id),
  /*
    When the row changed, not when the game was played.

    These are different questions and only one of them breaks a merge: editing
    a game recorded last month must not claim to be a month old, or the older
    copy on another device wins the tie. Falls back to `playedAt` for a row
    written before the column existed, which is what the migration uses too.
  */
  updatedAt: (row) => iso(row.updatedAt > 0 ? row.updatedAt : row.playedAt),
};

/**
 * The app's own preferences, as one record called `app`.
 *
 * The tenth collection, and the one this client did not have. Doc 06 said the
 * web was implementing it and the web was not: Android syncs it, the server has
 * always stored it, and the effect of the gap was the quiet one the contract
 * warns about — a setting changed on the phone and never arriving here, with
 * nothing anywhere reporting a problem.
 *
 * `lastCardSync` is deliberately not in the body, on either platform. It says
 * when *this* device last fetched from MarvelCDB, which is not a preference and
 * is wrong on any other device the moment it arrives.
 */
export const SETTINGS: Mapping<StoredSettings> = {
  name: 'settings',
  table: () => db.appSettings,
  // Literally `app`. One record per account, and the id is a constant rather
  // than a generated one so that two devices write the same record instead of
  // one each.
  idOf: () => SETTINGS_KEY,
  bodyOf: (row) => ({
    cardLocale: row.cardLocale,
    themeChoice: row.themeChoice,
    playLocation: row.playLocation,
    trackEncounter: row.trackEncounter,
    dismissedPacks: [...row.dismissedPacks],
  }),
  rowOf: (_id, body) => ({
    id: SETTINGS_KEY,
    cardLocale: typeof body.cardLocale === 'string' ? body.cardLocale : '',
    themeChoice: typeof body.themeChoice === 'string' ? body.themeChoice : '',
    playLocation: typeof body.playLocation === 'string' ? body.playLocation : '',
    trackEncounter: body.trackEncounter === true,
    dismissedPacks: Array.isArray(body.dismissedPacks)
      ? body.dismissedPacks.filter((entry): entry is string => typeof entry === 'string')
      : [],
  }),
  // No timestamp on the row, and inventing one from the clock would make every
  // scan look like an edit. Change detection is by digest here, as everywhere.
  updatedAt: () => new Date(0).toISOString(),
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
  SETTINGS,
  OWNED_PACKS,
  EXCLUDED_MODULAR_SETS,
  EXCLUDED_SCENARIOS,
  FAVOURITE_CARDS,
  FAVOURITE_PLAYS,
  SAVED_DECKS,
  DECK_FOLDERS,
  CAMPAIGN_RUNS,
  CAMPAIGN_EVENTS,
  PLAYS,
  RANDOMIZER_HISTORY,
  /*
   * Last, and the order is load-bearing: this list is the order records are
   * read and pushed in, and the server checks a rating against the play or
   * run it cites *as the server holds it* — pushed earlier, or earlier in the
   * same batch. Listed before PLAYS, every rating in a first sync was refused
   * as not_played and dropped, the two honest ones with the one that was not.
   * Driving a first sync in a browser is what caught it.
   */
  RATINGS,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- one list of
  // differently-typed mappings; each is used only through its own row type.
] as unknown as readonly Mapping<any>[];

export const collectionByName = (name: string): Mapping<unknown> | undefined =>
  (COLLECTIONS as readonly Mapping<unknown>[]).find((mapping) => mapping.name === name);
