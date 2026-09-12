/**
 * Ratings, as the client builds them.
 *
 * The server checks a rating against the play it cites, so the client's job
 * is to cite honestly: the right subjects for what was on the table, the
 * evidence that lets the server check, and a context that is a snapshot of
 * that game. A wrong subject key here is a rating the server refuses, or
 * worse, one it accepts for the wrong thing.
 *
 *   npm run test:ratings
 */
import { readFileSync } from 'node:fs';
import {
  campaignSubject,
  campaignLayoutOf,
  modularOverallKey,
  modularSubject,
  ratingOfPlay,
  ratingOfRun,
  scenarioSubject,
  subjectsOfPlay,
} from '../src/lib/ratings.ts';
import { mergeBodies } from '../src/lib/sync/merge.ts';
import { cursorAfterPush } from '../src/lib/sync/engine.ts';

let failures = 0;
function check(label, ok, detail = '') {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
  if (!ok) {
    failures += 1;
  }
}

const SETS = [
  { code: 'rhino', name: 'Rhino', type: 'villain', packCode: 'core' },
  { code: 'bomb_scare', name: 'Bomb Scare', type: 'modular', packCode: 'core' },
  { code: 'masters_of_evil', name: 'Masters of Evil', type: 'modular', packCode: 'core' },
];

const play = (over = {}) => ({
  id: 'p1', playedAt: 1, updatedAt: 1, deletedAt: null,
  scenarioCode: 'rhino', scenarioName: 'Rhino', difficulty: 'expert_i', standardSet: 'standard_ii',
  heroCode: 'spiderman', heroName: 'Spider-Man', aspects: 'justice', otherHeroes: 'Captain America',
  roster: [{ code: 'spiderman', name: 'Spider-Man', aspect: 'justice' }, { code: 'captain_america', name: 'Captain America', aspect: 'leadership' }],
  players: 2, won: true, elapsedMillis: 1, notes: '', location: '', victoryPoints: 0,
  campaignRunId: null, reportedToBgg: false, photos: '', modularSets: 'bomb_scare,masters_of_evil',
  ...over,
});

// --- keys ------------------------------------------------------------------------

{
  check('a scenario key', scenarioSubject('rhino').key === 'scenario:rhino');
  check('a modular key carries its pairing', modularSubject('bomb_scare', 'rhino').key === 'modular:bomb_scare@rhino');
  check('a campaign key', campaignSubject('gmw').key === 'campaign:gmw');
  check('the per-set view is not a pairing', modularOverallKey('bomb_scare') === 'modular:bomb_scare');
}

// --- what a game can be rated on -------------------------------------------------

{
  const subjects = subjectsOfPlay(play(), SETS);
  check('the scenario first, then each set paired with it',
    subjects.map((s) => s.key).join(' ') === 'scenario:rhino modular:bomb_scare@rhino modular:masters_of_evil@rhino',
    subjects.map((s) => s.key).join(' '));
  check('a game with no modular sets rates only its scenario',
    subjectsOfPlay(play({ modularSets: '', notes: '' }), SETS).length === 1);
  check('a game with no scenario rates nothing',
    subjectsOfPlay(play({ scenarioCode: '', modularSets: '' }), SETS).length === 0);
}

