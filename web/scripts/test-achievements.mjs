/**
 * The achievements, against the shared vectors.
 *
 * docs/spec/achievements/test-vectors.json is the contract with the Android
 * port: every case's expected state must come out of `derive` exactly,
 * arrays in order, keys in any order. Then the definitions file itself, and
 * the normalisation of this client's own records into the facts the vectors
 * are written in.
 *
 *   npm run test:achievements
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { derive, newlyUnlocked } from '../src/lib/achievements/derive.ts';
import { achievementTargets } from '../src/lib/achievements/details.ts';
import { parseDefinitions } from '../src/lib/achievements/definitions.ts';
import { factOf, levelOf, runFactOf, scenarioKeyOf, seatsOf } from '../src/lib/achievements/normalise.ts';

let failures = 0;
function check(label, ok, detail = '') {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
  if (!ok) {
    failures += 1;
  }
}

const sortKeys = (v) => (Array.isArray(v) ? v.map(sortKeys) : v !== null && typeof v === 'object'
  ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])])) : v);
const canonical = (v) => JSON.stringify(sortKeys(v));

// --- the vectors ---------------------------------------------------------------------

const vectors = JSON.parse(readFileSync(join(import.meta.dirname, '..', '..', 'docs', 'spec', 'achievements', 'test-vectors.json'), 'utf8'));
check('at least twenty vectors', vectors.cases.length >= 20, String(vectors.cases.length));
for (const c of vectors.cases) {
  const got = derive(c.input);
  for (const definition of c.input.definitions) {
    const targets = achievementTargets(c.input, definition);
    if (targets === null) continue;
    const expected = c.expected.achievements.find((a) => a.id === definition.id);
    check(`checklist matches shared progress: ${c.name}/${definition.id}`, targets.length === expected.progress.target && targets.filter((t) => t.completedBy !== null).length === expected.progress.current);
    check(`checklist ignores input order: ${c.name}/${definition.id}`, canonical(targets) === canonical(achievementTargets({ ...c.input, facts: [...c.input.facts].reverse() }, definition)));
  }
  const ok = canonical(got) === canonical(c.expected);
  check(`vector: ${c.name}`, ok, ok ? '' : `\n  got      ${canonical(got).slice(0, 400)}\n  expected ${canonical(c.expected).slice(0, 400)}`);
  const again = derive({ ...c.input, facts: [...c.input.facts].reverse(), runs: [...c.input.runs].reverse() });
  check('  idempotent, whatever the input order', canonical(again) === canonical(got));
}

// --- the definitions file ----------------------------------------------------------------

{
  const text = readFileSync(join(import.meta.dirname, '..', 'public', 'achievements.json'), 'utf8');
  const file = parseDefinitions(JSON.parse(text));
  check('the shipped definitions parse', file !== null && file.achievements.length >= 30, String(file?.achievements.length));
  const ids = new Set(file.achievements.map((a) => a.id));
  check('every id is unique', ids.size === file.achievements.length);
  check('every id is a slug', file.achievements.every((a) => /^[a-z0-9_]+$/.test(a.id)));
  check('tiers ascend', file.achievements.every((a) => (a.tiers ?? []).every((t, i, all) => i === 0 || t.n > all[i - 1].n)));
  check('a newer schema is refused', parseDefinitions({ ...JSON.parse(text), schemaVersion: 99 }) === null);
  check('another scale is refused', parseDefinitions({ ...JSON.parse(text), difficultyScaleVersion: 2 }) === null);
  check('an unknown predicate kind is refused', parseDefinitions({ ...JSON.parse(text), achievements: [{ id: 'x', category: 'mode', scope: 'global', hidden: false, predicate: { kind: 'wat' } }] }) === null);
  check('any definitions version loads', parseDefinitions({ ...JSON.parse(text), definitionsVersion: 4242 }) !== null);
  // The whole shipped catalogue derives over an empty history without throwing.
  const state = derive({ definitions: file.achievements, definitionsVersion: file.definitionsVersion, catalogue: { heroes: [], scenarios: [] }, ownedPacks: [], facts: [], runs: [] });
  check('the shipped definitions derive over nothing', state.achievements.length === file.achievements.length && state.achievements.every((a) => a.status !== 'unlocked'));
}

// --- normalisation of this client's records -------------------------------------------------

{
  check('level: standard sets', levelOf('standard_i') === 'standard' && levelOf('Standard III') === 'standard' && levelOf('standard') === 'standard');
  check('level: expert sets', levelOf('EXPERT_II') === 'expert' && levelOf('expert') === 'expert');
  check('level: nothing usable is unknown, never standard', levelOf('') === 'unknown' && levelOf('heroic') === 'unknown' && levelOf(undefined) === 'unknown');
  check('scenario key: a one-off code stands', scenarioKeyOf({ scenarioCode: 'rhino', campaignRunId: null }, () => null) === 'rhino');
  check('scenario key: a Fear No Evil job loses its villain', scenarioKeyOf({ scenarioCode: 'fne_s1_musee__fne_villain_electro', campaignRunId: null }, () => null) === 'fne_s1_musee');
  check('scenario key: the finale stands', scenarioKeyOf({ scenarioCode: 'fne_s6_caid', campaignRunId: null }, () => null) === 'fne_s6_caid');
  check('scenario key: a versus code stands', scenarioKeyOf({ scenarioCode: 'a__b', campaignRunId: null }, () => null) === 'a__b');
  check('scenario key: a campaign play resolves through its run', scenarioKeyOf({ scenarioCode: 's1_x', campaignRunId: 'r' }, () => 'crossbones') === 'crossbones');
  check('scenario key: an unresolved campaign play is marked', scenarioKeyOf({ scenarioCode: 's1_x', campaignRunId: 'r' }, () => null) === 'campaign:s1_x');
  const seats = seatsOf({ roster: [{ code: 'a', name: '', aspect: 'Leadership, Justice' }, { code: 'b', name: '', aspect: 'justice', isOwner: true }], heroCode: '', aspects: '' });
  check('seats: aspects read as a sorted set, the flagged seat owns', seats[0].aspects.join(',') === 'justice,leadership' && seats[0].isOwner === false && seats[1].isOwner === true);
  const noFlag = seatsOf({ roster: [{ code: 'a', name: '', aspect: '' }, { code: 'b', name: '', aspect: 'x' }], heroCode: '', aspects: '' });
  check('seats: with no flag the first seat owns', noFlag[0].isOwner === true && noFlag[1].isOwner === false);
  const twoFlags = seatsOf({ roster: [{ code: 'a', name: '', aspect: '', isOwner: true }, { code: 'b', name: '', aspect: 'x', isOwner: true }], heroCode: '', aspects: '' });
  check('seats: two flags, the first keeps it', twoFlags[0].isOwner === true && twoFlags[1].isOwner === false);
  const implicit = seatsOf({ roster: [], heroCode: '01001a', aspects: 'justice' });
  check('seats: an empty roster is one implicit seat', implicit.length === 1 && implicit[0].heroCode === '01001a' && implicit[0].isOwner === true);
  const play = { id: 'p', playedAt: 5, scenarioCode: 'rhino', difficulty: 'expert_i', roster: [], heroCode: 'h', aspects: 'justice', players: 9, won: true, campaignRunId: null, mode: 'weird', deletedAt: null };
  const fact = factOf(play, () => null);
  check('a fact: players clamped, unknown mode read as none', fact.players === 4 && fact.mode === null && fact.level === 'expert');
  check('a tombstone gives no fact', factOf({ ...play, deletedAt: 1 }, () => null) === null);
  const run = runFactOf({ id: 'r', templateId: 'trors', difficulty: 'Expert', finished: true }, { campaignLost: true });
  check('a run fact: level from its difficulty, lost from the engine', run.level === 'expert' && run.finished && run.lost);
  const before = derive({ ...vectors.cases[0].input });
  const after = derive({ ...vectors.cases[2].input });
  check('newly unlocked is the delta, not the whole', newlyUnlocked(before, after).map((u) => u.id).join(',') === 'true_solo_win');
}

{
  const definition = { id: 'test', scope: 'owned', category: 'difficulty', hidden: false, predicate: { kind: 'scenarios_won', pack: 'core', minDifficulty: 'expert' } };
  const fact = { id: 'a', playedAt: 1, scenarioKey: 'rhino', level: 'expert', won: true, players: 1, seats: [{ heroCode: 'h', aspects: ['justice'], isOwner: false }], campaignRunId: null, mode: null };
  const input = { definitions: [definition], definitionsVersion: 1, catalogue: { heroes: [], scenarios: ['rhino', 'klaw', 'ultron'].map((key) => ({ key, packCode: 'core' })) }, ownedPacks: [], facts: [fact, { ...fact, id: 'b', scenarioKey: 'klaw' }, { ...fact, id: 'c', scenarioKey: 'ultron', level: 'standard' }], runs: [] };
  const targets = achievementTargets(input, definition);
  check('two of three: name exactly the missing Expert scenario', targets.filter((t) => !t.completedBy).map((t) => t.key).join(',') === 'ultron');
  check('two of three: name both completed scenarios, even without ownership', targets.filter((t) => t.completedBy).map((t) => t.key).join(',') === 'rhino,klaw');
  check('losses never satisfy the missing scenario', achievementTargets({ ...input, facts: [...input.facts, { ...fact, id: 'd', scenarioKey: 'ultron', won: false }] }, definition).find((t) => t.key === 'ultron').completedBy === null);
  check('a qualifying win completes the checklist', achievementTargets({ ...input, facts: [...input.facts, { ...fact, id: 'e', scenarioKey: 'ultron' }] }, definition).every((t) => t.completedBy !== null));
}

console.log(failures === 0 ? '\nPASS' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
