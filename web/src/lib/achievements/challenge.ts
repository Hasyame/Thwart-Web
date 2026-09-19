import { achievementTargets } from './details';
import type { AchievementDefinition, DeriveInput } from './types';

export interface AchievementChallenge {
  hero?: string;
  scenario?: string;
  aspect?: string;
  players?: number;
  distinctAspects?: boolean;
  expert?: boolean;
  destination?: 'game' | 'campaign' | 'draft' | 'sealed';
}

export function achievementChallenge(input: DeriveInput, definition: AchievementDefinition): AchievementChallenge | null {
  const p = definition.predicate;
  if (p.kind === 'loss_count') return null;
  const targets = achievementTargets(input, definition);
  const target = targets?.find((t) => t.completedBy === null && (t.pack === null || input.ownedPacks.includes(t.pack)));
  if (targets !== null && target === undefined) return null;
  const challenge: AchievementChallenge = { expert: 'minDifficulty' in p && p.minDifficulty === 'expert' };
  if (target?.kind === 'hero') challenge.hero = target.key;
  if (target?.kind === 'scenario') challenge.scenario = target.key;
  if (target?.kind === 'aspect') { challenge.aspect = target.key; if (p.kind === 'aspects_won') challenge.scenario = p.scenario; }
  if (p.kind === 'table_win') { challenge.players = p.players; challenge.distinctAspects = p.distinctAspects; }
  if (p.kind === 'campaign') challenge.destination = 'campaign';
  if (p.kind === 'mode_win') {
    if (p.mode !== 'draft' && p.mode !== 'sealed') return null;
    challenge.destination = p.mode;
  }
  if (p.kind === 'count' && p.what === 'heroes_played') {
    const played = new Set(input.facts.flatMap((f) => f.seats.map((s) => s.heroCode)));
    const hero = input.catalogue.heroes.find((h) => input.ownedPacks.includes(h.packCode) && !played.has(h.code));
    if (hero === undefined) return null;
    challenge.hero = hero.code;
  }
  return challenge;
}
