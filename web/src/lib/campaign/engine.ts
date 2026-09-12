import { evaluate, type EvaluationContext } from './conditions';
import {
  counterOf,
  EMPTY_STATE,
  type AnswerSet,
  type CampaignEvent,
  type CampaignState,
  type CampaignTemplate,
  type CounterDefinition,
  type Effect,
  type Outcome,
  type ScenarioTemplate,
  type SetupStep,
} from './types';

/**
 * Deriving campaign state from the event log.
 *
 * A port of `engine/CampaignEngine.kt`. Pure: same template, same events, same
 * hero stats, same state. That is what makes undo, replay after a template fix,
 * and merging two devices tractable rather than a special case each.
 *
 * State is never stored. Everything on screen is folded from the log on the way
 * past, which is why a correction to a campaign can be published and every run
 * in progress simply reads differently next time it is opened.
 */

/** Facts from the card database, so a counter can cap at printed health. */
export interface HeroCardStats {
  readonly heroId: string;
  readonly printedHealth: number | null;
}

/**
 * The sentinel the campaign-scoped environment draw records under, so it is
 * never confused with a real scenario's draws and never cleared when a scenario
 * finishes.
 */
export const ENVIRONMENT_DRAW_SCENARIO = '__environments__';

/** Flag-set scope that keys each flag by the scenario that set it. */
const PER_SCENARIO = 'perScenario';

/** Prompt id the engine treats as "was this hero eliminated". */
export const ELIMINATED_PROMPT_ID = 'eliminated';

const HERO_HEALTH_REFERENCE = 'heroCard.health';

/** Counter a market purchase spends when the template does not say. */
const MARKET_COUNTER_FALLBACK = 'credits';

const EMPTY_ANSWERS: AnswerSet = {};

/**
 * The operation token, lowercased.
 *
 * The templates write `addCounter`, the tokens are `addcounter`, and the app
 * lowercases before matching. Comparing the two directly is a bug with no
 * symptom: every effect falls through to "unknown", nothing throws, nothing
 * fails to typecheck, and every campaign quietly stops doing anything. It cost
 * a whole engine's worth of silence before a real run showed credits at minus
 * twelve.
 */
const opOf = (effect: Effect): string => effect.op.toLowerCase();

// --- small readers ------------------------------------------------------------

const scenarioOf = (
  template: CampaignTemplate,
  id: string | null | undefined,
): ScenarioTemplate | undefined =>
  (template.scenarios ?? []).find((scenario) => scenario.id === id);

const counterDefOf = (
  template: CampaignTemplate,
  id: string | null | undefined,
): CounterDefinition | undefined =>
  (template.counters ?? []).find((counter) => counter.id === id);

const isHeroScoped = (counter: CounterDefinition): boolean => counter.scope === 'hero';

/**
 * The same campaign with every `setupFragments` include spelled out.
 *
 * **Applied once, when a template is read, so nothing downstream has to know
 * that fragments exist.** The app does exactly this and for the same reason:
 * the engine, the dealer and the briefing all walk setup steps, and a step
 * hidden inside a fragment is a step they silently skip. Age of Apocalypse
 * keeps both of its draws — the MISSION and the OVERSEER — in a fragment, so
 * without this neither was ever dealt and neither was ever cleared on a replay.
 *
 * One level deep, as the templates are: a fragment cannot include another. An
 * include naming a fragment that does not exist is left in place rather than
 * silently dropped, so it shows up as a step with nothing in it instead of
 * disappearing.
 */
export function expandTemplate(template: CampaignTemplate): CampaignTemplate {
  const fragments = template.setupFragments ?? {};
  const expand = (steps: readonly SetupStep[] | undefined): readonly SetupStep[] =>
    (steps ?? []).flatMap((step) =>
      step.include != null ? (fragments[step.include] ?? [step]) : [step],
    );

  return {
    ...template,
    scenarios: (template.scenarios ?? []).map((scenario) => ({
      ...scenario,
      preSetup: expand(scenario.preSetup),
      campaignSetup: expand(scenario.campaignSetup),
      information: expand(scenario.information),
    })),
  };
}

