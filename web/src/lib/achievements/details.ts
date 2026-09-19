import { CLASSIC_ASPECTS, LEVEL_RANK, type AchievementDefinition, type DeriveInput, type PlayFact } from './types';

/** Display-only checklist. No stored state or change to the shared derivation output. */
export interface AchievementTarget {
  readonly key: string;
  readonly kind: 'scenario' | 'hero' | 'aspect';
  readonly pack: string | null;
  readonly completedBy: PlayFact | null;
}

export function achievementTargets(input: DeriveInput, definition: AchievementDefinition): readonly AchievementTarget[] | null {
  const p = definition.predicate;
  if (p.kind !== 'scenarios_won' && p.kind !== 'heroes_won' && p.kind !== 'aspects_won') return null;
  const wins = input.facts.filter((f) => f.won && LEVEL_RANK[f.level] >= LEVEL_RANK[p.minDifficulty ?? 'unknown'])
    .sort((a, b) => a.playedAt - b.playedAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  if (p.kind === 'scenarios_won') {
    return [...new Map(input.catalogue.scenarios.map((s) => [s.key, s.packCode]))]
      .filter(([, pack]) => p.pack === '*' || pack === p.pack)
      .map(([key, pack]) => ({ key, pack, kind: 'scenario', completedBy: wins.find((f) => f.scenarioKey === key) ?? null }));
  }
  if (p.kind === 'heroes_won') {
    return [...new Map(input.catalogue.heroes.map((h) => [h.code, h.packCode]))]
      .filter(([, pack]) => p.pack === '*' || pack === p.pack)
      .map(([key, pack]) => ({ key, pack, kind: 'hero', completedBy: wins.find((f) => f.seats.some((s) => s.heroCode === key)) ?? null }));
  }
  return CLASSIC_ASPECTS.map((key) => ({
    key, kind: 'aspect', pack: p.scenario === undefined ? null : input.catalogue.scenarios.find((s) => s.key === p.scenario)?.packCode ?? null,
    completedBy: wins.find((f) => (p.scenario === undefined || f.scenarioKey === p.scenario) && f.seats.some((s) => s.aspects.includes(key))) ?? null,
  }));
}
