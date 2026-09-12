/**
 * The picks the app makes so the players do not have to.
 *
 * Where the rules say "randomly select an available X", the app draws it and
 * writes it down. Two things have to hold or that is worse than asking: the
 * draw must not be made twice for the same setup, and it must not change while
 * somebody is reading the setup off it. Both come from the same property —
 * these functions say nothing when the log already holds the answer — so that
 * is what most of this checks.
 *
 * The sweep at the end is the other half: every question and every effect in
 * every bundled campaign has to be one this client understands. A question it
 * does not understand is not an error anywhere, it is simply never asked, and
 * the campaign quietly diverges from the app's.
 *
 *   npm run test:deal
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  environmentOfferFor,
  setupDrawsFor,
  villainAssignmentFor,
  VILLAIN_DRAW_ID,
} from '../src/lib/campaign/deal.ts';
import { allSetupSteps, expandTemplate } from '../src/lib/campaign/engine.ts';
import { EFFECT_OPS, EMPTY_STATE, PROMPT_TYPES, promptTypeOf } from '../src/lib/campaign/types.ts';

let failures = 0;
function check(label, ok, detail = '') {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
  if (!ok) {
    failures += 1;
  }
}

/** Deterministic, so a failure is reproducible rather than a bad afternoon. */
function seeded(seed) {
  let value = seed;
  return () => {
    value = (value * 1103515245 + 12345) % 2147483648;
    return value / 2147483648;
  };
}

/** What the log would look like after these draws were filed. */
const withDraws = (state, pending) => {
  const draws = { ...state.draws };
  for (const draw of pending) {
    draws[draw.scenarioId] = { ...(draws[draw.scenarioId] ?? {}), [draw.drawId]: draw.cardCodes };
  }
  return { ...state, draws };
};

// --- setup draws ----------------------------------------------------------------

const heroes = [
  { id: 'h1', heroCardCode: '01001a', name: 'Peter' },
  { id: 'h2', heroCardCode: '01029a', name: 'Carol' },
];

const template = {
  id: 't',
  schemaVersion: 1,
  name: { en: 'Test' },
  scenarios: [
    {
      id: 's1',
      campaignSetup: [
        { text: { en: 'Deal two' }, draw: { id: 'rooms', from: ['a', 'b', 'c', 'd'], count: 2 } },
        {
          text: { en: 'One each' },
          draw: { id: 'gear', from: ['g1', 'g2', 'g3', 'g4'], count: 1, perHero: true },
        },
      ],
      // A draw written into the information block was never dealt at all before
      // every section was walked, which is how one whole face went undrawn.
      information: [{ text: { en: 'And one more' }, draw: { id: 'face', from: ['f1', 'f2'] } }],
    },
  ],
};

const base = { ...EMPTY_STATE, templateId: 't', heroes, currentScenarioId: 's1' };

{
  const pending = setupDrawsFor(template, base, seeded(7));
  const byId = new Map(pending.map((draw) => [draw.drawId, draw.cardCodes]));

  check('a plain draw deals what it asks for', byId.get('rooms')?.length === 2);
  check('and never the same card twice', new Set(byId.get('rooms')).size === 2);
  check('a per-hero draw deals to each player', byId.has('gear|h1') && byId.has('gear|h2'));
  check('a draw in the information block is dealt too', byId.has('face'));

  // The whole point: run again over a log that already holds them and nothing
  // is dealt. Without this, every reload of the briefing rerolled the mission.
  const again = setupDrawsFor(template, withDraws(base, pending), seeded(99));
  check('nothing is dealt twice', again.length === 0, `${again.length} extra`);
}

{
  // An offer deals several for the players to choose between, rather than
  // dealing one and deciding for them.
  const offering = {
    ...template,
    scenarios: [
      {
        id: 's1',
        campaignSetup: [{ text: { en: 'Pick one' }, draw: { id: 'boon', from: ['a', 'b', 'c'], offer: 2 } }],
      },
    ],
  };
  const pending = setupDrawsFor(offering, base, seeded(3));
  check('an offer deals as many as it offers', pending[0]?.cardCodes.length === 2);
}

