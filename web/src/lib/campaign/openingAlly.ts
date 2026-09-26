import type { IndexRow } from '../types';
import type { SavedDeck } from '../records';
import type { CampaignHero } from './types';

export function openingAllies(hero: CampaignHero, decks: readonly SavedDeck[], index: readonly IndexRow[], expert: boolean): readonly IndexRow[] {
  const deck = decks.find(d => d.id === hero.deckId);
  if (deck === undefined) return [];
  let slots: Record<string, number>;
  try { slots = JSON.parse(deck.slots) as Record<string, number>; } catch { return []; }
  const traits = index.find(c => c.code === hero.heroCardCode)?.traitKeys ?? [];
  return index.filter(c => c.typeCode === 'ally' && (slots[c.code] ?? 0) > 0 &&
    (!expert || (c.traitKeys ?? []).some(t => traits.includes(t))));
}
