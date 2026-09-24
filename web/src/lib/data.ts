import { localisedCardImage } from './cardImages';
import type { Card, CardSet, DataMeta, IndexRow, Locale, Pack } from './types';
import type { ScenarioRulesFile } from './randomizer';

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

const setsCache = new Map<Locale, Promise<readonly CardSet[]>>();

export function loadSets(locale: Locale): Promise<readonly CardSet[]> {
  const cached = setsCache.get(locale);
  if (cached !== undefined) {
    return cached;
  }
  const promise = getJson<CardSet[]>(`${BASE}/sets.${locale}.json`).catch(
    (error: unknown) => {
      setsCache.delete(locale);
      throw error;
    },
  );
  setsCache.set(locale, promise);
  return promise;
}

export function loadPackCards(
  locale: Locale,
  packCode: string,
): Promise<readonly Card[]> {
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
 * Full card records for a set of packs, keyed by code.
 *
 * A deck draws on several packs at once and needs more than the search index
 * carries — images for the previews, resource icons for the composition, the
 * deck-building fields for legality. Pack files are cached after the first
 * load, so opening a second deck from the same boxes costs nothing.
 */
export async function loadCardsByCode(
  locale: Locale,
  packCodes: Iterable<string>,
): Promise<Map<string, Card>> {
  const packs = [...new Set(packCodes)];
  const loaded = await Promise.all(
    // A pack that fails to load must not take the whole deck view with it:
    // the cards from it simply stay unresolved, which the view reports.
    packs.map((pack) => loadPackCards(locale, pack).catch((): readonly Card[] => [])),
  );
  const byCode = new Map<string, Card>();
  for (const cards of loaded) {
    for (const card of cards) {
      byCode.set(card.code, card);
    }
  }
  return byCode;
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

let rulesCache: Promise<ScenarioRulesFile> | null = null;

/**
 * Scenario setup rules: modular counts and mandatory sets, per scenario.
 *
 * Locale-independent by design — the file holds no names, because those come
 * from the card database already localised.
 */
export function loadScenarioRules(): Promise<ScenarioRulesFile> {
  if (rulesCache === null) {
    rulesCache = getJson<ScenarioRulesFile>(`${BASE}/scenario-rules.json`).catch(
      (error: unknown) => {
        rulesCache = null;
        throw error;
      },
    );
  }
  return rulesCache;
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
 * Absolute URL for a card image.
 *
 * The API returns a host-relative path such as `/bundles/cards/01001a.png`.
 * In English that is MarvelCDB's picture; MarvelCDB's locale subdomains serve
 * the same English files. With French cards the picture is a French scan
 * from the community sites, falling back to MarvelCDB (lib/cardImages).
 * Referenced, never copied: the artwork belongs to Fantasy Flight Games and
 * to Marvel, and nothing in this project re-hosts it.
 */
export function cardImageUrl(imageSrc: string | null | undefined): string | null {
  if (imageSrc === null || imageSrc === undefined || imageSrc.trim() === '') {
    return null;
  }
  return localisedCardImage(imageSrc);
}

export function marvelCdbCardUrl(locale: Locale, code: string): string {
  const host = locale === 'fr' ? 'fr.marvelcdb.com' : 'marvelcdb.com';
  return `https://${host}/card/${encodeURIComponent(code)}`;
}
