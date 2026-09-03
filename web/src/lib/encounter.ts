import type { Card } from './types';

/**
 * The counters a scenario puts on the table.
 *
 * A port of the app's `domain/play/Encounter.kt` and `VillainStages.kt`, plus
 * the side builders from `EncounterRepository`. Ported rather than reinvented
 * because these are rules, and two implementations of a rule are two chances to
 * get it wrong; where the Kotlin explains a decision, the explanation comes
 * with it.
 *
 * Deliberately only counters. It does not know that Ultron drones enter play or
 * that a Crisis icon stops thwarting: a tracker that half-adjudicates rules is
 * one that is wrong at somebody's table, and then the numbers it *is* keeping
 * stop being trusted either.
 *
 * Nothing here is curated. The villain's health and the scheme's threat come
 * from the same card rows the Cards page shows, so a scenario added to
 * MarvelCDB works without this file being touched.
 */

/**
 * One printed side of a villain or a main scheme.
 *
 * The numbers are as printed, not as they end up on the table: most are "per
 * player", and the scaling happens here because the card does not know how many
 * people turned up.
 */
export interface EncounterSide {
  readonly name: string;
  readonly stage: string;
  /** Villain health, or a main scheme's threat limit. Null when starred. */
  readonly value: number | null;
  readonly perPlayer: boolean;
  /**
   * The card prints a star rather than a number, so the scenario decides it.
   * Five cards do this, Juggernaut and Mojo among them, and no amount of card
   * data will say what the number is, so the player types it.
   */
  readonly starred: boolean;
  /** Threat already on a scheme when it comes into play. Schemes only. */
  readonly startingThreat: number;
  readonly startingThreatPerPlayer: boolean;
  /** Threat added at the end of every round. Schemes only. */
  readonly escalation: number;
  readonly escalationPerPlayer: boolean;
  /**
   * Threat the campaign puts on the scheme on top of what the card prints.
   *
   * Already worked out, and not scaled again: Fear No Evil starts a job with a
   * threat for every pressure box ticked against it, and that is a flat amount
   * whatever the printed threat beside it does.
   */
  readonly extraStartingThreat?: number;
}

/**
 * One stage of the main scheme, and the schemes printed for it.
 *
 * Usually one. Seven stages in the database print several and the table picks
 * one: Mansion Attack draws a room out of four, Mister Sinister one scheme out
 * of three, Kang a realm out of four.
 *
 * Not a detail that can be skipped by taking the first. Kang's four realms
 * share a threat limit of 9 but start on 0, 1 or 2 threat depending which one
 * is on the table, so guessing puts the counter in the wrong place three times
 * out of four.
 */
export interface SchemeStage {
  readonly stage: string;
  readonly options: readonly EncounterSide[];
}

export interface EncounterSetup {
  readonly villain: readonly EncounterSide[];
  readonly scheme: readonly SchemeStage[];
  readonly players: number;
  /**
   * How many copies of the main scheme are on the table at once.
   *
   * One almost everywhere: a table plays a main scheme and turns it over. Fear
   * No Evil's racket job deals one to *each* player, who works their own market
   * alone, so three players have three schemes running side by side and
   * finishing at different times. Folding those into a single bar would count
   * to a limit nobody is playing to, and could not say whose was nearly done.
   */
  readonly schemeCopies?: number;
}

export interface EncounterProgress {
  readonly villainIndex: number;
  readonly damage: number;
  readonly schemeIndex: number;
  /** Which of this stage's printed schemes is on the table. */
  readonly schemeOption: number;
  readonly threat: number;
  /**
   * Threat on the second and later copies of the main scheme.
   *
   * The first copy's threat stays in `threat` rather than all of them moving
   * into one list, because a game put away before this existed wrote `threat`
   * into its saved counters and renaming it would bring every paused game back
   * with its scheme empty.
   */
  readonly extraThreats: readonly number[];
  readonly round: number;
  /** Filled in by the player, for the stages that print a star. */
  readonly manualVillainHealth: number | null;
  readonly manualSchemeLimit: number | null;
}

export interface Encounter {
  readonly setup: EncounterSetup;
  readonly progress: EncounterProgress;
}

const scaled = (value: number, scales: boolean, players: number): number =>
  scales ? value * players : value;

export const totalFor = (side: EncounterSide, players: number): number | null =>
  side.value === null ? null : scaled(side.value, side.perPlayer, players);

export const startingThreatFor = (side: EncounterSide, players: number): number =>
  scaled(side.startingThreat, side.startingThreatPerPlayer, players) +
  (side.extraStartingThreat ?? 0);

