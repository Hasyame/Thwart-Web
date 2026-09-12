import type { IndexRow } from './types';
import { buildableFor } from './decks';
import { NO_FILTERS, searchCards, type Collection } from './search';

/**
 * How the pool a deck is built from is narrowed.
 *
 * Every card that can go in the deck is on the page from the first pixel;
 * these only take away. Nothing here is remembered between decks except the
 * collection tick, which is a preference rather than a filter.
 */
export interface PoolFilter {
  /** Factions shown. Empty means none, not all: the chips are the whole rule. */
  readonly factions: ReadonlySet<string>;
  /** Card types shown. Empty means all. */
  readonly types: ReadonlySet<string>;
  readonly query: string;
  /** Printed cost to show: null for any, 0..4 exact, `COST_CAP` for that and above. */
  readonly cost: number | null;
  readonly ownedOnly: boolean;
  readonly sort: 'name' | 'cost';
}

/** The last cost chip means "this or more". */
export const COST_CAP = 5;

/** The factions a fresh deck's pool starts on: its aspects, and basic. */
export function startingFactions(deckAspects: readonly string[]): Set<string> {
  return new Set([...deckAspects.filter((a) => a !== ''), 'basic']);
}

/**
 * The faction chips, in the order they are worth reading: the deck's own
 * aspects first, then basic, then whatever else the pool holds -- the other
 * aspects, and 'pool for the one hero who has it.
 */
export function factionOrder(
  rows: readonly IndexRow[],
  deckAspects: readonly string[],
): readonly { code: string; name: string }[] {
  const names = new Map<string, string>();
  for (const row of rows) {
    if (!names.has(row.factionCode)) {
      names.set(row.factionCode, row.factionName);
    }
  }
  const first = [...deckAspects.filter((a) => names.has(a)), 'basic'].filter((code, i, all) => all.indexOf(code) === i);
  // Sorted by the letters of the name: 'pool would otherwise sort first on its apostrophe.
  const letters = (code: string): string => (names.get(code) ?? code).replace(/^[^\p{L}]+/u, '');
  const rest = [...names.keys()].filter((code) => !first.includes(code)).sort((a, b) => letters(a).localeCompare(letters(b)));
  return [...first, ...rest].filter((code) => names.has(code)).map((code) => ({ code, name: names.get(code) ?? code }));
}

/**
 * Every card somebody can *choose* for a deck for this hero, before any filter.
 *
 * The hero's own cards can go in the deck, and are not in the pool: they are
 * in every deck at their printed count, listed under their own heading, and a
 * stepper beside one would only offer a change the rules refuse.
 */
export function poolFor(index: readonly IndexRow[], heroSetCode: string | null): IndexRow[] {
  return index.filter((row) => buildableFor(row, heroSetCode) && row.setCode === null);
}

/**
 * The pool, narrowed and ordered.
 *
 * The text goes through the same matcher the card list uses, so typing here
 * finds what typing there finds; the rest is plain set membership. Sorting by
 * cost keeps name order inside a cost, and puts the costless (a resource, a
 * card with no printed cost) after everything that has one.
 */
export function poolRows(
  pool: readonly IndexRow[],
  filter: PoolFilter,
  collection: Collection,
): IndexRow[] {
  const searched = searchCards(pool, {
    query: filter.query,
    filters: { ...NO_FILTERS, ownedOnly: filter.ownedOnly },
    collection,
    limit: Number.POSITIVE_INFINITY,
  }).rows;
  const rows = searched.filter((row) => {
    if (!filter.factions.has(row.factionCode)) {
      return false;
    }
    if (filter.types.size > 0 && !filter.types.has(row.typeCode)) {
      return false;
    }
    if (filter.cost !== null) {
      if (row.cost === null) {
        return false;
      }
      return filter.cost >= COST_CAP ? row.cost >= COST_CAP : row.cost === filter.cost;
    }
    return true;
  });
  if (filter.sort === 'cost') {
    return rows.sort((a, b) => {
      const ca = a.cost ?? Number.POSITIVE_INFINITY;
      const cb = b.cost ?? Number.POSITIVE_INFINITY;
      return ca !== cb ? ca - cb : a.name.localeCompare(b.name);
    });
  }
  // With no words typed the matcher's rank is flat and this is name order
  // already; with words it is relevance, which is what somebody typing wants.
  return filter.query.trim() === '' ? rows.sort((a, b) => a.name.localeCompare(b.name)) : rows;
}