/** Every setup step in a scenario, in the order the briefing shows them. */
export const allSetupSteps = (scenario: ScenarioTemplate): readonly SetupStep[] => [
  ...(scenario.preSetup ?? []),
  ...(scenario.campaignSetup ?? []),
  ...(scenario.information ?? []),
];

export const heroDrawId = (drawId: string, heroId: string): string => `${drawId}|${heroId}`;

const drawnCards = (
  state: CampaignState,
  scenarioId: string | null | undefined,
  drawId: string,
): readonly string[] => state.draws[scenarioId ?? '']?.[drawId] ?? [];

/**
 * Every card a draw came up with, a per-hero draw included.
 *
 * A per-hero draw has no cards of its own: they are filed one hero at a time.
 * Effects that record what was drawn want the lot.
 */
function allDrawnCards(
  state: CampaignState,
  scenarioId: string | null | undefined,
  drawId: string,
): readonly string[] {
  const own = drawnCards(state, scenarioId, drawId);
  if (own.length > 0) {
    return own;
  }
  const prefix = `${drawId}|`;
  const forScenario = state.draws[scenarioId ?? ''] ?? {};
  return Object.entries(forScenario)
    .filter(([key]) => key.startsWith(prefix))
    .flatMap(([, codes]) => codes);
}

// --- clamping -----------------------------------------------------------------

function clamp(value: number, template: CampaignTemplate, counterId: string): number {
  const def = counterDefOf(template, counterId);
  if (def === undefined) {
    return value;
  }
  let result = value;
  if (def.min != null) {
    result = Math.max(result, def.min);
  }
  if (def.max != null) {
    result = Math.min(result, def.max);
  }
  return result;
}

/** Hit points on Expert cap at the hero's printed health, from the card database. */
function clampHero(
  value: number,
  template: CampaignTemplate,
  counterId: string,
  stats: HeroCardStats | undefined,
): number {
  let result = clamp(value, template, counterId);
  const def = counterDefOf(template, counterId);
  if (def?.maxFrom === HERO_HEALTH_REFERENCE && stats?.printedHealth != null) {
    result = Math.min(result, stats.printedHealth);
  }
  return result;
}

function resolveValue(effect: Effect, answers: AnswerSet): number | null {
  const fromAnswer = effect.from == null ? undefined : answers.numbers?.[effect.from];
  const raw = fromAnswer ?? effect.value;
  if (raw == null) {
    return null;
  }
  // Division first, so "for every 2, gain 1, up to 3" reads in that order.
  const divided =
    effect.divideBy != null && effect.divideBy > 0 ? Math.floor(raw / effect.divideBy) : raw;
  const capped = effect.max != null ? Math.min(divided, effect.max) : divided;
  return effect.min != null ? Math.max(capped, effect.min) : capped;
}

function addHeroCards(
  state: CampaignState,
  listId: string,
  heroId: string,
  codes: readonly string[],
): CampaignState {
  const list = state.heroCardLists[listId] ?? {};
  return {
    ...state,
    heroCardLists: {
      ...state.heroCardLists,
      [listId]: { ...list, [heroId]: [...(list[heroId] ?? []), ...codes] },
    },
  };
}

// --- effects ------------------------------------------------------------------

/**
 * Applies a hero-scoped counter change.
 *
 * A hero eliminated in this scenario is skipped, which is the rule the brief
 * calls out: they take no part in the victory rewards but rejoin next time.
 */
