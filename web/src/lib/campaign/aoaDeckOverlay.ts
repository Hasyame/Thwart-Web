import type { CampaignState } from './types';

/** Printed mission cards derived from the log, separate from ordinary deck slots. */
export function aoaDeckOverlay(state: CampaignState): readonly {code: string; optional: boolean}[] {
  if (state.templateId !== 'aoa') return [];
  const has = (flag: string): boolean => Object.values(state.flags[flag] ?? {}).some(Boolean);
  const result: {code: string; optional: boolean}[] = [];
  if (has('seattleWon') && !has('seattleLost')) result.push({code: '45176', optional: true});
  const mission = state.draws[state.currentScenarioId ?? '']?.mission ?? [];
  if (!has('evacuateWon') && (has('evacuateLost') || mission.includes('45167a'))) {
    result.push({code: '45178', optional: false});
  }
  return result;
}
