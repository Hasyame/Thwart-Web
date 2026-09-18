import { loadCard } from './data';
import type { Card, IndexRow, Locale, Pack } from './types';

/**
 * Looking at a card without leaving the page you are on.
 *
 * A campaign setup step names a dozen cards, and following one of them by
 * navigating away means losing your place in a list somebody is reading with
 * cards in their other hand. So the card opens *over* the page instead, and
 * closing it puts you back exactly where you were.
 *
 * A singleton, deliberately. One card window at a time is the whole point, and
 * the alternative is threading the index and the card language through every
 * component that might mention a card.
 */

interface Config {
  index: readonly IndexRow[];
  cardLocale: Locale;
  packs: readonly Pack[];
}

const config = $state<Config>({ index: [], cardLocale: 'en', packs: [] });

/** Told once, by the root, since only it knows which language the cards are in. */
export function configureCardViewer(index: readonly IndexRow[], cardLocale: Locale, packs: readonly Pack[] = []): void {
  config.index = index;
  config.cardLocale = cardLocale;
  config.packs = packs;
}

/** The index and the packs as the root gave them, for what a card detail counts from them. */
export const viewerIndex = (): readonly IndexRow[] => config.index;
export const viewerPacks = (): readonly Pack[] => config.packs;

export const viewer = $state<{ code: string | null }>({ code: null });

export const showCard = (code: string): void => {
  viewer.code = code;
};

export const hideCard = (): void => {
  viewer.code = null;
};

/**
 * True when this code is a card the database can actually show.
 *
 * Fear No Evil names its jobs with ids of its own — `s2_poursuite` — which the
 * template gives a name but MarvelCDB has never heard of. Those read as plain
 * text rather than pretending to be openable and then failing.
 */
export const isKnownCard = (code: string): boolean =>
  config.index.some((row) => row.code === code);

const cache = new Map<string, Promise<Card | null>>();

/** One card, cached, so hovering the same reference twice costs one fetch. */
export function fetchCard(code: string): Promise<Card | null> {
  const key = `${config.cardLocale}/${code}`;
  const cached = cache.get(key);
  if (cached !== undefined) {
    return cached;
  }
  const promise = loadCard(config.cardLocale, code, config.index).catch(() => {
    cache.delete(key);
    return null;
  });
  cache.set(key, promise);
  return promise;
}

export const viewerLocale = (): Locale => config.cardLocale;
