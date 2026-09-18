import type { Route } from './router';
import type { Strings } from './i18n';
import type { Locale } from './types';

/**
 * What the document says about itself, per page.
 *
 * A single-page app has one `index.html`, so without this every page shares
 * one title and one description, which is what a search engine files it
 * under and what a shared link shows. Google renders the JavaScript and reads
 * the DOM it produces, so a title set here is the title it indexes — but it
 * has to be set on every navigation, not once at load, or every deep link
 * carries the home page's words.
 *
 * Two things are kept out of the index on purpose:
 *
 *  - **Private pages.** The history, statistics, decks, account and the BGG
 *    page show what this browser holds; crawled, they render as empty screens
 *    with a sign-in prompt, which is not a result anyone should land on.
 *  - **Card pages.** Thousands of them, each carrying MarvelCDB's card text.
 *    Indexing them would be indexing MarvelCDB's content under this domain —
 *    the reference asset is theirs, and a card search that ranks above its
 *    source is not something to want. They stay linkable and titled, since a
 *    shared card link deserves a card's name on it, but `noindex`.
 *
 * Pure: returns what to set, and `applyHead` sets it. So the mapping can be
 * tested without a DOM.
 */

export const SITE_ORIGIN = 'https://thwart.app';

export interface Head {
  readonly title: string;
  readonly description: string;
  /** Absolute, without a query string: the page, not the view of it. */
  readonly canonical: string;
  readonly noindex: boolean;
}

/** Routes that show this browser's own data, and nothing to a crawler. */
const PRIVATE: ReadonlySet<Route['name']> = new Set([
  'history',
  'stats',
  'decks',
  'deck',
  'account',
  'bgg',
  'verify',
  'notFound',
]);

/** Where a route lives, for the canonical. The router's own reverse mapping. */
export function headFor(
  route: Route,
  t: Strings,
  pathOf: (route: Route) => string,
  cardName: string | null = null,
): Head {
  const seo = t.seo;
  const page = ((): { title: string; description: string } => {
    switch (route.name) {
      case 'home':
        return { title: seo.homeTitle, description: seo.homeDescription };
      case 'search':
        return { title: seo.cardsTitle, description: seo.cardsDescription };
      case 'card':
        return {
          title: cardName === null || cardName === '' ? seo.cardTitle : seo.cardTitleNamed(cardName),
          description: seo.cardDescription,
        };
      case 'collection':
        return { title: seo.collectionTitle, description: seo.collectionDescription };
      case 'randomizer':
        return { title: seo.randomizerTitle, description: seo.randomizerDescription };
      case 'versus':
        return { title: seo.versusTitle, description: seo.versusDescription };
      case 'play':
      case 'hub':
        return { title: seo.playTitle, description: seo.playDescription };
      case 'campaigns':
        return { title: seo.campaignsTitle, description: seo.campaignsDescription };
      case 'rules':
        return { title: seo.rulesTitle, description: seo.rulesDescription };
      case 'decks':
      case 'deck':
        return { title: seo.decksTitle, description: seo.decksDescription };
      case 'draft':
        return { title: seo.draftTitle, description: seo.draftDescription };
      case 'history':
        return { title: seo.historyTitle, description: seo.historyDescription };
      case 'stats':
        return { title: seo.statsTitle, description: seo.statsDescription };
      case 'account':
      case 'verify':
        return { title: seo.accountTitle, description: seo.accountDescription };
      case 'bgg':
        return { title: seo.bggTitle, description: seo.bggDescription };
      case 'notFound':
        return { title: seo.notFoundTitle, description: seo.notFoundDescription };
    }
  })();

  // The path without its query: a filtered history is the history page.
  const path = pathOf(route).split('?')[0] ?? '/';
  return {
    title: page.title,
    description: page.description,
    canonical: `${SITE_ORIGIN}${path === '' ? '/' : path}`,
    noindex: PRIVATE.has(route.name) || route.name === 'card',
  };
}

function meta(selector: string, attribute: 'name' | 'property', key: string): HTMLMetaElement {
  let element = document.head.querySelector<HTMLMetaElement>(selector);
  if (element === null) {
    element = document.createElement('meta');
    element.setAttribute(attribute, key);
    document.head.append(element);
  }
  return element;
}

/** Writes a head into the document. Idempotent: the same tags, updated in place. */
export function applyHead(head: Head, locale: Locale): void {
  document.title = head.title;
  document.documentElement.lang = locale;

  meta('meta[name="description"]', 'name', 'description').content = head.description;
  meta('meta[property="og:title"]', 'property', 'og:title').content = head.title;
  meta('meta[property="og:description"]', 'property', 'og:description').content = head.description;
  meta('meta[property="og:url"]', 'property', 'og:url').content = head.canonical;
  meta('meta[property="og:locale"]', 'property', 'og:locale').content =
    locale === 'fr' ? 'fr_FR' : 'en_GB';
  meta('meta[name="robots"]', 'name', 'robots').content = head.noindex ? 'noindex, follow' : 'index, follow';

  let canonical = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (canonical === null) {
    canonical = document.createElement('link');
    canonical.rel = 'canonical';
    document.head.append(canonical);
  }
  canonical.href = head.canonical;
}
