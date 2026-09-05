/**
 * The filters that narrow the card list.
 *
 * Four of them arrived late and each has one way of being quietly wrong: a
 * cost range that swallows every card with no printed cost, an owned-only
 * filter reading the card rather than its pack, a trait filter that matches a
 * card whose name happens to contain the word, and a favourites filter keyed
 * on the wrong column. All four are asserted here rather than eyeballed,
 * because each failure looks like a short list and not like an error.
 *
 *   npm run test:filters
 */
import {
  EMPTY_COLLECTION,
  NO_FILTERS,
  activeFilterCount,
  searchCards,
} from '../src/lib/search.ts';
import { normalizeForSearch } from '../src/lib/normalize.js';

let failures = 0;
function check(label, ok, detail = '') {
  if (ok) {
    console.log(`ok    ${label}${detail ? `  (${detail})` : ''}`);
  } else {
    failures += 1;
    console.log(`FAIL  ${label}${detail ? `  (${detail})` : ''}`);
  }
}

const row = (code, extra = {}) => ({
  code,
  name: extra.name ?? code,
  subname: null,
  packCode: extra.packCode ?? 'core',
  setCode: null,
  typeCode: extra.typeCode ?? 'ally',
  typeName: 'Ally',
  factionCode: extra.factionCode ?? 'justice',
  factionName: 'Justice',
  cost: 'cost' in extra ? extra.cost : 2,
  isUnique: false,
  traits: extra.traits ?? [],
  s: normalizeForSearch([extra.name ?? code, ...(extra.traits ?? [])].join(' ')),
});

const find = (index, filters, collection = EMPTY_COLLECTION) =>
  searchCards(index, { query: '', filters: { ...NO_FILTERS, ...filters }, limit: 100, collection })
    .rows.map((r) => r.code)
    .sort();

// --- traits --------------------------------------------------------------------------

{
  const index = [
    row('a', { name: 'Black Widow', traits: ['Avenger', 'Spy'] }),
    row('b', { name: 'Spy Games', traits: ['Attack'] }),
    row('c', { name: 'Hawkeye', traits: ['Avenger'] }),
  ];

  check('a trait filter finds the cards carrying it', find(index, { trait: 'Avenger' }).join(',') === 'a,c');
  check(
    'and not a card whose name merely contains the word',
    find(index, { trait: 'Spy' }).join(',') === 'a',
    'Spy Games is named for it, and does not have it',
  );
  check('the comparison ignores case', find(index, { trait: 'avenger' }).join(',') === 'a,c');
  check(
    'a card from an index built before traits existed simply has none',
    find([{ ...row('old'), traits: undefined }], { trait: 'Avenger' }).length === 0,
  );
  check('typing the trait still finds both, which is the search and not the filter',
    searchCards(index, { query: 'spy', filters: NO_FILTERS, limit: 100 }).total === 2);
}

// --- cost ----------------------------------------------------------------------------

{
  const index = [
    row('free', { cost: 0 }),
    row('one', { cost: 1 }),
    row('three', { cost: 3 }),
    row('hero', { cost: null }),
  ];

  check('a lower bound is inclusive', find(index, { minCost: 1 }).join(',') === 'one,three');
  check('an upper bound is inclusive', find(index, { maxCost: 1 }).join(',') === 'free,one');
  check('both together are a range', find(index, { minCost: 1, maxCost: 1 }).join(',') === 'one');
  /*
   * The one that would go unnoticed: heroes, villains and most encounter cards
   * print no cost, and treating that as zero puts the entire villain deck at
   * the top of every low-cost search.
   */
  check(
    'a card with no printed cost is not cost zero',
    !find(index, { maxCost: 0 }).includes('hero'),
    `got ${find(index, { maxCost: 0 }).join(',') || 'nothing'}`,
  );
  check('and is not in a range at all', find(index, { minCost: 0, maxCost: 9 }).join(',') === 'free,one,three');
  check('while no bound leaves it in', find(index, {}).includes('hero'));
}

// --- what the collection says ----------------------------------------------------------

{
  const index = [
    row('owned', { packCode: 'core' }),
    row('unowned', { packCode: 'gob' }),
    row('starred', { packCode: 'gob' }),
  ];
  const collection = {
    ownedPacks: new Set(['core']),
    favourites: new Set(['starred']),
  };

  check(
    'owned-only reads the pack, not the card',
    find(index, { ownedOnly: true }, collection).join(',') === 'owned',
  );
  check(
    'favourites-only reads the card',
    find(index, { favouritesOnly: true }, collection).join(',') === 'starred',
  );
  check(
    'the two narrow together rather than widening',
    find(index, { ownedOnly: true, favouritesOnly: true }, collection).length === 0,
    'the starred card is in a pack that is not owned',
  );
  check(
    'with nothing known, owned-only shows nothing rather than everything',
    find(index, { ownedOnly: true }).length === 0,
    'an empty collection means no pack is owned, which is the honest reading',
  );
}

// --- the count the interface shows -------------------------------------------------------

{
  check('nothing set is nothing active', activeFilterCount(NO_FILTERS) === 0);
  check('a switch counts', activeFilterCount({ ...NO_FILTERS, ownedOnly: true }) === 1);
  check('a switch left off does not', activeFilterCount({ ...NO_FILTERS, ownedOnly: false }) === 0);
  check(
    'a cost of zero counts, because zero is a real bound',
    activeFilterCount({ ...NO_FILTERS, maxCost: 0 }) === 1,
  );
  check(
    'several count together',
    activeFilterCount({ ...NO_FILTERS, trait: 'Avenger', minCost: 1, favouritesOnly: true }) === 3,
  );
}

process.exit(failures === 0 ? 0 : 1);
