/**
 * A whole Fear No Evil campaign, played against the template that ships.
 *
 * The engine tests use a hand-built template, which is exactly where a mistake
 * in the real one hides. This drives the fetched file end to end, the way the
 * phone's FearNoEvilCampaignTest does, and asserts the rules the English
 * rulebook (mc60, 2026) settled:
 *
 *   - losing a scenario does not fail it (p.8); it stays open, against the
 *     same Underling, and on Standard a defeat adds nothing;
 *   - on Expert a defeat adds one pressure mark, and three marks fail the job;
 *   - on Expert a Kingpin defeat sacrifices one Completed environment, which
 *     turns Failed, and the finale is replayed; with none left to give, one
 *     more defeat loses the campaign — a `lose` next step;
 *   - on Standard a Kingpin defeat is simply replayed;
 *   - the defeat's questions are the defeat's, shown while their `when` holds,
 *     and the hit points they record are capped at printed health.
 *
 *   npm run test:fne
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fold } from '../src/lib/campaign/engine.ts';
import { evaluate } from '../src/lib/campaign/conditions.ts';
import { choosableScenarios } from '../src/lib/campaign/rules.ts';
import { counterOf, flagOf, heroCounterOf } from '../src/lib/campaign/types.ts';

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
 * The English titles came with the corrected template, so a copy that still
 * says "Musée" in English is older than the rules asserted here and would
 * fail for the wrong reason. Said up front.
 */
check(
  'the template is the corrected one (English titles)',
  (fne.scenarios ?? []).some((s) => s.name?.en === 'Art Museum Heist'),
);

const FIVE = ['s1_musee', 's2_poursuite', 's3_racket', 's4_raft', 's5_rotatives'];
const BOSS = 's6_caid';

// --- the log, event by event ------------------------------------------------------

let clock = 0;
const tick = () => ++clock;

const HERO = { id: 'h1', deckId: 'd1', heroCardCode: '01001', name: 'Hero' };

const start = (difficulty = 'standard') => ({
  id: 'start',
  timestamp: tick(),
  type: 'setup',
  templateId: fne.id,
  difficulty,
  heroes: [HERO],
  startScenarioId: fne.scenarios[0].id,
});

const offer = (...ids) => ({ id: `offer-${tick()}`, timestamp: clock, type: 'environments_offered', offered: ids });
const keep = (id) => ({ id: `keep-${tick()}`, timestamp: clock, type: 'environment_chosen', environmentId: id });

const play = (id) => [
  { id: `choose-${tick()}`, timestamp: clock, type: 'scenario_chosen', scenarioId: id },
  { id: `done-${tick()}`, timestamp: clock, type: 'scenario_result', scenarioId: id, victory: true },
];

/** A defeat, then moving on from it, which is what the defeat page offers. */
const lose = (id, answers = {}) => [
  { id: `choose-${tick()}`, timestamp: clock, type: 'scenario_chosen', scenarioId: id },
  { id: `lost-${tick()}`, timestamp: clock, type: 'scenario_result', scenarioId: id, victory: false, answers },
  { id: `on-${tick()}`, timestamp: clock, type: 'continued', scenarioId: id, victory: false },
];

const choosable = (state) => choosableScenarios(fne, state).map((s) => s.id);

/** One rotation each, all five won: the road to the boss. */
const through = (difficulty) => [
  start(difficulty),
  ...FIVE.flatMap((id) => [offer(id), keep(id), ...play(id)]),
];

// --- losing a job and moving on does not fail it ------------------------------------

{
  // p.8: "Losing a scenario does not automatically cause it to fail and it
  // may be able to be attempted again." Only three marks fail a job, and on
  // Standard a defeat adds none. The job stays on the list, and its
  // environment goes on neither face.
  const state = fold(fne, [
    start(),
    offer('s2_poursuite', 's3_racket'),
    keep('s2_poursuite'),
    ...lose('s1_musee'),
  ]);
  check('a lost job is still choosable', choosable(state).includes('s1_musee'), choosable(state).join(','));
  check('and carries no pressure on Standard', counterOf(state, 'pressionMusee') === 0, String(counterOf(state, 'pressionMusee')));
  check('and is not Failed', flagOf(state, 'echoue', 's1_musee') === false);
  check('nor Completed', flagOf(state, 'acheve', 's1_musee') === false);
  check('the campaign goes on', state.finished === false && state.campaignLost === false);
  check('and the table picks what to play next', state.awaitingChoice === true);
}