export const escalationFor = (side: EncounterSide, players: number): number =>
  scaled(side.escalation, side.escalationPerPlayer, players);

/** Nothing to count is not worth showing. */
export const isUsable = (setup: EncounterSetup): boolean =>
  setup.villain.length > 0 || setup.scheme.length > 0;

export const schemeStageOf = (e: Encounter): SchemeStage | null =>
  e.setup.scheme[e.progress.schemeIndex] ?? null;

export const villainSideOf = (e: Encounter): EncounterSide | null =>
  e.setup.villain[e.progress.villainIndex] ?? null;

export function schemeSideOf(e: Encounter): EncounterSide | null {
  const stage = schemeStageOf(e);
  if (stage === null) {
    return null;
  }
  return stage.options[e.progress.schemeOption] ?? stage.options[0] ?? null;
}

/** The villain's health at this stage, or what the player typed for a star. */
export function villainHealth(e: Encounter): number | null {
  const side = villainSideOf(e);
  return (side === null ? null : totalFor(side, e.setup.players)) ?? e.progress.manualVillainHealth;
}

/** The threat this scheme advances at, or what the player typed for a star. */
export function schemeLimit(e: Encounter): number | null {
  const side = schemeSideOf(e);
  return (side === null ? null : totalFor(side, e.setup.players)) ?? e.progress.manualSchemeLimit;
}

export const villainDefeated = (e: Encounter): boolean => {
  const health = villainHealth(e);
  return health !== null && e.progress.damage >= health;
};

/** Copies of the main scheme in play, never fewer than one. */
export const schemeCopies = (e: Encounter): number =>
  Math.max(1, e.setup.schemeCopies ?? 1);

/** Threat on one copy of the main scheme. Copy zero is the table's own. */
export const threatOn = (e: Encounter, copy: number): number =>
  copy <= 0 ? e.progress.threat : (e.progress.extraThreats[copy - 1] ?? 0);

export const schemeCompleteOn = (e: Encounter, copy: number): boolean => {
  const limit = schemeLimit(e);
  return limit !== null && threatOn(e, copy) >= limit;
};

export const schemeComplete = (e: Encounter): boolean => schemeCompleteOn(e, 0);

export const isFinalVillainStage = (e: Encounter): boolean =>
  e.progress.villainIndex >= e.setup.villain.length - 1;

export const isFinalSchemeStage = (e: Encounter): boolean =>
  e.progress.schemeIndex >= e.setup.scheme.length - 1;

/**
 * Says which of this stage's schemes is on the table, and starts it there.
 *
 * The threat is reset rather than kept, because this choice is made when the
 * scheme comes into play: a different realm is a different card, not the same
 * one renamed, and carrying a count across would describe neither.
 */
export function withSchemeOption(e: Encounter, option: number): Encounter {
  const stage = schemeStageOf(e);
  if (stage === null) {
    return e;
  }
  const chosen = stage.options[option];
  if (chosen === undefined) {
    return e;
  }
  const start = startingThreatFor(chosen, e.setup.players);
  return withProgress(e, {
    schemeOption: option,
    threat: start,
    extraThreats: Array.from({ length: schemeCopies(e) - 1 }, () => start),
    manualSchemeLimit: null,
  });
}

function withProgress(e: Encounter, change: Partial<EncounterProgress>): Encounter {
  return { setup: e.setup, progress: { ...e.progress, ...change } };
}

/**
 * Damage on the villain. A negative amount heals.
 *
 * Stopping at the stage's health rather than running past it: the number beside
 * it is what somebody reads to know the villain is done, and a count of 53/51
 * tells them nothing they wanted.
 */
export function damaged(e: Encounter, amount: number): Encounter {
  const raised = Math.max(0, e.progress.damage + amount);
  const health = villainHealth(e);
  return withProgress(e, { damage: health === null ? raised : Math.min(raised, health) });
}

/** Threat on the main scheme. A negative amount thwarts. */
export const threatened = (e: Encounter, amount: number): Encounter =>
  threatenedOn(e, 0, amount);

/** The same, on one particular copy of the scheme. */
export function threatenedOn(e: Encounter, copy: number, amount: number): Encounter {
  const raised = Math.max(0, threatOn(e, copy) + amount);
  const limit = schemeLimit(e);
  const capped = limit === null ? raised : Math.min(raised, limit);
  if (copy <= 0) {
    return withProgress(e, { threat: capped });
  }
  const grown = [...e.progress.extraThreats];
  while (grown.length < copy) {
    grown.push(0);
  }
  grown[copy - 1] = capped;
  return withProgress(e, { extraThreats: grown });
}

