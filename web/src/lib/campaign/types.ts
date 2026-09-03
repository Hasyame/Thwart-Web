/**
 * The campaign vocabulary, field for field as the app declares it.
 *
 * Three things live here: the template, which is data written for the app and
 * fetched from its repository; the event log, which is what a run actually is;
 * and the state, which is never stored and always folded from the log.
 *
 * Ported from `domain/campaign/template/CampaignTemplate.kt`,
 * `Conditions.kt` and `engine/CampaignEvent.kt`. The names match on purpose:
 * the same JSON has to mean the same thing in both clients, and a second
 * dialect of it would be two engines disagreeing about the same campaign.
 */

export interface LocalizedText {
  readonly fr?: string | null;
  readonly en?: string | null;
}

// --- conditions and effects ---------------------------------------------------

/**
 * A condition on the state, written as data.
 *
 * Every field is optional and they are combined with AND: a condition naming
 * both a counter and a flag holds only when both do. `any` and `all` nest,
 * which is what lets a rule say "either of these two things".
 */
export interface Condition {
  readonly difficulty?: string | null;

  /** An answer id that must be true, or must not be. */
  readonly answer?: string | null;
  readonly notAnswer?: string | null;
  readonly heroAnswer?: string | null;
  readonly notHeroAnswer?: string | null;

  readonly cardList?: string | null;
  readonly contains?: string | null;
  readonly notContains?: string | null;
  readonly minSize?: number | null;
  readonly maxSize?: number | null;
  /** Sizes are compared per player rather than absolutely. */
  readonly perPlayer?: boolean;

  readonly flag?: string | null;
  readonly notFlag?: string | null;
  readonly countTrue?: string | null;
  readonly countAtLeast?: number | null;
  readonly countAtMost?: number | null;

  readonly counter?: string | null;
  readonly atLeast?: number | null;
  readonly atMost?: number | null;
  readonly equals?: number | null;

  readonly choice?: string | null;
  readonly choiceIs?: string | null;

  /**
   * True when a setup draw came up with a particular card, written
   * `drawId:cardCode`.
   *
   * A drawn card can carry rules of its own, and those cannot be written into
   * the scenario because which one is in play is not known until it is drawn.
   */
  readonly drawIs?: string | null;

  /**
   * True when at least one hero satisfies the nested condition.
   *
   * Setup steps are shown once for the table, not per player, so a rule like
   * "deal this to whoever holds the Power Stone" has to ask whether some hero
   * qualifies. Without it a hero-scoped counter is read against the campaign
   * and always comes back zero.
   */
  readonly anyHero?: Condition | null;

  readonly any?: readonly Condition[];
  readonly all?: readonly Condition[];
}

export const EFFECT_OPS = [
  'addcounter',
  /**
   * Takes a value away from a counter, which is how "3 minus what was
   * recorded" is expressed: set it to 3, then subtract. Two small steps rather
   * than a formula in the schema.
   */
  'subtractcounter',
  'setcounter',
  'setherocounter',
  'addherocounter',
  'setflag',
  'addcard',
  'addcardsfromanswer',
  /**
   * Replaces a card list with what was answered, rather than adding to it.
   *
   * Mutant Genesis records which Future Past cards are still in circulation;
   * the ones that reached the victory display are gone for good. That is a
   * list that shrinks, and adding to it would shuffle a destroyed Sentinel
   * back in next game.
   */
  'setcardsfromanswer',
  'adddrawncard',
  'eliminatehero',
] as const;

export type EffectOp = (typeof EFFECT_OPS)[number];

/**
 * One change to the state.
 *
 * Arithmetic is deliberately kept out of the schema: a rule is several small
 * steps rather than one formula. `max` caps a single operation, `value` is a
 * literal, and `from` takes the number the player answered.
 */
export interface Effect {
  readonly op: string;
  readonly when?: Condition | null;

  readonly counter?: string | null;
  readonly flag?: string | null;
  readonly cardList?: string | null;

