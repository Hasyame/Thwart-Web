import { db, SETTINGS_KEY } from './db';
import { completePlay } from './playShape';
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
  /** Photographs named in the bundle. The files are not in it; see below. */
  readonly photos: number;
}

export type ImportMode = 'merge' | 'replace';

export class BackupError extends Error {}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
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
    // Readable in principle — the convention says so — but say it out loud, so
    // a user restoring a file from a much newer app is not surprised later by
    // something that quietly did not come across.
    console.warn(
      `Backup format ${formatVersion} is newer than ${BACKUP_FORMAT_VERSION}; unknown fields will be ignored.`,
    );
  }

  return {
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
    // Absent from a phone's backup, so an empty list rather than a failure.
    favouritePlays: asArray<FavouritePlay>(record['favouritePlays']),
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
): Promise<ImportSummary> {
  await db.transaction('rw', db.tables, async () => {
    if (mode === 'replace') {
      await Promise.all(db.tables.map((table) => table.clear()));
    }

    await db.ownedPacks.bulkPut([...backup.ownedPacks]);
    await db.excludedModularSets.bulkPut([...backup.excludedModularSets]);
    await db.excludedScenarios.bulkPut([...(backup.excludedScenarios ?? [])]);
    await db.favouriteCards.bulkPut([...backup.favouriteCards]);
    await db.favouritePlays.bulkPut([...(backup.favouritePlays ?? [])]);
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
      await db.appSettings.put({ ...backup.settings, id: SETTINGS_KEY });
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
 * `photos` is always empty. The site has no photographs: they live in the
 * phone's private storage and doc 01 §6 keeps them out of scope. Naming files
 * that are not in the bundle would make a restore report them missing.
 */
export async function exportBackup(): Promise<Backup> {
  const [
    ownedPacks,
    excludedModularSets,
    excludedScenarios,
    favouriteCards,
    favouritePlays,
    decks,
    plays,
    campaignRuns,
    campaignEvents,
    randomizerHistory,
    storedSettings,
  ] = await Promise.all([
    db.ownedPacks.toArray(),
    db.excludedModularSets.toArray(),
    db.excludedScenarios.toArray(),
    db.favouriteCards.toArray(),
    db.favouritePlays.toArray(),
    db.decks.toArray(),
    db.plays.toArray(),
    db.campaignRuns.toArray(),
    db.campaignEvents.toArray(),
    db.randomizerHistory.toArray(),
    db.appSettings.get(SETTINGS_KEY),
  ]);

  return {
    formatVersion: BACKUP_FORMAT_VERSION,
    createdAt: Date.now(),
    appVersion: `web ${__APP_VERSION__}`,
    ownedPacks,
    excludedModularSets,
    excludedScenarios,
    decks,
    campaignRuns,
    campaignEvents,
    plays,
    randomizerHistory,
    favouriteCards,
    favouritePlays,
    // Null when this browser has never been handed any, which the app reads as
    // "leave the device's own settings alone". Emitting an empty object instead
    // would tell it to reset them to the defaults.
    settings:
      storedSettings === undefined
        ? null
        : {
            cardLocale: storedSettings.cardLocale,
            themeChoice: storedSettings.themeChoice,
            playLocation: storedSettings.playLocation,
            trackEncounter: storedSettings.trackEncounter,
            dismissedPacks: storedSettings.dismissedPacks,
          },
    photos: [],
  };
}

/** Offers the bundle as a download, named the way the app names its own. */
export function downloadBackup(backup: Backup): void {
  const stamp = new Date(backup.createdAt).toISOString().slice(0, 10);
  const blob = new Blob([JSON.stringify(backup)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `thwart-backup-${stamp}.json`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();

  // Freed on the next tick rather than immediately: revoking synchronously can
  // beat the download starting in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
