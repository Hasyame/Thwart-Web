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
  /**
   * When this row last changed, in epoch milliseconds.
   *
   * Sync metadata rather than something the app shows. It is what a merge
   * compares when two devices have both touched a play, and `playedAt` cannot
   * stand in for it: editing a game recorded last month must not claim to be a
   * month old.
   *
   * The Android app has carried this since the sync contract existed and
   * serialises it into the body, so a play written here without it produced a
   * different digest from the same play written there — each device seeing the
   * other's row as changed and pushing it back.
   */
  readonly updatedAt: number;
  /**
   * When this row was deleted, or null while it is a game that happened.
   *
   * A tombstone, matching the Android app. Deleting is not erasing: the row
   * stays so the delete can reach the other devices, and so it can be undone on
   * this one. Every query that counts or lists plays must exclude these, which
   * is why there is exactly one query layer that does it — see lib/plays/query.
   *
   * The sync protocol carries the deletion as a record-level flag with a null
   * body, so this field is never what tells another device about it. It is this
   * device's own memory of what it did.
   */
  readonly deletedAt: number | null;
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
 * A game put down mid-play, with enough of the table written down to rebuild it.
 *
 * A short pause is the clock stopping. This is the other kind: the table is
 * cleared, or left for a week, and what matters is not the clock but where
 * everything stood.
 *
 * One at a time, by design. Two saved games would need naming, choosing between
 * and tidying up, which is a filing system for a thing that happens when
 * somebody has to go and eat.
 *
 * Field for field as `PausedGameEntity` declares it, including the joined
 * strings, even though this table is local to one device and never travels:
 * the same shape means the same reasoning applies in both places, and it costs
 * nothing to keep.
 */
export interface PausedGame {
  readonly id: string;
  readonly savedAt: number;
  readonly scenarioCode: string;
  readonly scenarioName: string;
  readonly difficulty: string;
  /** Hero codes and names, as `code|name` entries, comma separated. */
  readonly heroes: string;
  readonly modularSetCodes: string;
  readonly elapsedMillis: number;
  /** Which half of the round it stopped in: PLAYER or VILLAIN. */
  readonly phase: PausedPhase;
  /** The villain phase step, or an empty string in the player phase. */
  readonly villainStep: VillainStep | '';
  /** Hit points left, as `heroCode|points` entries, comma separated. */
  readonly heroLives: string;
  readonly villainLife: number;
  /** Which villain card is face up: 1, 2 or 3. */
  readonly villainStage: number;
  readonly campaignRunId: string;
}

/** The two halves of a round a game can be stopped in. */
export type PausedPhase = 'PLAYER' | 'VILLAIN';

/**
 * The steps of the villain phase, in the order they are resolved.
 *
 * Written down because coming back to a table after a week, the question is
 * never "whose turn" but "how far through the villain's turn were we".
 */
export const VILLAIN_STEPS = [
  'PLACE_THREAT',
  'ACTIVATE_MINIONS',
  'DEAL_ENCOUNTERS',
  'REVEAL_ENCOUNTERS',
  'PASS_FIRST_PLAYER',
] as const;

export type VillainStep = (typeof VILLAIN_STEPS)[number];

/**
 * The app's own preferences, as `BackupSettings` declares them.
 *
 * Carried through this site, never applied to it. They are the phone's
 * settings, and this site has its own; adopting somebody's Android theme
 * because they imported a backup would be a surprise, and writing them back
 * unchanged is what keeps a phone to phone round trip through here lossless.
 */
export interface BackupSettings {
  readonly cardLocale: string;
  readonly themeChoice: string;
  readonly playLocation: string;
  readonly trackEncounter: boolean;
  readonly dismissedPacks: readonly string[];
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
  /**
   * Null, not absent, is meaningful: the app reads it as "this file has no
   * settings, leave the device's own alone", where an empty object would mean
   * "use the defaults" and reset somebody's language.
   */
  readonly settings?: BackupSettings | null;
}

export const BACKUP_FORMAT_VERSION = 1;