  readonly value?: number | null;
  readonly boolValue?: boolean | null;
  /** Answer id supplying the value. */
  readonly from?: string | null;
  /**
   * Floor-divides the value before it is applied, for rules of the shape "for
   * every 2 of these, gain 1". Applied before max and min.
   */
  readonly divideBy?: number | null;
  readonly max?: number | null;
  readonly min?: number | null;

  readonly cardCode?: string | null;
  readonly perHero?: boolean;
}

// --- the template -------------------------------------------------------------

export type CounterScope = 'campaign' | 'hero';

export interface CounterDefinition {
  readonly id: string;
  readonly label?: LocalizedText;
  readonly scope?: string;
  readonly initial?: number;
  readonly min?: number | null;
  readonly max?: number | null;
  /** `heroCard.health` caps hit points at the hero's printed health. */
  readonly maxFrom?: string | null;
  readonly activeWhen?: Condition | null;
}

export interface FlagSetDefinition {
  readonly id: string;
  readonly label?: LocalizedText;
  readonly scope?: string;
}

export interface CardListDefinition {
  readonly id: string;
  readonly label?: LocalizedText;
  readonly scope?: string;
}

export interface MarketEntry {
  readonly cardCode: string;
  readonly cost: number;
  readonly cardListId?: string;
}

export interface MarketDefinition {
  readonly counterId?: string;
  readonly entries?: readonly MarketEntry[];
}

export interface CampaignChoiceOption {
  readonly id: string;
  readonly label: LocalizedText;
  readonly detail?: LocalizedText | null;
}

export interface CampaignChoice {
  readonly id: string;
  readonly label: LocalizedText;
  readonly options?: readonly CampaignChoiceOption[];
}

export interface DrawDefinition {
  readonly id: string;
  readonly from?: readonly string[];
  /** A card list whose contents are taken out of the pool first. */
  readonly excluding?: string | null;
  readonly counts?: Readonly<Record<string, string>>;
  readonly perHero?: boolean;
  /** Deal this many and let the players keep some. */
  readonly offer?: number;
  readonly count?: number;
  readonly perHeroPools?: Readonly<Record<string, readonly string[]>>;
  readonly perHeroPoolList?: string | null;
  readonly excludingPerHero?: string | null;
}

export interface ActionCost {
  readonly counterId: string;
  readonly amount: number;
}

export interface SetupAction {
  readonly id: string;
  readonly label: LocalizedText;
  readonly enabledWhen?: Condition | null;
  readonly cost?: ActionCost | null;
  readonly effects?: readonly Effect[];
  readonly perHero?: boolean;
  readonly repeatable?: boolean;
}

export interface SetupStep {
  readonly text?: LocalizedText;
  readonly when?: Condition | null;
  readonly action?: SetupAction | null;
  readonly cards?: readonly string[];
  readonly showCounter?: string | null;
  readonly showCardList?: string | null;
  readonly showHeroesWith?: string | null;
  /** Pulls in a shared fragment by id, so a rule is written once. */
  readonly include?: string | null;
  readonly draw?: DrawDefinition | null;
  /**
   * An amount the app works out and writes into this step's `{value}`.
   *
   * A step whose amount comes to nothing is not shown at all, so the rule that
   * decides whether it applies and the sum that says how much are the same
   * declaration rather than two that can disagree.
   */
  readonly compute?: ComputedAmount | null;
}

export interface BaseSetup {
  readonly villainDeck?: Readonly<Record<string, readonly string[]>>;
  readonly villainDeckFromDraw?: string | null;
  readonly villainDecks?: Readonly<Record<string, Readonly<Record<string, readonly string[]>>>>;
  readonly mainScheme?: readonly string[];
  readonly encounterSets?: readonly string[];
  readonly modularSets?: readonly string[];
}

/**
 * The question kinds a template may ask.
 *
 * **Written here as the app matches them, not as a template spells them.** The
 * templates say `perHeroNumber` and `cardSelect`; the app lowercases and drops
 * underscores before comparing, so `per_hero_number`, `perHeroNumber` and
 * `PERHERONUMBER` are all the same question. Comparing a template's spelling
 * directly matched nothing at all, and every question in every campaign fell
 * through to "this build cannot ask that" — silently, because an unmatched
 * question is not an error anywhere.
 */