function applyPerHeroCounter(
  template: CampaignTemplate,
  state: CampaignState,
  effect: Effect,
  literalDelta: number | null,
  scenarioId: string | null | undefined,
  answers: AnswerSet,
  heroStats: Readonly<Record<string, HeroCardStats>>,
  actingHeroId: string | null | undefined,
): CampaignState {
  const counterId = effect.counter;
  if (counterId == null) {
    return state;
  }
  const eliminated = state.eliminatedInScenario[scenarioId ?? ''] ?? [];
  const targets =
    actingHeroId != null
      ? [actingHeroId]
      : state.heroes.map((hero) => hero.id).filter((id) => !eliminated.includes(id));

  const perHeroNumbers = effect.from == null ? undefined : answers.perHeroNumbers?.[effect.from];
  // A yes/no per hero doubles as a marker: "which hero holds this?" becomes 1
  // for that hero and 0 for the rest.
  const perHeroBooleans = effect.from == null ? undefined : answers.perHeroBooleans?.[effect.from];
  const perHeroAnswers: Readonly<Record<string, number>> | undefined =
    perHeroNumbers ??
    (perHeroBooleans === undefined
      ? undefined
      : Object.fromEntries(
          Object.entries(perHeroBooleans).map(([id, yes]) => [id, yes ? 1 : 0]),
        ));

  const current: Record<string, number> = { ...(state.heroCounters[counterId] ?? {}) };
  const op = opOf(effect);
  const setting = op === 'setherocounter' || op === 'setcounter';

  for (const heroId of targets) {
    const context: EvaluationContext = { state, scenarioId, answers, heroId };
    if (!evaluate(effect.when, context)) {
      continue;
    }
    const value = perHeroAnswers?.[heroId] ?? literalDelta;
    if (value == null) {
      continue;
    }
    const capped = effect.max != null ? Math.min(value, effect.max) : value;
    const floored = effect.min != null ? Math.max(capped, effect.min) : capped;
    const existing = current[heroId] ?? 0;
    current[heroId] = clampHero(
      setting ? floored : existing + floored,
      template,
      counterId,
      heroStats[heroId],
    );
  }
  return { ...state, heroCounters: { ...state.heroCounters, [counterId]: current } };
}

