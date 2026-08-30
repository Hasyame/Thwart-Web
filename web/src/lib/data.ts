import type { Card, DataMeta, IndexRow, Locale, Pack } from './types';

/**
 * Loads the files written by `scripts/fetch-cards.mjs`.
 *
 * Everything is cached per locale for the life of the page. The index is
 * loaded once and searched in memory; full card records arrive a pack at a
 * time, because that is how the build splits them and because opening a card
 * only ever needs the pack it came from.
 */

const BASE = `${import.meta.env.BASE_URL}data`;

const indexCache = new Map<Locale, Promise<readonly IndexRow[]>>();
const packsCache = new Map<Locale, Promise<readonly Pack[]>>();
const packCardsCache = new Map<string, Promise<readonly Card[]>>();
let metaCache: Promise<DataMeta> | null = null;

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${url} responded ${response.status}`);
  }
  return (await response.json()) as T;
}

export function loadIndex(locale: Locale): Promise<readonly IndexRow[]> {
  const cached = indexCache.get(locale);
  if (cached !== undefined) {
    return cached;
  }
  const promise = getJson<IndexRow[]>(`${BASE}/index.${locale}.json`).catch(
    (error: unknown) => {
      // Do not cache a failure, or a transient network error permanently
      // breaks the page and the retry button lies.
      indexCache.delete(locale);
      throw error;
    },
  );
  indexCache.set(locale, promise);
  return promise;
}

export function loadPacks(locale: Locale): Promise<readonly Pack[]> {
  const cached = packsCache.get(locale);
  if (cached !== undefined) {
    return cached;
  }
  const promise = getJson<Pack[]>(`${BASE}/packs.${locale}.json`).catch(
    (error: unknown) => {
      packsCache.delete(locale);
      throw error;
    },
  );
  packsCache.set(locale, promise);
  return promise;
}

function loadPackCards(locale: Locale, packCode: string): Promise<readonly Card[]> {
  const key = `${locale}/${packCode}`;
  const cached = packCardsCache.get(key);
  if (cached !== undefined) {
    return cached;
  }
  const promise = getJson<Card[]>(
    `${BASE}/cards/${locale}/${encodeURIComponent(packCode)}.json`,
  ).catch((error: unknown) => {
    packCardsCache.delete(key);
    throw error;
  });
  packCardsCache.set(key, promise);
  return promise;
}

/**
 * Fetches one full card record.
 *
 * Takes the pack code from the already-loaded index rather than searching every
 * pack file, which is the whole reason the index carries it.
 */
export async function loadCard(
  locale: Locale,
  code: string,
  index: readonly IndexRow[],
): Promise<Card | null> {
  const row = index.find((candidate) => candidate.code === code);
  if (row === undefined) {
    return null;
  }
  const cards = await loadPackCards(locale, row.packCode);
  return cards.find((card) => card.code === code) ?? null;
}

export function loadMeta(): Promise<DataMeta> {
  if (metaCache === null) {
    metaCache = getJson<DataMeta>(`${BASE}/meta.json`).catch((error: unknown) => {
      metaCache = null;
      throw error;
    });
  }
  return metaCache;
}

/**
 * Absolute URL for a card image on MarvelCDB.
 *
 * The API returns a host-relative path such as `/bundles/cards/01001a.png`.
 * Images are always taken from the canonical host — they are language-neutral
 * artwork, and the locale subdomains serve the same files. Referenced, never
 * copied: the artwork belongs to Fantasy Flight Games and to Marvel, and
 * nothing in this project re-hosts it.
 */
export function cardImageUrl(imageSrc: string | null | undefined): string | null {
  if (imageSrc === null || imageSrc === undefined || imageSrc.trim() === '') {
    return null;
  }
  if (imageSrc.startsWith('http')) {
    return imageSrc;
  }
  return `https://marvelcdb.com/${imageSrc.replace(/^\/+/, '')}`;
}

export function marvelCdbCardUrl(locale: Locale, code: string): string {
  const host = locale === 'fr' ? 'fr.marvelcdb.com' : 'marvelcdb.com';
  return `https://${host}/card/${encodeURIComponent(code)}`;
}