export const PROMPT_TYPES = [
  'number',
  'boolean',
  'perheronumber',
  'perheroboolean',
  /**
   * Each hero picks from a known set of cards, one answer per hero.
   *
   * Distinct from cardselect, which records a single set for the table. When
   * a campaign says "each player chooses one", two players may well pick the
   * same card, and a shared set cannot hold it twice, nor say who took it.
   */
  'perherocardselect',
  'cardlist',
  'cardselect',
  /**
   * Picked out of the run's own decks, filled at the moment it is asked
   * because the set is whatever the players built.
   */
  'deckcardselect',
  'choice',
] as const;

export type PromptType = (typeof PROMPT_TYPES)[number] | 'unknown';

export interface PromptOption {
  readonly id: string;
  readonly label?: LocalizedText | null;
}

export interface Prompt {
  readonly id: string;
  readonly type: string;
  readonly label?: LocalizedText | null;
  readonly when?: Condition | null;
  readonly min?: number | null;
  readonly max?: number | null;
  readonly options?: readonly PromptOption[];
  readonly cards?: readonly string[];
}

export interface NextStep {
  readonly goto?: string | null;
  readonly when?: Condition | null;
  readonly end?: boolean;
  /** The players pick which scenario comes next. */
  readonly choose?: boolean;
}

export interface Outcome {
  readonly message?: LocalizedText | null;
  readonly prompts?: readonly Prompt[];
  readonly effects?: readonly Effect[];
  /**
   * Applied when the players move on rather than reconsidering. A defeat that
   * can be retried settles nothing until then.
   */
  readonly onContinue?: readonly Effect[];
  readonly next?: readonly NextStep[];
}

export interface ScenarioTemplate {
  readonly id: string;
  readonly name?: LocalizedText | null;
  readonly flavour?: LocalizedText | null;
  readonly victoryLabel?: LocalizedText | null;
  readonly defeatLabel?: LocalizedText | null;
  readonly baseSetup?: BaseSetup | null;
  readonly preSetup?: readonly SetupStep[];
  readonly campaignSetup?: readonly SetupStep[];
  readonly information?: readonly SetupStep[];
  readonly onVictory?: Outcome | null;
  readonly onDefeat?: Outcome | null;
  readonly failedWhen?: Condition | null;
  readonly pressureCounterId?: string | null;
  readonly handlerId?: string | null;
}

export interface CampaignTemplate {
  readonly id: string;
  readonly schemaVersion: number;
  readonly name: LocalizedText;
  readonly packCode?: string | null;
  readonly difficulties?: readonly string[];
  readonly counters?: readonly CounterDefinition[];
  readonly flagSets?: readonly FlagSetDefinition[];
  readonly cardLists?: readonly CardListDefinition[];
  readonly market?: MarketDefinition | null;
  readonly setupFragments?: Readonly<Record<string, readonly SetupStep[]>>;
  readonly scenarios?: readonly ScenarioTemplate[];
  readonly startScenarioId?: string | null;
  readonly finaleScenarioId?: string | null;
  readonly chooseFirstScenario?: boolean;
  readonly setupChoices?: readonly CampaignChoice[];
  readonly environmentDraw?: DrawDefinition | null;
  readonly localCardNames?: Readonly<Record<string, LocalizedText>>;
  readonly villainPool?: readonly string[];
  readonly losesWhenScenarioFails?: boolean;
  readonly notice?: LocalizedText | null;
  /** Marked incomplete by whoever wrote it. Shown, but with a warning. */
  readonly wip?: boolean;
  /** Numbers the campaign counts with when the card database cannot. */
  readonly tracker?: CampaignTracker | null;
}

// --- numbers a campaign carries itself ----------------------------------------

/**
 * A number worked out from the campaign rather than printed on a card.
 *
 * Campaign books state these as a sum for the table to do — one threat per
 * pressure box ticked, or two on an expert campaign — for a number the app
 * already holds every part of.
 */
