import {
  countTrueOf,
  counterOf,
  flagOf,
  heroCounterOf,
  type AnswerSet,
  type CampaignState,
  type Condition,
} from './types';

/**
 * Judging a template condition against the state.
 *
 * A port of `engine/ConditionEvaluator.kt`. Every field present must hold, and
 * `any` is the escape hatch for alternatives. A condition with no fields set is
 * vacuously true, which is what makes `when` optional everywhere in the schema.
 *
 * This is the file where a mistake does not crash anything: it quietly changes
 * what a campaign does, three scenarios later, in a way nobody can trace back.
 * Hence the port rather than a rewrite, and hence the tests against the real
 * templates.
 */

export interface EvaluationContext {
  readonly state: CampaignState;
  readonly scenarioId?: string | null;
  readonly answers?: AnswerSet;
  /** Set when evaluating per hero, so hero counters resolve to that hero. */
  readonly heroId?: string | null;
}

const EMPTY_ANSWERS: AnswerSet = {};

/**
 * `trackerDefeated.s1_badoon` reads one scenario's flag; `trackerDefeated`
 * reads the current scenario's, falling back to the campaign-scoped slot.
 */
function resolveFlag(
  reference: string,
  state: CampaignState,
  currentScenarioId: string | null | undefined,
): boolean {
  const dot = reference.indexOf('.');
  if (dot >= 0) {
    return flagOf(state, reference.slice(0, dot), reference.slice(dot + 1));
  }
  return flagOf(state, reference, currentScenarioId ?? '') || flagOf(state, reference, '');
}

export function evaluate(
  condition: Condition | null | undefined,
  context: EvaluationContext,
): boolean {
  if (condition === null || condition === undefined) {
    return true;
  }
  const { state } = context;
  const answers = context.answers ?? EMPTY_ANSWERS;

  if (
    condition.difficulty !== null &&
    condition.difficulty !== undefined &&
    state.difficulty.toLowerCase() !== condition.difficulty.toLowerCase()
  ) {
    return false;
  }

  if (condition.answer != null && answers.booleans?.[condition.answer] !== true) {
    return false;
  }
  if (condition.notAnswer != null && answers.booleans?.[condition.notAnswer] === true) {
    return false;
  }

  // Per-hero answers are read for whichever hero is being evaluated, so a
  // reward can land on one player and not another.
  if (condition.heroAnswer != null) {
    if (context.heroId == null) {
      return false;
    }
    if (answers.perHeroBooleans?.[condition.heroAnswer]?.[context.heroId] !== true) {
      return false;
    }
  }
  if (condition.notHeroAnswer != null) {
    if (context.heroId == null) {
      return false;
    }
    if (answers.perHeroBooleans?.[condition.notHeroAnswer]?.[context.heroId] === true) {
      return false;
    }
  }

  if (condition.cardList != null) {
    const recorded = state.cardLists[condition.cardList] ?? [];
    if (condition.contains != null && !recorded.includes(condition.contains)) {
      return false;
    }
    if (condition.notContains != null && recorded.includes(condition.notContains)) {
      return false;
    }
    // A bound written per player is multiplied by the heroes in the run, so
    // "1 card per player or fewer" is one check for the table rather than a
    // question asked of each hero in turn.
    const perPlayer = condition.perPlayer === true ? Math.max(1, state.heroes.length) : 1;
    if (condition.minSize != null && recorded.length < condition.minSize * perPlayer) {
      return false;
    }
    if (condition.maxSize != null && recorded.length > condition.maxSize * perPlayer) {
      return false;
    }
  }

  if (condition.flag != null && !resolveFlag(condition.flag, state, context.scenarioId)) {
    return false;
  }
  if (condition.notFlag != null && resolveFlag(condition.notFlag, state, context.scenarioId)) {
    return false;
  }

  if (condition.drawIs != null) {
    const colon = condition.drawIs.indexOf(':');
    const drawId = colon < 0 ? condition.drawIs : condition.drawIs.slice(0, colon);
    const code = colon < 0 ? '' : condition.drawIs.slice(colon + 1);
    const drawn = state.draws[context.scenarioId ?? '']?.[drawId] ?? [];
    if (!drawn.includes(code)) {
      return false;
    }
  }

  if (condition.countTrue != null) {
    const count = countTrueOf(state, condition.countTrue);
    if (condition.countAtLeast != null && count < condition.countAtLeast) {
      return false;
    }
    if (condition.countAtMost != null && count > condition.countAtMost) {
      return false;
    }
    // Without a bound, countTrue alone means at least one.
    if (condition.countAtLeast == null && condition.countAtMost == null && count < 1) {
      return false;
    }
  }

  if (condition.counter != null) {
    const heroScoped =
      context.heroId != null &&
      Object.prototype.hasOwnProperty.call(state.heroCounters, condition.counter);
    const value = heroScoped
      ? heroCounterOf(state, condition.counter, context.heroId as string)
      : counterOf(state, condition.counter);
    if (condition.atLeast != null && value < condition.atLeast) {
      return false;
    }
    if (condition.atMost != null && value > condition.atMost) {
      return false;
    }
    if (condition.equals != null && value !== condition.equals) {
      return false;
    }
  }

  if (condition.choice != null && condition.choiceIs != null) {
    if (answers.choices?.[condition.choice] !== condition.choiceIs) {
      return false;
    }
  }

  if (condition.anyHero != null) {
    const holds = state.heroes.some((hero) =>
      evaluate(condition.anyHero, { ...context, heroId: hero.id }),
    );
    if (!holds) {
      return false;
    }
  }

  const all = condition.all ?? [];
  if (all.length > 0 && all.some((nested) => !evaluate(nested, context))) {
    return false;
  }
  const any = condition.any ?? [];
  if (any.length > 0 && !any.some((nested) => evaluate(nested, context))) {
    return false;
  }

  return true;
}