// --- on Expert a defeat is one mark, and three of them fail the job -----------------

{
  const two = fold(fne, [
    start('expert'),
    offer('s2_poursuite', 's3_racket'),
    keep('s2_poursuite'),
    ...lose('s1_musee'),
    ...lose('s1_musee'),
  ]);
  check('two Expert defeats are two marks', counterOf(two, 'pressionMusee') === 2, String(counterOf(two, 'pressionMusee')));
  check('two marks: still open', choosable(two).includes('s1_musee'));

  const three = fold(fne, [
    start('expert'),
    offer('s2_poursuite', 's3_racket'),
    keep('s2_poursuite'),
    ...lose('s1_musee'),
    ...lose('s1_musee'),
    ...lose('s1_musee'),
  ]);
  check('three marks', counterOf(three, 'pressionMusee') === 3);
  check('three marks: failed, and off the list', !choosable(three).includes('s1_musee'), choosable(three).join(','));
  check('a failed job is not the campaign', three.campaignLost === false && three.finished === false);
}

// --- on Expert the boss takes a Completed environment on a defeat, or the campaign ---

{
  // One sacrificed: the job is now Failed, the boss is replayed.
  const flipped = fold(fne, [...through('expert'), ...lose(BOSS, { booleans: { flip_s3_racket: true } })]);
  check('the sacrificed job is no longer Completed', flagOf(flipped, 'acheve', 's3_racket') === false);
  check('and is Failed', flagOf(flipped, 'echoue', 's3_racket') === true);
  check('the finale is replayed', flipped.currentScenarioId === BOSS, String(flipped.currentScenarioId));
  check('and the campaign is neither lost nor over', flipped.campaignLost === false && flipped.finished === false);
  check('the other four stay Completed',
    FIVE.filter((id) => id !== 's3_racket').every((id) => flagOf(flipped, 'acheve', id)));

  // Every one of the five sacrificed, then one more defeat: lost.
  let events = through('expert');
  for (const id of FIVE) {
    events = [...events, ...lose(BOSS, { booleans: { [`flip_${id}`]: true } })];
  }
  const stillOn = fold(fne, events);
  check('the fifth sacrifice is still a replay', stillOn.campaignLost === false && stillOn.currentScenarioId === BOSS);
  check('with nothing left Completed', FIVE.every((id) => flagOf(stillOn, 'acheve', id) === false));

  const lost = fold(fne, [...events, ...lose(BOSS)]);
  check('nothing left to give: the campaign is lost', lost.campaignLost === true);
  check('and over', lost.finished === true && lost.awaitingChoice === false && lost.currentScenarioId === null);
}

// --- on Standard the boss is simply replayed -----------------------------------------

{
  const state = fold(fne, [...through('standard'), ...lose(BOSS), ...lose(BOSS)]);
  check('a Standard Kingpin defeat replays the finale', state.currentScenarioId === BOSS);
  check('and loses nothing', state.campaignLost === false && state.finished === false);
  check('nothing was flipped', FIVE.every((id) => flagOf(state, 'acheve', id)));
}

// --- the defeat asks the defeat's questions ------------------------------------------

const scenarioOf = (id) => fne.scenarios.find((s) => s.id === id);

/** The questions a defeat page would show, as CampaignQuestions filters them. */
const defeatPrompts = (state, id, answers = {}) =>
  (scenarioOf(id).onDefeat?.prompts ?? [])
    .filter((prompt) => evaluate(prompt.when, { state, scenarioId: id, answers }))
    .map((prompt) => prompt.id);

