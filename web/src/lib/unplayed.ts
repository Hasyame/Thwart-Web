import { isFne, splitFne } from './fearNoEvil';
import { roll, ruleFor, scenariosShortOfExtras, type RollInput, type Draw } from './randomizer';

export const scenarioIdentity = (code: string): string => isFne(code) ? splitFne(code).job : code;
export const pairing = (hero: string, scenario: string): string => JSON.stringify([hero, scenarioIdentity(scenario)]);

/** Enumerate possible scenarios rather than retrying random draws and missing rare pairs. */
export function rollUnplayed(input: RollInput, played: ReadonlySet<string>): Draw | null {
  const { pools, previous, locked, playerCount } = input;
  const short = new Set(scenariosShortOfExtras(pools, playerCount, input.extraModularSets ?? 0).map((r) => r.code));
  const scenarios = locked.has('scenario')
    ? [ruleFor(pools, previous.scenarioCode)].filter((r) => r !== null)
    : pools.scenarios.filter((r) => !short.has(r.code));
  const candidates = scenarios.flatMap((scenario) => {
    const heroes = pools.heroes.filter((hero) => !played.has(pairing(hero.code, scenario.code)));
    const valid = locked.has('heroes')
      ? previous.heroes.length === playerCount && previous.heroes.every((h) => !played.has(pairing(h.code, scenario.code)))
      : heroes.length >= playerCount;
    return valid ? [{ scenario, heroes }] : [];
  });
  const selected = candidates[Math.floor(Math.random() * candidates.length)];
  if (selected === undefined) return null;
  return roll({ ...input, pools: { ...pools, scenarios: [selected.scenario], heroes: selected.heroes } });
}
