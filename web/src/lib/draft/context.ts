import type { IndexRow } from '../types';
import { heroRules, type HeroDeckRules } from '../deckRules';
import { heroIdentities } from '../decks';
import { identityTraitKeys } from '../synergy';
import { cardFromRow } from './cards';
import { buildStock } from './stock';
import { DRAFT_RULES, type DraftContext } from './types';

/**
 * The card data the engine reads, built from the index and the collection.
 *
 * Everything here is derived: the shelf from the owned packs, each identity's
 * rules and signature cards from its pack's rows, its traits from its faces.
 * Built once when the draft page opens and again for every identity added,
 * never written down with the state (types.ts). Offline holds, because the
 * index is all it needs.
 */

/** The identities the collection holds, as hero codes, in the shelf's order. */
export function ownedHeroes(index: readonly IndexRow[], ownedPacks: ReadonlyMap<string, number>): string[] {
  const owned = new Set([...ownedPacks].filter(([, n]) => n > 0).map(([code]) => code));
  return heroIdentities(index)
    .filter((identity) => {
      const row = index.find((r) => r.code === identity.code);
      return row !== undefined && owned.has(row.packCode);
    })
    .map((identity) => identity.code);
}

/** An identity's rules, from its own pack's rows. */
export function rulesFor(index: readonly IndexRow[], heroCode: string): HeroDeckRules | null {
  const hero = index.find((row) => row.code === heroCode);
  if (hero === undefined) {
    return null;
  }
  const packRows = index.filter((row) => row.packCode === hero.packCode);
  return heroRules(cardFromRow(hero), packRows.map(cardFromRow));
}

export function buildContext(
  index: readonly IndexRow[],
  ownedPacks: ReadonlyMap<string, number>,
  heroCodes: readonly string[],
): DraftContext {
  const { pool, stock } = buildStock(index, ownedPacks);
  const rules = new Map<string, HeroDeckRules>();
  const identities = new Map<string, ReadonlySet<string>>();
  const signatureCards = new Map<string, ReadonlyMap<string, IndexRow>>();
  const byCode = new Map(index.map((row) => [row.code, row] as const));
  for (const heroCode of heroCodes) {
    const heroRulesOf = rulesFor(index, heroCode);
    if (heroRulesOf === null) {
      continue;
    }
    rules.set(heroCode, heroRulesOf);
    identities.set(heroCode, identityTraitKeys(index, heroCode));
    const signature = new Map<string, IndexRow>();
    for (const code of heroRulesOf.requiredCards.keys()) {
      const row = byCode.get(code);
      if (row !== undefined) {
        signature.set(code, row);
      }
    }
    signatureCards.set(heroCode, signature);
  }
  return {
    pool,
    initialStock: stock,
    rules,
    identities,
    signatureCards,
    poolAspectAvailable: (ownedPacks.get(DRAFT_RULES.POOL_PACK) ?? 0) > 0,
  };
}
