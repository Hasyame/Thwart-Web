/**
 * Shapes of the data files written by `scripts/fetch-cards.mjs`.
 *
 * These describe MarvelCDB's payload, so the field names are its snake_case
 * ones rather than the app's. Renaming them here would mean a mapping layer
 * whose only purpose was cosmetic, and a place for the two to disagree.
 */

/** The two languages MarvelCDB serves, by host. */
export type Locale = 'en' | 'fr';

export const LOCALES: readonly Locale[] = ['en', 'fr'] as const;

/**
 * One row of the search index.
 *
 * Everything the results list draws, and nothing else — the index is loaded up
 * front, so anything added here is paid for on every first visit.
 */
export interface IndexRow {
  readonly code: string;
  readonly name: string;
  readonly subname: string | null;
  readonly packCode: string;
  /** The card's own set — hero, villain, modular. Null when it has none. */
  readonly setCode: string | null;
  readonly typeCode: string;
  readonly typeName: string;
  readonly factionCode: string;
  readonly factionName: string;
  readonly cost: number | null;
  readonly isUnique: boolean;
  /**
   * The card's traits, one per entry.
   *
   * Optional because an index built before this existed does not carry them,
   * and an absent list must read as "no traits" rather than as an error. They
   * are also folded into `s`, which is what makes them findable by typing;
   * this is what makes them selectable.
   */
  readonly traits?: readonly string[];
  /** Pre-folded search text. See lib/normalize.js. */
  readonly s: string;
}

/**
 * A full card record, as MarvelCDB returns it.
 *
 * Only the fields the detail view actually reads are declared. The files hold
 * every field the API returns — the app keeps them all on the same reasoning,
 * that losing data you do not yet use is worse than storing it — so widening
 * this interface never requires re-fetching.
 */
export interface Card {
  readonly code: string;
  readonly name: string;
  readonly real_name?: string;
  readonly subname?: string | null;
  readonly type_code: string;
  readonly type_name: string;
  readonly faction_code: string;
  readonly faction_name: string;
  readonly pack_code: string;
  readonly pack_name: string;
  readonly card_set_code?: string | null;
  readonly card_set_name?: string | null;
  readonly traits?: string | null;

  readonly text?: string | null;
  readonly flavor?: string | null;
  readonly back_name?: string | null;
  readonly back_text?: string | null;
  readonly back_flavor?: string | null;
  readonly errata?: string | null;
  readonly illustrator?: string | null;

  readonly imagesrc?: string | null;
  readonly backimagesrc?: string | null;

  readonly cost?: number | null;
  readonly resource_physical?: number | null;
  readonly resource_mental?: number | null;
  readonly resource_energy?: number | null;
  readonly resource_wild?: number | null;

  readonly health?: number | null;
  readonly hand_size?: number | null;
  readonly attack?: number | null;
  readonly thwart?: number | null;
  readonly defense?: number | null;
  readonly recover?: number | null;
  readonly scheme?: number | null;
  readonly boost?: number | null;
  /**
   * The encounter tracker's numbers.
   *
   * Two spellings for the same idea, and they disagree: a villain's health
   * carries `health_per_hero`, where **true** means multiply by the number of
   * players, while a scheme's threat carries `threat_fixed`, where **false**
   * means multiply. Normalised once in lib/encounter.ts so nothing downstream
   * has to remember which is which.
   *
   * A `*_star` card prints a star instead of a number, so the scenario decides
   * it and the player types it in.
   */
  readonly stage?: string | null;
  readonly health_per_hero?: boolean;
  readonly health_star?: boolean;
  readonly threat?: number | null;
  readonly threat_fixed?: boolean;
  readonly threat_star?: boolean;
  readonly base_threat?: number | null;
  readonly base_threat_fixed?: boolean;
  readonly escalation_threat?: number | null;
  readonly escalation_threat_fixed?: boolean;

  readonly quantity?: number | null;
  readonly deck_limit?: number | null;
  readonly is_unique?: boolean;
  readonly permanent?: boolean;
  readonly double_sided?: boolean;
  readonly url?: string | null;
}

export interface Pack {
  readonly code: string;
  readonly name: string;
  readonly position: number;
  readonly available: string | null;
  readonly known: number | null;
  readonly total: number | null;
  /**
   * Release wave, from the curated `data/pack-metadata.json` — MarvelCDB does
   * not expose it. `0` means the file does not mention this pack, matching the
   * app's `UNCURATED_WAVE`.
   */
  readonly wave: number;
  /** `CORE`, `HERO_PACK`, `SCENARIO_PACK`, `CAMPAIGN_BOX`, or null if unknown. */
  readonly type: string | null;
  readonly waveInferred: boolean;
}

/**
 * A card set: a modular set, a villain, a hero's own set, a nemesis set.
 *
 * `type` is MarvelCDB's `card_set_type_name_code` — `modular`, `villain`,
 * `hero`, `nemesis`, `standard`, `expert` and a few rarer ones. The collection
 * screen cares about `modular` (sets a pack contains but a second-hand box may
 * be missing) and `villain` (the scenarios in it), and ignores the rest.
 */
export interface CardSet {
  readonly code: string;
  readonly name: string;
  readonly type: string | null;
  readonly packCode: string;
}

export interface DataMeta {
  readonly fetchedAt: string;
  readonly source: string;
  readonly digest: string;
  readonly locales: ReadonlyArray<{
    readonly locale: Locale;
    readonly cards: number;
    readonly packs: number;
    readonly digest: string;
  }>;
}
