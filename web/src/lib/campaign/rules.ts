import { evaluate } from './conditions';
import { heroCounterOf } from './types';
import type {
  CampaignState,
  CampaignTemplate,
  DrawDefinition,
  MarketEntry,
  ScenarioTemplate,
} from './types';

/**
 * The rules that sit beside the fold: what a draw may still come up with, which
 * scenarios the players may still pick, and what the market will sell.
 *
 * Ported from `CampaignEngine.drawPool`, `choosableScenarios` and
 * `engine/MarketRules.kt`. They are here rather than in engine.ts because none
 * of them change state: they answer questions the screens ask, and keeping them
 * apart is what stops a screen reaching into the fold.
 */

// --- draws --------------------------------------------------------------------

/**
 * One player's pool, or null when this draw does not have per-hero ones.
 *
 * A hero who recorded no marker gets an empty pool rather than the table's,
 * which is what keeps a player who has not chosen a role from being dealt
 * somebody else's upgrade.
 */
function perHeroPool(
  draw: DrawDefinition,
  state: CampaignState,
  heroId: string | null | undefined,
): readonly string[] | null {
  const pools = draw.perHeroPools ?? {};
  if (Object.keys(pools).length === 0 || heroId == null) {
    return null;
  }
  const listId = draw.perHeroPoolList;
  if (listId == null) {
    return null;
  }
  const forHero = state.heroCardLists[listId]?.[heroId] ?? [];
  const marker = forHero.at(-1);
  return pools[marker ?? ''] ?? [];
}

/**
 * The cards a draw may come up with.
 *
 * Anything already recorded in the excluding list is spent. If that empties the
 * pool the full set comes back: a scenario that needs a card must get one, and
 * an empty setup step would read as a bug.
 *
 * A per-hero pool does not refill, because running out of role upgrades is the
 * rule working rather than a pool to reset.
 */
export function drawPool(
  draw: DrawDefinition,
  state: CampaignState,
  heroId: string | null = null,
): readonly string[] {
  const own = perHeroPool(draw, state, heroId);
  const candidates = own ?? draw.from ?? [];

  const spent = new Set<string>();
  if (draw.excluding != null) {
    for (const code of state.cardLists[draw.excluding] ?? []) {
      spent.add(code);
    }
  }
  if (heroId != null && draw.excludingPerHero != null) {
    for (const code of state.heroCardLists[draw.excludingPerHero]?.[heroId] ?? []) {
      spent.add(code);
    }
  }

  const left = candidates.filter((code) => !spent.has(code));
  if (own !== null) {
    return left;
  }
  return left.length > 0 ? left : candidates;
}

/**
 * Deals from a pool without replacement.
 *
 * The randomness is the caller's, passed in, so a test can be deterministic and
 * so nothing here draws twice for the same screen. The engine records what came
 * up as an event precisely because a pick made while rendering would come out
 * differently on every redraw, and the mission would change while the player
 * was reading it.
 */
export function deal(
  pool: readonly string[],
  count: number,
  random: () => number = Math.random,
): string[] {
  const remaining = [...pool];
  const drawn: string[] = [];
  for (let i = 0; i < count && remaining.length > 0; i += 1) {
    const index = Math.floor(random() * remaining.length) % remaining.length;
    drawn.push(...remaining.splice(index, 1));
  }
  return drawn;
}

// --- what to play next ---------------------------------------------------------

/**
 * The scenarios the players may still pick.
 *
 * Resolved, not merely played. Fear No Evil says a lost scenario has not failed
 * and may be attempted again; only winning it, or letting the villains push it
 * to its limit, settles it. Treating any completed scenario as done took a
 * defeat and quietly struck the job off, which is neither the rule nor what a
 * table expects.
 *
 * The finale is held back until it is the only thing left, which is what makes
 * it the finale.
 */
export function choosableScenarios(
  template: CampaignTemplate,
  state: CampaignState,
): readonly ScenarioTemplate[] {
  const won = new Set(
    state.completedScenarios.filter((result) => result.victory).map((result) => result.scenarioId),
  );
  const scenarios = template.scenarios ?? [];

  const remaining = scenarios.filter((scenario) => {
    if (won.has(scenario.id) || scenario.id === template.finaleScenarioId) {
      return false;
    }
    // Lost without ever being played: a place pushed three times is gone.
    // Offering it again would let a table undo the one decision the campaign
    // asks of them.
    if (
      scenario.failedWhen != null &&
      evaluate(scenario.failedWhen, { state, scenarioId: scenario.id })
    ) {
      return false;
    }
    return true;
  });

  if (remaining.length > 0) {
    return remaining;
  }
  return scenarios.filter(
    (scenario) => scenario.id === template.finaleScenarioId && !won.has(scenario.id),
  );
}

// --- the market ----------------------------------------------------------------

/** Why a hero cannot buy a market card right now. */
export type PurchaseRefusal =
  | { readonly kind: 'not_enough_credits' }
  /** Someone in the group already bought it. One copy per campaign, group-wide. */
  | { readonly kind: 'already_owned_by_group'; readonly heroId: string }
  | { readonly kind: 'no_market' }
  | { readonly kind: 'unknown_card' };

export interface MarketOffer {
  readonly entry: MarketEntry;
  readonly affordable: boolean;
  readonly refusal: PurchaseRefusal | null;
}

export const canBuy = (offer: MarketOffer): boolean => offer.refusal === null;

const MARKET_COUNTER_FALLBACK = 'credits';

/**
 * The market between scenarios.
 *
 * The rule that is easy to get wrong: **one copy of each card per campaign
 * across the whole group**, not per hero. Credits, by contrast, are per hero.
 */
export function offersFor(
  template: CampaignTemplate,
  state: CampaignState,
  heroId: string,
): readonly MarketOffer[] {
  const market = template.market;
  if (market == null) {
    return [];
  }
  const counterId = market.counterId ?? MARKET_COUNTER_FALLBACK;
  const credits = heroCounterOf(state, counterId, heroId);
  const takenBy = new Map(state.purchases.map((purchase) => [purchase.cardCode, purchase.heroId]));

  return (market.entries ?? []).map((entry) => {
    const owner = takenBy.get(entry.cardCode);
    const affordable = credits >= entry.cost;
    const refusal: PurchaseRefusal | null =
      owner !== undefined
        ? { kind: 'already_owned_by_group', heroId: owner }
        : affordable
          ? null
          : { kind: 'not_enough_credits' };
    return { entry, affordable, refusal };
  });
}

export function canPurchase(
  template: CampaignTemplate,
  state: CampaignState,
  heroId: string,
  cardCode: string,
): PurchaseRefusal | null {
  const market = template.market;
  if (market == null) {
    return { kind: 'no_market' };
  }
  const entry = (market.entries ?? []).find((candidate) => candidate.cardCode === cardCode);
  if (entry === undefined) {
    return { kind: 'unknown_card' };
  }
  const owner = state.purchases.find((purchase) => purchase.cardCode === cardCode);
  if (owner !== undefined) {
    return { kind: 'already_owned_by_group', heroId: owner.heroId };
  }
  const counterId = market.counterId ?? MARKET_COUNTER_FALLBACK;
  if (heroCounterOf(state, counterId, heroId) < entry.cost) {
    return { kind: 'not_enough_credits' };
  }
  return null;
}
