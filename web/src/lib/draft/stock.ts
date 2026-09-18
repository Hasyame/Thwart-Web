import type { IndexRow } from '../types';
import { buildableFor } from '../decks';

/**
 * What is on the shelf before anyone draws: the cards, and how many of each.
 *
 * Counts the collection as physical cards. A reprint is the same card, so
 * every printing of a title is folded onto one code and their copies add up:
 * three Swarm Tactics in Wasp's pack and three in Ant-Man's are six on the
 * shelf. A pack owned twice counts twice. A card in no owned pack is not on
 * the shelf at all. The Android app's `DraftStockBuilder`.
 *
 * The code a card is folded onto is the original printing's when that pack
 * is owned, and otherwise the first owned printing's. It used to be the
 * original's whatever the collection, and somebody who owned Energy only
 * through Ms. Marvel's pack was offered the Core Set's Energy: the same
 * card, but shown as a printing they do not have, which reads as a card
 * they do not have. A pick is always a printing on the shelf now.
 *
 * Only cards with no set of their own: an identity's signature cards go in
 * that identity's deck by rule, never on the shelf.
 */
export interface DraftStock {
  readonly pool: ReadonlyMap<string, IndexRow>;
  readonly stock: ReadonlyMap<string, number>;
}

/** The first printing a row repeats, through any chain of reprints. */
function rootOf(row: IndexRow, byCode: ReadonlyMap<string, IndexRow>): string {
  let code = row.code;
  const seen = new Set<string>();
  for (;;) {
    const next = byCode.get(code)?.duplicateOf;
    if (next === undefined || seen.has(next)) {
      return code;
    }
    seen.add(code);
    code = next;
  }
}

export function buildStock(index: readonly IndexRow[], ownedPacks: ReadonlyMap<string, number>): DraftStock {
  const byCode = new Map(index.map((row) => [row.code, row] as const));
  // Every owned printing of each card, in the index's order, under the root.
  const printings = new Map<string, { row: IndexRow; copies: number }[]>();
  for (const row of index) {
    const owned = ownedPacks.get(row.packCode) ?? 0;
    if (owned <= 0 || !buildableFor(row, null) || row.hidden === true) {
      continue;
    }
    const root = rootOf(row, byCode);
    const list = printings.get(root) ?? [];
    list.push({ row, copies: owned * (row.quantity ?? 1) });
    printings.set(root, list);
  }
  const stock = new Map<string, number>();
  const pool = new Map<string, IndexRow>();
  for (const [root, list] of printings) {
    // The original names the card when it is on the shelf; a reprint only
    // stands in for it when the original is in no owned pack.
    const shown = list.find(({ row }) => row.code === root)?.row ?? (list[0] as { row: IndexRow }).row;
    pool.set(shown.code, shown);
    stock.set(
      shown.code,
      list.reduce((sum, { copies }) => sum + copies, 0),
    );
  }
  return { pool, stock };
}
