import { db, SETTINGS_KEY } from './db';
import { safePhotoName, writeBackupArchive, writeBackupDocument, type BackupPhoto } from './backupArchive';
import { completePlay, playWire } from './playShape';
import {
  BACKUP_FORMAT_VERSION,
  type Backup,
  type BackupSettings,
  type CampaignEvent,
  type CampaignRun,
  type ExcludedModularSet,
  type ExcludedScenario,
  type FavouriteCard,
  type FavouritePlay,
  type DeckFolder,
  type Rating,
  type OwnedPack,
  type Play,
  type RandomizerHistoryRow,
  type SavedDeck,
} from './records';

/**
 * Reading and writing the app's backup bundle.
 *
 * Until there is a sync server, this file *is* the bridge between a phone and a
 * browser: the app already exports everything it holds, so the site imports
 * that and exports it back. It is the poor relation of sync — somebody has to
 * move the file themselves — but it is honest about what it is, needs no
 * server, and works today.
 *
 * It also keeps us honest. If the site can round-trip a real backup from a real
 * phone, its record shapes are right by demonstration rather than by intention,
 * which is exactly the discipline doc 04 asks for.
 */

export interface ImportSummary {
  readonly ownedPacks: number;
  readonly excludedModularSets: number;
  readonly excludedScenarios: number;
  readonly favouriteCards: number;
  readonly decks: number;
  readonly plays: number;
  readonly campaignRuns: number;
  readonly campaignEvents: number;
  readonly randomizerHistory: number;
  /** Photographs named in the document; archive bytes are supplied separately. */
  readonly photos: number;
}

export type ImportMode = 'merge' | 'replace';

export class BackupError extends Error {}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

const BACKUP_KEYS = new Set([
  'formatVersion', 'createdAt', 'appVersion', 'ownedPacks', 'excludedModularSets',
  'excludedScenarios', 'decks', 'campaignRuns', 'campaignEvents', 'plays',
  'randomizerHistory', 'favouriteCards', 'favouritePlays', 'ratings', 'deckFolders',
  'photos', 'settings',
]);
const SETTINGS_KEYS = new Set([
  'cardLocale', 'themeChoice', 'playLocation', 'trackEncounter', 'dismissedPacks',
]);

function unknownFields(record: object, known: ReadonlySet<string>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(record).filter(([key]) => !known.has(key)));
}

/**
 * Parses a backup file.
 *
 * Deliberately forgiving about missing collections and strict about the two
 * things that say this is a backup at all. A file that is merely *newer* than
 * us must still import — the app's own format convention is that unknown keys
 * are ignored rather than treated as an error, and refusing a file because it
 * has a field we have not heard of would be worse than useless.
 */
export function parseBackup(text: string): Backup {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new BackupError('not-json');
  }

  if (raw === null || typeof raw !== 'object') {
    throw new BackupError('not-a-backup');
  }
  const record = raw as Record<string, unknown>;

  const formatVersion = record['formatVersion'];
  if (typeof formatVersion !== 'number') {
    throw new BackupError('not-a-backup');
  }
  if (formatVersion > BACKUP_FORMAT_VERSION) {
    // Readable: the convention says so, and the fields this build does not
    // know are kept on each record and written back on export. Said out
    // loud all the same, so a file from a much newer app is not a surprise.
    console.warn(
      `Backup format ${formatVersion} is newer than ${BACKUP_FORMAT_VERSION}; unknown fields are kept, not read.`,
    );
  }

  return {
    ...record,
    formatVersion,
    createdAt: typeof record['createdAt'] === 'number' ? record['createdAt'] : 0,
    appVersion: typeof record['appVersion'] === 'string' ? record['appVersion'] : '',
    ownedPacks: asArray<OwnedPack>(record['ownedPacks']),
    excludedModularSets: asArray<ExcludedModularSet>(record['excludedModularSets']),
    excludedScenarios: asArray<ExcludedScenario>(record['excludedScenarios']),
    decks: asArray<SavedDeck>(record['decks']),
    campaignRuns: asArray<CampaignRun>(record['campaignRuns']),
    campaignEvents: asArray<CampaignEvent>(record['campaignEvents']),
    plays: asArray<Play>(record['plays']),
    randomizerHistory: asArray<RandomizerHistoryRow>(record['randomizerHistory']),
    favouriteCards: asArray<FavouriteCard>(record['favouriteCards']),
    // Older clients omit this collection.
    favouritePlays: asArray<FavouritePlay>(record['favouritePlays']),
    ratings: asArray<Rating>(record['ratings']),
    deckFolders: asArray<DeckFolder>(record['deckFolders']),
    photos: asArray<string>(record['photos']),
    settings: asSettings(record['settings']),
  };
}