{
  const standard = fold(fne, [start(), offer('s1_musee', 's2_poursuite'), keep('s1_musee')]);
  check('a Standard defeat asks for the victory points only',
    defeatPrompts(standard, 's1_musee').join(',') === 'vp', defeatPrompts(standard, 's1_musee').join(','));

  const expert = fold(fne, [start('expert'), offer('s1_musee', 's2_poursuite'), keep('s1_musee')]);
  check('an Expert defeat also asks each hero\'s remaining hit points',
    defeatPrompts(expert, 's1_musee').join(',') === 'vp,hpPerHero', defeatPrompts(expert, 's1_musee').join(','));
  check('as a per-hero number',
    scenarioOf('s1_musee').onDefeat.prompts.find((p) => p.id === 'hpPerHero')?.type === 'perHeroNumber');

  // The Kingpin defeat: one flip question per Completed environment, on
  // Expert only, and each disappears once its environment is no longer
  // Completed.
  const atBoss = fold(fne, through('expert'));
  check('the Expert Kingpin defeat offers all five flips',
    defeatPrompts(atBoss, BOSS).join(',') === 'hpPerHero,flip_s1_musee,flip_s2_poursuite,flip_s3_racket,flip_s4_raft,flip_s5_rotatives',
    defeatPrompts(atBoss, BOSS).join(','));
  const oneGone = fold(fne, [...through('expert'), ...lose(BOSS, { booleans: { flip_s3_racket: true } })]);
  check('a flipped environment is no longer offered',
    !defeatPrompts(oneGone, BOSS).includes('flip_s3_racket') && defeatPrompts(oneGone, BOSS).includes('flip_s4_raft'),
    defeatPrompts(oneGone, BOSS).join(','));
  const atBossStandard = fold(fne, through('standard'));
  check('on Standard the Kingpin defeat asks nothing',
    defeatPrompts(atBossStandard, BOSS).length === 0, defeatPrompts(atBossStandard, BOSS).join(','));
}

// --- hit points carry over from a defeat as from a victory, capped ----------------------

{
  const stats = { h1: { heroId: 'h1', printedHealth: 12 } };
  const afterLoss = fold(fne, [
    start('expert'),
    offer('s1_musee', 's2_poursuite'),
    keep('s1_musee'),
    ...lose('s1_musee', { numbers: { vp: 0 }, perHeroNumbers: { hpPerHero: { h1: 7 } } }),
  ], stats);
  check('a defeat records the hit points left', heroCounterOf(afterLoss, 'hp', 'h1') === 7, String(heroCounterOf(afterLoss, 'hp', 'h1')));

  const overTyped = fold(fne, [
    start('expert'),
    offer('s1_musee', 's2_poursuite'),
    keep('s1_musee'),
    ...lose('s1_musee', { perHeroNumbers: { hpPerHero: { h1: 13 } } }),
  ], stats);
  check('capped at printed health', heroCounterOf(overTyped, 'hp', 'h1') === 12, String(heroCounterOf(overTyped, 'hp', 'h1')));

  const afterWin = fold(fne, [
    start('expert'),
    offer('s1_musee', 's2_poursuite'),
    keep('s1_musee'),
    { id: `choose-${tick()}`, timestamp: clock, type: 'scenario_chosen', scenarioId: 's1_musee' },
    { id: `done-${tick()}`, timestamp: clock, type: 'scenario_result', scenarioId: 's1_musee', victory: true,
      answers: { perHeroNumbers: { hpPerHero: { h1: 9 } } } },
  ], stats);
  check('the same on a victory', heroCounterOf(afterWin, 'hp', 'h1') === 9, String(heroCounterOf(afterWin, 'hp', 'h1')));

  const onStandard = fold(fne, [
    start(),
    offer('s1_musee', 's2_poursuite'),
    keep('s1_musee'),
    ...lose('s1_musee', { perHeroNumbers: { hpPerHero: { h1: 7 } } }),
  ], stats);
  check('and not at all on Standard', heroCounterOf(onStandard, 'hp', 'h1') === 0, String(heroCounterOf(onStandard, 'hp', 'h1')));
}

// --- the defeat page can always move on -------------------------------------------------

{
  // No FNE outcome carries `onContinue` any more: moving on costs nothing.
  // What the defeat page keys "continue" on instead is a `choose` next step.
  for (const id of FIVE) {
    const outcome = scenarioOf(id).onDefeat;
    check(`${id}: a defeat leads to the choice, at no cost`,
      (outcome.onContinue ?? []).length === 0 && (outcome.next ?? []).some((step) => step.choose === true));
  }
  const boss = scenarioOf(BOSS).onDefeat;
  check('the finale\'s defeat ends in a goto or a lose, never a choice',
    (boss.next ?? []).every((step) => step.goto === BOSS || step.lose === true));
}

console.log(failures === 0 ? '\nPASS' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
