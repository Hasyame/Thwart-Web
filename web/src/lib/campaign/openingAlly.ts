import type { IndexRow } from '../types';
import type { SavedDeck } from '../records';
import type { CampaignHero } from './types';
import { parseSlots } from '../decks';

export function openingAllies(hero: CampaignHero, decks: readonly SavedDeck[], index: readonly IndexRow[], expert: boolean): readonly IndexRow[] {
  const deck = decks.find(d => d.id === (hero.deckId ?? hero.id));
  if (deck === undefined) return [];
  const slots = parseSlots(deck.slots);
  const traits = index.find(c => c.code === hero.heroCardCode)?.traitKeys ?? [];
  return index.filter(c => c.typeCode === 'ally' && (slots.get(c.code) ?? 0) > 0 &&
    (!expert || (c.traitKeys ?? []).some(t => traits.includes(t))));
}
