/**
 * The condition evaluator, and whether the types cover the real templates.
 *
 * A mistake here does not crash anything. It quietly changes what a campaign
 * does, several scenarios later, in a way nobody can trace back, which is why
 * the port is line for line and why this exists.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { evaluate } from '../src/lib/campaign/conditions.ts';
import { EMPTY_STATE, amountFor, amountInputOf } from '../src/lib/campaign/types.ts';

let failures = 0;
function check(label, ok, detail = '') {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
  if (!ok) {
    failures += 1;
  }
}

const heroes = [
  { id: 'h1', heroCardCode: '01001a', name: 'Spider-Man' },
  { id: 'h2', heroCardCode: '01002a', name: 'Captain Marvel' },
];
const state = (over = {}) => ({ ...EMPTY_STATE, heroes, ...over });

// --- the empty condition ------------------------------------------------------

check('no condition is true', evaluate(null, { state: state() }));
check('an empty condition is true', evaluate({}, { state: state() }));

// --- difficulty ---------------------------------------------------------------

check('difficulty matches', evaluate({ difficulty: 'standard' }, { state: state() }));
check('difficulty is case insensitive', evaluate({ difficulty: 'STANDARD' }, { state: state() }));
check('difficulty can fail', !evaluate({ difficulty: 'expert' }, { state: state() }));

// --- answers ------------------------------------------------------------------

{
  const answers = { booleans: { rescued: true }, choices: { path: 'left' } };
  check('answer true', evaluate({ answer: 'rescued' }, { state: state(), answers }));
  check('answer missing is false', evaluate({ answer: 'other' }, { state: state(), answers }) === false);
  check('notAnswer', evaluate({ notAnswer: 'other' }, { state: state(), answers }));
  check('notAnswer fails when true', !evaluate({ notAnswer: 'rescued' }, { state: state(), answers }));

  check('choice matches', evaluate({ choice: 'path', choiceIs: 'left' }, { state: state(), answers }));
  check('choice can fail', !evaluate({ choice: 'path', choiceIs: 'right' }, { state: state(), answers }));
  // choice without choiceIs asserts nothing, which is what the app does.
  check('choice alone is true', evaluate({ choice: 'path' }, { state: state(), answers }));
}

// --- per-hero answers ---------------------------------------------------------

{
  const answers = { perHeroBooleans: { wounded: { h1: true } } };
  check('heroAnswer for the right hero', evaluate({ heroAnswer: 'wounded' }, { state: state(), answers, heroId: 'h1' }));
  check('heroAnswer for another hero', !evaluate({ heroAnswer: 'wounded' }, { state: state(), answers, heroId: 'h2' }));
  // Without a hero there is nobody to ask, so it cannot hold.
  check('heroAnswer with no hero is false', !evaluate({ heroAnswer: 'wounded' }, { state: state(), answers }));
  check('notHeroAnswer with no hero is false', !evaluate({ notHeroAnswer: 'wounded' }, { state: state(), answers }));
  check('notHeroAnswer for another hero', evaluate({ notHeroAnswer: 'wounded' }, { state: state(), answers, heroId: 'h2' }));
}

// --- card lists ---------------------------------------------------------------

{
  const s = state({ cardLists: { scars: ['01001', '01002', '01003'] } });
  check('contains', evaluate({ cardList: 'scars', contains: '01002' }, { state: s }));
  check('notContains', evaluate({ cardList: 'scars', notContains: '01099' }, { state: s }));
  check('minSize', evaluate({ cardList: 'scars', minSize: 3 }, { state: s }));
  check('minSize can fail', !evaluate({ cardList: 'scars', minSize: 4 }, { state: s }));
  check('maxSize', evaluate({ cardList: 'scars', maxSize: 3 }, { state: s }));

  // Two heroes, so "1 per player or fewer" allows two and this has three.
  check('perPlayer multiplies the bound', !evaluate({ cardList: 'scars', maxSize: 1, perPlayer: true }, { state: s }));
  check('perPlayer allows the scaled amount', evaluate({ cardList: 'scars', maxSize: 2, perPlayer: true }, { state: s }));
  // With one hero it is not multiplied at all.
  const solo = state({ heroes: [heroes[0]], cardLists: { scars: ['a', 'b'] } });
  check('perPlayer with one hero', !evaluate({ cardList: 'scars', maxSize: 1, perPlayer: true }, { state: solo }));
}

// --- flags --------------------------------------------------------------------

{
  const s = state({ flags: { beaten: { s1: true, '': false }, ally: { '': true } } });
  check('flag named with a scenario', evaluate({ flag: 'beaten.s1' }, { state: s }));
  check('flag named with another scenario', !evaluate({ flag: 'beaten.s2' }, { state: s }));
  // Bare, it reads the current scenario's slot first.
  check('bare flag reads the current scenario', evaluate({ flag: 'beaten' }, { state: s, scenarioId: 's1' }));
  check('bare flag in another scenario', !evaluate({ flag: 'beaten' }, { state: s, scenarioId: 's2' }));
  // And falls back to the campaign-scoped slot.
  check('bare flag falls back to the campaign', evaluate({ flag: 'ally' }, { state: s, scenarioId: 's2' }));
  check('notFlag', evaluate({ notFlag: 'beaten' }, { state: s, scenarioId: 's2' }));
}

// --- an amount read off a set of flags ------------------------------------------

{
  /*
   * A computed amount usually reads a counter. It can instead name a `flagSet`
   * and be measured by how many of that set's flags are true — how many jobs
   * have been settled is a count of flags rather than a number anybody keeps.
   *
   * Declaring the key is not the same as honouring it, which is the whole point
   * of this block. An amount whose counter does not exist reads as zero, zero
   * is below every threshold, and a step carrying it is simply never shown. So
   * the sweep further down would pass on a build that ignored `flagSet`
   * entirely, and the campaign would quietly skip a setup instruction.
   */
  const s = state({ flags: { acheve: { s1: true, s2: true, s3: false } }, counters: { acheve: 99 } });

  check(
    'an amount on a flag set counts the true flags',
    amountInputOf(s, { flagSet: 'acheve' }) === 2,
    `got ${amountInputOf(s, { flagSet: 'acheve' })}`,
  );
  check(
    'and does not read a counter that happens to share the name',
    amountInputOf(s, { flagSet: 'acheve' }) !== 99,
  );
  check(
    'an amount with no flag set still reads its counter',
    amountInputOf(s, { counter: 'acheve' }) === 99,
  );
  check('an absent amount is nothing', amountInputOf(s, null) === 0);

  // And the whole way through, which is what the templates actually do: below
  // the threshold the step is not shown, at or above it the amount is real.
  check(
    'below the threshold a flag-set amount is nothing',
    amountFor({ flagSet: 'acheve', threshold: 3 }, amountInputOf(s, { flagSet: 'acheve' }), false) === 0,
  );
  check(
    'at the threshold it is one per flag',
    amountFor({ flagSet: 'acheve', threshold: 2 }, amountInputOf(s, { flagSet: 'acheve' }), false) === 2,
  );
  check(
    'and expert reads its own per-unit',
    amountFor(
      { flagSet: 'acheve', threshold: 1, perUnit: 1, perUnitExpert: 2 },
      amountInputOf(s, { flagSet: 'acheve' }),
      true,
    ) === 4,
  );
}

