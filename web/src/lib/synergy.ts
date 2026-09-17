import type { IndexRow, Synergy } from './types';

/**
 * Synergy between a deck and its identity, read from what the build derived.
 *
 * The rule itself lives in `scripts/lib/synergy.mjs`, which is the contract
 * with the Android app and writes `synergy` and `traitKeys` onto every index
 * row at build time. This is the browser's half: which faces an identity has,
 * which cards in a deck none of them can play, and nothing more. A card that
 * fails is still legal — this is a warning, never a rule — and nothing here
 * is ever stored on the deck.
 *
 * docs/spec/synergie-et-draft.md, phase 1.
 */

/** As `traitKey()` in scripts/lib/synergy.mjs: the same key from either side. */
export const traitKey = (raw: string): string =>
  raw.toLowerCase().replace(/\./g, '').replace(/\s+/g, ' ').trim();

/**
 * Every trait on every face of the identity that owns a hero card.
 *
 * The faces are the hero and alter-ego cards of the hero's set — two for most,
 * more for an identity with several hero forms — and the condition is met
 * when any of them has the trait, so their keys are one set. Empty when the
 * hero is unknown or the index predates the keys.
 */
export function identityTraitKeys(index: readonly IndexRow[], heroCode: string): ReadonlySet<string> {
  const hero = index.find((row) => row.code === heroCode);
  const keys = new Set<string>();
  if (hero === undefined) {
    return keys;
  }
  const faces =
    hero.setCode === null
      ? [hero]
      : index.filter(
          (row) =>
            row.setCode === hero.setCode && (row.typeCode === 'hero' || row.typeCode === 'alter_ego'),
        );
  for (const face of faces) {
    for (const key of face.traitKeys ?? []) {
      keys.add(key);
    }
  }
  return keys;
}

/** Whether an identity with these traits can play a card with this condition. */
export function compatible(synergy: Synergy | null | undefined, identityTraits: ReadonlySet<string>): boolean {
  if (synergy === null || synergy === undefined) {
    return true;
  }
  return synergy.anyOfTraits.some((trait) => identityTraits.has(trait));
}

/** Whether a row can be played by the identity. A row with no condition always can. */
export const rowCompatible = (row: IndexRow, identityTraits: ReadonlySet<string>): boolean =>
  compatible(row.synergy ?? null, identityTraits);

/**
 * The cards of a deck the identity cannot play, in the deck's order.
 *
 * Recomputed whenever the slots change, so the warning follows the deck live
 * and disappears when the last such card is taken out. A code the index does
 * not know is skipped: nothing can be said about it.
 */
export function synergyProblems(
  slots: ReadonlyMap<string, number>,
  rowOf: (code: string) => IndexRow | undefined,
  identityTraits: ReadonlySet<string>,
): IndexRow[] {
  const out: IndexRow[] = [];
  for (const [code, count] of slots) {
    if (count <= 0) {
      continue;
    }
    const row = rowOf(code);
    if (row !== undefined && !rowCompatible(row, identityTraits)) {
      out.push(row);
    }
  }
  return out;
}
