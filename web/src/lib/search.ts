import { queryTokens } from './normalize.js';
import type { IndexRow } from './types';

export { normalizeForSearch, queryTokens } from './normalize.js';

export interface Filters {
  readonly typeCode: string | null;
  readonly factionCode: string | null;
  readonly packCode: string | null;
}

export const NO_FILTERS: Filters = {
  typeCode: null,
  factionCode: null,
  packCode: null,
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

function matchesFilters(row: IndexRow, filters: Filters): boolean {
  if (filters.typeCode !== null && row.typeCode !== filters.typeCode) {
    return false;
  }
  if (filters.factionCode !== null && row.factionCode !== filters.factionCode) {
    return false;
  }
  if (filters.packCode !== null && row.packCode !== filters.packCode) {
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
}

export interface SearchResult {
  readonly rows: readonly IndexRow[];
  /** Total matches before the limit, so the UI can say what it is not showing. */
  readonly total: number;
}

export function searchCards(
  index: readonly IndexRow[],
  options: SearchOptions,
): SearchResult {
  const tokens = queryTokens(options.query);
  const joined = tokens.join(' ');

  const matched = index.filter(
    (row) => matchesFilters(row, options.filters) && matchesTokens(row, tokens),
  );

  const sorted = [...matched].sort((a, b) => {
    const byRank = rank(a, joined) - rank(b, joined);
    if (byRank !== 0) {
      return byRank;
    }
    return a.name.localeCompare(b.name);
  });

  return { rows: sorted.slice(0, options.limit), total: sorted.length };
}
