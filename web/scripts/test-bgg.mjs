/**
 * The BoardGameGeek comment, line for line as the phone posts it.
 *
 * Two clients writing the same play two ways would make one person's BGG log
 * read as two people's. The phone's builder is `BggPayload.kt`; this asserts
 * the web produces the same lines from the same play.
 *
 *   npm run test:bgg
 */
import { bggComment } from '../src/lib/bggComment.ts';

let failures = 0;
function check(label, ok, detail = '') {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
  if (!ok) {
    failures += 1;
  }
}

const label = (id) => ({ standard_i: 'Standard I', expert_i: 'Expert I' })[id] ?? id;

// 21:02 local, after 48 minutes.
const finished = new Date(2026, 8, 11, 21, 2).getTime();
const play = (over = {}) => ({
  id: 'p', playedAt: finished, elapsedMillis: 48 * 60_000,
  scenarioCode: 'rhino', scenarioName: 'Rhino', difficulty: 'standard_i', standardSet: 'standard_i',
  heroCode: 'spiderman', heroName: 'Spider-Man', aspects: 'Justice', otherHeroes: 'Captain America',
  roster: [], players: 2, won: true, notes: 'Modular sets: Bomb Scare', location: '', victoryPoints: 0,
  campaignRunId: null, reportedToBgg: false, photos: '', modularSets: 'bomb_scare',
  ...over,
});

{
  const lines = bggComment(play(), label).split('\n');
  check('result and scenario first, with the difficulty label', lines[0] === 'Win — Rhino (Standard I)', lines[0]);
  check('every hero at the table', lines[1] === 'Heroes: Spider-Man, Captain America', lines[1]);
  check('the aspects', lines[2] === 'Aspects: Justice', lines[2]);
  check('the day and the start–end the app knows and BGG does not', lines[3] === 'Played 2026-09-11, 20:14–21:02', lines[3]);
  check('then the notes, which is where the modular sets already are', lines[4] === 'Modular sets: Bomb Scare', lines[4]);
  check('and nothing else', lines.length === 5, String(lines.length));
}

{
  const lines = bggComment(play({ won: false, otherHeroes: '', aspects: '', notes: '  ', difficulty: '' }), label).split('\n');
  check('a loss says so', lines[0] === 'Loss — Rhino', lines[0]);
  check('one hero, no aspect: the lines that would be empty are absent', lines[1] === 'Heroes: Spider-Man' && lines[2].startsWith('Played '), lines.join(' | '));
  check('blank notes add no line', lines.length === 3, String(lines.length));
}

{
  const c = bggComment(play({ scenarioName: '', scenarioCode: 'klaw', heroName: '' }), label);
  check('a play with no scenario name falls back to its code', c.startsWith('Win — klaw'), c.split('\n')[0]);
  check('the other seats are still heroes when the first is blank', c.includes('Heroes: Captain America'));
  check('no hero at all, no Heroes line', !bggComment(play({ heroName: '', otherHeroes: '' }), label).includes('Heroes:'));
}

console.log(failures === 0 ? '\nPASS' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
