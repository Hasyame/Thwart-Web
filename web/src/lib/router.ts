/**
 * The smallest router that gives real URLs.
 *
 * Real paths rather than hash fragments, because doc 04's whole argument for
 * building the card browser first is that a card is an indexable page. A
 * crawler will not follow `#/card/01001a`.
 *
 * Nine routes, and still not enough to justify a routing library.
 */

export type Route =
  | { readonly name: 'search' }
  | { readonly name: 'collection' }
  | { readonly name: 'randomizer' }
  | { readonly name: 'decks' }
  | { readonly name: 'play' }
  | { readonly name: 'stats' }
  | { readonly name: 'campaigns' }
  | { readonly name: 'rules' }
  | { readonly name: 'card'; readonly code: string };

const CARD_PATH = /^\/card\/([^/]+)\/?$/;
const COLLECTION_PATH = /^\/collection\/?$/;
const RANDOMIZER_PATH = /^\/randomizer\/?$/;
const DECKS_PATH = /^\/decks\/?$/;
const PLAY_PATH = /^\/play\/?$/;
const STATS_PATH = /^\/stats\/?$/;
const CAMPAIGNS_PATH = /^\/campaigns\/?$/;
const RULES_PATH = /^\/rules\/?$/;

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
  if (PLAY_PATH.test(normalised)) {
    return { name: 'play' };
  }
  if (STATS_PATH.test(normalised)) {
    return { name: 'stats' };
  }
  if (CAMPAIGNS_PATH.test(normalised)) {
    return { name: 'campaigns' };
  }
  if (RULES_PATH.test(normalised)) {
    return { name: 'rules' };
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
  if (route.name === 'play') {
    return `${trimmedBase}/play`;
  }
  if (route.name === 'stats') {
    return `${trimmedBase}/stats`;
  }
  if (route.name === 'campaigns') {
    return `${trimmedBase}/campaigns`;
  }
  if (route.name === 'rules') {
    return `${trimmedBase}/rules`;
  }
  return trimmedBase === '' ? '/' : `${trimmedBase}/`;
}