// --- countTrue ----------------------------------------------------------------

{
  const s = state({ flags: { beaten: { s1: true, s2: true, s3: false } } });
  check('countTrue alone means at least one', evaluate({ countTrue: 'beaten' }, { state: s }));
  check('countTrue on an empty set', !evaluate({ countTrue: 'missing' }, { state: s }));
  check('countAtLeast', evaluate({ countTrue: 'beaten', countAtLeast: 2 }, { state: s }));
  check('countAtLeast can fail', !evaluate({ countTrue: 'beaten', countAtLeast: 3 }, { state: s }));
  check('countAtMost', evaluate({ countTrue: 'beaten', countAtMost: 2 }, { state: s }));
  // A bound of zero is a real bound, not an absent one.
  check('countAtMost zero', !evaluate({ countTrue: 'beaten', countAtMost: 0 }, { state: s }));
}

// --- counters -----------------------------------------------------------------

{
  const s = state({ counters: { credits: 5 }, heroCounters: { wounds: { h1: 3, h2: 0 } } });
  check('counter atLeast', evaluate({ counter: 'credits', atLeast: 5 }, { state: s }));
  check('counter atMost', evaluate({ counter: 'credits', atMost: 5 }, { state: s }));
  check('counter equals', evaluate({ counter: 'credits', equals: 5 }, { state: s }));
  check('counter equals can fail', !evaluate({ counter: 'credits', equals: 4 }, { state: s }));

  // A hero-scoped counter resolves to the hero being evaluated.
  check('hero counter for h1', evaluate({ counter: 'wounds', atLeast: 3 }, { state: s, heroId: 'h1' }));
  check('hero counter for h2', !evaluate({ counter: 'wounds', atLeast: 1 }, { state: s, heroId: 'h2' }));
  // With no hero it reads the campaign counter, which is zero here.
  check('hero counter with no hero reads the campaign', !evaluate({ counter: 'wounds', atLeast: 1 }, { state: s }));
}

// --- anyHero ------------------------------------------------------------------

