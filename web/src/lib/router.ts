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
  | { readonly name: 'versus' }
  | { readonly name: 'decks' }
  | { readonly name: 'play' }
  | { readonly name: 'stats' }
  | { readonly name: 'campaigns' }
  | { readonly name: 'rules' }
  /**
   * The games and campaigns already played.
   *
   * The filters ride in the query string rather than in component state, so a
   * filtered view is a URL: it can be bookmarked, shared, and comes back the
   * same after a reload. `play` opens one game's detail and `run` one
   * campaign's, both by id, for the same reason.
   */
  | { readonly name: 'history'; readonly filter?: HistoryFilter }
  /** The account, which exists whether or not anybody is signed in to one. */
  | { readonly name: 'account' }
  /**
   * Where the link in a confirmation message lands.
   *
   * The token rides in the query string rather than the path, because that is
   * what a mail client will not try to be clever about, and because it keeps
   * the secret out of the part of the URL a crawler would treat as a page.
   */
  | { readonly name: 'verify'; readonly token: string }
  | { readonly name: 'card'; readonly code: string };

const CARD_PATH = /^\/card\/([^/]+)\/?$/;
const COLLECTION_PATH = /^\/collection\/?$/;
const RANDOMIZER_PATH = /^\/randomizer\/?$/;
const VERSUS_PATH = /^\/versus\/?$/;
const DECKS_PATH = /^\/decks\/?$/;
const PLAY_PATH = /^\/play\/?$/;
const STATS_PATH = /^\/stats\/?$/;
const CAMPAIGNS_PATH = /^\/campaigns\/?$/;
const RULES_PATH = /^\/rules\/?$/;
const ACCOUNT_PATH = /^\/account\/?$/;
const VERIFY_PATH = /^\/verify\/?$/;
const HISTORY_PATH = /^\/history\/?$/;

/**
 * The filter state a history URL carries.
 *
 * Every field is optional and absent means no restriction, which is what makes
 * `/history` with no query string the whole history rather than nothing.
 *
 * Dates are `YYYY-MM-DD` rather than epoch millis: a URL somebody might paste
 * into a message should be readable, and a day is what the control offers.
 */
export interface HistoryFilter {
  readonly from?: string;
  readonly to?: string;
  readonly hero?: string;
  readonly aspect?: string;
  readonly scenario?: string;
  readonly result?: 'won' | 'lost';
  readonly campaign?: string;
  /** A game's id, when one is open. */
  readonly play?: string;
  /** A campaign run's id, when one is open. */
  readonly run?: string;
}

const HISTORY_KEYS = [
  'from',
  'to',
  'hero',
  'aspect',
  'scenario',
  'result',
  'campaign',
  'play',
  'run',
] as const;

function historyFilterFrom(search: string): HistoryFilter {
  const params = new URLSearchParams(search);
  const out: Record<string, string> = {};
  for (const key of HISTORY_KEYS) {
    const value = params.get(key)?.trim();
    if (value !== undefined && value !== '') {
      out[key] = value;
    }
  }
  // Anything else is not a result. A URL saying `result=maybe` should show
  // everything rather than nothing at all.
  if (out.result !== 'won' && out.result !== 'lost') {
    delete out.result;
  }
  return out as HistoryFilter;
}

/** The query string for a filter, with the empty fields left out. */
export function historyQuery(filter: HistoryFilter): string {
  const params = new URLSearchParams();
  for (const key of HISTORY_KEYS) {
    const value = filter[key];
    if (value !== undefined && value !== '') {
      params.set(key, value);
    }
  }
  const query = params.toString();
  return query === '' ? '' : `?${query}`;
}

export function routeFromPath(pathname: string, base: string, search = ''): Route {
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
  if (VERSUS_PATH.test(path)) {
    return { name: 'versus' };
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
  if (ACCOUNT_PATH.test(normalised)) {
    return { name: 'account' };
  }
  if (VERIFY_PATH.test(normalised)) {
    return { name: 'verify', token: new URLSearchParams(search).get('token') ?? '' };
  }
  if (HISTORY_PATH.test(normalised)) {
    return { name: 'history', filter: historyFilterFrom(search) };
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
  if (route.name === 'versus') {
    return `${trimmedBase}/versus`;
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
  if (route.name === 'account') {
    return `${trimmedBase}/account`;
  }
  if (route.name === 'history') {
    return `${trimmedBase}/history${historyQuery(route.filter ?? {})}`;
  }
  if (route.name === 'verify') {
    // Written without the token. The address bar keeps the one it arrived with;
    // this is only ever used to build a link *to* the page, and a link that
    // carried somebody's token would be a link that confirms their account.
    return `${trimmedBase}/verify`;
  }
  return trimmedBase === '' ? '/' : `${trimmedBase}/`;
}