/**
 * Flips the villain to its next stage, carrying no damage over.
 *
 * Not automatic on reaching the health: defeating a villain stage is a thing the
 * table does, with a step to it and sometimes a choice, and a counter that
 * jumped ahead on its own would be describing a board that does not exist yet.
 */
export function villainAdvanced(e: Encounter): Encounter {
  if (isFinalVillainStage(e)) {
    return e;
  }
  return withProgress(e, {
    villainIndex: e.progress.villainIndex + 1,
    damage: 0,
    manualVillainHealth: null,
  });
}

/** Advances the main scheme, starting the new one at its own printed threat. */
export function schemeAdvanced(e: Encounter): Encounter {
  if (isFinalSchemeStage(e)) {
    return e;
  }
  const next = e.setup.scheme[e.progress.schemeIndex + 1]?.options[0];
  const start = next === undefined ? 0 : startingThreatFor(next, e.setup.players);
  return withProgress(e, {
    schemeIndex: e.progress.schemeIndex + 1,
    // Back to the first option: a new stage is a new choice, and the number
    // chosen for the last one says nothing about this one.
    schemeOption: 0,
    threat: start,
    extraThreats: Array.from({ length: schemeCopies(e) - 1 }, () => start),
    manualSchemeLimit: null,
  });
}

/**
 * Ends the round: the acceleration goes on the main scheme.
 *
 * The one piece of arithmetic worth automating. It is per player, it happens
 * every single round, and forgetting it is the commonest way a game ends up
 * somewhere it should not be.
 */
export function roundEnded(e: Encounter): Encounter {
  const side = schemeSideOf(e);
  const escalation = side === null ? 0 : escalationFor(side, e.setup.players);
  // Every copy accelerates, not only the first: a table playing one scheme
  // each is a table where each of them speeds up every round.
  let after = e;
  for (let copy = 0; copy < schemeCopies(e); copy += 1) {
    after = threatenedOn(after, copy, escalation);
  }
  return withProgress(after, { round: after.progress.round + 1 });
}

export const withManualVillainHealth = (e: Encounter, health: number | null): Encounter =>
  withProgress(e, { manualVillainHealth: health });

export const withManualSchemeLimit = (e: Encounter, limit: number | null): Encounter =>
  withProgress(e, { manualSchemeLimit: limit });

/** A scenario at the start of a game, with the scheme's printed threat on it. */
export function startOf(setup: EncounterSetup): Encounter {
  const first = setup.scheme[0]?.options[0];
  const start = first === undefined ? 0 : startingThreatFor(first, setup.players);
  const copies = Math.max(1, setup.schemeCopies ?? 1);
  return {
    setup,
    progress: {
      villainIndex: 0,
      damage: 0,
      schemeIndex: 0,
      schemeOption: 0,
      threat: start,
      extraThreats: Array.from({ length: copies - 1 }, () => start),
      round: 1,
      manualVillainHealth: null,
      manualSchemeLimit: null,
    },
  };
}

// --- building a setup out of cards -------------------------------------------

/**
 * Which villain stages a difficulty actually puts on the table.
 *
 * A villain printed I, II and III is played I then II on Standard, and II then
 * III on Expert. Galaxy's Most Wanted states it plainly. Walking all three
 * whatever the difficulty made a Standard game ask for a stage that was not in
 * the deck.
 *
 * Everything else is returned untouched, deliberately. The stage field also
 * carries a villain's two sides (A and B, as the Wrecking Crew four are
 * printed), the four-part shapes some scenarios use, and Kang, whose difficulty
 * lives in which encounter set was taken rather than in the stages. None of
 * those are difficulty tiers, and dropping one of them would break a scenario in
 * order to fix a different one.
 *
 * Grouped by villain, because a scenario can field several: Tower Defense has
 * Corvus Glaive and Proxima Midnight, each printed I, II and III, and treating
 * the six as one list would take the wrong two.
 */
const CLASSIC_STAGES = ['I', 'II', 'III'];

export function selectVillainStages<T>(
  cards: readonly T[],
  expert: boolean,
  name: (card: T) => string,
  stage: (card: T) => string | null,
): T[] {
  const byVillain = new Map<string, Set<string>>();
  for (const card of cards) {
    const printed = byVillain.get(name(card)) ?? new Set<string>();
    const value = stage(card);
    if (value !== null) {
      printed.add(value.toUpperCase());
    }
    byVillain.set(name(card), printed);
  }

  const dropped = expert ? 'I' : 'III';
  return cards.filter((card) => {
    const printed = byVillain.get(name(card)) ?? new Set<string>();
    const isClassic =
      printed.size === CLASSIC_STAGES.length && CLASSIC_STAGES.every((s) => printed.has(s));
    return !isClassic || stage(card)?.toUpperCase() !== dropped;
  });
}

