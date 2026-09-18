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
  /** The front door: what is new, where everything is. */
  | { readonly name: 'home' }
  /** The card search, with the words typed so far when a link carries them. */
  | { readonly name: 'search'; readonly query?: string }
  | { readonly name: 'collection' }
  | { readonly name: 'achievements' }
  | { readonly name: 'randomizer' }
  | { readonly name: 'versus' }
  | { readonly name: 'decks' }
  /** The draft: decks built from the collection, a pick at a time. */
  | { readonly name: 'draft' }
  /**
   * One deck on a page of its own, to read or, with `edit`, to build.
   *
   * A URL because a deck is a thing people send each other and come back
   * to, and because the back button should leave the editor for the deck
   * and the deck for the shelf, not the site.
   */
  | { readonly name: 'deck'; readonly id: string; readonly edit?: boolean }
  | { readonly name: 'play' }
  /**
   * The Play hub: the four ways of playing on one screen, as the phone has it.
   *
   * Deliberately not `/play`. That path is your own setup and stays that way
   * whichever navigation somebody has chosen, because a URL that meant one
   * thing on one device and another elsewhere is a URL nobody can share.
   */
  | { readonly name: 'hub' }
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
  /** The BoardGameGeek connection, a page of its own under Settings. */
  | { readonly name: 'bgg' }
  /**
   * An address nothing answers to. Its own page rather than the home page,
   * so a mistyped link says so, and so a crawler sees `noindex` rather than
   * a second copy of the home page under a made-up address; nginx answers
   * such paths with a real 404 status and this document.
   */
  | { readonly name: 'notFound'; readonly path: string }
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
const CARDS_PATH = /^\/cards\/?$/;
const COLLECTION_PATH = /^\/collection\/?$/;
const ACHIEVEMENTS_PATH = /^\/achievements\/?$/;
const RANDOMIZER_PATH = /^\/randomizer\/?$/;
const VERSUS_PATH = /^\/versus\/?$/;
const DECKS_PATH = /^\/decks\/?$/;
const DRAFT_PATH = /^\/draft\/?$/;
const DECK_PATH = /^\/decks\/([^/]+)(\/edit)?\/?$/;
const PLAY_PATH = /^\/play\/?$/;
const HUB_PATH = /^\/hub\/?$/;
const STATS_PATH = /^\/stats\/?$/;
const CAMPAIGNS_PATH = /^\/campaigns\/?$/;
const RULES_PATH = /^\/rules\/?$/;
const ACCOUNT_PATH = /^\/account\/?$/;
const BGG_PATH = /^\/settings\/bgg\/?$/;
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
  /** `1` to show only starred games. */
  readonly favourite?: string;
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
  'favourite',
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
  if (ACHIEVEMENTS_PATH.test(normalised)) {
    return { name: 'achievements' };
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
  if (DRAFT_PATH.test(normalised)) {
    return { name: 'draft' };
  }
  const deck = DECK_PATH.exec(normalised);
  if (deck !== null && deck[1] !== undefined) {
    return deck[2] === undefined
      ? { name: 'deck', id: decodeURIComponent(deck[1]) }
      : { name: 'deck', id: decodeURIComponent(deck[1]), edit: true };
  }
  if (PLAY_PATH.test(normalised)) {
    return { name: 'play' };
  }
  if (HUB_PATH.test(normalised)) {
    return { name: 'hub' };
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
  if (BGG_PATH.test(normalised)) {
    return { name: 'bgg' };
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
  // The search, with a query when the address carries one: what a search
  // engine's sitelinks box sends, and what a shared search link is.
  if (CARDS_PATH.test(normalised)) {
    const q = new URLSearchParams(search).get('q');
    return q === null || q === '' ? { name: 'search' } : { name: 'search', query: q };
  }
  // The home page, by its root and by the name the file has on disk: a
  // request for /index.html is the same document, not a missing one.
  if (normalised === '/' || normalised === '/index.html') {
    return { name: 'home' };
  }
  return { name: 'notFound', path: normalised };
}

export function pathForRoute(route: Route, base: string): string {
  const trimmedBase = base.endsWith('/') ? base.slice(0, -1) : base;
  if (route.name === 'card') {
    return `${trimmedBase}/card/${encodeURIComponent(route.code)}`;
  }
  if (route.name === 'search') {
    const q = route.query === undefined || route.query === '' ? '' : `?q=${encodeURIComponent(route.query)}`;
    return `${trimmedBase}/cards${q}`;
  }
  if (route.name === 'collection') {
    return `${trimmedBase}/collection`;
  }
  if (route.name === 'achievements') {
    return `${trimmedBase}/achievements`;
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
  if (route.name === 'draft') {
    return `${trimmedBase}/draft`;
  }
  if (route.name === 'deck') {
    return `${trimmedBase}/decks/${encodeURIComponent(route.id)}${route.edit === true ? '/edit' : ''}`;
  }
  if (route.name === 'play') {
    return `${trimmedBase}/play`;
  }
  if (route.name === 'hub') {
    return `${trimmedBase}/hub`;
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
  if (route.name === 'bgg') {
    return `${trimmedBase}/settings/bgg`;
  }
  if (route.name === 'notFound') {
    return `${trimmedBase}${route.path}`;
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
