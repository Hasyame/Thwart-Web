/**
 * The encounter tracker, against the real card database.
 *
 * Ported rules deserve tests built from the cards themselves rather than from
 * fixtures somebody typed: a fixture agrees with whatever the port did, and the
 * two spellings of "per player" in this data are exactly the sort of thing a
 * hand-written fixture gets wrong in the same direction as the code.
 *
 * Needs `npm run data` to have been run.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  damaged,
  isFinalVillainStage,
  roundEnded,
  schemeAdvanced,
  schemeComplete,
  schemeLimit,
  selectVillainStages,
  setupFor,
  startOf,
  threatened,
  villainAdvanced,
  villainDefeated,
  villainHealth,
  withSchemeOption,
} from '../src/lib/encounter.ts';

let failures = 0;
function check(label, ok, detail = '') {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
  if (!ok) {
    failures += 1;
  }
}

const DATA = join(import.meta.dirname, '..', 'public', 'data', 'cards', 'en');
if (!existsSync(DATA)) {
  console.error('No card data. Run `npm run data` first.');
  process.exit(1);
}

const pack = (code) => JSON.parse(readFileSync(join(DATA, `${code}.json`), 'utf8'));
const setOf = (packCode, setCode) =>
  pack(packCode).filter((card) => card.card_set_code === setCode);

// --- Ultron, the scenario everyone owns --------------------------------------

const ultron = setOf('core', 'ultron');

{
  const solo = setupFor(ultron, 1, false);
  check('villain stages found', solo.villain.length === 2, solo.villain.map((v) => v.stage).join(','));
  check('scheme stages found', solo.scheme.length === 3, solo.scheme.map((s) => s.stage).join(','));
  check('one option per Ultron stage', solo.scheme.every((s) => s.options.length === 1));

  // Ultron I prints 17 health per hero.
  let game = startOf(solo);
  check('solo villain health', villainHealth(game) === 17, String(villainHealth(game)));

  const four = startOf(setupFor(ultron, 4, false));
  check('four-player villain health scales', villainHealth(four) === 68, String(villainHealth(four)));

  // The Crimson Cowl prints 3 threat and is not fixed, so it scales too.
  check('solo scheme limit', schemeLimit(game) === 3, String(schemeLimit(game)));
  check('four-player scheme limit', schemeLimit(four) === 12, String(schemeLimit(four)));

  // Damage stops at the printed health rather than running past it.
  game = damaged(game, 20);
  check('damage is capped at the health', game.progress.damage === 17, String(game.progress.damage));
  check('villain reads as defeated', villainDefeated(game));

  // Advancing carries no damage over, and is never automatic.
  game = villainAdvanced(game);
  check('advancing resets damage', game.progress.damage === 0);
  check('stage II health', villainHealth(game) === 22, String(villainHealth(game)));
  check('stage II is the last', isFinalVillainStage(game));
  check('advancing past the last stage does nothing', villainAdvanced(game) === game);

  // Healing cannot go below zero.
  check('healing floors at zero', damaged(damaged(game, 3), -10).progress.damage === 0);
}

// --- Standard and Expert take different stages -------------------------------

{
  // A villain printed I, II and III: Standard plays I and II, Expert II and III.
  const classic = [
    { name: 'Drang', stage: 'I' },
    { name: 'Drang', stage: 'II' },
    { name: 'Drang', stage: 'III' },
  ];
  const standard = selectVillainStages(classic, false, (c) => c.name, (c) => c.stage);
  const expert = selectVillainStages(classic, true, (c) => c.name, (c) => c.stage);
  check('standard drops III', standard.map((c) => c.stage).join(',') === 'I,II');
  check('expert drops I', expert.map((c) => c.stage).join(',') === 'II,III');

  // Two villains, each printed I, II and III. Treating the six as one list
  // would take the wrong two.
  const pair = [
    { name: 'Corvus Glaive', stage: 'I' },
    { name: 'Corvus Glaive', stage: 'II' },
    { name: 'Corvus Glaive', stage: 'III' },
    { name: 'Proxima Midnight', stage: 'I' },
    { name: 'Proxima Midnight', stage: 'II' },
    { name: 'Proxima Midnight', stage: 'III' },
  ];
  const both = selectVillainStages(pair, false, (c) => c.name, (c) => c.stage);
  check('each villain keeps its own two', both.length === 4, both.map((c) => `${c.name[0]}${c.stage}`).join(','));

  // Not a difficulty tier: A and B sides, as the Wrecking Crew are printed.
  const sides = [
    { name: 'Wrecker', stage: 'A' },
    { name: 'Wrecker', stage: 'B' },
  ];
  check('two-sided villains are untouched', selectVillainStages(sides, true, (c) => c.name, (c) => c.stage).length === 2);
}

// --- the round, and acceleration ---------------------------------------------

{
  const four = startOf(setupFor(ultron, 4, false));
  // Ultron accelerates 1 per player, every round. The commonest thing to
  // forget, which is why it is the one piece of arithmetic worth automating.
  const after = roundEnded(four);
  check('round advances', after.progress.round === 2);
  check('acceleration is per player', after.progress.threat === 4, String(after.progress.threat));

  // Threat is capped at the limit, the same way damage is.
  let full = four;
  for (let i = 0; i < 20; i += 1) {
    full = roundEnded(full);
  }
  check('threat is capped at the limit', full.progress.threat === schemeLimit(four), String(full.progress.threat));
  check('scheme reads as complete', schemeComplete(full));

  // Thwarting takes it back down, never below zero.
  check('thwarting floors at zero', threatened(full, -1000).progress.threat === 0);
}

// --- the scheme's own starting threat ----------------------------------------

{
  // Advancing a scheme starts the new one at its own printed base threat, not
  // at zero and not carrying the old one over.
  const scenarios = [];
  for (const packCode of ['core', 'mts', 'gmw']) {
    if (!existsSync(join(DATA, `${packCode}.json`))) {
      continue;
    }
    for (const card of pack(packCode)) {
      if (card.type_code === 'main_scheme' && (card.base_threat ?? 0) > 0) {
        scenarios.push(card.card_set_code);
      }
    }
  }
  const withBase = scenarios[0];
  if (withBase === undefined) {
    console.log('note  no scenario in the sampled packs prints a base threat; skipped');
  } else {
    const packCode = pack('core').some((c) => c.card_set_code === withBase) ? 'core' : 'mts';
    const setup = setupFor(setOf(packCode, withBase), 2, false);
    let game = startOf(setup);
    const firstBase = setup.scheme[0].options[0];
    check(
      'the first scheme starts on its printed threat',
      game.progress.threat === (firstBase.startingThreatPerPlayer ? firstBase.startingThreat * 2 : firstBase.startingThreat),
      `${withBase} threat=${game.progress.threat}`,
    );
    game = threatened(game, 5);
    game = schemeAdvanced(game);
    const second = setup.scheme[1]?.options[0];
    if (second !== undefined) {
      const expected = second.startingThreatPerPlayer ? second.startingThreat * 2 : second.startingThreat;
      check('advancing does not carry threat over', game.progress.threat === expected, String(game.progress.threat));
    }
  }
}

// --- every scenario in the database ------------------------------------------

/*
The sweep that matters.

A tracker is only useful if it can read the scenario somebody actually put on
the table, so this walks every villain set in every pack and reports the ones it
cannot describe. Failures here are data, not necessarily bugs: a handful of
cards print a star instead of a number on purpose. What would be a bug is a
scenario with no villain at all, or a scheme whose stages come back doubled.
*/
{
  const { readdirSync } = await import('node:fs');
  let scenarios = 0;
  let noVillain = 0;
  let noScheme = 0;
  let starred = 0;
  const duplicated = [];
  const withChoices = [];

  for (const file of readdirSync(DATA)) {
    const cards = JSON.parse(readFileSync(join(DATA, file), 'utf8'));
    const villainSets = new Set(
      cards.filter((c) => c.card_set_type_name_code === 'villain').map((c) => c.card_set_code),
    );
    for (const setCode of villainSets) {
      const setup = setupFor(cards.filter((c) => c.card_set_code === setCode), 2, false);
      scenarios += 1;
      if (setup.villain.length === 0) {
        noVillain += 1;
      }
      if (setup.scheme.length === 0) {
        noScheme += 1;
      }
      if (setup.villain.some((v) => v.starred) || setup.scheme.some((s) => s.starred)) {
        starred += 1;
      }
      // The A side carries no threat, so a doubled list means the filter let it
      // through and the tracker would show each stage twice.
      const stages = setup.scheme.map((s) => s.stage.toUpperCase());
      if (new Set(stages).size !== stages.length) {
        duplicated.push(setCode);
      }
      if (setup.scheme.some((s) => s.options.length > 1)) {
        withChoices.push(setCode);
      }
    }
  }

  console.log(`      swept ${scenarios} scenarios: ${noVillain} with no villain, ${noScheme} with no scheme, ${starred} with a starred number`);
  console.log(`      ${withChoices.length} offer a choice of scheme at a stage: ${withChoices.join(', ')}`);
  check('no scenario lists a scheme stage twice', duplicated.length === 0, duplicated.join(','));
  check('most scenarios have a villain', noVillain < scenarios * 0.1, `${noVillain}/${scenarios}`);
}

