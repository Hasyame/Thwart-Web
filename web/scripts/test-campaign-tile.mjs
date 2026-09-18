/**
 * What a campaign's tile says: its face, its status, its score.
 *
 * The status rule is the one that matters — a campaign is lost only when the
 * engine says so, and won when finished otherwise, however many games were
 * lost on the way — because a tile that read "lost" off the last game would
 * call most won campaigns lost. Against the shipped templates for the faces,
 * since a hand-written one would only prove the test agrees with itself.
 *
 *   npm run test:tile
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { boxArtOf, faceCardOf, fieldHue, parseEventRows, tileOf } from '../src/lib/campaignTile.ts';
import { expandTemplate } from '../src/lib/campaign/engine.ts';
import { scenarioFaceOf } from '../src/lib/scenarioFace.ts';

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
  const raw = JSON.parse(readFileSync(join(TEMPLATES, file), 'utf8'));
  templates.set(raw.id, expandTemplate(raw));
}

// --- the face: the final villain, from the last scenario that names one -------------

{
  const faces = { trors: '04125', mts: '21160', gmw: '16103', mg: '32138', sm: '27113', next: '40163', aoa: '45184a', aos: '50165a' };
  for (const [id, code] of Object.entries(faces)) {
    check(`${id}: the face is the final villain`, faceCardOf(templates.get(id)) === code, faceCardOf(templates.get(id)));
  }
  check('Fear No Evil has no face: its villains are on no database', faceCardOf(templates.get('fne')) === null);
  check('so it carries the bundled key art instead', boxArtOf('fne') === '/art/campaigns/fne.jpg');
  check('and no other campaign does', ['aoa', 'aos', 'gmw', 'mg', 'mts', 'next', 'sm', 'trors'].every((id) => boxArtOf(id) === null));
  check('no template, no face', faceCardOf(null) === null);
}

// --- the status ---------------------------------------------------------------------

let clock = 0;
const ev = (event) => ({ id: `e${++clock}`, timestamp: clock, ...event });
const setup = (templateId, difficulty = 'standard') =>
  ev({ type: 'setup', templateId, difficulty, heroes: [{ id: 'h1', heroCardCode: '01001a', name: 'Hero' }], startScenarioId: templates.get(templateId).scenarios[0].id });
const result = (scenarioId, victory) => ev({ type: 'scenario_result', scenarioId, victory, answers: {} });
const run = (templateId, finished = false) => ({ id: 'r', templateId, templateName: templateId, name: 'x', difficulty: 'standard', standardSet: '', createdAt: 0, finished, templateJson: '', timerAccumulatedMillis: 0, timerRunningSince: null, timerScenarioId: null });

{
  const trors = templates.get('trors');
  const ids = trors.scenarios.map((s) => s.id);

  const fresh = tileOf(run('trors'), trors, [setup('trors')]);
  check('started, nothing played: not started', fresh.status === 'not-started', fresh.status);
  check('with the score at zero of five', fresh.beaten === 0 && fresh.total === 5 && fresh.results.length === 0);

  const going = tileOf(run('trors'), trors, [setup('trors'), result(ids[0], true), result(ids[1], false), result(ids[1], true)]);
  check('a game played: in progress', going.status === 'in-progress', going.status);
  check('two scenarios beaten, a loss on the way', going.beaten === 2 && going.results.join(',') === 'true,false,true', going.results.join(','));

  const won = tileOf(run('trors', true), trors, [setup('trors'), result(ids[0], true), result(ids[1], false), result(ids[1], true), result(ids[2], true), result(ids[3], true), result(ids[4], true)]);
  check('finished after a lost game on the way: won, not lost', won.status === 'won', won.status);
  check('five of five', won.beaten === 5 && won.total === 5);

  const conceded = tileOf(run('trors'), trors, [setup('trors'), result(ids[0], true), ev({ type: 'campaign_conceded' })]);
  check('conceded is its own word', conceded.status === 'conceded', conceded.status);

  // A run whose template cannot be read still says something honest.
  const blind = tileOf(run('trors', true), null, []);
  check('no template: the run\'s own flag decides, and there is no face', blind.status === 'won' && blind.faceCode === null && blind.total === 0);
}

{
  // Lost as the engine means it: Fear No Evil's finale on Expert with no
  // Completed environment left to sacrifice takes the `lose` step.
  const fne = templates.get('fne');
  const five = ['s1_musee', 's2_poursuite', 's3_racket', 's4_raft', 's5_rotatives'];
  const offer = (...ids) => ev({ type: 'environments_offered', offered: ids });
  const keep = (id) => ev({ type: 'environment_chosen', environmentId: id });
  const chosen = (id) => ev({ type: 'scenario_chosen', scenarioId: id });
  const lose = (id, booleans = {}) => [chosen(id), result(id, false), ev({ type: 'continued', scenarioId: id, victory: false })].map((e) => (e.type === 'scenario_result' ? { ...e, answers: { booleans } } : e));
  let events = [setup('fne', 'expert')];
  for (const id of five) {
    events.push(offer(id), keep(id), chosen(id), result(id, true));
  }
  for (const id of five) {
    events.push(...lose('s6_caid', { [`flip_${id}`]: true }));
  }
  const stillOn = tileOf(run('fne'), fne, events);
  check('five sacrifices: still in progress', stillOn.status === 'in-progress', stillOn.status);
  const lost = tileOf(run('fne'), fne, [...events, ...lose('s6_caid')]);
  check('the sixth defeat loses the campaign: lost', lost.status === 'lost', lost.status);
  check('lost outranks the run\'s finished flag reading as won', tileOf(run('fne', true), fne, [...events, ...lose('s6_caid')]).status === 'lost');
  check('the score still counts the five beaten', lost.beaten === 5 && lost.total === 6);
}

// --- the rows as stored ---------------------------------------------------------------

{
  const rows = [
    { id: 'a', runId: 'r', timestamp: 1, payload: JSON.stringify({ id: 'a', timestamp: 1, type: 'setup' }) },
    { id: 'b', runId: 'r', timestamp: 2, payload: '{not json' },
  ];
  const parsed = parseEventRows(rows);
  check('a row that does not parse is skipped, not fatal', parsed.length === 1 && parsed[0].type === 'setup');
}

// --- the colour field -----------------------------------------------------------------

{
  check('the same campaign is always the same colour', fieldHue('fne') === fieldHue('fne'));
  check('and a hue, not anything else', fieldHue('trors') >= 0 && fieldHue('trors') < 360);
  const hues = new Set([...templates.keys()].map(fieldHue));
  check('nine campaigns, more than a couple of hues between them', hues.size >= 6, String(hues.size));
}

console.log(failures === 0 ? '\nPASS' : `\n${failures} FAILED`);
{
  // The face of a one-off game on the history, against the real index: the
  // villain, or the main scheme when the box has no villain, and always one
  // with a picture when any of them has one. Here rather than with the plays
  // because this is the one test of those that runs after the card data.
  const index = JSON.parse(readFileSync(new URL('../public/data/index.en.json', import.meta.url), 'utf8'));
  const rhino = scenarioFaceOf(index, 'rhino');
  check('Rhino is faced by Rhino', rhino?.name === 'Rhino' && rhino?.typeCode === 'villain', rhino?.name);
  check('and the row carries its picture', typeof rhino?.img === 'string', rhino?.img);
  const crew = scenarioFaceOf(index, 'wrecking_crew');
  check('a scenario with no villain shows its scheme', crew?.typeCode === 'main_scheme', crew?.typeCode);
  check('an unknown scenario has no face', scenarioFaceOf(index, 'no_such') === null);
  const scenarios = JSON.parse(readFileSync(new URL('../public/data/scenario-rules.json', import.meta.url), 'utf8')).scenarios;
  const faceless = scenarios.filter((s) => scenarioFaceOf(index, s.code) === null).map((s) => s.code);
  check('every scenario the rules know has a face', faceless.length === 0, faceless.join(',') || 'none');
}

process.exit(failures === 0 ? 0 : 1);
