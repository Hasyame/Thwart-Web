/**
 * The user's own data, in the shapes the Android app already uses.
 *
 * **These field names are not a design choice made here.** They are copied from
 * the app's Room entities, which `BackupRepository` serialises directly into the
 * export bundle. Doc 04 makes the reason explicit and it is the single most
 * important constraint on this file: when sync arrives, two clients that agree
 * about what a play is need a transport; two that disagree need a migration.
 * So the local database stores the *same* records, not similar ones.
 *
 * Kotlin serialises property names verbatim, so these are camelCase and match
 * the JSON in a real backup file byte for byte.
 *
 * Source of truth: `data/db/entity/*.kt` and `data/backup/BackupModels.kt`.
 */

/** `data/db/entity/PackEntity.kt` — OwnedPackEntity. */
export interface OwnedPack {
  /** MarvelCDB pack code. Natural key; no foreign key, deliberately. */
  readonly packCode: string;
  /** A second Core Set is a real possibility and changes what may be drawn. */
  readonly quantity: number;
}

/** `data/db/entity/PackEntity.kt` — ExcludedModularSetEntity. */
export interface ExcludedModularSet {
  readonly setCode: string;
}

/**
 * `data/db/entity/PackEntity.kt` — ExcludedScenarioEntity.
 *
 * Absent from the app's `Backup` class, which is a bug in the app rather than
 * an omission here: the table exists and is exported nowhere, so a restore
 * loses it silently. Doc 01 §7 records it. Written on export regardless — an
 * older app ignores unknown keys, so the extra field costs nothing and a future
 * fixed app will read it.
 */
export interface ExcludedScenario {
  readonly scenarioCode: string;
}

/** `data/db/entity/FavouriteEntity.kt` — FavouriteCardEntity. */
export interface FavouriteCard {
  readonly cardCode: string;
  readonly addedAt: number;
}

/**
 * `data/db/entity/SavedDeckEntity.kt`.
 *
 * Not written by this app yet — decks are a later phase — but declared and
 * stored so an imported backup round-trips without loss. See `db.ts`.
 */
export interface SavedDeck {
  readonly id: string;
  readonly marvelCdbId: number;
  readonly kind: string;
  readonly url: string;
  readonly name: string;
  readonly heroCode: string;
  readonly heroName: string;
  readonly aspects: string;
  readonly slots: string;
  readonly ignoreDeckLimitSlots: string;
  readonly descriptionMd: string | null;
  readonly version: string | null;
  readonly tags: string | null;
  readonly rawJson: string;
  readonly lastSyncedAt: number;
  readonly locallyEdited: boolean;
}

/** `data/db/entity/PlayHero.kt`. One seat: who was played, with which aspect. */
export interface PlayHero {
  readonly code: string;
  readonly name: string;
  readonly aspect: string;
}

/** `data/db/entity/PlayEntity.kt`. */
export interface Play {
  readonly id: string;
  readonly playedAt: number;
  readonly scenarioCode: string;
  readonly scenarioName: string;
  readonly difficulty: string;
  readonly standardSet: string;
  readonly heroCode: string;
  readonly heroName: string;
  readonly aspects: string;
  readonly otherHeroes: string;
  readonly roster: readonly PlayHero[];
  readonly players: number;
  readonly won: boolean;
  readonly elapsedMillis: number;
  readonly notes: string;
  readonly location: string;
  readonly victoryPoints: number;
  readonly campaignRunId: string | null;
  readonly reportedToBgg: boolean;
  readonly photos: string;
}

/** `data/db/entity/CampaignEntity.kt` — CampaignRunEntity. */
export interface CampaignRun {
  readonly id: string;
  readonly templateId: string;
  readonly templateName: string;
  readonly name: string;
  readonly difficulty: string;
  readonly standardSet: string;
  readonly createdAt: number;
  readonly finished: boolean;
  readonly templateJson: string;
  readonly timerAccumulatedMillis: number;
  readonly timerRunningSince: number | null;
  readonly timerScenarioId: string | null;
}

/** `data/db/entity/CampaignEntity.kt` — CampaignEventEntity. */
export interface CampaignEvent {
  readonly id: string;
  readonly runId: string;
  readonly timestamp: number;
  readonly payload: string;
}

/** `data/db/entity/RandomizerHistoryEntity.kt`. */
export interface RandomizerHistoryRow {
  readonly id: string;
  readonly createdAt: number;
  readonly scenarioCode: string;
  readonly difficulty: string;
  readonly playerCount: number;
  readonly heroes: string;
  readonly modularSetCodes: string;
  readonly beaten: boolean;
}

/**
 * The export bundle, exactly as `data/backup/BackupModels.kt` declares it.
 *
 * `formatVersion` stays at 1. The app's own comment explains the convention:
 * fields added after the format shipped do not bump it, because an older build
 * ignores unknown keys and can still read a newer file, which beats refusing
 * the backup outright.
 */
export interface Backup {
  readonly formatVersion: number;
  readonly createdAt: number;
  readonly appVersion: string;
  readonly ownedPacks: readonly OwnedPack[];
  readonly excludedModularSets: readonly ExcludedModularSet[];
  readonly excludedScenarios?: readonly ExcludedScenario[];
  readonly decks: readonly SavedDeck[];
  readonly campaignRuns: readonly CampaignRun[];
  readonly campaignEvents: readonly CampaignEvent[];
  readonly plays: readonly Play[];
  readonly randomizerHistory: readonly RandomizerHistoryRow[];
  readonly favouriteCards: readonly FavouriteCard[];
  readonly photos: readonly string[];
}

export const BACKUP_FORMAT_VERSION = 1;
