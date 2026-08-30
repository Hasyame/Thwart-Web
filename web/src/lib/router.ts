/**
 * The smallest router that gives real URLs.
 *
 * Real paths rather than hash fragments, because doc 04's whole argument for
 * building the card browser first is that a card is an indexable page. A
 * crawler will not follow `#/card/01001a`.
 *
 * Five routes is still not enough to justify a routing library.
 */

export type Route =
  | { readonly name: 'search' }
  | { readonly name: 'collection' }
  | { readonly name: 'randomizer' }
  | { readonly name: 'decks' }
  | { readonly name: 'card'; readonly code: string };

const CARD_PATH = /^\/card\/([^/]+)\/?$/;
const COLLECTION_PATH = /^\/collection\/?$/;
const RANDOMIZER_PATH = /^\/randomizer\/?$/;
const DECKS_PATH = /^\/decks\/?$/;

export function routeFromPath(pathname: string, base: string): Route {
  const trimmedBase = base.endsWith('/') ? base.slice(0, -1) : base;
  const path = pathname.startsWith(trimmedBase)
    ? pathname.slice(trimmedBase.length)
    : pathname;

  const normalised = path === '' ? '/' : path;

  const match = CARD_PATH.exec(normalised);
  if (match !== null && match[1] !== undefined) {
    return { name: 'card', code: decodeURIComponent(match[1]) };
  }
  if (COLLECTION_PATH.test(normalised)) {
    return { name: 'collection' };
  }
  if (RANDOMIZER_PATH.test(normalised)) {
    return { name: 'randomizer' };
  }
  if (DECKS_PATH.test(normalised)) {
    return { name: 'decks' };
  }
  return { name: 'search' };
}

export function pathForRoute(route: Route, base: string): string {
  const trimmedBase = base.endsWith('/') ? base.slice(0, -1) : base;
  if (route.name === 'card') {
    return `${trimmedBase}/card/${encodeURIComponent(route.code)}`;
  }
  if (route.name === 'collection') {
    return `${trimmedBase}/collection`;
  }
  if (route.name === 'randomizer') {
    return `${trimmedBase}/randomizer`;
  }
  if (route.name === 'decks') {
    return `${trimmedBase}/decks`;
  }
  return trimmedBase === '' ? '/' : `${trimmedBase}/`;
}