{
  const s = state({ heroCounters: { stone: { h1: 1, h2: 0 } } });
  check('anyHero holds when one does', evaluate({ anyHero: { counter: 'stone', atLeast: 1 } }, { state: s }));
  check('anyHero fails when none do', !evaluate({ anyHero: { counter: 'stone', atLeast: 2 } }, { state: s }));
}

// --- draws --------------------------------------------------------------------

{
  const s = state({ draws: { s1: { mission: ['31088'] } } });
  check('drawIs', evaluate({ drawIs: 'mission:31088' }, { state: s, scenarioId: 's1' }));
  check('drawIs for another card', !evaluate({ drawIs: 'mission:31089' }, { state: s, scenarioId: 's1' }));
  check('drawIs in another scenario', !evaluate({ drawIs: 'mission:31088' }, { state: s, scenarioId: 's2' }));
}

// --- nesting ------------------------------------------------------------------

{
  const s = state({ counters: { credits: 5 } });
  check('all holds', evaluate({ all: [{ counter: 'credits', atLeast: 1 }, { difficulty: 'standard' }] }, { state: s }));
  check('all fails on one', !evaluate({ all: [{ counter: 'credits', atLeast: 9 }, { difficulty: 'standard' }] }, { state: s }));
  check('any holds on one', evaluate({ any: [{ counter: 'credits', atLeast: 9 }, { difficulty: 'standard' }] }, { state: s }));
  check('any fails on none', !evaluate({ any: [{ counter: 'credits', atLeast: 9 }, { difficulty: 'expert' }] }, { state: s }));
  // Fields alongside a nesting are ANDed with it, not replaced by it.
  check('a field beside any still applies', !evaluate({ difficulty: 'expert', any: [{ difficulty: 'standard' }] }, { state: s }));
}

// --- do the types cover the real templates? -----------------------------------

/*
The sweep that matters for a ported schema.

A key present in the templates but missing from the TypeScript is not a type
error: it is silently dropped, and whatever rule it expressed stops happening.
So every key at every depth of all nine templates is collected and checked
against what the port declares.
*/
{
  const dir = join(import.meta.dirname, '..', 'public', 'data', 'campaigns');
  if (!existsSync(dir)) {
    console.error('No campaign templates. Run `npm run campaigns` first.');
    process.exit(1);
  }

  const declared = new Set(
    readFileSync(join(import.meta.dirname, '..', 'src', 'lib', 'campaign', 'types.ts'), 'utf8')
      .split('\n')
      .map((line) => /^\s*readonly ([A-Za-z0-9_]+)\??:/.exec(line)?.[1])
      .filter((name) => name !== undefined),
  );
  // Written in the JSON, named differently or handled specially in the port.
  for (const known of ['when', 'type', 'fr', 'en', '_note']) {
    declared.add(known);
  }

  /*
   * Fields whose keys are data, not field names.
   *
   * setupFragments is "fragment id to steps", villainDeck is "difficulty to
   * codes", localCardNames is "card code to name". Their keys are written by
   * whoever wrote the campaign, so the level below them is skipped rather than
   * checked, which is what turns this into a real assertion instead of a
   * report somebody has to eyeball.
   */
  const FREE_FORM = new Set([
    'setupFragments',
    'localCardNames',
    'villainDeck',
    'villainDecks',
    'counts',
    'perHeroPools',
    // The campaign's own tracker: villains keyed by the id their draw uses,
    // schemes by scenario id.
    'villains',
    'schemes',
  ]);

  const keys = new Set();
  const collect = (value, parent = '') => {
    if (Array.isArray(value)) {
      value.forEach((entry) => collect(entry, parent));
    } else if (value !== null && typeof value === 'object') {
      const dataKeyed = FREE_FORM.has(parent);
      for (const [key, nested] of Object.entries(value)) {
        if (!dataKeyed) {
          keys.add(key);
        }
        // villainDecks nests twice: difficulty, then slot. Both levels are
        // data, so the marker is carried down one more.
        collect(nested, dataKeyed && parent === 'villainDecks' ? parent : key);
      }
    }
  };

  let templates = 0;
  for (const file of readdirSync(dir)) {
    if (file === 'index.json' || !file.endsWith('.json')) {
      continue;
    }
    collect(JSON.parse(readFileSync(join(dir, file), 'utf8')));
    templates += 1;
  }

  const unknown = [...keys].filter((key) => !declared.has(key)).sort();

  console.log(`      swept ${templates} templates, ${keys.size} distinct keys`);

  if (unknown.length > 0) {
    console.log(`      undeclared: ${unknown.join(', ')}`);
  }
  check('every key in every template is declared', unknown.length === 0, `${unknown.length} unknown`);
}

process.exit(failures === 0 ? 0 : 1);