/**
 * Reads the app's settings block, or null.
 *
 * Null and absent mean the same thing here and both mean "this file carries
 * none", which is not the same as "these are the defaults": the app leaves the
 * device alone in the first case and would overwrite it in the second.
 */
function asSettings(value: unknown): BackupSettings | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  return {
    ...record,
    cardLocale: typeof record['cardLocale'] === 'string' ? record['cardLocale'] : '',
    themeChoice: typeof record['themeChoice'] === 'string' ? record['themeChoice'] : '',
    playLocation: typeof record['playLocation'] === 'string' ? record['playLocation'] : '',
    trackEncounter: record['trackEncounter'] === true,
    dismissedPacks: Array.isArray(record['dismissedPacks'])
      ? record['dismissedPacks'].filter((entry): entry is string => typeof entry === 'string')
      : [],
  };
}

export function summarise(backup: Backup): ImportSummary {
  return {
    ownedPacks: backup.ownedPacks.length,
    excludedModularSets: backup.excludedModularSets.length,
    excludedScenarios: backup.excludedScenarios?.length ?? 0,
    favouriteCards: backup.favouriteCards.length,
    decks: backup.decks.length,
    plays: backup.plays.length,
    campaignRuns: backup.campaignRuns.length,
    campaignEvents: backup.campaignEvents.length,
    randomizerHistory: backup.randomizerHistory.length,
    photos: backup.photos.length,
  };
}

/**
 * Writes a parsed backup into the local database, in one transaction.
 *
 * `merge` keeps what is already here and lets the incoming file win on a
 * collision — `bulkPut` is keyed on the app's own identifiers, so importing the
 * same file twice is a no-op rather than a duplication. That idempotence is not
 * incidental: it is the property that makes this safe to press twice, and it is
 * the same property the sync protocol will rely on later.
 *
 * `replace` empties the tables first. Offered because "restore this backup over
 * whatever is here" is a thing people legitimately want, but never the default.
 *
 * **The backup passed in must be plain data, not reactive state.** IndexedDB
 * writes through the structured clone algorithm, which throws `DataCloneError`
 * on a Proxy — and Svelte 5 deep-proxies anything held in `$state`. Callers
 * hold parsed backups in `$state.raw` for this reason.
 */
export async function importBackup(
  backup: Backup,
  mode: ImportMode,
  photos: readonly BackupPhoto[] = [],
): Promise<ImportSummary> {
  await db.transaction('rw', db.tables, async () => {
    if (mode === 'replace') {
      await Promise.all(db.tables.map((table) => table.clear()));
    }

    const metadata = await db.backupMetadata.get(SETTINGS_KEY);
    await db.backupMetadata.put({
      id: SETTINGS_KEY,
      extra: { ...metadata?.extra, ...unknownFields(backup, BACKUP_KEYS) },
      settingsExtra: {
        ...metadata?.settingsExtra,
        ...(backup.settings == null ? {} : unknownFields(backup.settings, SETTINGS_KEYS)),
      },
    });

    const declared = new Set(backup.photos);
    await db.photos.bulkPut(photos.filter(photo => safePhotoName(photo.name) && declared.has(photo.name)));

    await db.ownedPacks.bulkPut([...backup.ownedPacks]);
    await db.excludedModularSets.bulkPut([...backup.excludedModularSets]);
    await db.excludedScenarios.bulkPut([...(backup.excludedScenarios ?? [])]);
    await db.favouriteCards.bulkPut([...backup.favouriteCards]);
    await db.favouritePlays.bulkPut([...(backup.favouritePlays ?? [])]);
    await db.ratings.bulkPut([...(backup.ratings ?? [])]);
    await db.deckFolders.bulkPut([...(backup.deckFolders ?? [])]);
    await db.decks.bulkPut([...backup.decks]);
    // Completed the same way a synced body is: a backup written by the phone
    // has the same fields missing, for the same reason.
    await db.plays.bulkPut(backup.plays.map((play) => completePlay(play, play.id)));
    await db.campaignRuns.bulkPut([...backup.campaignRuns]);
    await db.campaignEvents.bulkPut([...backup.campaignEvents]);
    await db.randomizerHistory.bulkPut([...backup.randomizerHistory]);

    // Stored, never applied. These are the phone's preferences; this site has
    // its own, and adopting somebody's Android theme because they imported a
    // backup would be a surprise. Keeping them is what makes a phone to phone
    // round trip through here lossless.
    if (backup.settings != null) {
      const { cardLocale, themeChoice, playLocation, trackEncounter, dismissedPacks } = backup.settings;
      await db.appSettings.put({ id: SETTINGS_KEY, cardLocale, themeChoice, playLocation, trackEncounter, dismissedPacks });
    }
  });

  return summarise(backup);
}