export interface ComputedAmount {
  /** The campaign counter the amount is read from. */
  readonly counter: string;
  /** What one unit of that counter is worth, on standard and on expert. */
  readonly perUnit?: number;
  readonly perUnitExpert?: number;
  /** Below this the amount is nothing. */
  readonly threshold?: number;
  /**
   * True when reaching the threshold is worth one amount rather than one per
   * unit. La Poursuite puts a single token on its tanker once two boxes are
   * ticked; the museum puts one on its scheme for every box.
   */
  readonly once?: boolean;
}

/**
 * One printed side, as the tracker counts it.
 *
 * Mirrors the card rather than the rules: `value` is the number printed on it
 * and `perPlayer` says whether the small figure icon is beside that number, so
 * a template records what somebody can read off the card and check.
 */
export interface TrackedSide {
  readonly name: string;
  readonly stage?: string;
  /** Villain health, or a main scheme's threat limit. Null when starred. */
  readonly value?: number | null;
  readonly perPlayer?: boolean;
  /** The card prints a star instead of a number, so the table sets it. */
  readonly starred?: boolean;
  readonly startingThreat?: number;
  readonly startingThreatPerPlayer?: boolean;
  readonly escalation?: number;
  readonly escalationPerPlayer?: boolean;
  /**
   * Threat the campaign adds on top of the printed `startingThreat`.
   *
   * A job under pressure starts with tokens already on its scheme, which is
   * not on the card and cannot be: it depends on how the campaign has gone.
   */
  readonly startingThreatFrom?: ComputedAmount | null;
  /**
   * The difficulty this side is played on, when the modes use different cards.
   *
   * Fear No Evil's subordinates are dealt as two stages out of three: standard
   * faces I and II, expert II and III. Null on every side played either way,
   * which is most of them.
   */
  readonly onlyOn?: string | null;
}

/**
 * Villain and main scheme numbers a campaign carries itself.
 *
 * Keyed by whatever the campaign identifies them with: a villain by the id its
 * draw uses, a scheme by its scenario id. Both are lists because a villain has
 * stages and a finale can turn over to a second scheme.
 *
 * This exists because Fear No Evil's villains are on no database. Without it
 * that whole campaign has no tracker at all — no health to count down, no
 * threat to count up — which is most of what a companion is for.
 */
export interface CampaignTracker {
  readonly villains?: Readonly<Record<string, readonly TrackedSide[]>>;
  readonly schemes?: Readonly<Record<string, readonly TrackedSide[]>>;
  /**
   * Scenario ids whose main scheme is dealt to each player rather than once to
   * the table.
   *
   * Fear No Evil's racket job gives every player a market of their own to
   * clear, so a table of three is thwarting three schemes that finish at
   * different times.
   */
  readonly perPlayerSchemes?: readonly string[];
}

/**
 * What a computed amount comes to, given the counter it reads and the mode.
 *
 * Floored at zero throughout: a template can be imported from a file, and a
 * negative amount would read as an instruction to take threat off.
 */
export function amountFor(
  amount: ComputedAmount | null | undefined,
  counterValue: number,
  expert: boolean,
): number {
  if (amount == null) {
    return 0;
  }
  const threshold = amount.threshold ?? 1;
  if (counterValue < threshold) {
    return 0;
  }
  const unit = Math.max(0, (expert ? amount.perUnitExpert : amount.perUnit) ?? 1);
  return amount.once === true ? unit : unit * Math.max(0, counterValue);
}

// --- the event log ------------------------------------------------------------

export interface CampaignHero {
  /** Stable id within the run; the deck id it was created from. */
  readonly id: string;
  readonly deckId?: string | null;
  readonly heroCardCode: string;
  readonly name: string;
}

/**
 * Questionnaire answers.
 *
 * Stored raw and separately from the effects they produced, so correcting a
 * template and replaying is possible without asking the player again.
 */
export interface AnswerSet {
  readonly numbers?: Readonly<Record<string, number>>;
  readonly booleans?: Readonly<Record<string, boolean>>;
  readonly choices?: Readonly<Record<string, string>>;
  readonly cardLists?: Readonly<Record<string, readonly string[]>>;
  readonly perHeroNumbers?: Readonly<Record<string, Readonly<Record<string, number>>>>;
  readonly perHeroBooleans?: Readonly<Record<string, Readonly<Record<string, boolean>>>>;
  /**
   * Prompt id to hero id to the cards that hero chose.
   *
   * Kept apart from cardLists because who chose what is the point.
   */
  readonly perHeroCards?: Readonly<Record<string, Readonly<Record<string, readonly string[]>>>>;
}