function applyEffect(
  template: CampaignTemplate,
  state: CampaignState,
  effect: Effect,
  scenarioId: string | null | undefined,
  answers: AnswerSet,
  heroStats: Readonly<Record<string, HeroCardStats>>,
  actingHeroId: string | null | undefined,
): CampaignState {
  const baseContext: EvaluationContext = {
    state,
    scenarioId,
    answers,
    heroId: actingHeroId,
  };

  switch (opOf(effect)) {
    case 'addcounter':
    case 'subtractcounter':
    case 'setcounter': {
      const def = counterDefOf(template, effect.counter);
      // The validator rejects undeclared counters, so this only happens when an
      // old event log is replayed against a template that has since dropped
      // one. Resurrecting it would put a counter on screen the campaign no
      // longer has.
      if (def === undefined) {
        return state;
      }
      const delta = resolveValue(effect, answers);
      if (delta === null) {
        return state;
      }

      if (isHeroScoped(def)) {
        // The condition is judged per hero inside, not here: a per-hero
        // condition has no answer without a hero, so testing it once up front
        // would fail for everyone.
        return applyPerHeroCounter(
          template, state, effect, delta, scenarioId, answers, heroStats, actingHeroId,
        );
      }
      if (!evaluate(effect.when, baseContext)) {
        return state;
      }
      const id = effect.counter;
      if (id == null) {
        return state;
      }
      const existing = counterOf(state, id);
      const op = opOf(effect);
      const raw =
        op === 'addcounter'
          ? existing + delta
          : op === 'subtractcounter'
            ? existing - delta
            : delta;
      return { ...state, counters: { ...state.counters, [id]: clamp(raw, template, id) } };
    }

    case 'addherocounter':
    case 'setherocounter': {
      if (counterDefOf(template, effect.counter) === undefined) {
        return state;
      }
      return applyPerHeroCounter(
        template, state, effect, resolveValue(effect, answers), scenarioId, answers, heroStats, actingHeroId,
      );
    }

    case 'setflag': {
      if (!evaluate(effect.when, baseContext)) {
        return state;
      }
      const flagId = effect.flag;
      if (flagId == null) {
        return state;
      }
      // An answer that is missing means "no", never "yes". A switch the player
      // never touches puts nothing in the answer map, so falling through to a
      // default of true silently marked the box for every scenario it was left
      // alone in, which is how one check produced three cards of setup.
      const value =
        effect.boolValue != null
          ? effect.boolValue
          : effect.from != null
            ? answers.booleans?.[effect.from] === true
            : true;

      // Split the same way conditions read it: `set.key` names its own key, a
      // bare id is keyed by the scope its set declares. A campaign-scoped flag
      // keyed by scenario reads back only in the scenario that set it, which is
      // not what campaign means.
      const dot = flagId.indexOf('.');
      const setId = dot < 0 ? flagId : flagId.slice(0, dot);
      const declared = (template.flagSets ?? []).find((set) => set.id === setId);
      const key =
        dot >= 0
          ? flagId.slice(dot + 1)
          : declared?.scope === PER_SCENARIO
            ? (scenarioId ?? '')
            : '';
      const existing = state.flags[setId] ?? {};
      return { ...state, flags: { ...state.flags, [setId]: { ...existing, [key]: value } } };
    }

    case 'addcard': {
      if (!evaluate(effect.when, baseContext)) {
        return state;
      }
      const listId = effect.cardList;
      const code = effect.cardCode;
      if (listId == null || code == null) {
        return state;
      }
      if (effect.perHero === true || actingHeroId != null) {
        if (actingHeroId == null) {
          return state;
        }
        return addHeroCards(state, listId, actingHeroId, [code]);
      }
      return {
        ...state,
        cardLists: { ...state.cardLists, [listId]: [...(state.cardLists[listId] ?? []), code] },
      };
    }

    case 'addcardsfromanswer': {
      if (!evaluate(effect.when, baseContext)) {
        return state;
      }
      const listId = effect.cardList;
      if (listId == null) {
        return state;
      }
      // A per-hero answer folds into the same list, distinctly: what later
      // scenarios need from "each player chose one" is which cards are in play,
      // not who holds which. Who holds which stays in the answer, for the log.
      const fromList = effect.from == null ? [] : (answers.cardLists?.[effect.from] ?? []);
      const perHero =
        effect.from == null ? {} : (answers.perHeroCards?.[effect.from] ?? {});
      const codes = [
        ...new Set(fromList.length > 0 ? fromList : Object.values(perHero).flat()),
      ];
      return {
        ...state,
        cardLists: { ...state.cardLists, [listId]: [...(state.cardLists[listId] ?? []), ...codes] },
      };
    }

    case 'setcardsfromanswer': {
      if (!evaluate(effect.when, baseContext)) {
        return state;
      }
      const listId = effect.cardList;
      if (listId == null) {
        return state;
      }
      const answered = effect.from == null ? [] : (answers.cardLists?.[effect.from] ?? []);
      return { ...state, cardLists: { ...state.cardLists, [listId]: [...answered] } };
    }

    case 'adddrawncard': {
      if (!evaluate(effect.when, baseContext)) {
        return state;
      }
      const listId = effect.cardList;
      const drawId = effect.from;
      if (listId == null || drawId == null) {
        return state;
      }
      // Read against the scenario being resolved, so a strike records what that
      // scenario drew rather than whatever is current now. Per hero, this
      // records what that player drew against their own list: Mutant Genesis
      // removes a role upgrade from the campaign for the player who had it, not
      // for the table, so a shared list would take one player's card off
      // everybody.
      if (effect.perHero === true) {
        return state.heroes.reduce((acc, hero) => {
          const forHero = drawnCards(acc, scenarioId, heroDrawId(drawId, hero.id));
          return forHero.length === 0 ? acc : addHeroCards(acc, listId, hero.id, forHero);
        }, state);
      }
      const drawn = allDrawnCards(state, scenarioId, drawId);
      const already = state.cardLists[listId] ?? [];
      const fresh = drawn.filter((code) => !already.includes(code));
      if (fresh.length === 0) {
        return state;
      }
      return { ...state, cardLists: { ...state.cardLists, [listId]: [...already, ...fresh] } };
    }

    case 'eliminatehero': {
      if (actingHeroId == null) {
        return state;
      }
      const key = scenarioId ?? '';
      const existing = state.eliminatedInScenario[key] ?? [];
      return {
        ...state,
        eliminatedInScenario: {
          ...state.eliminatedInScenario,
          [key]: existing.includes(actingHeroId) ? existing : [...existing, actingHeroId],
        },
      };
    }

    default:
      // An operation this build does not know. Ignored rather than guessed at:
      // a template written for a newer app must not have its rules invented.
      return state;
  }
}

