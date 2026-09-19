import Dexie, { type Table } from 'dexie';
import type { BackupPhoto } from './backupArchive';
import { completePlay } from './playShape';
import type { DraftState } from './draft/types';
import type {
  BackupSettings,
  CampaignEvent,
  CampaignRun,
  DeckFolder,
  ExcludedModularSet,
  ExcludedScenario,
  FavouriteCard,
  FavouritePlay,
  OwnedPack,
  PausedGame,
  Play,
  RandomizerHistoryRow,
  Rating,
  SavedDeck,
} from './records';
import type { StoredSyncState, SyncRecordState } from './sync/state';

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

/** Opaque backup fields stay device-local, outside the account sync contract. */
export interface BackupMetadata {
  readonly id: typeof SETTINGS_KEY;
  readonly extra: Record<string, unknown>;
  readonly settingsExtra: Record<string, unknown>;
}

/** The draft in progress, as lib/draft/types writes it. */
export interface DraftRow {
  readonly id: string;
  readonly state: DraftState;
  readonly updatedAt: number;
}

class ThwartDatabase extends Dexie {
  // Written by this version.
  ownedPacks!: Table<OwnedPack, string>;
  excludedModularSets!: Table<ExcludedModularSet, string>;
  excludedScenarios!: Table<ExcludedScenario, string>;
  favouriteCards!: Table<FavouriteCard, string>;
  favouritePlays!: Table<FavouritePlay, string>;
  deckFolders!: Table<DeckFolder, string>;
  /**
   * The draft in progress, one row. This device's table session: never
   * synced, never in a backup, not in ALL_TABLES -- erasing the collection
   * clears it separately, since a draft without its shelf is nothing.
   */
  drafts!: Table<DraftRow, string>;
  ratings!: Table<Rating, string>;

  // Carried, not yet written. See the class comment.
  decks!: Table<SavedDeck, string>;
  plays!: Table<Play, string>;
  campaignRuns!: Table<CampaignRun, string>;
  campaignEvents!: Table<CampaignEvent, string>;
  randomizerHistory!: Table<RandomizerHistoryRow, string>;
  // One row, keyed by a constant. The app's settings are carried through this
  // site without being applied to it.
  appSettings!: Table<StoredSettings, string>;
  backupMetadata!: Table<BackupMetadata, string>;
  /** Local photo bytes, never included in account sync. */
  photos!: Table<BackupPhoto, string>;
  /** At most one row. See the PausedGame comment for why. */
  pausedGames!: Table<PausedGame, string>;

  /**
   * What this browser knows about each record the server has seen.
   *
   * Keyed `[collection+id]`, holding the revision the server gave it and a
   * digest of the body that was sent. Comparing that digest with the row as it
   * stands now is how a change is noticed: there is no dirty flag to set, so
   * there is no write anywhere in the app that can forget to set one.
   */
  syncRecords!: Table<SyncRecordState, [string, string]>;

  /** One row: who is signed in on this browser, and how far it has read. */
  syncState!: Table<StoredSyncState, string>;

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

    // v4 adds what sync needs to know, and nothing the app itself reads. Both
    // stores are new, so no existing row is touched and a browser that never
    // signs in carries two empty tables.
    this.version(4).stores({
      syncRecords: '[collection+id], collection',
      syncState: 'id',
    });

    /*
      v5: a play knows when it changed and whether it was deleted.

      `deletedAt` is indexed because every list and every count filters on it,
      and a heavy history is thousands of rows: a full scan to hide three
      deleted games is a scan too many. `[deletedAt+playedAt]` is the compound
      the history page reads — live rows, newest first — so the page can be
      served from the index rather than sorted in memory.

      The existing rows are migrated rather than left undefined. A play written
      before this had neither field, and `undefined` sorts outside an index in
      IndexedDB: those rows would simply not appear in a query that filters on
      `deletedAt`, which is every query there now is. `playedAt` stands in for
      `updatedAt` because it is the only timestamp such a row has.
    */
    this.version(5)
      .stores({
        plays: 'id, playedAt, heroCode, scenarioCode, campaignRunId, deletedAt, [deletedAt+playedAt]',
      })
      .upgrade((tx) =>
        tx
          .table('plays')
          .toCollection()
          .modify((play) => {
            if (typeof play.updatedAt !== 'number') {
              play.updatedAt = typeof play.playedAt === 'number' ? play.playedAt : 0;
            }
            if (play.deletedAt === undefined) {
              play.deletedAt = null;
            }
            // The web-only flag this replaces. A game somebody set aside was
            // never a deleted game, so it comes back as an ordinary play
            // rather than being tombstoned on their behalf.
            delete play.ignored;
          }),
      );

    /*
      v6: repair the rows a synced body left half-written.

      v5 filled in `updatedAt` and `deletedAt` for rows this browser had
      written itself. It did not touch what sync had put there, and that is
      where the real damage was: Android's kotlinx omits every property equal
      to its default, so a play arriving from a phone was missing most of them.
      `roster` absent is the one that mattered — iterating it threw inside the
      statistics and left the page showing its loading line for ever.

      The fix is at the boundary now (lib/playShape.ts), so nothing new arrives
      broken. This is for what is already stored, on every device that has ever
      synced.
    */
    this.version(6).upgrade((tx) =>
      tx
        .table('plays')
        .toCollection()
        .modify((play) => {
          const complete = completePlay(play, play.id);
          for (const [key, value] of Object.entries(complete)) {
            play[key] = value;
          }
        }),
    );

    // v7: starred games. A new store and nothing else, so no existing row is
    // touched; keyed by the play so starring twice is one row.
    this.version(7).stores({
      favouritePlays: 'playId, addedAt',
    });

    // v8: difficulty ratings, keyed by subject.
    this.version(8).stores({
      ratings: 'subject, ratedAt',
    });

    // v9: folders on the shelf of decks.
    this.version(9).stores({
      deckFolders: 'id, updatedAt',
    });

    // v10: the draft in progress.
    this.version(10).stores({
      drafts: 'id',
    });

    // v11 preserves unknown backup envelope/settings fields without changing
    // existing rows or sending opaque imported data to an account.
    this.version(11).stores({
      backupMetadata: 'id',
    });
    this.version(12).stores({ photos: 'name' });
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

/** Stars a game, or takes the star off. Returns whether it is starred now. */
export async function toggleFavouritePlay(playId: string): Promise<boolean> {
  const existing = await db.favouritePlays.get(playId);
  if (existing === undefined) {
    await db.favouritePlays.put({ playId, addedAt: Date.now() });
    return true;
  }
  await db.favouritePlays.delete(playId);
  return false;
}

// --- wholesale -------------------------------------------------------------

/** Every table, in one place, so import and erase cannot forget one. */
export const ALL_TABLES = [
  'ownedPacks',
  'excludedModularSets',
  'excludedScenarios',
  'favouriteCards',
  'favouritePlays',
  'ratings',
  'deckFolders',
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
