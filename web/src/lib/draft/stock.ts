import type { IndexRow } from '../types';
import { buildableFor } from '../decks';
import { canonicalOf } from './cards';

/**
 * What is on the shelf before anyone draws: the cards, and how many of each.
 *
 * Counts the collection as physical cards. A reprint is the same card, so
 * every printing of a title is folded onto the original's code and their
 * copies add up: three Swarm Tactics in Wasp's pack and three in Ant-Man's
 * are six on the shelf. A pack owned twice counts twice. A card in no owned
 * pack is not on the shelf at all. The Android app's `DraftStockBuilder`.
 *
 * Only cards with no set of their own: an identity's signature cards go in
 * that identity's deck by rule, never on the shelf.
 */
export interface DraftStock {
  readonly pool: ReadonlyMap<string, IndexRow>;
  readonly stock: ReadonlyMap<string, number>;
}

export function buildStock(index: readonly IndexRow[], ownedPacks: ReadonlyMap<string, number>): DraftStock {
  const stock = new Map<string, number>();
  const pool = new Map<string, IndexRow>();
  for (const row of index) {
    const owned = ownedPacks.get(row.packCode) ?? 0;
    if (owned <= 0 || !buildableFor(row, null) || row.hidden === true) {
      continue;
    }
    const canonical = canonicalOf(row);
    stock.set(canonical, (stock.get(canonical) ?? 0) + owned * (row.quantity ?? 1));
    // The original printing names the card; a reprint only stands in for it
    // when the original is in no owned pack.
    if (row.duplicateOf === undefined || !pool.has(canonical)) {
      pool.set(canonical, row.duplicateOf === undefined ? row : { ...row, code: canonical });
    }
  }
  return { pool, stock };
}