export function applyEffects(
  template: CampaignTemplate,
  state: CampaignState,
  effects: readonly Effect[],
  scenarioId: string | null | undefined,
  answers: AnswerSet,
  heroStats: Readonly<Record<string, HeroCardStats>>,
  actingHeroId: string | null = null,
): CampaignState {
  return effects.reduce(
    (current, effect) =>
      applyEffect(template, current, effect, scenarioId, answers, heroStats, actingHeroId),
    state,
  );
}

// --- the pieces of the fold ---------------------------------------------------

function applyStart(
  template: CampaignTemplate,
  event: Extract<CampaignEvent, { type: 'setup' }>,
): CampaignState {
  const chooseFirst = template.chooseFirstScenario === true;

  const counters: Record<string, number> = {};
  const heroCounters: Record<string, Record<string, number>> = {};
  for (const counter of template.counters ?? []) {
    const initial = counter.initial ?? 0;
    if (isHeroScoped(counter)) {
      heroCounters[counter.id] = Object.fromEntries(
        event.heroes.map((hero) => [hero.id, initial]),
      );
    } else {
      counters[counter.id] = initial;
    }
  }

  return {
    ...EMPTY_STATE,
    templateId: template.id,
    difficulty: event.difficulty,
    heroes: event.heroes,
    started: true,
    awaitingChoice: chooseFirst,
    currentScenarioId: chooseFirst ? null : event.startScenarioId,
    // Unanswered questions fall back to the campaign's own first option, so a
    // run started before a question existed still folds.
    choices: Object.fromEntries(
      (template.setupChoices ?? []).map((choice) => [
        choice.id,
        event.choices?.[choice.id] ?? choice.options?.[0]?.id ?? '',
      ]),
    ),
    counters,
    heroCounters,
  };
}

const eliminatedHeroes = (answers: AnswerSet): string[] =>
  Object.entries(answers.perHeroBooleans?.[ELIMINATED_PROMPT_ID] ?? {})
    .filter(([, yes]) => yes)
    .map(([heroId]) => heroId);

interface Advance {
  readonly scenarioId: string | null;
  readonly finished: boolean;
  readonly awaitingChoice: boolean;
  /** Over as a defeat, not merely over. */
  readonly lost?: boolean;
}

/**
 * `next` is a guarded list evaluated in order, so a branch is data. The engine
 * never assumes the next scenario in the array.
 */
function resolveNext(
  outcome: Outcome | null | undefined,
  state: CampaignState,
  scenarioId: string,
  answers: AnswerSet,
): Advance {
  const context: EvaluationContext = { state, scenarioId, answers };
  const step = (outcome?.next ?? []).find((candidate) => evaluate(candidate.when, context));
  if (step === undefined) {
    return { scenarioId, finished: false, awaitingChoice: false };
  }
  if (step.lose === true) {
    return { scenarioId: null, finished: true, awaitingChoice: false, lost: true };
  }
  if (step.end === true) {
    return { scenarioId: null, finished: true, awaitingChoice: false };
  }
  // Nothing is current while the players decide, so the run has no scenario to
  // render until they have.
  if (step.choose === true) {
    return { scenarioId: null, finished: false, awaitingChoice: true };
  }
  if (step.goto != null) {
    return { scenarioId: step.goto, finished: false, awaitingChoice: false };
  }
  return { scenarioId, finished: false, awaitingChoice: false };
}

/**
 * This scenario's draws as a replay should find them.
 *
 * Setup draws are made again, which is what a fresh setup means, while anything
 * the campaign assigned outside the scenario's setup survives. Fear No Evil
 * notes which subordinate is behind a job before it is ever played, and the
 * book keeps that name once noted; dropping the lot dealt a different villain
 * every time a job was retried.
 */
