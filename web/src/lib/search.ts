import { queryTokens } from './normalize.js';
import type { IndexRow } from './types';

export { normalizeForSearch, queryTokens } from './normalize.js';

export interface Filters {
  readonly typeCode: string | null;
  readonly factionCode: string | null;
  readonly packCode: string | null;
  /** A card must carry this trait. Compared case-insensitively. */
  readonly trait: string | null;
  /** Inclusive bounds on printed cost. Null is no bound at that end. */
  readonly minCost: number | null;
  readonly maxCost: number | null;
  /** Only cards from packs the collection says are owned. */
  readonly ownedOnly: boolean;
  /** Only starred cards. */
  readonly favouritesOnly: boolean;
}

export const NO_FILTERS: Filters = {
  typeCode: null,
  factionCode: null,
  packCode: null,
  trait: null,
  minCost: null,
  maxCost: null,
  ownedOnly: false,
  favouritesOnly: false,
};

/** True when anything is narrowing the list, so the interface can say so. */
export const activeFilterCount = (filters: Filters): number =>
  [
    filters.typeCode,
    filters.factionCode,
    filters.packCode,
    filters.trait,
    filters.minCost,
    filters.maxCost,
    filters.ownedOnly ? true : null,
    filters.favouritesOnly ? true : null,
  ].filter((value) => value !== null && value !== false).length;

/**
 * What the collection says, for the two filters that need it.
 *
 * Passed in rather than read here: this module is pure and knows nothing about
 * the database, which is what lets the whole matcher be asserted directly.
 */
export interface Collection {
  readonly ownedPacks: ReadonlySet<string>;
  readonly favourites: ReadonlySet<string>;
}

export const EMPTY_COLLECTION: Collection = {
  ownedPacks: new Set(),
  favourites: new Set(),
};

/**
 * Prefix-matches every token against a card's folded text.
 *
 * Every token must match, so extra words narrow rather than widen — which is
 * what a person typing `spider justice` expects, and what the app's FTS
 * expression does. Prefix rather than whole-word so results appear while the
 * query is still half typed.
 */
function matchesTokens(row: IndexRow, tokens: readonly string[]): boolean {
  if (tokens.length === 0) {
    return true;
  }
  const haystack = row.s;
  return tokens.every((token) => {
    if (haystack.startsWith(token)) {
      return true;
    }
    // A token may begin any word in the folded text, which is space separated,
    // so a leading space is what makes this a word-boundary prefix match
    // rather than a substring match.
    return haystack.includes(` ${token}`);
  });
}

function matchesFilters(row: IndexRow, filters: Filters, collection: Collection): boolean {
  if (filters.typeCode !== null && row.typeCode !== filters.typeCode) {
    return false;
  }
  if (filters.factionCode !== null && row.factionCode !== filters.factionCode) {
    return false;
  }
  if (filters.packCode !== null && row.packCode !== filters.packCode) {
    return false;
  }
  if (filters.trait !== null) {
    const wanted = filters.trait.toLowerCase();
    if (!(row.traits ?? []).some((trait) => trait.toLowerCase() === wanted)) {
      return false;
    }
  }
  /*
   * A card with no printed cost is not cost zero.
   *
   * Heroes, villains and most encounter cards print nothing there, and folding
   * them in as zero would put the whole villain deck at the top of "cost 0 to
   * 1". Asking for a cost range is asking for cards that have one.
   */
  if (filters.minCost !== null && (row.cost === null || row.cost < filters.minCost)) {
    return false;
  }
  if (filters.maxCost !== null && (row.cost === null || row.cost > filters.maxCost)) {
    return false;
  }
  if (filters.ownedOnly && !collection.ownedPacks.has(row.packCode)) {
    return false;
  }
  if (filters.favouritesOnly && !collection.favourites.has(row.code)) {
    return false;
  }
  return true;
}

/**
 * Ranks a match so that the card you meant comes first.
 *
 * Lower sorts earlier. An exact name beats a name that merely starts with the
 * query, which beats a match found somewhere in the traits — otherwise typing
 * `spider-man` buries Spider-Man himself under every card with the Spider
 * trait.
 */
function rank(row: IndexRow, joined: string): number {
  if (joined === '') {
    return 3;
  }
  if (row.s === joined) {
    return 0;
  }
  if (row.s.startsWith(joined)) {
    return 1;
  }
  return 2;
}

export interface SearchOptions {
  readonly query: string;
  readonly filters: Filters;
  readonly limit: number;
  /** Only consulted by the owned and favourites filters. */
  readonly collection?: Collection;
}

export interface SearchResult {
  readonly rows: readonly IndexRow[];
  /** Total matches before the limit, so the UI can say what it is not showing. */
  readonly total: number;
}

const byName = new Intl.Collator();

export function searchCards(
  index: readonly IndexRow[],
  options: SearchOptions,
): SearchResult {
  const tokens = queryTokens(options.query);
  const joined = tokens.join(' ');

  const collection = options.collection ?? EMPTY_COLLECTION;
  const matched = index.filter(
    (row) => matchesFilters(row, options.filters, collection) && matchesTokens(row, tokens),
  );

  // A collator, not localeCompare: the same order, and an order of magnitude
  // cheaper over the fifty thousand comparisons a sort of the whole index
  // makes, which was a visible part of the first paint on a phone.
  const sorted = [...matched].sort((a, b) => {
    const byRank = rank(a, joined) - rank(b, joined);
    if (byRank !== 0) {
      return byRank;
    }
    return byName.compare(a.name, b.name);
  });

  return { rows: sorted.slice(0, options.limit), total: sorted.length };
}
