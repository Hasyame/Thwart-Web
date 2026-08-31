import Dexie, { type Table } from 'dexie';
import type {
  BackupSettings,
  CampaignEvent,
  CampaignRun,
  ExcludedModularSet,
  ExcludedScenario,
  FavouriteCard,
  OwnedPack,
  PausedGame,
  Play,
  RandomizerHistoryRow,
  SavedDeck,
} from './records';

/**
 * The anonymous user's database.
 *
 * IndexedDB, not cookies and not `localStorage`. A cookie is four kilobytes and
 * is sent to a server on every request, which is wrong twice over for data that
 * should never leave the machine. `localStorage` is synchronous, string-only
 * and capped around five megabytes. IndexedDB is a real database: megabytes of
 * room, indexed queries, transactions, and it survives closing the browser.
 *
 * So an anonymous visitor gets durable data, exactly as the Android app does
 * with no account. That is the whole point — offline-first is the rule on both
 * sides, and an account is opt-in. Nothing here talks to a server.
 *
 * **Every table in the app's backup bundle is declared, including the ones this
 * app cannot yet display.** Decks, plays and campaigns are later phases, but a
 * backup imported from a phone must round-trip without loss: storing rows we
 * cannot draw is cheap, and quietly dropping somebody's play history because
 * the statistics screen does not exist yet would be unforgivable.
 */
/** The single settings row, with the constant key it is stored under. */
export interface StoredSettings extends BackupSettings {
  readonly id: typeof SETTINGS_KEY;
}

export const SETTINGS_KEY = 'app';

class ThwartDatabase extends Dexie {
  // Written by this version.
  ownedPacks!: Table<OwnedPack, string>;
  excludedModularSets!: Table<ExcludedModularSet, string>;
  excludedScenarios!: Table<ExcludedScenario, string>;
  favouriteCards!: Table<FavouriteCard, string>;

  // Carried, not yet written. See the class comment.
  decks!: Table<SavedDeck, string>;
  plays!: Table<Play, string>;
  campaignRuns!: Table<CampaignRun, string>;
  campaignEvents!: Table<CampaignEvent, string>;
  randomizerHistory!: Table<RandomizerHistoryRow, string>;
  // One row, keyed by a constant. The app's settings are carried through this
  // site without being applied to it.
  appSettings!: Table<StoredSettings, string>;
  /** At most one row. See the PausedGame comment for why. */
  pausedGames!: Table<PausedGame, string>;

  constructor() {
    super('thwart');

    // The primary keys are the app's own: natural codes where the app uses a
    // natural code, and its client-generated UUIDs everywhere else. Doc 01 §3
    // found no auto-increment key anywhere in the schema, which is what lets
    // the two stores share identifiers rather than needing a mapping table.
    this.version(1).stores({
      ownedPacks: 'packCode',
      excludedModularSets: 'setCode',
      excludedScenarios: 'scenarioCode',
      favouriteCards: 'cardCode, addedAt',
      decks: 'id, heroCode',
      plays: 'id, playedAt, heroCode, scenarioCode, campaignRunId',
      campaignRuns: 'id, createdAt',
      campaignEvents: 'id, runId, timestamp',
      randomizerHistory: 'id, createdAt',
    });

    // v2 adds the app's own settings, which backups started carrying in 1.39.0.
    // A new store rather than a changed one, so no existing row is touched.
    this.version(2).stores({
      appSettings: 'id',
    });

    // v3 adds the game put away mid-play. Not in the backup and never synced:
    // a game in progress describes the table in front of one person.
    this.version(3).stores({
      pausedGames: 'id, savedAt',
    });
  }
}

export const db = new ThwartDatabase();

/**
 * Whether IndexedDB is usable at all.
 *
 * A private window, storage blocked by policy, or a browser in a state it will
 * not explain can all make this fail. The site still has to work — the card
 * browser needs no storage whatsoever — so this is asked once and the
 * collection screen says something honest rather than throwing.
 */
export async function storageAvailable(): Promise<boolean> {
  try {
    await db.open();
    return true;
  } catch {
    return false;
  }
}

// --- collection ------------------------------------------------------------

export async function setPackQuantity(
  packCode: string,
  quantity: number,
): Promise<void> {
  if (quantity <= 0) {
    // Not owning a pack is the absence of a row, matching the app: its
    // OwnedPackDao deletes rather than storing a zero. When sync arrives this
    // becomes a tombstone, but the shape of the data does not change.
    await db.ownedPacks.delete(packCode);
    return;
  }
  await db.ownedPacks.put({ packCode, quantity });
}

export async function setModularSetExcluded(
  setCode: string,
  excluded: boolean,
): Promise<void> {
  if (excluded) {
    await db.excludedModularSets.put({ setCode });
  } else {
    await db.excludedModularSets.delete(setCode);
  }
}

export async function setScenarioExcluded(
  scenarioCode: string,
  excluded: boolean,
): Promise<void> {
  if (excluded) {
    await db.excludedScenarios.put({ scenarioCode });
  } else {
    await db.excludedScenarios.delete(scenarioCode);
  }
}

// --- favourites ------------------------------------------------------------

export async function toggleFavourite(cardCode: string): Promise<boolean> {
  const existing = await db.favouriteCards.get(cardCode);
  if (existing === undefined) {
    await db.favouriteCards.put({ cardCode, addedAt: Date.now() });
    return true;
  }
  await db.favouriteCards.delete(cardCode);
  return false;
}

// --- wholesale -------------------------------------------------------------

/** Every table, in one place, so import and erase cannot forget one. */
export const ALL_TABLES = [
  'ownedPacks',
  'excludedModularSets',
  'excludedScenarios',
  'favouriteCards',
  'decks',
  'plays',
  'campaignRuns',
  'campaignEvents',
  'randomizerHistory',
] as const;

export async function clearEverything(): Promise<void> {
  await db.transaction('rw', db.tables, async () => {
    await Promise.all(db.tables.map((table) => table.clear()));
  });
}
