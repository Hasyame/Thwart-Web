/**
 * The numbers a campaign counts with when the card database cannot.
 *
 * Fear No Evil's subordinates are the campaign's own invention and are on no
 * database, so for that campaign the template is the only source there is.
 * Without this the whole campaign has no tracker at all — nothing counting
 * down, nothing counting up — which is most of what a companion is opened for.
 *
 * The three things that go wrong quietly, and are asserted here against the
 * real template rather than a fixture:
 *
 *   - a stage played on one difficulty only, so an expert table does not count
 *     a villain down to a number printed on a card that is not on the table;
 *   - the threat a job already carries from the pressure against it, which is
 *     not on the card and cannot be;
 *   - a scheme dealt to each player rather than once to the table.
 *
 *   npm run test:tracker
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { trackerSetupFor } from '../src/lib/campaign/encounter.ts';
import { EMPTY_STATE, amountFor } from '../src/lib/campaign/types.ts';
import {
  roundEnded,
  schemeCopies,
  startOf,
  threatenedOn,
  threatOn,
  totalFor,
} from '../src/lib/encounter.ts';

let failures = 0;
function check(label, ok, detail = '') {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
  if (!ok) {
    failures += 1;
  }
}

const FILE = join(import.meta.dirname, '..', 'public', 'data', 'campaigns', 'fne.json');
if (!existsSync(FILE)) {
  console.error('No campaign templates. Run `npm run campaigns` first.');
  process.exit(1);
}
const fne = JSON.parse(readFileSync(FILE, 'utf8'));

/*
 * Everything below reads the template, so a copy without the block is a
 * failure and not something to skip: it means the campaign data this runner
 * has is older than the code, and the tests would otherwise pass by testing
 * nothing.
 */
check('Fear No Evil carries its own numbers', fne.tracker != null);
if (fne.tracker == null) {
  console.error('  fne.json has no tracker block; run `npm run campaigns`.');
  process.exit(1);
}

const heroes = [
  { id: 'h1', heroCardCode: '01001a', name: 'Peter' },
  { id: 'h2', heroCardCode: '01029a', name: 'Carol' },
  { id: 'h3', heroCardCode: '01029b', name: 'Jess' },
];

const scenarioOf = (id) => (fne.scenarios ?? []).find((s) => s.id === id) ?? null;

const stateFor = ({ difficulty = 'standard', counters = {}, draws = {}, scenarioId }) => ({
  ...EMPTY_STATE,
  templateId: 'fne',
  difficulty,
  heroes,
  counters,
  draws,
  currentScenarioId: scenarioId,
});

// --- amounts ------------------------------------------------------------------

{
  const perBox = { counter: 'pressionMusee', perUnit: 1, perUnitExpert: 2, threshold: 1 };
  check('below the threshold an amount is nothing', amountFor(perBox, 0, false) === 0);
  check('one per box on standard', amountFor(perBox, 2, false) === 2);
  check('two per box on expert', amountFor(perBox, 2, true) === 4);

  // La Poursuite puts a single token on its tanker once two boxes are ticked;
  // the museum puts one on its scheme for every box. Same shape, one flag.
  const once = { counter: 'x', perUnit: 1, threshold: 2, once: true };
  check('a once amount does not multiply', amountFor(once, 3, false) === 1);
  check('and is still nothing below its threshold', amountFor(once, 1, false) === 0);
}

// --- a job with pressure on it ---------------------------------------------------