function replayedDraws(
  draws: CampaignState['draws'],
  template: CampaignTemplate,
  scenarioId: string,
): CampaignState['draws'] {
  const scenario = scenarioOf(template, scenarioId);
  const setupDrawIds = new Set(
    allSetupSteps(scenario ?? { id: scenarioId })
      .map((step) => step.draw?.id)
      .filter((id): id is string => id != null),
  );
  const kept = Object.fromEntries(
    Object.entries(draws[scenarioId] ?? {}).filter(([drawId]) => {
      // A per-hero draw files under `drawId|heroId`, so the setup id has to be
      // matched on the prefix as well as whole.
      const base = drawId.includes('|') ? drawId.slice(0, drawId.indexOf('|')) : drawId;
      return !setupDrawIds.has(base);
    }),
  );
  const next = { ...draws };
  if (Object.keys(kept).length === 0) {
    delete next[scenarioId];
  } else {
    next[scenarioId] = kept;
  }
  return next;
}

function applyScenario(
  template: CampaignTemplate,
  state: CampaignState,
  event: Extract<CampaignEvent, { type: 'scenario_result' }>,
  heroStats: Readonly<Record<string, HeroCardStats>>,
): CampaignState {
  const scenario = scenarioOf(template, event.scenarioId);
  if (scenario === undefined) {
    return state;
  }
  const answers = event.answers ?? EMPTY_ANSWERS;
  const outcome = event.victory ? scenario.onVictory : scenario.onDefeat;
  const elapsed = event.elapsedMillis ?? 0;

  let next: CampaignState = {
    ...state,
    eliminatedInScenario: {
      ...state.eliminatedInScenario,
      [event.scenarioId]: eliminatedHeroes(answers),
    },
  };

  if (outcome != null) {
    next = applyEffects(
      template, next, outcome.effects ?? [], event.scenarioId, answers, heroStats,
    );
  }

  const advanced = resolveNext(outcome, next, event.scenarioId, answers);

  return {
    ...next,
    completedScenarios: [
      ...next.completedScenarios,
      {
        eventId: event.id,
        scenarioId: event.scenarioId,
        victory: event.victory,
        answers,
        elapsedMillis: elapsed,
        timestamp: event.timestamp,
      },
    ],
    totalPlayTimeMillis: next.totalPlayTimeMillis + elapsed,
    draws: replayedDraws(next.draws, template, event.scenarioId),
    currentScenarioId: advanced.scenarioId,
    finished: advanced.finished,
    campaignLost: next.campaignLost || advanced.lost === true,
    awaitingChoice: advanced.awaitingChoice,
    // A new rotation: the villains get to pick their next two places.
    environmentPicked: false,
  };
}

/**
 * Records what a draw came up with, and raises any counter that card feeds.
 *
 * The counters are declared on the draw rather than written by an effect,
 * because a draw happens during setup where no effects run.
 */
function applyDraw(
  template: CampaignTemplate,
  state: CampaignState,
  event: Extract<CampaignEvent, { type: 'setup_draw' }>,
): CampaignState {
  // The environment draw is campaign-scoped and keys its rounds by their own
  // ids, so its counts are found on the template rather than in any scenario's
  // setup.
  const fromScenarios = (template.scenarios ?? [])
    .flatMap((scenario) => scenario.campaignSetup ?? [])
    .map((step) => step.draw)
    .find((draw) => draw != null && draw.id === event.drawId);
  const definition =
    fromScenarios ??
    (event.scenarioId === ENVIRONMENT_DRAW_SCENARIO ? template.environmentDraw : null);
  const counts = definition?.counts ?? {};

  const counters = { ...state.counters };
  for (const code of event.cardCodes) {
    const counterId = counts[code];
    if (counterId === undefined) {
      continue;
    }
    counters[counterId] = clamp((counters[counterId] ?? 0) + 1, template, counterId);
  }

  return {
    ...state,
    counters,
    draws: {
      ...state.draws,
      [event.scenarioId]: {
        ...(state.draws[event.scenarioId] ?? {}),
        [event.drawId]: event.cardCodes,
      },
    },
  };
}

