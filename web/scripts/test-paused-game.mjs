/**
 * A game put away comes back the same.
 *
 * The joined strings are the app's own format, and the villain's damage is
 * stored inside out: the table writes down the life left on the card, where the
 * tracker counts damage up. Both are easy to get backwards and neither shows up
 * until somebody comes back to a table a week later, so both are tested.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { setupFor, startOf, damaged, villainHealth } from '../src/lib/encounter.ts';
import { splitHeroes, splitLives, restoreEncounter } from '../src/lib/pausedGame.ts';

let failures = 0;
function check(label, ok, detail = '') {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
  if (!ok) {
    failures += 1;
  }
}

// --- the joined strings ------------------------------------------------------

{
  const heroes = splitHeroes('01001a|Spider-Man,01002a|Captain Marvel');
  check('heroes split', heroes.length === 2);
  check('code and name kept apart', heroes[0].code === '01001a' && heroes[0].name === 'Spider-Man');

  // A name with no code, or an empty entry, must not produce a seat that
  // reads as blank on the screen.
  check('an empty list is empty', splitHeroes('').length === 0);
  check('a bare code falls back to itself', splitHeroes('01001a').at(0)?.name === '01001a');

  const lives = splitLives('01001a|8,01002a|11');
  check('lives split', lives['01001a'] === '8' && lives['01002a'] === '11');
  check('an empty list of lives is empty', Object.keys(splitLives('')).length === 0);
}

// --- the villain, stored inside out ------------------------------------------

{
  const cards = JSON.parse(
    readFileSync(join(import.meta.dirname, '..', 'public', 'data', 'cards', 'en', 'core.json'), 'utf8'),
  ).filter((card) => card.card_set_code === 'ultron');

  const setup = setupFor(cards, 2, false);
  // Ultron I is 17 per hero, so 34 for two.
  let game = startOf(setup);
  check('two-player health', villainHealth(game) === 34, String(villainHealth(game)));

  game = damaged(game, 12);
  const lifeLeft = 34 - 12;

  const restored = restoreEncounter(setup, {
    id: 'current',
    savedAt: 0,
    scenarioCode: 'ultron',
    scenarioName: 'Ultron',
    difficulty: 'STANDARD_I',
    heroes: '',
    modularSetCodes: '',
    elapsedMillis: 0,
    phase: 'PLAYER',
    villainStep: '',
    heroLives: '',
    villainLife: lifeLeft,
    villainStage: 1,
    campaignRunId: '',
  });
  check('damage comes back', restored.progress.damage === 12, String(restored.progress.damage));
  check('the stage comes back', restored.progress.villainIndex === 0);

  // Stage II, written down mid-fight.
  const second = restoreEncounter(setup, {
    id: 'current', savedAt: 0, scenarioCode: 'ultron', scenarioName: 'Ultron',
    difficulty: 'STANDARD_I', heroes: '', modularSetCodes: '', elapsedMillis: 0,
    phase: 'VILLAIN', villainStep: 'PLACE_THREAT', heroLives: '',
    villainLife: 40, villainStage: 2, campaignRunId: '',
  });
  // Ultron II is 22 per hero, 44 for two, so 40 left is 4 damage.
  check('stage II damage comes back', second.progress.damage === 4, String(second.progress.damage));

  // A stage that does not exist must not put the tracker out of bounds.
  const clamped = restoreEncounter(setup, {
    id: 'current', savedAt: 0, scenarioCode: 'ultron', scenarioName: 'Ultron',
    difficulty: 'STANDARD_I', heroes: '', modularSetCodes: '', elapsedMillis: 0,
    phase: 'PLAYER', villainStep: '', heroLives: '',
    villainLife: 10, villainStage: 9, campaignRunId: '',
  });
  check('an impossible stage is clamped', clamped.progress.villainIndex === setup.villain.length - 1);

  // More life than the card has cannot make the damage negative.
  const healed = restoreEncounter(setup, {
    id: 'current', savedAt: 0, scenarioCode: 'ultron', scenarioName: 'Ultron',
    difficulty: 'STANDARD_I', heroes: '', modularSetCodes: '', elapsedMillis: 0,
    phase: 'PLAYER', villainStep: '', heroLives: '',
    villainLife: 999, villainStage: 1, campaignRunId: '',
  });
  check('damage never goes negative', healed.progress.damage === 0);
}

process.exit(failures === 0 ? 0 : 1);
