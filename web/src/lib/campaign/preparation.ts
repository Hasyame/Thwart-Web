import type { SetupStep } from './types';

/** Presentation-only routing of the audited AoA instructions; never changes the log. */
export function aoaPlayerDeckStep(step: SetupStep): boolean {
  return step.showCardList?.startsWith('reward') === true
    || ['seattleWon', 'seattleLost', 'evacuateWon', 'evacuateLost', 'seawallWon', 'lostmutantsWon', 'lostmutantsLost'].includes(step.when?.countTrue ?? '');
}

/** Scenario instructions stored in the original campaign template belong beside the scheme. */
export function aoaScenarioStep(step: SetupStep, scenarioId: string): boolean {
  if (step.draw?.id === 'horsemen' || step.when?.scenarioDifficulty != null) return true;
  if (scenarioId === 's2_four_horsemen' && !step.when && !step.draw && !step.cards && !step.action) {
    return step.text?.en === 'Give the active counter to the leftmost villain';
  }
  return scenarioId === 's5_en_sabah_nur' && step.cards?.includes('45163') === true;
}

/** These instructions already have dedicated controls, so do not repeat their template prose. */
export function aoaRepeatedStep(step: SetupStep): boolean {
  return step.text?.en === "Choose the Standard set for this game. Scenario difficulty is independent of campaign difficulty."
    || (step.cards?.length === 0 && step.when?.difficulty != null && step.showCounter == null && step.action == null);
}
