import type { Card, Locale } from './types';

/** Targeted corrections from Rules Reference 1.8 p69, applied to cached data too. */
export function withCurrentErrata(card: Card, locale: Locale): Card {
  if (!['45017', '45171a'].includes(card.code)) return card;
  const correct = (text: string | null | undefined): string | null | undefined => {
    if (text == null) return text;
    if (card.code === '45017') return locale === 'fr'
      ? text.replace(/pouvant lui être attachée/gi, 'pouvant être attachée à un allié')
      : text.replace(/attached to that ally/gi, 'attached to an ally');
    if (locale === 'fr') return !text.includes('cette phase')
      ? text.replace(/joué dans la zone de mission/gi, 'joué dans la zone de mission lors de cette phase') : text;
    return !text.includes('this phase') ? text.replace(/played to the mission/gi, 'played to the mission this phase') : text;
  };
  return {...card, text: correct(card.text), real_text: correct(card.real_text), rules_reference: '1.8'};
}
