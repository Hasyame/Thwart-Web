import { pairing, rollUnplayed } from '../src/lib/unplayed.ts';
/**
 * The draw, with extra modular sets on top.
 *
 * Random by nature, so these are invariants over many rolls rather than one
 * seeded draw: the count is exactly what was asked, nothing is drawn twice,
 * nothing mandated is drawn, nothing comes from outside the scenario's own
 * pool, and a collection that cannot supply the request says so rather than
 * quietly drawing fewer. docs/spec/ratings-and-modular-sets.md §1.1.
 *
 *   npm run test:randomizer
 */
import {
  MAX_EXTRA_MODULARS,
  modularCandidatesFor,
  modularShortfall,
  roll,
  scenariosShortOfExtras,
  EMPTY_DRAW,
} from '../src/lib/randomizer.ts';

let failures = 0;
function check(label, ok, detail = '') {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
  if (!ok) {
    failures += 1;
  }
}

const set = (code, packCode) => ({ code, name: code, type: 'modular', packCode });

// Twelve ordinary sets across two packs, and three that belong to MojoMania only.
const MODULARS = [
  ...['a', 'b', 'c', 'd', 'e', 'f'].map((c) => set(c, 'core')),
  ...['g', 'h', 'i', 'j', 'k', 'l'].map((c) => set(c, 'hood')),
  ...['mojo1', 'mojo2', 'mojo3'].map((c) => set(c, 'mojo')),
];

const RHINO = { code: 'rhino', packCode: 'core', modularCount: 1, mandatoryModulars: ['a'], recommendedModulars: [] };
const KLAW = { code: 'klaw', packCode: 'core', modularCount: 1, mandatoryModulars: [], recommendedModulars: [] };
// One set plus one per hero, and only from its own pack, as MojoMania is read.
const MOJO = { code: 'mojo', packCode: 'mojo', modularCount: 1, modularCountPerHero: 1, mandatoryModulars: [], recommendedModulars: [], modularPacks: ['mojo'] };

const pools = {
  scenarios: [RHINO, KLAW, MOJO],
  modularSets: MODULARS,
  heroes: [{ code: 'h1', name: 'One' }, { code: 'h2', name: 'Two' }],
  difficulties: ['STANDARD_I'],
  ownedDifficulties: ['STANDARD_I'],
  aspects: ['justice'],
};

const ROLLS = 300;
const rollsWith = (extras, locked = new Set(), previous = EMPTY_DRAW, playerCount = 1) =>
  Array.from({ length: ROLLS }, () => roll({ pools, previous, locked, playerCount, extraModularSets: extras }));

// --- zero extras is exactly today -------------------------------------------------

{
  const draws = rollsWith(0);
  const counts = new Set(draws.map((d) => d.modularSetCodes.length + d.mandatoryModularCodes.length));
  check('with no extras, every scenario draws its own count', [...counts].every((n) => n === 1 || n === 2),
    [...counts].join(','));
  check('and the default is zero', roll({ pools, previous: EMPTY_DRAW, locked: new Set(), playerCount: 1 }).modularSetCodes.length <= 2);
}

// --- extras are added, exactly ---------------------------------------------------

{
  const locked = new Set(['scenario']);
  const onKlaw = { ...EMPTY_DRAW, scenarioCode: 'klaw' };
  for (const extras of [1, 3, 5]) {
    const draws = rollsWith(extras, locked, onKlaw);
    check(`${extras} extra(s) on Klaw draws ${1 + extras}`,
      draws.every((d) => d.modularSetCodes.length === 1 + extras),
      [...new Set(draws.map((d) => d.modularSetCodes.length))].join(','));
    check(`  and never the same set twice`,
      draws.every((d) => new Set(d.modularSetCodes).size === d.modularSetCodes.length));
  }
  const over = rollsWith(9, locked, onKlaw);
  check('more than the cap is clamped to the cap', over.every((d) => d.modularSetCodes.length === 1 + MAX_EXTRA_MODULARS));
}

// --- mandated sets are placed, not drawn, and never drawn again -------------------

{
  const draws = rollsWith(3, new Set(['scenario']), { ...EMPTY_DRAW, scenarioCode: 'rhino' });
  check('the mandated set is always placed', draws.every((d) => d.mandatoryModularCodes.join(',') === 'a'));
  check('and is never among the drawn ones', draws.every((d) => !d.modularSetCodes.includes('a')));
  check('the scenario count plus extras is honoured beside it', draws.every((d) => d.modularSetCodes.length === 3),
    [...new Set(draws.map((d) => d.modularSetCodes.length))].join(','));
}