{
  const scenario = scenarioOf('s1_musee');
  const clean = trackerSetupFor(fne, stateFor({ scenarioId: 's1_musee' }), scenario, 2);
  const pressed = trackerSetupFor(
    fne,
    stateFor({ scenarioId: 's1_musee', counters: { pressionMusee: 2 } }),
    scenario,
    2,
  );

  check('a job the campaign describes produces a scheme', (clean?.scheme.length ?? 0) > 0);

  const cleanStart = startOf(clean).progress.threat;
  const pressedStart = startOf(pressed).progress.threat;
  check(
    'pressure puts threat on the job before anybody sits down',
    pressedStart > cleanStart,
    `${cleanStart} -> ${pressedStart}`,
  );

  // The printed threat is per player and the pressure is flat, so the two must
  // not be scaled together.
  const pressedThree = trackerSetupFor(
    fne,
    stateFor({ scenarioId: 's1_musee', counters: { pressionMusee: 2 } }),
    scenario,
    3,
  );
  const three = startOf(pressedThree).progress.threat;
  check(
    'the pressure is not multiplied by the players a second time',
    three - cleanStart * 1.5 === pressedStart - cleanStart,
    `two: ${pressedStart}, three: ${three}`,
  );
}

// --- a subordinate played on one difficulty only ---------------------------------

{
  const villainId = fne.villainPool?.[0];
  const scenario = scenarioOf('s1_musee');
  const draws = { s1_musee: { villain: [villainId] } };

  const standard = trackerSetupFor(
    fne,
    stateFor({ scenarioId: 's1_musee', draws }),
    scenario,
    2,
  );
  const expert = trackerSetupFor(
    fne,
    stateFor({ scenarioId: 's1_musee', draws, difficulty: 'expert' }),
    scenario,
    2,
  );

  const stages = (setup) => setup.villain.map((side) => side.stage).join(',');
  check('the drawn subordinate brings its own stages', standard.villain.length > 0, stages(standard));
  check(
    'standard and expert are not the same two stages',
    stages(standard) !== stages(expert),
    `standard ${stages(standard)} vs expert ${stages(expert)}`,
  );

  // The health is per player, so a two-handed table counts to twice the print.
  const first = standard.villain[0];
  check(
    'health scales with the table',
    totalFor(first, 2) === (first.value ?? 0) * 2,
    `${first.value} printed, ${totalFor(first, 2)} for two`,
  );
}

// --- a scheme each ----------------------------------------------------------------

{
  const racket = trackerSetupFor(
    fne,
    stateFor({ scenarioId: 's3_racket' }),
    scenarioOf('s3_racket'),
    3,
  );
  const museum = trackerSetupFor(
    fne,
    stateFor({ scenarioId: 's1_musee' }),
    scenarioOf('s1_musee'),
    3,
  );

  check('the racket deals a scheme to each player', racket?.schemeCopies === 3);
  check('an ordinary job deals one to the table', (museum?.schemeCopies ?? 1) === 1);

  let game = startOf(racket);
  check('every copy starts where the card starts it', schemeCopies(game) === 3);

  // Thwarting one is thwarting one, not all of them: they finish at different
  // times, which is the whole reason they are counted apart.
  game = threatenedOn(game, 1, 4);
  check(
    'threat goes on the copy it was put on',
    threatOn(game, 1) - threatOn(game, 0) === 4,
    `copy 0: ${threatOn(game, 0)}, copy 1: ${threatOn(game, 1)}`,
  );

  // A table playing one scheme each is a table where each of them speeds up.
  const before = [0, 1, 2].map((copy) => threatOn(game, copy));
  const after = roundEnded(game);
  const moved = [0, 1, 2].map((copy) => threatOn(after, copy) - before[copy]);
  check(
    'every copy accelerates at the end of a round',
    moved.every((step) => step === moved[0]) && moved[0] > 0,
    `by ${moved.join(', ')}`,
  );
}

// --- a campaign that carries nothing ---------------------------------------------

{
  const plain = JSON.parse(
    readFileSync(join(import.meta.dirname, '..', 'public', 'data', 'campaigns', 'aoa.json'), 'utf8'),
  );
  const scenario = (plain.scenarios ?? [])[0];
  check(
    'a campaign without a tracker block asks the card database instead',
    trackerSetupFor(plain, stateFor({ scenarioId: scenario.id }), scenario, 2) === null,
  );
}

process.exit(failures === 0 ? 0 : 1);
