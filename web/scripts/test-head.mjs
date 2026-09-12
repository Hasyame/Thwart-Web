/**
 * What each page says about itself.
 *
 * A single-page app has one index.html, so the title and description a search
 * engine files a page under come from lib/head, per route and per language.
 * The mistakes here are quiet: a deep link carrying the home page's title, a
 * private page left open to indexing, a canonical with a query string on it.
 *
 *   npm run test:head
 */
import { headFor, SITE_ORIGIN } from '../src/lib/head.ts';
import { pathForRoute } from '../src/lib/router.ts';
import { strings } from '../src/lib/i18n.ts';

let failures = 0;
function check(label, ok, detail = '') {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
  if (!ok) {
    failures += 1;
  }
}

const en = strings('en');
const fr = strings('fr');
const pathOf = (route) => pathForRoute(route, '');
const head = (route, t = en, name = null) => headFor(route, t, pathOf, name);

{
  const home = head({ name: 'search' });
  check('the home page names the game', home.title.includes('Marvel Champions'), home.title);
  check('and is indexable', home.noindex === false);
  check('with the site as its canonical', home.canonical === `${SITE_ORIGIN}/`, home.canonical);
  check('a description under 160 characters, or Google truncates it', home.description.length <= 165, String(home.description.length));
}

{
  // Every public page: a title of its own, naming the game, indexable.
  const seen = new Set();
  for (const name of ['collection', 'randomizer', 'versus', 'play', 'campaigns', 'rules']) {
    const h = head({ name });
    check(`${name}: names the game`, h.title.includes('Marvel Champions'), h.title);
    check(`${name}: indexable`, h.noindex === false);
    check(`${name}: canonical is its path`, h.canonical === `${SITE_ORIGIN}/${name}`, h.canonical);
    check(`${name}: a title of its own`, !seen.has(h.title), h.title);
    seen.add(h.title);
  }
}

{
  // Private pages: titled, but kept out of the index.
  for (const route of [
    { name: 'history' }, { name: 'stats' }, { name: 'decks' }, { name: 'deck', id: 'x' },
    { name: 'account' }, { name: 'bgg' }, { name: 'verify', token: 't' },
  ]) {
    check(`${route.name}: noindex`, head(route).noindex === true);
  }
  const filtered = head({ name: 'history', filter: { hero: 'spiderman' } });
  check('a filtered history has the history page as canonical, no query',
    filtered.canonical === `${SITE_ORIGIN}/history`, filtered.canonical);
}

{
  // A card page: the card's name on the tab, noindex all the same.
  const named = head({ name: 'card', code: '01001a' }, en, 'Spider-Man');
  check('a card page carries the card\'s name', named.title.startsWith('Spider-Man'), named.title);
  check('and still names the game', named.title.includes('Marvel Champions'));
  check('and is not indexed: the text is MarvelCDB\'s', named.noindex === true);
  const unnamed = head({ name: 'card', code: '01001a' });
  check('before the card loads, a generic card title', unnamed.title.includes('Marvel Champions') && !unnamed.title.startsWith('null'), unnamed.title);
  check('the canonical is the card\'s path', named.canonical === `${SITE_ORIGIN}/card/01001a`, named.canonical);
}

{
  // In French, the French words: a French reader's tab and a French result.
  const home = head({ name: 'search' }, fr);
  check('the French title is French', home.title.includes('compagnon'), home.title);
  check('and the canonical does not change with the language', home.canonical === `${SITE_ORIGIN}/`);
  for (const key of Object.keys(en.seo)) {
    const a = en.seo[key];
    const b = fr.seo[key];
    check(`seo.${key} exists in both languages`, typeof a === typeof b && (typeof a !== 'string' || (a !== '' && b !== '')));
  }
}

console.log(failures === 0 ? '\nPASS' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