// --- Kang, where the choice changes the numbers -------------------------------

/*
The case that decided the shape of SchemeStage.

Kang's four stage-3 realms share a threat limit of 9 and start on 0, 1 or 2
threat depending which is on the table. Taking the first would put the counter
in the wrong place three times out of four, which is why the stage carries its
options and the table says which one it drew.
*/
{
  const kangFile = ['toafk'].find((code) => existsSync(join(DATA, `${code}.json`)));
  if (kangFile === undefined) {
    console.log('note  the Kang pack is not in the data; skipped');
  } else {
    const setup = setupFor(setOf(kangFile, 'kang'), 1, false);
    const stage3 = setup.scheme.find((s) => s.stage.toUpperCase() === '3B');
    check('Kang stage 3 keeps its four realms', stage3?.options.length === 4, String(stage3?.options.length));

    const limits = new Set(stage3.options.map((o) => o.value));
    check('the realms share a threat limit', limits.size === 1, [...limits].join(','));

    const starts = new Set(stage3.options.map((o) => o.startingThreat));
    check('but not a starting threat', starts.size > 1, [...starts].sort().join(','));

    // Choosing puts the counter where that realm actually starts.
    let game = startOf(setup);
    while (game.setup.scheme[game.progress.schemeIndex].stage.toUpperCase() !== '3B') {
      game = schemeAdvanced(game);
    }
    for (let i = 0; i < stage3.options.length; i += 1) {
      const chosen = withSchemeOption(game, i);
      const expected = stage3.options[i].startingThreat;
      check(
        `realm ${i + 1} starts on its own threat`,
        chosen.progress.threat === expected,
        `${stage3.options[i].name}: ${chosen.progress.threat}`,
      );
    }
  }
}

process.exit(failures === 0 ? 0 : 1);