{
  // A pool the log has emptied refills, because a scenario that needs a card
  // must get one and an empty setup step reads as a bug.
  const spending = {
    ...template,
    scenarios: [
      {
        id: 's1',
        campaignSetup: [
          { text: { en: 'Deal' }, draw: { id: 'rooms', from: ['a', 'b'], excluding: 'used', count: 1 } },
        ],
      },
    ],
  };
  const spent = { ...base, cardLists: { used: ['a', 'b'] } };
  const pending = setupDrawsFor(spending, spent, seeded(1));
  check('an emptied pool still deals something', pending[0]?.cardCodes.length === 1);
}

{
  // A draw written into a shared fragment.
  //
  // This is the shape that went wrong: the briefing pulled fragments in as it
  // rendered, so the step was on screen, while the dealer walked the scenario's
  // own steps and never saw it. Age of Apocalypse keeps both of its draws that
  // way, so neither the MISSION nor the OVERSEER was ever dealt — and neither
  // was cleared on a replay, because the engine reads the same list.
  const shared = {
    id: 't',
    schemaVersion: 1,
    name: { en: 'Test' },
    setupFragments: {
      missions: [{ text: { en: 'Deal one' }, draw: { id: 'mission', from: ['m1', 'm2'] } }],
    },
    scenarios: [{ id: 's1', campaignSetup: [{ include: 'missions' }] }],
  };

  check('a fragment hides its draw until it is spelled out',
    setupDrawsFor(shared, base, seeded(4)).length === 0);
  check('and the expanded template deals it',
    setupDrawsFor(expandTemplate(shared), base, seeded(4))[0]?.drawId === 'mission');

  // An include naming a fragment that does not exist is left in place rather
  // than dropped, so it shows up as a step with nothing in it.
  const missing = { ...shared, scenarios: [{ id: 's1', campaignSetup: [{ include: 'nope' }] }] };
  check('a missing fragment leaves its step alone',
    (expandTemplate(missing).scenarios[0].campaignSetup ?? []).length === 1);
}

// --- who is behind the job -------------------------------------------------------

const TEMPLATES = join(import.meta.dirname, '..', 'public', 'data', 'campaigns');
if (!existsSync(TEMPLATES)) {
  console.error('No campaign templates. Run `npm run campaigns` first.');
  process.exit(1);
}

const templates = new Map();
for (const file of readdirSync(TEMPLATES)) {
  if (file === 'index.json' || !file.endsWith('.json')) {
    continue;
  }
  const parsed = JSON.parse(readFileSync(join(TEMPLATES, file), 'utf8'));
  templates.set(parsed.id, parsed);
}