/**
 * Deals the rotation's environments and pushes the places they name.
 *
 * Two dealt, one tick each. One dealt, the last place still in the pile, takes
 * two, which is the rule for a lone environment and the reason the end of a
 * campaign closes in fast.
 */
function applyEnvironmentOffer(
  template: CampaignTemplate,
  state: CampaignState,
  event: Extract<CampaignEvent, { type: 'environments_offered' }>,
): CampaignState {
  const counts = template.environmentDraw?.counts ?? {};
  const perEnvironment = event.offered.length === 1 ? 2 : 1;

  const counters = { ...state.counters };
  for (const environment of event.offered) {
    const counterId = counts[environment];
    if (counterId === undefined) {
      continue;
    }
    counters[counterId] = clamp(
      (counters[counterId] ?? 0) + perEnvironment,
      template,
      counterId,
    );
  }

  const pushed: CampaignState = { ...state, counters, environmentOffer: event.offered };
  if (template.losesWhenScenarioFails !== true) {
    return pushed;
  }

  // Only a job still in play can fall. One the players already saw through is
  // settled, whatever number is left beside its name, and ending a campaign
  // over a finished job is a defeat nobody could have prevented.
  const settled = new Set(pushed.completedScenarios.map((result) => result.scenarioId));
  const fallen = (template.scenarios ?? []).some(
    (scenario) =>
      !settled.has(scenario.id) &&
      scenario.failedWhen != null &&
      evaluate(scenario.failedWhen, { state: pushed, scenarioId: scenario.id }),
  );
  return fallen ? { ...pushed, campaignLost: true, finished: true } : pushed;
}

function applyPurchase(
  state: CampaignState,
  event: Extract<CampaignEvent, { type: 'purchase' }>,
): CampaignState {
  const credits = { ...(state.heroCounters[MARKET_COUNTER_FALLBACK] ?? {}) };
  credits[event.heroId] = (credits[event.heroId] ?? 0) - event.cost;
  const withCard = addHeroCards(state, event.cardListId, event.heroId, [event.cardCode]);
  return {
    ...withCard,
    heroCounters: { ...withCard.heroCounters, [MARKET_COUNTER_FALLBACK]: credits },
    purchases: [
      ...withCard.purchases,
      {
        eventId: event.id,
        heroId: event.heroId,
        cardCode: event.cardCode,
        cost: event.cost,
        cardListId: event.cardListId,
      },
    ],
  };
}

function applySetupAction(
  template: CampaignTemplate,
  state: CampaignState,
  event: Extract<CampaignEvent, { type: 'setup_action' }>,
  heroStats: Readonly<Record<string, HeroCardStats>>,
): CampaignState {
  const scenario = scenarioOf(template, event.scenarioId);
  if (scenario === undefined) {
    return state;
  }
  const action = (scenario.campaignSetup ?? [])
    .map((step) => step.action)
    .find((candidate) => candidate != null && candidate.id === event.actionId);
  if (action == null) {
    return state;
  }

  let next = state;
  if (action.cost != null) {
    const { counterId, amount } = action.cost;
    if (event.heroId != null) {
      const counters = { ...(next.heroCounters[counterId] ?? {}) };
      counters[event.heroId] = (counters[event.heroId] ?? 0) - amount;
      next = { ...next, heroCounters: { ...next.heroCounters, [counterId]: counters } };
    } else {
      next = {
        ...next,
        counters: { ...next.counters, [counterId]: counterOf(next, counterId) - amount },
      };
    }
  }

  next = applyEffects(
    template, next, action.effects ?? [], event.scenarioId, EMPTY_ANSWERS, heroStats, event.heroId ?? null,
  );

  const key = `${event.scenarioId}:${event.heroId ?? ''}`;
  const taken = next.setupActionsTaken[key] ?? [];
  return {
    ...next,
    setupActionsTaken: { ...next.setupActionsTaken, [key]: [...taken, event.actionId] },
  };
}