/** Civil War's leaders sit in the villain's place and behave as one. */
const VILLAIN_TYPES = new Set(['villain', 'leader']);
const MAIN_SCHEME = 'main_scheme';

const numberOrNull = (value: unknown): number | null =>
  typeof value === 'number' ? value : null;

const flag = (value: unknown): boolean => value === true;

function villainSide(card: Card): EncounterSide {
  return {
    name: card.name,
    stage: card.stage ?? '',
    value: numberOrNull(card.health),
    // The card database says "per hero" here, where true means multiply.
    perPlayer: flag(card.health_per_hero),
    starred: flag(card.health_star),
    startingThreat: 0,
    startingThreatPerPlayer: false,
    escalation: 0,
    escalationPerPlayer: false,
  };
}

function schemeSide(card: Card): EncounterSide {
  const printed = numberOrNull(card.threat);
  return {
    name: card.name,
    stage: card.stage ?? '',
    // A printed limit of zero means this stage has no threat limit at all: it
    // advances some other way, as The Brotherhood Strikes! does when the
    // villains are defeated. Read literally it made the scheme "complete" the
    // moment the game started.
    value: printed !== null && printed > 0 ? printed : null,
    // ...and "fixed" here, where **false** means multiply. Same idea, opposite
    // spelling, which is exactly why it is normalised once, here.
    perPlayer: !flag(card.threat_fixed),
    starred: flag(card.threat_star),
    startingThreat: numberOrNull(card.base_threat) ?? 0,
    startingThreatPerPlayer: !flag(card.base_threat_fixed),
    escalation: numberOrNull(card.escalation_threat) ?? 0,
    escalationPerPlayer: !flag(card.escalation_threat_fixed),
  };
}

/**
 * The side of a main scheme that carries the numbers.
 *
 * The card database holds each scheme three times: side A with the setup text,
 * side B with the threat, and a combined double-sided row that repeats both.
 * Taking everything counted each stage twice and put the text side, which has no
 * threat limit, in front of the numbers side. Every scenario in the database has
 * a B side, so this loses nothing.
 */
const isNumbersSide = (card: Card): boolean =>
  !flag(card.double_sided) && (card.stage ?? '').toUpperCase().endsWith('B');

/**
 * Builds the setup for a scenario out of its own cards.
 *
 * `cards` is every card in the scenario's set; the caller has already loaded the
 * pack. Expert plays the last two villain stages where Standard plays the first
 * two.
 */
export function setupFor(
  cards: readonly Card[],
  players: number,
  expert: boolean,
): EncounterSetup {
  const villains = cards.filter(
    (card) => VILLAIN_TYPES.has(card.type_code) && !flag(card.double_sided),
  );
  return {
    villain: selectVillainStages(
      villains,
      expert,
      (card) => card.name,
      (card) => card.stage ?? null,
    ).map(villainSide),
    scheme: groupByStage(
      cards.filter((card) => card.type_code === MAIN_SCHEME && isNumbersSide(card)).map(schemeSide),
    ),
    players: Math.max(1, players),
  };
}

/**
 * Collapses schemes printed for the same stage into one stage with options.
 *
 * Order is the file's, which is MarvelCDB's, which is the order printed on the
 * cards. Sorting by stage name would put 10 before 2.
 */
function groupByStage(sides: readonly EncounterSide[]): SchemeStage[] {
  const stages: SchemeStage[] = [];
  const seen = new Map<string, EncounterSide[]>();
  for (const side of sides) {
    const key = side.stage.toUpperCase();
    const existing = seen.get(key);
    if (existing === undefined) {
      const options: EncounterSide[] = [side];
      seen.set(key, options);
      stages.push({ stage: side.stage, options });
    } else {
      existing.push(side);
    }
  }
  return stages;
}

/**
 * Sorted the way the cards are printed, not the way the file happens to hold
 * them. A tracker that offers stage III before stage I is describing a game
 * nobody is playing.
 */
export function sortByStage(sides: readonly EncounterSide[]): EncounterSide[] {
  const order = (stage: string): number => {
    const roman = ['I', 'II', 'III', 'IV', 'V'].indexOf(stage.replace(/[^IVX]/gi, '').toUpperCase());
    if (roman >= 0) {
      return roman;
    }
    const digits = stage.match(/\d+/);
    return digits === null ? 99 : Number(digits[0]);
  };
  return [...sides].sort((a, b) => order(a.stage) - order(b.stage));
}
