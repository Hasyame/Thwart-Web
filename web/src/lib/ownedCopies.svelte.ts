import { liveQuery } from 'dexie';
import { db } from './db';
import type { IndexRow, Pack } from './types';

/**
 * How many copies of a card the collection holds.
 *
 * The collection is packs and how many of each; the index knows how many
 * copies of a card each pack prints and which printings are the same card.
 * So a card's copies are the sum, over its own row and every reprint of it,
 * of the pack's copies times the printed quantity — the draft's shelf, read
 * for one card (lib/draft/stock.ts). Two Core Sets are four Energy; Swarm
 * Tactics in Wasp's pack and in Ant-Man's add up.
 *
 * Live, so the number follows the collection page without a reload, and a
 * singleton for the same reason the card viewer is one: the card window
 * opens over any page, and threading the collection through every one of
 * them would be the alternative.
 */

interface Owned {
  /** Pack code to how many of it are owned. */
  packs: ReadonlyMap<string, number>;
  loaded: boolean;
}

const owned = $state<Owned>({ packs: new Map(), loaded: false });

/** Subscribes for the life of the app. Returns the unsubscribe. */
export function watchOwnedPacks(): () => void {
  const subscription = liveQuery(() => db.ownedPacks.toArray()).subscribe((rows) => {
    owned.packs = new Map(rows.filter((r) => r.quantity > 0).map((r) => [r.packCode, r.quantity]));
    owned.loaded = true;
  });
  return () => subscription.unsubscribe();
}

export interface OwnedCopies {
  readonly total: number;
  /** Where they come from, in the collection's order, only the packs that hold any. */
  readonly parts: readonly { readonly packCode: string; readonly packName: string; readonly copies: number }[];
}

/**
 * The copies of this card in the collection, or null while the collection
 * has not been read. Every printing counts: the row asked for, and any row
 * that repeats it.
 */
export function copiesOwned(
  code: string,
  index: readonly IndexRow[],
  packs: readonly Pack[],
): OwnedCopies | null {
  if (!owned.loaded) {
    return null;
  }
  const row = index.find((r) => r.code === code);
  const canonical = row?.duplicateOf ?? code;
  const parts: { packCode: string; packName: string; copies: number }[] = [];
  let total = 0;
  for (const r of index) {
    if (r.code !== canonical && r.duplicateOf !== canonical) {
      continue;
    }
    const held = owned.packs.get(r.packCode) ?? 0;
    if (held <= 0) {
      continue;
    }
    const copies = held * (r.quantity ?? 1);
    total += copies;
    const part = parts.find((p) => p.packCode === r.packCode);
    if (part === undefined) {
      parts.push({ packCode: r.packCode, packName: packs.find((p) => p.code === r.packCode)?.name ?? r.packCode, copies });
    } else {
      part.copies += copies;
    }
  }
  return { total, parts };
}
