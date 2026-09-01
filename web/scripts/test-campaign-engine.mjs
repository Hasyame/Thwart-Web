/**
 * The fold, against real campaign runs.
 *
 * Synthetic events prove the port does what I thought it did. Somebody's actual
 * runs prove it agrees with the app that produced them, which is the only claim
 * that matters: the same log has to mean the same campaign in both clients.
 *
 * The strongest check here is not a number I typed. Each run carries the app's
 * own `finished` flag, written by the app's engine at the time; folding the log
 * afresh has to reach the same conclusion. A port that ends a campaign early,
 * or fails to end one, disagrees here and nowhere else until somebody plays it.
 *
 *   npm run test:engine -- path/to/backup.json
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fold } from '../src/lib/campaign/engine.ts';
import { EMPTY_STATE } from '../src/lib/campaign/types.ts';

let failures = 0;
function check(label, ok, detail = '') {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
  if (!ok) {
    failures += 1;
  }
}

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
  const template = JSON.parse(readFileSync(join(TEMPLATES, file), 'utf8'));
  templates.set(template.id, template);
}

// --- synthetic: the pieces that are easy to get backwards ---------------------

const template = {
  id: 't',
  schemaVersion: 1,
  name: { en: 'Test' },
  counters: [
    { id: 'credits', scope: 'campaign', initial: 2, min: 0, max: 5 },
    { id: 'wounds', scope: 'hero', initial: 0, min: 0, max: 3 },
  ],
  flagSets: [
    { id: 'beaten', scope: 'perScenario' },
    { id: 'ally', scope: 'campaign' },
  ],
  scenarios: [
    {
      id: 's1',
      onVictory: {
        effects: [
          { op: 'addcounter', counter: 'credits', value: 2 },
          { op: 'setflag', flag: 'beaten' },
        ],
        next: [{ goto: 's2' }],
      },
      onDefeat: { effects: [{ op: 'addherocounter', counter: 'wounds', value: 1 }], next: [{ goto: 's1' }] },
    },
    { id: 's2', onVictory: { effects: [], next: [{ end: true }] } },
  ],
};

const heroes = [
  { id: 'h1', deckId: 'h1', heroCardCode: '01001a', name: 'Spider-Man' },
  { id: 'h2', deckId: 'h2', heroCardCode: '01002a', name: 'Captain Marvel' },
];

const started = { id: 'e0', timestamp: 1, type: 'setup', templateId: 't', difficulty: 'standard', heroes, startScenarioId: 's1' };

{
  const state = fold(template, [started]);
  check('counters start at their initial', state.counters.credits === 2, String(state.counters.credits));
  check('hero counters start per hero', state.heroCounters.wounds?.h1 === 0 && state.heroCounters.wounds?.h2 === 0);
  check('the first scenario is current', state.currentScenarioId === 's1');
  check('started', state.started === true && state.finished === false);
}

{
  // A victory: effects run, the flag lands under the scenario that set it, and
  // next moves on.
  const state = fold(template, [
    started,
    { id: 'e1', timestamp: 2, type: 'scenario_result', scenarioId: 's1', victory: true },
  ]);
  check('victory effects applied', state.counters.credits === 4, String(state.counters.credits));
  // perScenario scope keys the flag by the scenario, not by the campaign.
  check('a perScenario flag is keyed by its scenario', state.flags.beaten?.s1 === true, JSON.stringify(state.flags));
  check('next advanced', state.currentScenarioId === 's2');
  check('the result is recorded', state.completedScenarios.length === 1);
}

{
  // The counter is capped by its own declaration, not by the effect.
  const state = fold(template, [
    started,
    { id: 'e1', timestamp: 2, type: 'scenario_result', scenarioId: 's1', victory: true },
    { id: 'e2', timestamp: 3, type: 'manual', counterId: 'credits', value: 99 },
  ]);
  // A manual adjustment is deliberately not clamped: it is somebody saying what
  // the number is, and the app does not argue.
  check('a manual adjustment is taken at face value', state.counters.credits === 99, String(state.counters.credits));
}

{
  const state = fold(template, [
    started,
    { id: 'e1', timestamp: 2, type: 'scenario_result', scenarioId: 's1', victory: true },
    { id: 'e2', timestamp: 3, type: 'scenario_result', scenarioId: 's2', victory: true },
  ]);
  check('end finishes the campaign', state.finished === true && state.currentScenarioId === null);
}

{
  // Revocation: the superseded result never takes effect, however late the
  // revocation was appended.
  const state = fold(template, [
    started,
    { id: 'e1', timestamp: 2, type: 'scenario_result', scenarioId: 's1', victory: true },
    { id: 'e2', timestamp: 9, type: 'revoke', revokedEventId: 'e1' },
  ]);
  check('a revoked result leaves no trace', state.counters.credits === 2 && state.completedScenarios.length === 0);
  check('and the campaign has not advanced', state.currentScenarioId === 's1');
}

{
  // Elimination: a hero eliminated in this scenario takes no part in the
  // rewards, and rejoins next time.
  const wounded = fold(template, [
    started,
    {
      id: 'e1', timestamp: 2, type: 'scenario_result', scenarioId: 's1', victory: false,
      answers: { perHeroBooleans: { eliminated: { h1: true } } },
    },
  ]);
  check('an eliminated hero is skipped', wounded.heroCounters.wounds?.h1 === 0, String(wounded.heroCounters.wounds?.h1));
  check('the others still take it', wounded.heroCounters.wounds?.h2 === 1, String(wounded.heroCounters.wounds?.h2));
}

{
  // Hero counters cap at printed health when the template says so.
  const capped = {
    ...template,
    counters: [{ id: 'hp', scope: 'hero', initial: 0, min: 0, max: 50, maxFrom: 'heroCard.health' }],
    scenarios: [{ id: 's1', onVictory: { effects: [{ op: 'setherocounter', counter: 'hp', value: 40 }], next: [{ end: true }] } }],
  };
  const state = fold(
    capped,
    [started, { id: 'e1', timestamp: 2, type: 'scenario_result', scenarioId: 's1', victory: true }],
    { h1: { heroId: 'h1', printedHealth: 12 } },
  );
  check('hp caps at printed health', state.heroCounters.hp?.h1 === 12, String(state.heroCounters.hp?.h1));
  check('a hero with no printed health is uncapped', state.heroCounters.hp?.h2 === 40, String(state.heroCounters.hp?.h2));
}

{
  // A refunded purchase leaves nothing behind.
  const withMarket = { ...template, scenarios: template.scenarios };
  const bought = [
    started,
    { id: 'p1', timestamp: 2, type: 'purchase', heroId: 'h1', cardCode: '01050', cost: 2, cardListId: 'purchases' },
  ];
  const spent = fold(withMarket, bought);
  check('a purchase spends credits', spent.heroCounters.credits?.h1 === -2, String(spent.heroCounters.credits?.h1));
  check('and files the card', spent.heroCardLists.purchases?.h1?.includes('01050') === true);

  const refunded = fold(withMarket, [...bought, { id: 'r1', timestamp: 3, type: 'purchase_refund', purchaseEventId: 'p1' }]);
  check('a refund undoes it', refunded.purchases.length === 0 && refunded.heroCardLists.purchases === undefined);
}

{
  /*
   * The op token is matched case-insensitively.
   *
   * Every template writes `addCounter`; the tokens are lowercase. Comparing
   * them directly makes every effect fall through to "unknown", which throws
   * nothing, fails no type check, and leaves campaigns silently inert. It went
   * unnoticed until a real run folded to minus twelve credits, so it gets a
   * test of its own rather than relying on a bound being breached.
   */
  const camel = {
    ...template,
    scenarios: [
      {
        id: 's1',
        onVictory: {
          effects: [
            { op: 'addCounter', counter: 'credits', value: 1 },
            { op: 'setFlag', flag: 'ally' },
            { op: 'addHeroCounter', counter: 'wounds', value: 1 },
          ],
          next: [{ end: true }],
        },
      },
    ],
  };
  const state = fold(camel, [
    started,
    { id: 'e1', timestamp: 2, type: 'scenario_result', scenarioId: 's1', victory: true },
  ]);
  check('camelCase addCounter applies', state.counters.credits === 3, String(state.counters.credits));
  check('camelCase setFlag applies', state.flags.ally?.[''] === true, JSON.stringify(state.flags));
  check('camelCase addHeroCounter applies', state.heroCounters.wounds?.h1 === 1, String(state.heroCounters.wounds?.h1));
}

