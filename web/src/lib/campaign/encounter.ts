import type { EncounterSetup, EncounterSide } from '../encounter';
import type { IndexRow } from '../types';
import { VILLAIN_DRAW_ID } from './deal';
import { amountFor, counterOf } from './types';
import type {
  BaseSetup,
  CampaignState,
  CampaignTemplate,
  ScenarioTemplate,
  TrackedSide,
} from './types';

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

// --- numbers the campaign carries itself ---------------------------------------

/**
 * The tracker a campaign supplies for itself, in place of the card database.
 *
 * Fear No Evil's subordinates are on no database — they are the campaign's own
 * invention — so without this that whole campaign has no tracker at all: no
 * health counting down, no threat counting up, which is most of what somebody
 * opens a companion for. Every other campaign leaves the block out and is read
 * from the cards as before.
 *
 * Ported from `CampaignRunViewModel.buildEncounter`.
 */
export function trackerSetupFor(
  template: CampaignTemplate,
  state: CampaignState,
  scenario: ScenarioTemplate | null,
  players: number,
): EncounterSetup | null {
  const tracker = template.tracker;
  if (tracker == null || scenario === null) {
    return null;
  }

  const drawn = drawnVillainFor(state, scenario.id);
  const villains =
    (drawn === null ? undefined : tracker.villains?.[drawn]) ?? tracker.villains?.[scenario.id];
  const schemes = tracker.schemes?.[scenario.id];
  if (villains === undefined && schemes === undefined) {
    return null;
  }

  const expert = isExpertCampaign(state);
  const side = (tracked: TrackedSide): EncounterSide => ({
    name: tracked.name,
    stage: tracked.stage ?? '',
    // Floored at zero: a template can be imported from a file, and a negative
    // health would have the villain defeated the moment the game started.
    value: tracked.value == null ? null : Math.max(0, tracked.value),
    perPlayer: tracked.perPlayer ?? true,
    starred: tracked.starred === true,
    startingThreat: Math.max(0, tracked.startingThreat ?? 0),
    startingThreatPerPlayer: tracked.startingThreatPerPlayer ?? true,
    escalation: Math.max(0, tracked.escalation ?? 0),
    escalationPerPlayer: tracked.escalationPerPlayer === true,
    // The pressure already on a job before anybody sits down. It is not on the
    // card and cannot be: it depends on how the campaign has gone.
    extraStartingThreat: amountFor(
      tracked.startingThreatFrom,
      counterOf(state, tracked.startingThreatFrom?.counter ?? ''),
      expert,
    ),
  });

  /*
   * A side played on one difficulty only.
   *
   * Fear No Evil deals its subordinates as two stages out of three: standard
   * faces I and II, expert II and III. Counting from the first stage whatever
   * the campaign had an expert table counting a villain down to a number
   * printed on a card that was not on the table.
   */
  const played = (tracked: TrackedSide): boolean =>
    tracked.onlyOn == null ||
    tracked.onlyOn.toLowerCase() === (expert ? 'expert' : 'standard');

  return {
    villain: (villains ?? []).filter(played).map(side),
    // One stage per entry, each with a single option: a campaign states the
    // stages it plays, where a printed scenario can offer a choice between
    // several schemes for one stage.
    scheme: (schemes ?? []).filter(played).map((tracked) => ({
      stage: tracked.stage ?? '',
      options: [side(tracked)],
    })),
    players: Math.max(1, players),
    // Fear No Evil's racket job deals a market to each player, so a table of
    // three is thwarting three schemes that finish at different times.
    schemeCopies: (tracker.perPlayerSchemes ?? []).includes(scenario.id)
      ? Math.max(1, players)
      : 1,
  };
}