interface EventBase {
  readonly id: string;
  readonly timestamp: number;
}

/**
 * Everything that happens in a run, as an append-only log.
 *
 * All state is derived by folding this list, which buys three things at once:
 * undo and history come free, a template correction can be replayed over an
 * existing run, and merging two devices is merging two lists by id.
 *
 * The `type` values are the app's `@SerialName` tokens. They travel in the
 * backup file and, later, through sync, so they are the wire format and not
 * ours to rename.
 */
export type CampaignEvent =
  | (EventBase & {
      readonly type: 'setup';
      readonly templateId: string;
      readonly difficulty: string;
      readonly heroes: readonly CampaignHero[];
      readonly startScenarioId: string;
      readonly choices?: Readonly<Record<string, string>>;
    })
  | (EventBase & {
      readonly type: 'scenario_result';
      readonly scenarioId: string;
      readonly victory: boolean;
      readonly answers?: AnswerSet;
      readonly elapsedMillis?: number;
    })
  | (EventBase & {
      readonly type: 'purchase';
      readonly heroId: string;
      readonly cardCode: string;
      readonly cost: number;
      readonly cardListId: string;
    })
  | (EventBase & { readonly type: 'purchase_refund'; readonly purchaseEventId: string })
  | (EventBase & {
      readonly type: 'continued';
      readonly scenarioId: string;
      readonly victory: boolean;
    })
  | (EventBase & {
      readonly type: 'setup_action';
      readonly scenarioId: string;
      readonly actionId: string;
      readonly heroId?: string | null;
    })
  | (EventBase & {
      readonly type: 'setup_draw';
      readonly scenarioId: string;
      readonly drawId: string;
      readonly cardCodes: readonly string[];
    })
  | (EventBase & {
      readonly type: 'setup_choice';
      readonly scenarioId: string;
      readonly drawId: string;
      readonly cardCode: string;
    })
  | (EventBase & { readonly type: 'environments_offered'; readonly offered: readonly string[] })
  | (EventBase & { readonly type: 'environment_chosen'; readonly environmentId: string })
  | (EventBase & { readonly type: 'campaign_conceded' })
  | (EventBase & { readonly type: 'scenario_chosen'; readonly scenarioId: string })
  | (EventBase & {
      readonly type: 'manual';
      readonly counterId?: string | null;
      readonly flagId?: string | null;
      readonly heroId?: string | null;
      readonly value?: number | null;
      readonly boolValue?: boolean | null;
      readonly note?: string | null;
    })
  | (EventBase & {
      readonly type: 'revoke';
      readonly revokedEventId: string;
      readonly note?: string | null;
    })
  | (EventBase & {
      readonly type: 'timer';
      readonly scenarioId: string;
      readonly elapsedMillis: number;
    });

// --- the folded state ---------------------------------------------------------

export interface ScenarioResult {
  readonly eventId: string;
  readonly scenarioId: string;
  readonly victory: boolean;
  readonly answers: AnswerSet;
  readonly elapsedMillis: number;
  readonly timestamp: number;
}

export interface Purchase {
  readonly eventId: string;
  readonly heroId: string;
  readonly cardCode: string;
  readonly cost: number;
  readonly cardListId: string;
}

/** Everything derived from the event log. Never stored, always folded. */
export interface CampaignState {
  readonly templateId: string;
  readonly difficulty: string;
  readonly heroes: readonly CampaignHero[];
  readonly started: boolean;
  readonly finished: boolean;

  readonly counters: Readonly<Record<string, number>>;
  /** Counter id to hero id to value. */
  readonly heroCounters: Readonly<Record<string, Readonly<Record<string, number>>>>;
  /** Flag set id to scenario id (or "" for campaign scope) to value. */
  readonly flags: Readonly<Record<string, Readonly<Record<string, boolean>>>>;

  readonly cardLists: Readonly<Record<string, readonly string[]>>;
  readonly heroCardLists: Readonly<Record<string, Readonly<Record<string, readonly string[]>>>>;