{
  // Out of order in the file, in order in the fold.
  const shuffled = [
    { id: 'e1', timestamp: 2, type: 'scenario_result', scenarioId: 's1', victory: true },
    started,
  ];
  const state = fold(template, shuffled);
  check('events fold in timestamp order', state.currentScenarioId === 's2' && state.counters.credits === 4);
}

// --- the real runs -------------------------------------------------------------

const backupPath = process.argv.find((arg, i) => i > 1 && arg.endsWith('.json'));
if (backupPath === undefined || !existsSync(backupPath)) {
  console.log('note  no backup given, so the real runs were not folded');
  process.exit(failures === 0 ? 0 : 1);
}

{
  const backup = JSON.parse(readFileSync(backupPath, 'utf8'));
  const runs = backup.campaignRuns ?? [];
  const byRun = new Map();
  for (const row of backup.campaignEvents ?? []) {
    const list = byRun.get(row.runId) ?? [];
    // The event travels as a serialised payload beside its row, which is where
    // the type discriminator lives.
    list.push(JSON.parse(row.payload));
    byRun.set(row.runId, list);
  }

  check('every run has a template', runs.every((run) => templates.has(run.templateId)),
    runs.map((run) => run.templateId).join(','));

  for (const run of runs) {
    const events = byRun.get(run.id) ?? [];
    const state = fold(templates.get(run.templateId), events);
    const results = events.filter((event) => event.type === 'scenario_result');
    const won = state.completedScenarios.filter((result) => result.victory).length;

    console.log(
      `      ${run.name} (${run.templateId}): ${events.length} events, ` +
        `${state.completedScenarios.length} played, ${won} won, ` +
        `finished=${state.finished} lost=${state.campaignLost}`,
    );

    check(`${run.name}: folds without losing a result`,
      state.completedScenarios.length === results.length,
      `${state.completedScenarios.length} of ${results.length}`);

    /*
     * The cross-check worth having.
     *
     * `finished` on the run was written by the app's own engine when it was
     * played. Folding the same log here has to reach the same answer; a port
     * that ends a campaign early, or fails to end one, disagrees here and
     * nowhere else until somebody plays it.
     */
    check(`${run.name}: agrees with the app about being finished`,
      state.finished === (run.finished === true),
      `folded ${state.finished}, recorded ${run.finished}`);

    check(`${run.name}: the roster survived`, state.heroes.length > 0,
      state.heroes.map((hero) => hero.name).join(', '));

    // Every counter the template declares stays inside its own bounds.
    const template = templates.get(run.templateId);
    const outOfBounds = [];
    for (const def of template.counters ?? []) {
      const values = def.scope === 'hero'
        ? Object.values(state.heroCounters[def.id] ?? {})
        : [state.counters[def.id] ?? 0];
      for (const value of values) {
        if ((def.min != null && value < def.min) || (def.max != null && value > def.max)) {
          outOfBounds.push(`${def.id}=${value}`);
        }
      }
    }
    check(`${run.name}: counters stay within their bounds`, outOfBounds.length === 0, outOfBounds.join(', '));

    /*
     * Something happened.
     *
     * Bounds alone would not have caught the op-token bug: with no effect
     * applying, every counter sits at its initial value, which is inside its
     * bounds. A finished run has to have moved something.
     */
    if (run.finished === true) {
      const moved =
        Object.values(state.counters).some((value) => value !== 0) ||
        Object.values(state.heroCounters).some((byHero) =>
          Object.values(byHero).some((value) => value !== 0)) ||
        Object.keys(state.flags).length > 0 ||
        Object.keys(state.cardLists).length > 0;
      check(`${run.name}: the effects actually ran`, moved,
        `counters=${JSON.stringify(state.counters)}`);
    }
  }

  // Folding is pure: the same log twice is the same state.
  const first = runs.map((run) => JSON.stringify(fold(templates.get(run.templateId), byRun.get(run.id) ?? [])));
  const again = runs.map((run) => JSON.stringify(fold(templates.get(run.templateId), byRun.get(run.id) ?? [])));
  check('folding is pure', first.join('|') === again.join('|'));

  // And an empty log folds to nothing rather than throwing.
  const empty = fold(templates.get('fne'), []);
  check('an empty log is an empty campaign', empty.started === false && empty.completedScenarios.length === 0);
  check('an empty fold keeps the template id', empty.templateId === 'fne' && EMPTY_STATE.templateId === '');
}

process.exit(failures === 0 ? 0 : 1);
