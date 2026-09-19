import { db } from './db';
import { loadScenarioRules } from './data';
import { loadFneBox } from './fearNoEvil';
import { buildPools, EMPTY_DRAW, roll } from './randomizer';
import type { CardSet, IndexRow } from './types';
import type { Session } from './session.svelte';
import type { AchievementChallenge } from './achievements/challenge';
import { ownedHeroes, rulesFor } from './draft/context';
import { imposedAspects } from './draft/engine';

export async function challengeGame(challenge: AchievementChallenge, sets: readonly CardSet[], index: readonly IndexRow[]): Promise<Partial<Session>> {

  const owned = new Map((await db.ownedPacks.toArray()).map((p) => [p.packCode, p.quantity]));
  const codes = ownedHeroes(index, owned).sort((a, b) => Number(b === challenge.hero) - Number(a === challenge.hero))
    .filter((code) => challenge.hero === undefined || code === challenge.hero || (challenge.players ?? 1) > 1)
    .filter((code) => !challenge.distinctAspects || rulesFor(index, code)?.aspectCount === 1)
    .slice(0, challenge.players ?? 1);
  const seats = codes.map((code, i) => {
    const rules = rulesFor(index, code);
    const aspects = imposedAspects(rules) ?? [...new Set([...(challenge.aspect === undefined ? [] : [challenge.aspect]),
      ...['aggression', 'justice', 'leadership', 'protection'].slice(challenge.distinctAspects ? i : 0)])].slice(0, rules?.aspectCount ?? 1);
    const name = index.find((r) => r.code === code)?.name ?? code;
    return { deckId: code, deckName: name, heroCode: code, heroName: name, aspect: aspects.join(',') };
  });
  if (seats.length !== (challenge.players ?? 1) ||
      (challenge.hero !== undefined && !codes.includes(challenge.hero)) ||
      (challenge.aspect !== undefined && !seats.some((s) => s.aspect.split(',').includes(challenge.aspect!)))) {
    throw new Error('Challenge requirements unavailable');
  }
  const [rules, fne, missing, excluded] = await Promise.all([loadScenarioRules(), loadFneBox(), db.excludedModularSets.toArray(), db.excludedScenarios.toArray()]);
  const pools = buildPools({ rules, fne: fne?.packCode ? { packCode: fne.packCode, scenarios: fne.scenarios('en'), villains: fne.villains('en').map((v) => v.id) } : null, index, sets, ownedPackCodes: new Set([...owned].filter(([, n]) => n > 0).map(([code]) => code)),
    excludedModularSets: new Set(missing.map((s) => s.setCode)), excludedScenarios: new Set(excluded.map((s) => s.scenarioCode)) });
  const scenarios = pools.scenarios.filter((s) => challenge.scenario === undefined || s.code === challenge.scenario);
  const difficulties = pools.difficulties.filter((d) => challenge.expert ? d.startsWith('EXPERT') : d.startsWith('STANDARD'));
  if (scenarios.length === 0 || difficulties.length === 0) throw new Error('Challenge requirements unavailable');
  const draw = roll({ pools: { ...pools, scenarios, difficulties },
    previous: EMPTY_DRAW, locked: new Set(), playerCount: challenge.players ?? 1 });
  return { seats, scenarioCode: draw.scenarioCode ?? '', scenarioName: sets.find((s) => s.code === draw.scenarioCode)?.name ?? draw.scenarioCode ?? '',
    difficulty: draw.difficulty ?? 'STANDARD_I', standardSet: draw.standardSet, modularSetCodes: [...draw.mandatoryModularCodes, ...draw.modularSetCodes] };
}

export async function limitedGame(ids: readonly string[], random: boolean, sets: readonly CardSet[], index: readonly IndexRow[]): Promise<Partial<Session>> {
  const decks = (await db.decks.bulkGet([...ids])).filter((deck) => deck !== undefined);
  if (decks.length === 0 || decks.length !== ids.length) throw new Error('Saved decks unavailable');
  const seats = decks.map((deck) => ({ deckId: deck.id, deckName: deck.name, heroCode: deck.heroCode, heroName: deck.heroName, aspect: deck.aspects }));
  if (!random) return { seats };
  const [rules, fne, owned, excludedModulars, excludedScenarios] = await Promise.all([
    loadScenarioRules(), loadFneBox(), db.ownedPacks.toArray(), db.excludedModularSets.toArray(), db.excludedScenarios.toArray(),
  ]);
  const pools = buildPools({ rules, fne: fne?.packCode ? { packCode: fne.packCode, scenarios: fne.scenarios('en'), villains: fne.villains('en').map((v) => v.id) } : null, sets, index, ownedPackCodes: new Set(owned.filter((p) => p.quantity > 0).map((p) => p.packCode)),
    excludedModularSets: new Set(excludedModulars.map((s) => s.setCode)), excludedScenarios: new Set(excludedScenarios.map((s) => s.scenarioCode)) });
  const draw = roll({ pools, previous: EMPTY_DRAW, locked: new Set(), playerCount: seats.length });
  return { seats, scenarioCode: draw.scenarioCode ?? '', scenarioName: sets.find((s) => s.code === draw.scenarioCode)?.name ?? draw.scenarioCode ?? '',
    difficulty: draw.difficulty ?? 'STANDARD_I', standardSet: draw.standardSet, modularSetCodes: [...draw.mandatoryModularCodes, ...draw.modularSetCodes] };
}
