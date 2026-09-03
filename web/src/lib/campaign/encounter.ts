import type { IndexRow } from '../types';
import { VILLAIN_DRAW_ID } from './deal';
import type { BaseSetup, CampaignState, CampaignTemplate, ScenarioTemplate } from './types';

/**
 * Working out which villain a campaign scenario fields, so the tracker can
 * count its health.
 *
 * The set is read off the villain rather than declared in the template: every
 * campaign already names its villain by card code, and the card knows which set
 * it belongs to, so this works for all nine without touching any of them.
 *
 * Ported from `BaseSetup.villainStages` and `CampaignRunViewModel.buildEncounter`.
 */

/**
 * The villain cards this scenario's deck is built from, at this difficulty.
 *
 * A campaign that deals its villain — Fear No Evil, whose subordinates are
 * settled before the first game — names it in the log rather than the template,
 * so the drawn card decides which of `villainDecks` applies.
 */
export function villainStages(
  setup: BaseSetup | null | undefined,
  difficulty: string,
  drawnVillain: string | null,
): readonly string[] {
  if (setup == null) {
    return [];
  }
  const fromDraw =
    setup.villainDeckFromDraw != null && drawnVillain !== null
      ? (setup.villainDecks?.[drawnVillain]?.[difficulty] ?? [])
      : [];
  return fromDraw.length > 0 ? fromDraw : (setup.villainDeck?.[difficulty] ?? []);
}

/** The villain assignment the log holds for a scenario, if it deals one. */
export const drawnVillainFor = (state: CampaignState, scenarioId: string): string | null =>
  state.draws[scenarioId]?.[VILLAIN_DRAW_ID]?.[0] ?? null;

/**
 * The encounter set whose cards the tracker should read, or null.
 *
 * Null for a scenario whose villain is in no database — Fear No Evil's are not
 * on MarvelCDB — and the panel then says so rather than counting numbers it
 * made up.
 */
export function trackedSetCode(
  scenario: ScenarioTemplate | null,
  state: CampaignState,
  index: readonly IndexRow[],
): string | null {
  if (scenario === null) {
    return null;
  }
  const drawn = drawnVillainFor(state, scenario.id);
  const villain =
    villainStages(scenario.baseSetup, state.difficulty, drawn)[0] ?? drawn ?? null;
  if (villain === null) {
    return null;
  }
  return index.find((row) => row.code === villain)?.setCode ?? null;
}

/** Everything a scenario's encounter deck is built from, encounter sets first. */
export const encounterSetsOf = (scenario: ScenarioTemplate | null): readonly string[] =>
  scenario === null
    ? []
    : [...(scenario.baseSetup?.encounterSets ?? []), ...(scenario.baseSetup?.modularSets ?? [])];

/**
 * The campaigns' own word for the harder mode.
 *
 * An expert campaign plays the same later villain stages a one-off expert game
 * does, which is the only thing the tracker needs to know.
 */
export const isExpertCampaign = (state: CampaignState): boolean =>
  state.difficulty.toLowerCase() === 'expert';

/** The scenario a run is currently on, or null between them. */
export const currentScenario = (
  template: CampaignTemplate | null,
  state: CampaignState | null,
): ScenarioTemplate | null => {
  if (template === null || state === null || state.currentScenarioId === null) {
    return null;
  }
  return (
    (template.scenarios ?? []).find((scenario) => scenario.id === state.currentScenarioId) ?? null
  );
};