  readonly eliminatedInScenario: Readonly<Record<string, readonly string[]>>;

  /**
   * Cards drawn for a scenario's setup, by scenario and draw id. Cleared when
   * the scenario finishes, so replaying after a defeat draws afresh rather
   * than repeating the setup that just went wrong.
   */
  readonly draws: Readonly<Record<string, Readonly<Record<string, readonly string[]>>>>;
  readonly choices: Readonly<Record<string, string>>;

  /** True while the campaign is waiting for the players to pick what to play. */
  readonly awaitingChoice: boolean;

  /**
   * Environments dealt this rotation and waiting on the players.
   *
   * Fear No Evil opens each rotation by dealing two places the villains have
   * hit. Both take the pressure; the players keep one, which then leaves the
   * pile for good.
   */
  readonly environmentOffer: readonly string[];

  /**
   * True once this rotation's environment has been kept.
   *
   * Without it the app looked at an empty table, decided nothing had been
   * dealt, and dealt again, every reload pushing two more places until one
   * fell and took the campaign with it.
   */
  readonly environmentPicked: boolean;

  /**
   * True when a place fell and took the campaign with it.
   *
   * Distinct from finished, which only says the campaign is over: a run that
   * ended this way is a defeat and is recorded as one.
   */
  readonly campaignLost: boolean;

  readonly currentScenarioId: string | null;
  readonly completedScenarios: readonly ScenarioResult[];
  readonly setupActionsTaken: Readonly<Record<string, readonly string[]>>;
  readonly purchases: readonly Purchase[];
  readonly totalPlayTimeMillis: number;
}

export const EMPTY_STATE: CampaignState = {
  templateId: '',
  difficulty: 'standard',
  heroes: [],
  started: false,
  finished: false,
  counters: {},
  heroCounters: {},
  flags: {},
  cardLists: {},
  heroCardLists: {},
  eliminatedInScenario: {},
  draws: {},
  choices: {},
  awaitingChoice: false,
  environmentOffer: [],
  environmentPicked: false,
  campaignLost: false,
  currentScenarioId: null,
  completedScenarios: [],
  setupActionsTaken: {},
  purchases: [],
  totalPlayTimeMillis: 0,
};

// --- reading the state --------------------------------------------------------

export const counterOf = (state: CampaignState, id: string): number => state.counters[id] ?? 0;

export const heroCounterOf = (state: CampaignState, id: string, heroId: string): number =>
  state.heroCounters[id]?.[heroId] ?? 0;

export const flagOf = (state: CampaignState, setId: string, scenarioId = ''): boolean =>
  state.flags[setId]?.[scenarioId] ?? false;

export const countTrueOf = (state: CampaignState, setId: string): number =>
  Object.values(state.flags[setId] ?? {}).filter(Boolean).length;

export const heroCardsOf = (
  state: CampaignState,
  listId: string,
  heroId: string,
): readonly string[] => state.heroCardLists[listId]?.[heroId] ?? [];

/** Cards bought anywhere in the run, for the cross-hero uniqueness rule. */
export const allPurchasedCardCodes = (state: CampaignState): ReadonlySet<string> =>
  new Set(state.purchases.map((purchase) => purchase.cardCode));

/**
 * A question's kind, normalised the way the app normalises it.
 *
 * See PROMPT_TYPES: the comparison is lowercase with underscores removed, so
 * the two clients agree about a template however it was spelled.
 */
export function promptTypeOf(prompt: Prompt): PromptType {
  const normalised = prompt.type.toLowerCase().replace(/_/g, '');
  return (PROMPT_TYPES as readonly string[]).includes(normalised)
    ? (normalised as PromptType)
    : 'unknown';
}

/** The text for a locale, falling back rather than showing nothing. */
export const textOf = (
  text: LocalizedText | null | undefined,
  locale: 'fr' | 'en',
): string => {
  if (text === null || text === undefined) {
    return '';
  }
  const wanted = locale === 'fr' ? text.fr : text.en;
  const other = locale === 'fr' ? text.en : text.fr;
  return wanted ?? other ?? '';
};