const fne = templates.get('fne');
if (fne === undefined) {
  check('Fear No Evil is bundled', false);
} else {
  const jobs = (fne.scenarios ?? [])
    .map((scenario) => scenario.id)
    .filter((id) => id !== fne.finaleScenarioId);

  let state = { ...EMPTY_STATE, templateId: 'fne', heroes, currentScenarioId: jobs[0] };
  const random = seeded(11);
  const assigned = [];

  for (const job of jobs.slice(0, fne.villainPool.length)) {
    state = { ...state, currentScenarioId: job };
    const draw = villainAssignmentFor(fne, state, random);
    if (draw === null) {
      break;
    }
    assigned.push(draw.cardCodes[0]);
    state = withDraws(state, [draw]);
  }

  check(
    'every job gets a different subordinate',
    assigned.length > 1 && new Set(assigned).size === assigned.length,
    assigned.join(', '),
  );

  // A name once noted is kept, which is why a job that is retried faces the
  // same villain rather than rerolling on every visit.
  state = { ...state, currentScenarioId: jobs[0] };
  check('an assignment already made is left alone', villainAssignmentFor(fne, state, random) === null);

  // The last villain brings his own; he is not one of the five.
  const finale = { ...state, currentScenarioId: fne.finaleScenarioId };
  check('the finale is not dealt one', villainAssignmentFor(fne, finale, random) === null);

  const recommended = {
    ...EMPTY_STATE,
    templateId: 'fne',
    heroes,
    currentScenarioId: jobs[0],
    choices: { villainOrder: 'recommended' },
  };
  check(
    'the recommended order is the book’s own',
    villainAssignmentFor(fne, recommended, seeded(5))?.cardCodes[0] === fne.villainPool[0],
  );

  /*
   * The book's fourth entry is "Purple Man or Typhoid Mary": one line for two
   * villains. So the first three come in order, the fourth is drawn between
   * the last two, and the fifth is whoever was not.
   */
  const pool = fne.villainPool;
  const tail = new Set(pool.slice(-2));
  const walk = (seed) => {
    const random = seeded(seed);
    let state = recommended;
    const order = [];
    for (const job of jobs.slice(0, pool.length)) {
      state = { ...state, currentScenarioId: job };
      const draw = villainAssignmentFor(fne, state, random);
      order.push(draw.cardCodes[0]);
      state = withDraws(state, [draw]);
    }
    return order;
  };
  const orders = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(walk);
  check(
    'the first three come in the book’s order',
    orders.every((order) => order.slice(0, 3).join(',') === pool.slice(0, 3).join(',')),
    orders.find((order) => order.slice(0, 3).join(',') !== pool.slice(0, 3).join(','))?.join(',') ?? '',
  );
  check(
    'the fourth is one of the last two',
    orders.every((order) => tail.has(order[3])),
    orders.map((order) => order[3]).join(', '),
  );
  check(
    'and the fifth is the other',
    orders.every((order) => tail.has(order[4]) && order[4] !== order[3]),
  );
  check(
    'drawn, not taken first: both come fourth over enough campaigns',
    new Set(orders.map((order) => order[3])).size === 2,
    [...new Set(orders.map((order) => order[3]))].join(', '),
  );
  check(
    'and every villain is dealt exactly once',
    orders.every((order) => new Set(order).size === pool.length),
  );

  // --- the rotation ---------------------------------------------------------

  const waiting = { ...EMPTY_STATE, templateId: 'fne', heroes, awaitingChoice: true };
  const offered = environmentOfferFor(fne, waiting, seeded(2));
  check('the villains push two places', offered?.length === 2, (offered ?? []).join(', '));

  check(
    'a rotation already read is not dealt again',
    environmentOfferFor(fne, { ...waiting, environmentPicked: true }, seeded(2)) === null,
  );
  check(
    'nothing is dealt while a scenario is being played',
    environmentOfferFor(fne, { ...waiting, awaitingChoice: false }, seeded(2)) === null,
  );

  // Only places still in play go back in the pile: the book takes the
  // environments of finished jobs out first, and without that the villains kept
  // hitting jobs the players had already put to bed.
  const won = jobs.slice(0, jobs.length - 1).map((id) => ({
    eventId: id,
    scenarioId: id,
    victory: true,
    answers: {},
    elapsedMillis: 0,
    timestamp: 0,
  }));
  const nearlyDone = { ...waiting, completedScenarios: won };
  const last = environmentOfferFor(fne, nearlyDone, seeded(2));
  check('the last place standing is dealt alone', last?.length === 1, (last ?? []).join(', '));
}

// --- every draw every bundled campaign asks for ----------------------------------