/**
 * Builds a bundle the Android app can restore.
 *
 * `appVersion` says where the file came from, because the app's own comment
 * says the field exists so a confusing restore can be traced — and "the web
 * app" is exactly the sort of provenance worth being able to see.
 *
 * Only locally available photos are listed. Play references remain intact when
 * the source backup or sync supplied no corresponding file.
 */
export async function exportBackup(): Promise<Backup> {
  const [
    ownedPacks,
    excludedModularSets,
    excludedScenarios,
    favouriteCards,
    favouritePlays,
    ratings,
    deckFolders,
    decks,
    plays,
    campaignRuns,
    campaignEvents,
    randomizerHistory,
    storedSettings,
    metadata,
    photos,
  ] = await Promise.all([
    db.ownedPacks.toArray(),
    db.excludedModularSets.toArray(),
    db.excludedScenarios.toArray(),
    db.favouriteCards.toArray(),
    db.favouritePlays.toArray(),
    db.ratings.toArray(),
    db.deckFolders.toArray(),
    db.decks.toArray(),
    db.plays.toArray(),
    db.campaignRuns.toArray(),
    db.campaignEvents.toArray(),
    db.randomizerHistory.toArray(),
    db.appSettings.get(SETTINGS_KEY),
    db.backupMetadata.get(SETTINGS_KEY),
    db.photos.toCollection().primaryKeys(),
  ]);

  return {
    ...metadata?.extra,
    formatVersion: BACKUP_FORMAT_VERSION,
    createdAt: Date.now(),
    appVersion: `web ${__APP_VERSION__}`,
    ownedPacks,
    excludedModularSets,
    excludedScenarios,
    decks,
    campaignRuns,
    campaignEvents,
    // On the wire shape: the unknown fields a play carried go back beside
    // the known ones, so a file round-trips through this build whole.
    plays: plays.map((play) => playWire(play) as unknown as Play),
    randomizerHistory,
    favouriteCards,
    favouritePlays,
    ratings,
    deckFolders,
    // Null when this browser has never been handed any, which the app reads as
    // "leave the device's own settings alone". Emitting an empty object instead
    // would tell it to reset them to the defaults.
    settings:
      storedSettings === undefined
        ? null
        : {
            ...metadata?.settingsExtra,
            cardLocale: storedSettings.cardLocale,
            themeChoice: storedSettings.themeChoice,
            playLocation: storedSettings.playLocation,
            trackEncounter: storedSettings.trackEncounter,
            dismissedPacks: storedSettings.dismissedPacks,
          },
    photos,
  };
}

/** Offers the bundle as a download, named the way the app names its own. */
export async function backupDownload(): Promise<{ backup: Backup; blob: Blob; extension: string }> {
  const snapshot = await db.transaction('r', db.tables, async () => ({
    backup: await exportBackup(), photos: await db.photos.toArray(),
  }));
  const document = JSON.stringify(snapshot.backup);
  return { backup: snapshot.backup,
    blob: snapshot.photos.length > 0 ? writeBackupArchive(document, snapshot.photos) : writeBackupDocument(document),
    extension: snapshot.photos.length > 0 ? 'zip' : 'json',
  };
}

export async function downloadBackup(): Promise<void> {
  const { backup, blob, extension } = await backupDownload();
  const stamp = new Date(backup.createdAt).toISOString().slice(0, 10);
  const url = URL.createObjectURL(blob);

  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `thwart-backup-${stamp}.${extension}`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();

  // Freed on the next tick rather than immediately: revoking synchronously can
  // beat the download starting in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
