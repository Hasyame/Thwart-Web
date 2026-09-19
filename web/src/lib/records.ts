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
 * A game somebody has starred, to find again and play again.
 *
 * Its own row rather than a flag on the play, and that is a sync decision
 * before it is a data one. A field the phone does not know is dropped the
 * next time the phone writes the play — that is how `Play.ignored` was lost
 * and why it was removed — whereas a collection the phone does not know is
 * deferred by it, untouched, until a build that does. It is also how the
 * contract already models a favourite: `favourite_cards` is a row keyed by
 * what it points at, and this is the same shape keyed by a play.
 *
 * Proposed to Android as `favourite_plays`; see doc 06.
 */
export interface FavouritePlay {
  readonly playId: string;
  readonly addedAt: number;
}

/**
 * A folder on the shelf of decks: a name, and the decks in it by id.
 *
 * The folder holds the list rather than each deck naming its folder, because
 * a deck's record is the phone's and MarvelCDB's shape and gains no field
 * lightly, and because a folder is one thing a person edits -- rename it,
 * drag a deck in, drag one out -- so one record changing is the honest
 * picture. A deck in no folder is simply in none. Synced as `deck_folders`;
 * the later `updatedAt` wins whole.
 */
export interface DeckFolder {
  readonly id: string;
  readonly name: string;
  readonly deckIds: readonly string[];
  readonly createdAt: number;
  readonly updatedAt: number;
}

/**
 * One player's current opinion of how hard something was.
 *
 * Keyed by its subject — `scenario:rhino`, `modular:bomb_scare@rhino`,
 * `campaign:gmw` — so one rating per player per subject is the data model
 * rather than a rule, and rating again is the same record with a newer
 * `ratedAt`. Checked by the server against the play or run it cites before it
 * is stored; a rating for something this account never played comes back
 * `rejected` and is dropped here. docs/spec/ratings-and-modular-sets.md §2.3.
 */
export interface Rating {
  readonly subject: string;
  /** 0 effortless … 5 impossible. */
  readonly score: number;
  readonly ratedAt: number;
  readonly evidence: { readonly playId?: string; readonly runId?: string };
  /**
   * The game it was given after, snapshotted then and never updated. Not
   * shown yet; kept so it is not lost.
   */
  readonly context: {
    readonly players: number;
    readonly heroes: readonly { readonly code: string; readonly aspect: string }[];
    readonly mode: string;
    readonly standardSet: string;
    /** For a modular set: the scenario it was paired with. */
    readonly scenario?: string;
  };
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
  /**
   * The seat of the person whose device recorded the game. Absent on a
   * record from before it existed, and then the first seat is the owner.
   * docs/spec/achievements/data-model.md §3.
   */
  readonly isOwner?: boolean;
  /** Keys this client does not know, kept for the next one that does. See `Play.extra`. */
  readonly extra?: Readonly<Record<string, unknown>>;
}

/** `data/db/entity/PlayEntity.kt`. */
export interface Play {
  readonly id: string;
  readonly playedAt: number;
  readonly scenarioCode: string;
  readonly scenarioName: string;
  readonly difficulty: string;
  readonly standardSet: string;
  /**
   * The modular sets shuffled in, by code, comma separated. Empty when none
   * were, and on plays recorded before either client kept this.
   *
   * The names have always gone into `notes` as a line for a reader, and still
   * do. Names are not enough to set the same game up again: they are in
   * whichever card language was current that day. So both clients keep the
   * codes beside them, for "play again"; see lib/replay.
   */
  readonly modularSets: string;
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
   * Which of Thwart's own modes produced the game: `draft` when the owner's
   * deck came out of the draft. Absent for an ordinary game; `sealed`,
   * `daily` and `shared` are reserved. docs/spec/achievements/data-model.md §3.
   */
  readonly mode?: string;
  /**
   * Fields the record carried that this client does not know.
   *
   * A backup or a sync body from a newer client may name fields this build
   * has never heard of. They are kept here, off the typed fields, and put
   * back into every body this client writes for the record, so a device one
   * release behind never strips what a newer one recorded. Known fields
   * always win over an extra key of the same name. Never read for meaning.
   * docs/spec/achievements/sync.md §2.
   */
  readonly extra?: Readonly<Record<string, unknown>>;
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
  readonly [key: string]: unknown;
  readonly cardLocale: string;
  readonly themeChoice: string;
  readonly playLocation: string;
  readonly trackEncounter: boolean;
  readonly dismissedPacks: readonly string[];
}

/**
 * The export bundle, exactly as `data/backup/BackupModels.kt` declares it.
 *
 * `formatVersion` is 2 since the achievements: the play record gained
 * `roster[].isOwner` and `mode`. Both clients read 1 and 2, write 2, and
 * keep every field they do not know on the record and write it back, so a
 * file from a newer build imports without losing anything.
 * docs/spec/achievements/sync.md.
 */
export interface Backup {
  readonly [key: string]: unknown;
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
  /**
   * Absent from a backup the phone wrote, and ignored by the phone when it
   * reads one — `ignoreUnknownKeys` is on there — so carrying it costs the
   * round trip nothing and keeps a web backup whole.
   */
  readonly favouritePlays: readonly FavouritePlay[];
  /** As with starred games: absent from a phone's backup, harmless there. */
  readonly ratings: readonly Rating[];
  readonly deckFolders: readonly DeckFolder[];
  readonly photos: readonly string[];
  /**
   * Null, not absent, is meaningful: the app reads it as "this file has no
   * settings, leave the device's own alone", where an empty object would mean
   * "use the defaults" and reset somebody's language.
   */
  readonly settings?: BackupSettings | null;
}

export const BACKUP_FORMAT_VERSION = 2;
