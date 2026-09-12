/**
 * That every destination stays reachable, in both arrangements.
 *
 * There is no horizontal scroll anywhere in the navigation and no search over
 * it: a destination that is on no tab and in no sheet is a page nobody can
 * find, and nothing about the app looks broken when it happens. That is the
 * failure this file exists to catch, and grouping the play screens doubles the
 * number of ways to cause it.
 *
 *   npm run test:nav
 */
import { pathForRoute, routeFromPath } from '../src/lib/router.ts';
import {
  DESTINATIONS,
  PLAY_TARGETS,
  TOP_BAR,
  overflowFor,
  tabFor,
  tabsFor,
  visible,
} from '../src/lib/nav.ts';

let failures = 0;
function check(label, ok, detail = '') {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
  if (!ok) {
    failures += 1;
  }
}

const ids = (list) => list.map((d) => d.id);

// --- nothing is lost, either way -------------------------------------------------

for (const grouped of [false, true]) {
  const name = grouped ? 'grouped' : 'separate';
  const reachable = new Set([...ids(tabsFor(grouped)), ...ids(overflowFor(grouped))]);

  // The hub is a door to these four, so with it on a tab they count as reached.
  if (grouped) {
    for (const id of PLAY_TARGETS) {
      reachable.add(id);
    }
  }

  const lost = DESTINATIONS.filter((d) => d.id !== 'hub' && !reachable.has(d.id));
  check(`${name}: every destination is reachable`, lost.length === 0, ids(lost).join(',') || 'none');

  // A destination in both places is the grouping not having grouped anything.
  const tabs = ids(tabsFor(grouped));
  const overflow = ids(overflowFor(grouped));
  const both = tabs.filter((id) => overflow.includes(id));
  check(`${name}: nothing is in two places at once`, both.length === 0, both.join(',') || 'none');

  check(`${name}: four tabs, so the bar keeps its shape`, tabs.length === 4, tabs.join(','));
}

// --- what grouping actually does -------------------------------------------------

{
  check('grouped puts the hub on a tab', ids(tabsFor(true)).includes('hub'));
  check('separate does not', !ids(tabsFor(false)).includes('hub'));

  // The whole point: the four are behind the hub and not loose in the sheet.
  const overflow = ids(overflowFor(true));
  const loose = PLAY_TARGETS.filter((id) => overflow.includes(id));
  check('grouped keeps the play screens out of the More sheet',
    loose.length === 0, loose.join(',') || 'none');

  // And separately, that the old arrangement is untouched. Somebody who never
  // finds the setting must see exactly what they saw before.
  check('separate is what it always was',
    ids(tabsFor(false)).join(',') === 'search,decks,campaigns,play');
  check('separate still lists the random draw in More',
    ids(overflowFor(false)).includes('randomizer'));
}

// --- the hub is never offered where it solves nothing ----------------------------

{
  check('the wide header never shows the hub', !ids(TOP_BAR).includes('hub'));
  check('the wide header shows everything else',
    ids(TOP_BAR).length === DESTINATIONS.length - 1);
  check('the More sheet never shows the hub',
    !ids(overflowFor(true)).includes('hub') && !ids(overflowFor(false)).includes('hub'));
}

// --- which tab lights up ---------------------------------------------------------

{
  check('a card lights the Cards tab', tabFor('card', false) === 'search');
  check('and still does when grouped', tabFor('card', true) === 'search');

  // Without this, walking into /campaigns from the hub lights nothing at all,
  // which reads as having fallen out of the app.
  for (const id of PLAY_TARGETS) {
    check(`grouped: ${id} lights the Play tab`, tabFor(id, true) === 'hub');
    check(`separate: ${id} lights itself`, tabFor(id, false) === id);
  }

  check('the account lights nothing', tabFor('account', true) === 'account');
  check('nor does the BoardGameGeek page', tabFor('bgg', true) === 'bgg');
}

// --- a build with no Versus box --------------------------------------------------

{
  const hidden = new Set(['versus']);
  check('hiding versus removes it from the sheet',
    !ids(visible(overflowFor(false), hidden)).includes('versus'));
  check('and from the wide header',
    !ids(visible(TOP_BAR, hidden)).includes('versus'));
}

// --- a deck's own page, and its editor, as URLs ----------------------------------------------
{
  const there = (path) => routeFromPath(path, '');
  const back = (route) => pathForRoute(route, '');
  check('a deck has a page', JSON.stringify(there('/decks/local-abc')) === JSON.stringify({ name: 'deck', id: 'local-abc' }));
  check('and an editor', JSON.stringify(there('/decks/local-abc/edit')) === JSON.stringify({ name: 'deck', id: 'local-abc', edit: true }));
  check('the shelf is still the shelf', there('/decks').name === 'decks' && there('/decks/').name === 'decks');
  check('an id with odd characters survives the round trip',
    there(back({ name: 'deck', id: 'decklist-40000' })).id === 'decklist-40000' && back({ name: 'deck', id: 'a b', edit: true }) === '/decks/a%20b/edit');
  check('a deck page lights the Decks tab', tabFor('deck', false) === 'decks' && tabFor('deck', true) === 'decks');
  check('BoardGameGeek has a page under Settings',
    there('/settings/bgg').name === 'bgg' && back({ name: 'bgg' }) === '/settings/bgg');
  check('an address nothing answers to is not the home page',
    there('/no-such-page').name === 'notFound' && there('/card').name === 'notFound', there('/no-such-page').name);
  check('and keeps its own path', back(there('/no/such')) === '/no/such');
  check('the root and index.html are the home page',
    there('/').name === 'search' && there('/index.html').name === 'search');
}

console.log(failures === 0 ? '\nPASS' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