{
  // A campaign scenario: recorded under the template's id, rated by its set,
  // with the template's modular sets — resolved through the run's template.
  // Real data, not a mock: the Galaxy's Most Wanted template as shipped and
  // the English card index, because the resolution walks villain card -> set
  // code and a hand-written index would only prove the test agrees with
  // itself.
  const raw = JSON.parse(readFileSync(new URL('../public/data/campaigns/gmw.json', import.meta.url), 'utf8'));
  const indexFile = JSON.parse(readFileSync(new URL('../public/data/index.en.json', import.meta.url), 'utf8'));
  const index = Array.isArray(indexFile) ? indexFile : (indexFile.cards ?? indexFile.rows);
  const setsFile = JSON.parse(readFileSync(new URL('../public/data/sets.en.json', import.meta.url), 'utf8'));
  const realSets = Array.isArray(setsFile) ? setsFile : Object.values(setsFile);
  const run = { id: 'run-gmw', templateJson: JSON.stringify(raw) };
  const campaignPlay = play({ scenarioCode: raw.scenarios[0].id, campaignRunId: 'run-gmw', modularSets: '' });
  const layout = campaignLayoutOf(campaignPlay, run, [], index, realSets);
  const subjects = subjectsOfPlay(campaignPlay, realSets, layout);
  check('a campaign scenario is rated by its card set',
    subjects[0]?.key === 'scenario:brotherhood_of_badoon', subjects[0]?.key);
  check('with the template\'s modular sets paired to it',
    subjects.slice(1).map((s) => s.key).sort().join(' ') === 'modular:band_of_badoon@brotherhood_of_badoon modular:ship_command@brotherhood_of_badoon',
    subjects.slice(1).map((s) => s.key).join(' '));
  check('and not the villain\'s own set or the standard set among them',
    layout !== null && !layout.modularSetCodes.includes('brotherhood_of_badoon') && !layout.modularSetCodes.includes('standard'));

  const unknownScenario = { ...campaignPlay, scenarioCode: 'no_such_scenario' };
  check('a scenario the template does not have resolves to nothing, not to a guess',
    campaignLayoutOf(unknownScenario, run, [], index, realSets) === null);
  const brokenRun = { id: 'run-x', templateJson: '{not json' };
  check('an unreadable template resolves to nothing', campaignLayoutOf(campaignPlay, brokenRun, [], index, realSets) === null);
  const fallback = subjectsOfPlay(campaignPlay, realSets, null);
  check('and the rating then falls back to what the play says',
    fallback.length === 1 && fallback[0].key === `scenario:${raw.scenarios[0].id}`, fallback.map((s) => s.key).join(' '));
}

// --- the record ------------------------------------------------------------------

{
  const r = ratingOfPlay(modularSubject('bomb_scare', 'rhino'), 4, play());
  check('the id is the subject', r.subject === 'modular:bomb_scare@rhino');
  check('the evidence is the play', r.evidence.playId === 'p1' && r.evidence.runId === undefined);
  check('the context is a snapshot of the table',
    r.context.players === 2 && r.context.mode === 'expert_i' && r.context.standardSet === 'standard_ii');
  check('with every seat and its aspect',
    r.context.heroes.map((h) => `${h.code}:${h.aspect}`).join(',') === 'spiderman:justice,captain_america:leadership');
  check('and, for a set, which scenario it was paired with', r.context.scenario === 'rhino');
  check('a scenario rating carries no pairing', ratingOfPlay(scenarioSubject('rhino'), 2, play()).context.scenario === undefined);
  check('the score is clamped to 0..5', ratingOfPlay(scenarioSubject('rhino'), 9, play()).score === 5 && ratingOfPlay(scenarioSubject('rhino'), -3, play()).score === 0);
  check('and rounded to an integer', ratingOfPlay(scenarioSubject('rhino'), 2.6, play()).score === 3);

  const c = ratingOfRun({ id: 'run1', templateId: 'gmw', difficulty: 'expert', standardSet: '' }, 3, 2);
  check('a campaign rating cites the run', c.subject === 'campaign:gmw' && c.evidence.runId === 'run1' && c.evidence.playId === undefined);
}

// --- the merge: the newer opinion is the current one -------------------------------

{
  const older = { subject: 'scenario:rhino', score: 1, ratedAt: 100, evidence: { playId: 'a' }, context: {} };
  const newer = { subject: 'scenario:rhino', score: 4, ratedAt: 900, evidence: { playId: 'b' }, context: {} };
  check('the later rating wins from the incoming side', mergeBodies('ratings', older, newer).body.score === 4);
  check('and from the local side', mergeBodies('ratings', newer, older).body.score === 4);
  check('the opposite of a favourite, where the earlier date is the truth',
    mergeBodies('favourite_plays', { playId: 'p', addedAt: 900 }, { playId: 'p', addedAt: 100 }).body.addedAt === 100);
}

// --- a refused rating must not stall the cursor ----------------------------------------

{
  const results = [
    { id: 'p1', collection: 'plays', revision: 11, outcome: 'applied' },
    { id: 'scenario:klaw', collection: 'ratings', revision: 0, outcome: 'rejected', reason: 'subject_mismatch' },
    { id: 'p2', collection: 'plays', revision: 12, outcome: 'applied' },
  ];
  check('the cursor steps past the applied records around a rejection', cursorAfterPush(10, results) === 12,
    String(cursorAfterPush(10, results)));
}

console.log(failures === 0 ? '\nPASS' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