{
  // The real check on expansion: for every scenario of every campaign, the
  // draws its setup declares are the draws that get dealt. A draw the dealer
  // cannot see is not an error anywhere — the step simply shows nothing, and
  // the table plays a scenario the campaign did not set up.
  const undealt = [];
  for (const [id, raw] of templates) {
    const expanded = expandTemplate(raw);
    for (const scenario of expanded.scenarios ?? []) {
      const declared = allSetupSteps(scenario)
        .map((step) => step.draw)
        .filter((draw) => draw != null)
        // A draw with only per-hero pools deals from the role that player
        // picked, so with nobody having picked one there is nothing to deal.
        // That is the rule working, not a draw going missing.
        .filter((draw) => (draw.from ?? []).length > 0);
      if (declared.length === 0) {
        continue;
      }
      const state = { ...EMPTY_STATE, templateId: id, heroes, currentScenarioId: scenario.id };
      const dealt = new Set(
        setupDrawsFor(expanded, state, seeded(13)).map((draw) =>
          draw.drawId.includes('|') ? draw.drawId.slice(0, draw.drawId.indexOf('|')) : draw.drawId,
        ),
      );
      for (const draw of declared) {
        if (!dealt.has(draw.id)) {
          undealt.push(`${id}/${scenario.id}:${draw.id}`);
        }
      }
    }
  }
  check('every draw a scenario declares is dealt', undealt.length === 0, undealt.slice(0, 6).join(', '));
}

{
  // The other half of that rule: once a player has a role, their pool is theirs
  // alone. Dealing from the table's pool instead would hand somebody else's
  // upgrade to a player who never chose that role.
  const mg = templates.get('mg');
  const withRole = {
    ...EMPTY_STATE,
    templateId: 'mg',
    heroes,
    currentScenarioId: mg?.startScenarioId ?? '',
    heroCardLists: { role: { h1: ['role:brawler'] } },
  };
  const dealt = setupDrawsFor(expandTemplate(mg ?? {}), withRole, seeded(6));
  const upgrade = dealt.find((draw) => draw.drawId.startsWith('roleUpgrade|'));
  check('a player with a role is dealt from their own pool', upgrade?.drawId === 'roleUpgrade|h1');
  check(
    'and a player without one is dealt nothing',
    !dealt.some((draw) => draw.drawId === 'roleUpgrade|h2'),
  );
}

// --- every question and every effect in every bundled campaign --------------------

const ops = new Set(EFFECT_OPS);
const kinds = new Set(PROMPT_TYPES);
const unknownPrompts = [];
const unknownOps = [];
const emptyPools = [];
let prompts = 0;
let effects = 0;

const walk = (node, templateId) => {
  if (Array.isArray(node)) {
    node.forEach((entry) => walk(entry, templateId));
    return;
  }
  if (node === null || typeof node !== 'object') {
    return;
  }
  if (typeof node.op === 'string') {
    effects += 1;
    if (!ops.has(node.op.toLowerCase())) {
      unknownOps.push(`${templateId}:${node.op}`);
    }
  }
  if (typeof node.type === 'string' && typeof node.id === 'string' && node.op === undefined) {
    prompts += 1;
    const kind = promptTypeOf(node);
    if (!kinds.has(kind)) {
      unknownPrompts.push(`${templateId}:${node.type}`);
    }
  }
  if (node.draw && typeof node.draw === 'object') {
    const pools = Object.values(node.draw.perHeroPools ?? {});
    const anyPool = (node.draw.from ?? []).length > 0 || pools.some((pool) => pool.length > 0);
    if (!anyPool) {
      emptyPools.push(`${templateId}:${node.draw.id}`);
    }
  }
  Object.values(node).forEach((value) => walk(value, templateId));
};

for (const [id, parsed] of templates) {
  walk(parsed, id);
}

console.log(`      swept ${prompts} questions and ${effects} effects across ${templates.size} campaigns`);
check(
  'every question is one this client can ask',
  unknownPrompts.length === 0,
  unknownPrompts.slice(0, 6).join(', '),
);
check('every effect is one this client applies', unknownOps.length === 0, unknownOps.slice(0, 6).join(', '));
check('no draw has an empty pool', emptyPools.length === 0, emptyPools.slice(0, 6).join(', '));

process.exit(failures === 0 ? 0 : 1);