function applyManual(
  state: CampaignState,
  event: Extract<CampaignEvent, { type: 'manual' }>,
): CampaignState {
  let next = state;
  if (event.counterId != null && event.value != null) {
    if (event.heroId != null) {
      const counters = { ...(next.heroCounters[event.counterId] ?? {}) };
      counters[event.heroId] = event.value;
      next = { ...next, heroCounters: { ...next.heroCounters, [event.counterId]: counters } };
    } else {
      next = { ...next, counters: { ...next.counters, [event.counterId]: event.value } };
    }
  }
  if (event.flagId != null) {
    const dot = event.flagId.indexOf('.');
    const setId = dot < 0 ? event.flagId : event.flagId.slice(0, dot);
    const key = dot < 0 ? '' : event.flagId.slice(dot + 1);
    const existing = next.flags[setId] ?? {};
    next = {
      ...next,
      flags: { ...next.flags, [setId]: { ...existing, [key]: event.boolValue ?? true } },
    };
  }
  return next;
}

// --- the fold -----------------------------------------------------------------

export function fold(
  template: CampaignTemplate,
  events: readonly CampaignEvent[],
  heroStats: Readonly<Record<string, HeroCardStats>> = {},
): CampaignState {
  // Revocations are applied first so a superseded result never takes effect,
  // however late the revocation was appended.
  const revoked = new Set(
    events.filter((event) => event.type === 'revoke').map((event) => event.revokedEventId),
  );
  const refunded = new Set(
    events
      .filter((event) => event.type === 'purchase_refund')
      .map((event) => event.purchaseEventId),
  );

  let state: CampaignState = { ...EMPTY_STATE, templateId: template.id };

  for (const event of [...events].sort((a, b) => a.timestamp - b.timestamp)) {
    if (revoked.has(event.id)) {
      continue;
    }
    switch (event.type) {
      case 'setup':
        state = applyStart(template, event);
        break;
      case 'scenario_result':
        state = applyScenario(template, state, event, heroStats);
        break;
      case 'purchase':
        state = refunded.has(event.id) ? state : applyPurchase(state, event);
        break;
      case 'setup_action':
        state = applySetupAction(template, state, event, heroStats);
        break;
      case 'continued': {
        // Moving on from a result the players could have reconsidered. Fear No
        // Evil's lost jobs settle here rather than when the defeat is filed,
        // because until this the table may go back.
        const scenario = scenarioOf(template, event.scenarioId);
        const outcome = event.victory ? scenario?.onVictory : scenario?.onDefeat;
        state = applyEffects(
          template, state, outcome?.onContinue ?? [], event.scenarioId, EMPTY_ANSWERS, heroStats,
        );
        break;
      }
      case 'setup_draw':
        state = applyDraw(template, state, event);
        break;
      case 'setup_choice':
        // The kept card replaces the offer, so everything downstream reads one
        // card without knowing a choice happened. The cards not kept were never
        // struck, so they are still in the pool.
        state = {
          ...state,
          draws: {
            ...state.draws,
            [event.scenarioId]: {
              ...(state.draws[event.scenarioId] ?? {}),
              [event.drawId]: [event.cardCode],
            },
          },
        };
        break;
      case 'environments_offered':
        state = applyEnvironmentOffer(template, state, event);
        break;
      case 'environment_chosen':
        // The rotation has been read. The pressure was applied when the two
        // were dealt, so nothing about the board changes here; this only clears
        // the offer so the next reload does not deal another pair.
        state = { ...state, environmentOffer: [], environmentPicked: true };
        break;
      case 'campaign_conceded':
        state = { ...state, campaignLost: true, finished: true, awaitingChoice: false };
        break;
      case 'scenario_chosen':
        state = { ...state, currentScenarioId: event.scenarioId, awaitingChoice: false };
        break;
      case 'manual':
        state = applyManual(state, event);
        break;
      case 'timer':
        state = {
          ...state,
          totalPlayTimeMillis: state.totalPlayTimeMillis + event.elapsedMillis,
        };
        break;
      case 'revoke':
      case 'purchase_refund':
        break;
    }
  }
  return state;
}
