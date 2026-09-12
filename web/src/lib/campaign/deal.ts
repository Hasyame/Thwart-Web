import { allSetupSteps, ENVIRONMENT_DRAW_SCENARIO, heroDrawId } from './engine';
import { choosableScenarios, deal, drawPool } from './rules';
import type { CampaignState, CampaignTemplate, DrawDefinition } from './types';

/**
 * Every random pick a campaign makes on the players' behalf.
 *
 * The app draws; asking the table to roll for it and type the answer back is
 * the work a companion exists to remove. Ported from `ensureSetupDraws`,
 * `ensureVillainAssignment` and `ensureEnvironmentOffer`.
 *
 * All three are pure and idempotent: they say what should be appended given
 * the state as it stands, and say nothing when the log already holds it. That
 * is what lets them run on every load without dealing a second time, and what
 * makes a pick stable — recorded as an event, it survives leaving the screen
 * and cannot change while somebody is reading the setup off it.
 */

/** Draw id the villain assignment is filed under, per scenario. */
export const VILLAIN_DRAW_ID = 'villain';

/** The campaign question asking which order the subordinates come in. */
export const VILLAIN_ORDER_CHOICE = 'villainOrder';

/** Its answer meaning "the order the book prints". */
export const VILLAIN_ORDER_RECOMMENDED = 'recommended';

/** A draw to file: which scenario, which draw, and what came up. */
export interface PendingDraw {
  readonly scenarioId: string;
  readonly drawId: string;
  readonly cardCodes: readonly string[];
}

/** How many cards a definition asks for. An offer deals several to choose from. */
const wantedFrom = (draw: DrawDefinition): number =>
  Math.max(1, (draw.offer ?? 0) > 0 ? (draw.offer ?? 0) : (draw.count ?? 1));

const alreadyDrawn = (
  draws: Readonly<Record<string, Readonly<Record<string, readonly string[]>>>>,
  scenarioId: string,
  drawId: string,
): boolean => (draws[scenarioId]?.[drawId] ?? []).length > 0;

/**
 * The draws the current scenario's setup calls for and has not had.
 *
 * Every section, not just the middle one: a draw written into the pre-setup or
 * the information block was never dealt, which is how Fear No Evil's Psyche
 * Perturbée face went undrawn.
 *
 * Worked out in sequence rather than mapped, because each draw must see the
 * ones before it — two draws over the same pool could otherwise come up with
 * one card twice in the same setup.
 */
export function setupDrawsFor(
  template: CampaignTemplate,
  state: CampaignState,
  random: () => number = Math.random,
): readonly PendingDraw[] {
  const scenarioId = state.currentScenarioId;
  if (scenarioId === null) {
    return [];
  }
  const scenario = (template.scenarios ?? []).find((candidate) => candidate.id === scenarioId);
  if (scenario === undefined) {
    return [];
  }

  const pending: PendingDraw[] = [];
  // A local view of what has been dealt, so a draw filed a moment ago is
  // visible to the next one without folding the whole log again.
  let draws = state.draws;
  const seen = (): CampaignState => ({ ...state, draws });

  for (const step of allSetupSteps(scenario)) {
    const definition = step.draw;
    if (definition == null) {
      continue;
    }
    // A per-hero draw deals to each player in turn, under its own id and
    // theirs, so a pool per player knows whose pool to deal from.
    const targets: ReadonlyArray<readonly [string, string | null]> =
      definition.perHero === true
        ? state.heroes.map((hero) => [heroDrawId(definition.id, hero.id), hero.id] as const)
        : [[definition.id, null] as const];

    for (const [drawId, heroId] of targets) {
      if (alreadyDrawn(draws, scenarioId, drawId)) {
        continue;
      }
      const codes = deal(drawPool(definition, seen(), heroId), wantedFrom(definition), random);
      if (codes.length === 0) {
        continue;
      }
      pending.push({ scenarioId, drawId, cardCodes: codes });
      draws = {
        ...draws,
        [scenarioId]: { ...(draws[scenarioId] ?? {}), [drawId]: codes },
      };
    }
  }
  return pending;
}

/**
 * Who is behind the job about to be played, settled once and kept.
 *
 * Fear No Evil fixes this before the first game and the players find out only
 * when they arrive. A name once noted is kept, which is why a job that is
 * retried faces the same villain, and everyone already noted is out of the
 * running, which is what keeps the five distinct across a campaign.
 */
export function villainAssignmentFor(
  template: CampaignTemplate,
  state: CampaignState,
  random: () => number = Math.random,
): PendingDraw | null {
  const pool = template.villainPool ?? [];
  const scenarioId = state.currentScenarioId;
  if (pool.length === 0 || scenarioId === null) {
    return null;
  }
  // The last villain brings his own; he is not one of the five.
  if (scenarioId === template.finaleScenarioId) {
    return null;
  }
  if (alreadyDrawn(state.draws, scenarioId, VILLAIN_DRAW_ID)) {
    return null;
  }

  const spent = new Set(
    (template.scenarios ?? [])
      .map((scenario) => state.draws[scenario.id]?.[VILLAIN_DRAW_ID]?.[0])
      .filter((code): code is string => code !== undefined),
  );
  const left = pool.filter((code) => !spent.has(code));
  const candidates = left.length > 0 ? left : pool;

  /*
   * The recommended order is the pool's own — the list the book prints for a
   * table meeting these five for the first time. Its last entry is "Purple
   * Man or Typhoid Mary", one line for two villains, so while both are left
   * the order says nothing between them and the app draws; the one not drawn
   * is the last. Any other answer means at random throughout. The phone's
   * `ensureVillainAssignment` reads the book the same way.
   */
  const recommended = state.choices[VILLAIN_ORDER_CHOICE] === VILLAIN_ORDER_RECOMMENDED;
  const tail = pool.slice(-2);
  const bothOfTheTailLeft =
    candidates.length === tail.length && tail.every((code) => candidates.includes(code));
  const villain =
    recommended && !bothOfTheTailLeft ? candidates[0] : deal(candidates, 1, random)[0];
  if (villain === undefined) {
    return null;
  }
  return { scenarioId, drawId: VILLAIN_DRAW_ID, cardCodes: [villain] };
}

/**
 * The rotation's environments, when a campaign works that way.
 *
 * Two off the top of what is left, or the last one on its own — which then
 * takes double the pressure. Only places still in play go back in: the book's
 * first step is to take the environments of finished and fallen jobs out of the
 * pile, and without it the villains kept hitting jobs the players had already
 * put to bed.
 *
 * Returns null when nothing should be dealt, which includes a rotation already
 * dealt and kept: an empty table read as "nothing dealt yet" would deal another
 * pair on every reload and push the city over on its own.
 */
export function environmentOfferFor(
  template: CampaignTemplate,
  state: CampaignState,
  random: () => number = Math.random,
): readonly string[] | null {
  const definition = template.environmentDraw;
  if (definition == null || !state.awaitingChoice || state.campaignLost) {
    return null;
  }
  if (state.environmentOffer.length > 0 || state.environmentPicked) {
    return null;
  }

  const live = new Set(
    choosableScenarios(template, state)
      .map((scenario) => scenario.id)
      .filter((id) => id !== template.finaleScenarioId),
  );
  const standing = (definition.from ?? []).filter((id) => live.has(id));
  if (standing.length === 0) {
    return null;
  }
  return standing.length === 1 ? standing : deal(standing, 2, random);
}

/** The scenario id an environment draw is filed under. */
export { ENVIRONMENT_DRAW_SCENARIO };