// --- a scenario with its own pool keeps to it, extras included ---------------------

{
  const draws = rollsWith(1, new Set(['scenario']), { ...EMPTY_DRAW, scenarioCode: 'mojo' }, 1);
  check('MojoMania extras come only from MojoMania',
    draws.every((d) => d.modularSetCodes.every((c) => c.startsWith('mojo'))));
  check('solo takes one plus one per hero plus the extra', draws.every((d) => d.modularSetCodes.length === 3),
    [...new Set(draws.map((d) => d.modularSetCodes.length))].join(','));
}

// --- what the collection cannot supply is said, not silently shortened -------------

{
  check('candidates exclude the mandated set', !modularCandidatesFor(pools, RHINO).some((s) => s.code === 'a'));
  check('candidates respect the scenario pool', modularCandidatesFor(pools, MOJO).length === 3);

  // MojoMania has three sets. Solo takes two, so one extra fits and two do not.
  check('one extra on MojoMania is not short', modularShortfall(pools, MOJO, 1, 1) === 0);
  check('two extras on MojoMania are short by one', modularShortfall(pools, MOJO, 1, 2) === 1, String(modularShortfall(pools, MOJO, 1, 2)));
  check('the shortfall grows with the table', modularShortfall(pools, MOJO, 2, 1) === 1);

  check('no scenario is short with no extras', scenariosShortOfExtras(pools, 1, 0).length === 0);
  check('with two extras, MojoMania is the one that is short',
    scenariosShortOfExtras(pools, 1, 2).map((r) => r.code).join(',') === 'mojo');

  // Unlocked, the short scenario is left out of the draw rather than drawn short.
  const draws = rollsWith(2);
  check('and is then never drawn', draws.every((d) => d.scenarioCode !== 'mojo'));
  // On the table: the scenario's own count plus the extras. Rhino's mandated
  // set is its count of one, so it draws two and places one; Klaw draws three.
  check('while the others put their full request on the table',
    draws.every((d) => d.scenarioCode === null || d.modularSetCodes.length + d.mandatoryModularCodes.length === 1 + 2),
    [...new Set(draws.map((d) => `${d.scenarioCode}:${d.modularSetCodes.length}+${d.mandatoryModularCodes.length}`))].join(' '));

  // Locked, the player's choice stands, and the page is what warns them.
  const kept = roll({ pools, previous: { ...EMPTY_DRAW, scenarioCode: 'mojo' }, locked: new Set(['scenario']), playerCount: 1, extraModularSets: 2 });
  check('a locked short scenario is kept', kept.scenarioCode === 'mojo');
  check('and draws what there is rather than nothing', kept.modularSetCodes.length === 3);
}

// --- locking the modular sets keeps the extras ------------------------------------

{
  const first = roll({ pools, previous: { ...EMPTY_DRAW, scenarioCode: 'klaw' }, locked: new Set(['scenario']), playerCount: 1, extraModularSets: 3 });
  const again = roll({ pools, previous: first, locked: new Set(['scenario', 'modularSets']), playerCount: 1, extraModularSets: 3 });
  check('locked modular sets survive a reroll, extras included', again.modularSetCodes.join(',') === first.modularSetCodes.join(','));
}

{
  const played = new Set(pools.scenarios.flatMap((s) => pools.heroes.map((h) => pairing(h.code, s.code))));
  const input = { pools, previous: EMPTY_DRAW, locked: new Set(), playerCount: 1 };
  check('unplayed reports an exhausted history', rollUnplayed(input, played) === null);
  played.delete(pairing('h1', 'rhino'));
  const drawn = rollUnplayed(input, played);
  check('unplayed finds the only remaining pair', drawn?.scenarioCode === 'rhino' && drawn.heroes[0]?.code === 'h1');
  check('unplayed requires new pairs for every seat', rollUnplayed({ ...input, playerCount: 2 }, played) === null);
  check('unplayed respects scenario lock', rollUnplayed({ ...input, previous: { ...EMPTY_DRAW, scenarioCode: 'klaw' }, locked: new Set(['scenario']) }, played) === null);
}
console.log(failures === 0 ? '\nPASS' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
