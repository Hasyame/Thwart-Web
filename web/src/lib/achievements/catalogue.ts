import type { IndexRow } from '../types';
import type { ScenarioRulesFile } from '../randomizer';
import type { CampaignTemplate } from '../campaign/types';
import { fneCodeOf } from '../fearNoEvil';
import type { Catalogue, HeroRef, ScenarioRef } from './types';

/**
 * What the grid ranges over: every hero and every scenario the card data
 * knows, each with its pack. data-model.md §4, "catalogue inputs".
 *
 * Heroes are index rows of type `hero`, one per hero card code. Scenarios
 * are the scenario-rules entries — the same list the randomiser draws
 * from — plus Fear No Evil's six one-off keys, which are on no database and
 * come from its template. Built once per card data, never from the plays:
 * a scenario nobody has played is still a row to fill.
 */
export function buildCatalogue(
  index: readonly IndexRow[],
  rules: ScenarioRulesFile | null,
  fneTemplate: CampaignTemplate | null,
): Catalogue {
  const heroes: HeroRef[] = [];
  const seenHero = new Set<string>();
  for (const row of index) {
    if (row.typeCode === 'hero' && !seenHero.has(row.code)) {
      seenHero.add(row.code);
      heroes.push({ code: row.code, packCode: row.packCode });
    }
  }
  const scenarios: ScenarioRef[] = [];
  const seenScenario = new Set<string>();
  for (const rule of rules?.scenarios ?? []) {
    if (!seenScenario.has(rule.code)) {
      seenScenario.add(rule.code);
      scenarios.push({ key: rule.code, packCode: rule.packCode });
    }
  }
  if (fneTemplate !== null) {
    const pack = fneTemplate.packCode ?? 'fne';
    for (const scenario of fneTemplate.scenarios ?? []) {
      const key = fneCodeOf(scenario.id);
      if (!seenScenario.has(key)) {
        seenScenario.add(key);
        scenarios.push({ key, packCode: pack });
      }
    }
  }
  heroes.sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
  scenarios.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return { heroes, scenarios };
}
