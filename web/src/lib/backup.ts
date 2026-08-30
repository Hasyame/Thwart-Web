import { db } from './db';
import {
  BACKUP_FORMAT_VERSION,
  type Backup,
  type CampaignEvent,
  type CampaignRun,
  type ExcludedModularSet,
  type ExcludedScenario,
  type FavouriteCard,
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
    photos: asArray<string>(record['photos']),
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
    await db.decks.bulkPut([...backup.decks]);
    await db.plays.bulkPut([...backup.plays]);
    await db.campaignRuns.bulkPut([...backup.campaignRuns]);
    await db.campaignEvents.bulkPut([...backup.campaignEvents]);
    await db.randomizerHistory.bulkPut([...backup.randomizerHistory]);
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
    decks,
    plays,
    campaignRuns,
    campaignEvents,
    randomizerHistory,
  ] = await Promise.all([
    db.ownedPacks.toArray(),
    db.excludedModularSets.toArray(),
    db.excludedScenarios.toArray(),
    db.favouriteCards.toArray(),
    db.decks.toArray(),
    db.plays.toArray(),
    db.campaignRuns.toArray(),
    db.campaignEvents.toArray(),
    db.randomizerHistory.toArray(),
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
