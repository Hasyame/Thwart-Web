/**
 * Fear No Evil played outside its campaign, read from the template that ships:
 * the six scenarios, the five subordinates, the codes a game carries, the
 * tracker's numbers, the briefing and the draw. The phone's FearNoEvilBoxTest
 * asserts the same answers against the same file, which is what keeps a game
 * recorded on one client readable on the other.
 *
 *   npm run test:fne-solo
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  FearNoEvilBox,
  composeFne,
  fneCodeOf,
  fneScenarioIdOf,
  isFne,
  needsVillain,
  splitFne,
} from '../src/lib/fearNoEvil.ts';
import { buildPools, roll, ruleFor, withVillain, EMPTY_DRAW } from '../src/lib/randomizer.ts';

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
const box = new FearNoEvilBox(JSON.parse(readFileSync(FILE, 'utf8')));

// --- the codes ---------------------------------------------------------------------

{
  check('a scenario id becomes a code', fneCodeOf('s1_musee') === 'fne_s1_musee');
  check('a job and a villain compose', composeFne('fne_s1_musee', 'fne_villain_electro') === 'fne_s1_musee__fne_villain_electro');
  const split = splitFne('fne_s1_musee__fne_villain_electro');
  check('and split again', split.job === 'fne_s1_musee' && split.villain === 'fne_villain_electro');
  check('the finale has no villain half', splitFne('fne_s6_caid').villain === null);
  check('the scenario id comes back from either form', fneScenarioIdOf('fne_s1_musee__fne_villain_electro') === 's1_musee');
  check('the family is told by its prefix', isFne('fne_s1_musee') && !isFne('rhino') && !isFne(null));
  check('a versus code is not split, whatever it joins', splitFne('a__b').job === 'a__b' && splitFne('a__b').villain === null);
}

// --- the box -----------------------------------------------------------------------

{
  const scenarios = box.scenarios('en');
  check('six scenarios', scenarios.length === 6, String(scenarios.length));
  check('five of them draw a subordinate', scenarios.filter((s) => s.needsVillain).length === 5);
  const finale = scenarios.find((s) => !s.needsVillain);
  check('the finale is Kingpin', finale?.code === 'fne_s6_caid' && finale?.name === 'Kingpin', finale?.name);
  check('named in English', scenarios[0]?.name === 'Art Museum Heist', scenarios[0]?.name);
  check('and in French', box.scenarios('fr')[0]?.name === "Cambriolage du Musée d'Art", box.scenarios('fr')[0]?.name);

  const villains = box.villains('en');
  check('five subordinates', villains.length === 5);
  check('named in English', villains.find((v) => v.id === 'fne_villain_homme_pourpre')?.name === 'Purple Man');
  check('and in French', box.villains('fr').find((v) => v.id === 'fne_villain_homme_pourpre')?.name === "L'Homme Pourpre");

  const names = box.names('en');
  check('a job on its own has a name', names.get('fne_s1_musee') === 'Art Museum Heist');
  check('a job with its villain names both', names.get('fne_s1_musee__fne_villain_electro') === 'Art Museum Heist : Electro');
  check('the finale is plain', names.get('fne_s6_caid') === 'Kingpin');
  check('and takes no subordinate', !names.has('fne_s6_caid__fne_villain_electro'));
  check('six scenarios and twenty-five pairings', names.size === 31, String(names.size));
}

// --- the tracker -------------------------------------------------------------------

{
  const standard = box.encounterSetup('fne_s1_musee__fne_villain_electro', 2, false, 'en');
  check('standard plays stages I and II', standard.villain.map((s) => s.stage).join(',') === 'I,II', standard.villain.map((s) => s.stage).join(','));
  check("in the reader's language", standard.villain.every((s) => s.name === 'Electro'), standard.villain[0]?.name);
  check('with the printed health', standard.villain[0]?.value === 15, String(standard.villain[0]?.value));
  check('and the job\'s one scheme', standard.scheme.length === 1 && standard.players === 2);
  const expert = box.encounterSetup('fne_s1_musee__fne_villain_electro', 1, true, 'en');
  check('expert plays II and III', expert.villain.map((s) => s.stage).join(',') === 'II,III');
  const kingpin = box.encounterSetup('fne_s6_caid', 1, false, 'en');
  check('Kingpin has his own stages', kingpin.villain.map((s) => s.stage).join(',') === 'A1,A2', kingpin.villain.map((s) => s.stage).join(','));
  check('the racket deals a scheme to each player', box.encounterSetup('fne_s3_racket__fne_villain_bullseye', 3, false, 'en').schemeCopies === 3);
  check('a job without its villain has nothing to count', box.encounterSetup('fne_s1_musee', 1, false, 'en').villain.length === 0);
}

// --- the briefing ------------------------------------------------------------------

{
  const steps = box.briefing('fne_s1_musee__fne_villain_electro', false, 'en');
  check('names the villain', steps.some((s) => s.includes('Underling villain: "Electro"')), JSON.stringify(steps));
  check('and its stages for the difficulty', steps.some((s) => s.includes('"Electro" (I) and (II)')));
  check('and nobody else\'s', !steps.some((s) => s.includes('Hammerhead')));
  const expert = box.briefing('fne_s1_musee__fne_villain_electro', true, 'en');
  check('expert names the later stages', expert.some((s) => s.includes('"Electro" (II) and (III)')));
  check('no braces are left in the prose', !steps.some((s) => s.includes('{')));
  check('the environment card is the campaign\'s, not the game\'s', !steps.some((s) => s.toLowerCase().includes('environment')));
  check('the main scheme deck is named', steps.some((s) => s.includes('Main scheme deck')));
  check('the drawing steps are dropped', !box.briefing('fne_s1_musee__fne_villain_mary_typhoide', false, 'en').some((s) => s.includes('drawn at random')));
  check('but Typhoid Mary\'s own rule stays', box.briefing('fne_s1_musee__fne_villain_mary_typhoide', false, 'en').some((s) => s.includes('Disturbed Psyche')));
  check('in French too', box.briefing('fne_s1_musee__fne_villain_electro', false, 'fr').some((s) => s.includes('SUBORDONNÉ : "Electro"')), JSON.stringify(box.briefing('fne_s1_musee__fne_villain_electro', false, 'fr')));
  check('the finale briefs without a villain draw', box.briefing('fne_s6_caid', false, 'en').some((s) => s.includes('"Kingpin" (A1)')));
}

// --- the draw ----------------------------------------------------------------------

{
  const rules = { scenarios: [{ code: 'rhino', packCode: 'core', modularCount: 1, mandatoryModulars: [], recommendedModulars: [] }], modularSets: [] };
  const sets = [{ code: 'a', name: 'a', type: 'modular', packCode: 'core' }, { code: 'b', name: 'b', type: 'modular', packCode: 'core' }];
  const fne = { packCode: 'fne', scenarios: box.scenarios('en'), villains: box.villains('en').map((v) => v.id) };
  const input = { rules, sets, index: [], excludedModularSets: new Set(), excludedScenarios: new Set(), fne };

  const owned = buildPools({ ...input, ownedPackCodes: new Set(['core', 'fne']) });
  check('owning the box adds six entries, not thirty', owned.scenarios.length === 7, String(owned.scenarios.length));
  check('the jobs draw from the five', Object.keys(owned.villainChoices).length === 5 && owned.villainChoices['fne_s1_musee']?.length === 5);
  check('the finale draws nothing', owned.villainChoices['fne_s6_caid'] === undefined);
  const notOwned = buildPools({ ...input, ownedPackCodes: new Set(['core']) });
  check('without the box, none of it', notOwned.scenarios.length === 1 && Object.keys(notOwned.villainChoices).length === 0);
  const excluded = buildPools({ ...input, ownedPackCodes: new Set(['core', 'fne']), excludedScenarios: new Set(['fne_s1_musee']) });
  check('a job excluded in the collection is excluded', !excluded.scenarios.some((r) => r.code === 'fne_s1_musee') && excluded.villainChoices['fne_s1_musee'] === undefined);

  const drawn = withVillain('fne_s1_musee', owned);
  check('a job drawn gets a subordinate', drawn.startsWith('fne_s1_musee__fne_villain_'), drawn);
  check('the finale is left alone', withVillain('fne_s6_caid', owned) === 'fne_s6_caid');
  check('as is any other scenario', withVillain('rhino', owned) === 'rhino');
  check('a job with its villain no longer needs one', !needsVillain(drawn, owned.villainChoices));
  check('a bare job does', needsVillain('fne_s1_musee', owned.villainChoices));
  check('the rule is found from either form of the code', ruleFor(owned, drawn)?.code === 'fne_s1_musee');

  const draws = Array.from({ length: 200 }, () => roll({ pools: owned, previous: EMPTY_DRAW, locked: new Set(), playerCount: 1, extraModularSets: 2 }));
  check('no roll leaves a job without its villain', draws.every((d) => !needsVillain(d.scenarioCode, owned.villainChoices)));
  const fneDraws = draws.filter((d) => isFne(d.scenarioCode));
  check('the box comes up', fneDraws.length > 0);
  check('and takes no modular set, extras or not', fneDraws.every((d) => d.modularSetCodes.length === 0 && d.mandatoryModularCodes.length === 0));
  const kept = roll({ pools: owned, previous: { ...EMPTY_DRAW, scenarioCode: drawn }, locked: new Set(['scenario']), playerCount: 1 });
  check('a locked job keeps its villain', kept.scenarioCode === drawn, kept.scenarioCode);
}

process.exit(failures === 0 ? 0 : 1);
