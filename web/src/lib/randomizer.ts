import type { CardSet, IndexRow } from './types';
import { composeFne, needsVillain, splitFne, type FneScenario } from './fearNoEvil';

/**
 * The draw.
 *
 * Ported from the app's `RandomizerRepository` and `RandomizerModels`, with the
 * same rules and the same vocabulary, so a player who knows one recognises the
 * other. The interesting decisions are not in the shuffling — that part is
 * trivial — but in what is allowed into the bag in the first place.
 */

/**
 * Difficulty, and the pack each set came in.
 *
 * Core is assumed rather than checked: without it there is no game to set a
 * difficulty for, and offering nothing would be worse than offering the two
 * levels everybody has.
 */
export const DIFFICULTIES = [
  { id: 'STANDARD_I', packCode: 'core', expert: false },
  { id: 'STANDARD_II', packCode: 'hood', expert: false },
  { id: 'STANDARD_III', packCode: 'aoa', expert: false },
  { id: 'EXPERT_I', packCode: 'core', expert: true },
  { id: 'EXPERT_II', packCode: 'hood', expert: true },
] as const;

export type DifficultyId = (typeof DIFFICULTIES)[number]['id'];

/**
 * The playable aspects.
 *
 * `basic` is not one: every deck has basic cards, so there is no such thing as
 * building *in* basic. Deadpool's own aspect only exists if you own his pack.
 */
export const ASPECTS = [
  'aggression',
  'justice',
  'leadership',
  'protection',
  'pool',
] as const;

export type Aspect = (typeof ASPECTS)[number];

/** Aspects that arrived in a pack of their own. The other four are in Core. */
const ASPECT_PACKS: Partial<Record<Aspect, string>> = { pool: 'deadpool' };

/** One entry of `scenario-rules.json`. Names are deliberately absent. */
export interface ScenarioRule {
  readonly code: string;
  readonly packCode: string;
  readonly modularCount: number;
  readonly mandatoryModulars: readonly string[];
  readonly recommendedModulars: readonly string[];
  /** Set when the scenario draws only from named packs, as MojoMania does. */
  readonly modularPacks?: readonly string[];
  /** Added to `modularCount` once per hero at the table. */
  readonly modularCountPerHero?: number;
  readonly needsReview?: boolean;
  /**
   * The scenario takes no modular set at all, extras included: Fear No
   * Evil's, whose encounter deck is named in the setup text.
   */
  readonly noModulars?: boolean;
}

export interface ScenarioRulesFile {
  readonly scenarios: readonly ScenarioRule[];
  readonly modularSets: readonly { readonly code: string; readonly packCode: string }[];
}

/** A field of the draw. Each one can be locked and rerolled on its own. */
export type DrawField = 'scenario' | 'difficulty' | 'heroes' | 'modularSets';

export interface HeroAssignment {
  readonly code: string;
  readonly name: string;
  readonly aspect: Aspect;
}

export interface Draw {
  readonly scenarioCode: string | null;
  readonly difficulty: DifficultyId | null;
  /** The Standard set played alongside an Expert one. Null otherwise. */
  readonly standardSet: DifficultyId | null;
  readonly playerCount: number;
  readonly heroes: readonly HeroAssignment[];
  readonly modularSetCodes: readonly string[];
  /** Sets the scenario requires. Shown apart, because they were not drawn. */
  readonly mandatoryModularCodes: readonly string[];
}

export const EMPTY_DRAW: Draw = {
  scenarioCode: null,
  difficulty: null,
  standardSet: null,
  playerCount: 1,
  heroes: [],
  modularSetCodes: [],
  mandatoryModularCodes: [],
};

export interface Pools {
  /** Scenarios that can be drawn, with their rules. */
  readonly scenarios: readonly ScenarioRule[];
  readonly modularSets: readonly CardSet[];
  readonly heroes: readonly { readonly code: string; readonly name: string }[];
  readonly difficulties: readonly DifficultyId[];
  readonly aspects: readonly Aspect[];
  /**
   * Every difficulty the collection allows, never narrowed by the filters.
   *
   * Kept because two draws need what is *ownable* rather than what is wanted.
   * Owning the pack a difficulty came in is not a preference, and the game
   * still needs a Standard set shuffled in with an Expert one however the
   * filter panel is set. See `roll`.
   */
  readonly ownedDifficulties: readonly DifficultyId[];
  /**
   * Scenarios that are played against a villain drawn at the table, and
   * the villains to draw from: Fear No Evil's jobs and its subordinates.
   * A draw of such a scenario draws its villain too, and a choice of one
   * asks for it. See lib/fearNoEvil.
   */
  readonly villainChoices: Readonly<Record<string, readonly string[]>>;
}

function pick<T>(items: readonly T[]): T | null {
  if (items.length === 0) {
    return null;
  }
  return items[Math.floor(Math.random() * items.length)] ?? null;
}

function sample<T>(items: readonly T[], count: number): T[] {
  // Fisher-Yates over a copy, then take the front. Correct for small n and
  // obviously so, which matters more here than being clever.
  const pool = [...items];
  for (let i = pool.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const a = pool[i];
    const b = pool[j];
    if (a !== undefined && b !== undefined) {
      pool[i] = b;
      pool[j] = a;
    }
  }
  return pool.slice(0, Math.max(0, count));
}

export interface PoolInput {
  readonly rules: ScenarioRulesFile;
  readonly sets: readonly CardSet[];
  readonly index: readonly IndexRow[];
  readonly ownedPackCodes: ReadonlySet<string>;
  readonly excludedModularSets: ReadonlySet<string>;
  readonly excludedScenarios: ReadonlySet<string>;
  /**
   * Fear No Evil's box, when its template has been read: its pack, its
   * scenarios and its subordinates. On no card database, so it cannot come
   * through the rules file like the others.
   */
  readonly fne?: {
    readonly packCode: string;
    readonly scenarios: readonly FneScenario[];
    readonly villains: readonly string[];
  } | null;
}

/**
 * Everything the collection allows.
 *
 * Built fresh whenever the collection changes. The app had a bug here worth not
 * repeating: its view model loaded the pools once, so changing the collection
 * and coming back left the old ones in place.
 *
 * A scenario with no rules entry is **left out rather than defaulted**. Five
 * villain sets are in that position — the four Wrecking Crew members and the
 * Marauders — and there is no honest guess at how many modular sets they take.
 * Offering a scenario with the wrong setup is worse than not offering it.
 */
export function buildPools(input: PoolInput): Pools {
  const { rules, sets, index, ownedPackCodes } = input;

  // Fear No Evil enters as six entries, not one per job and subordinate,
  // which would make the box come up five times as often as any other.
  const fne = input.fne ?? null;
  const fneScenarios: ScenarioRule[] =
    fne !== null && ownedPackCodes.has(fne.packCode)
      ? fne.scenarios
          .filter((scenario) => !input.excludedScenarios.has(scenario.code))
          .map((scenario) => ({
            code: scenario.code,
            packCode: fne.packCode,
            modularCount: 0,
            mandatoryModulars: [],
            recommendedModulars: [],
            noModulars: true,
          }))
      : [];
  const villainChoices: Record<string, readonly string[]> = {};
  if (fne !== null) {
    for (const scenario of fneScenarios) {
      if (fne.scenarios.find((s) => s.code === scenario.code)?.needsVillain === true) {
        villainChoices[scenario.code] = fne.villains;
      }
    }
  }

  const scenarios = [
    ...rules.scenarios.filter(
      (rule) =>
        ownedPackCodes.has(rule.packCode) && !input.excludedScenarios.has(rule.code),
    ),
    ...fneScenarios,
  ];

  const modularSets = sets.filter(
    (set) =>
      set.type === 'modular' &&
      ownedPackCodes.has(set.packCode) &&
      !input.excludedModularSets.has(set.code),
  );

  // One entry per hero, not per hero card: a hero with several versions would
  // otherwise be several heroes in the bag and come up that much more often.
  const seenHeroSets = new Set<string>();
  const heroes: { code: string; name: string }[] = [];
  for (const row of index) {
    if (row.typeCode !== 'hero' || !ownedPackCodes.has(row.packCode)) {
      continue;
    }
    const setKey = row.setCode ?? row.code;
    if (seenHeroSets.has(setKey)) {
      continue;
    }
    seenHeroSets.add(setKey);
    heroes.push({ code: row.code, name: row.name });
  }
  heroes.sort((a, b) => a.name.localeCompare(b.name));

  const difficulties = DIFFICULTIES.filter(
    (entry) => entry.packCode === 'core' || ownedPackCodes.has(entry.packCode),
  ).map((entry) => entry.id);

  const aspects = ASPECTS.filter((aspect) => {
    const required = ASPECT_PACKS[aspect];
    return required === undefined || ownedPackCodes.has(required);
  });

  return {
    scenarios,
    modularSets,
    heroes,
    difficulties,
    aspects,
    ownedDifficulties: difficulties,
    villainChoices,
  };
}

/**
 * The rule a scenario code falls under.
 *
 * A Fear No Evil job carries its villain in the code once one is drawn, and
 * the rule is the job's: the code is read back to the job before looking.
 */
export const ruleFor = (pools: Pools, code: string | null): ScenarioRule | null =>
  code === null ? null : (pools.scenarios.find((rule) => rule.code === splitFne(code).job) ?? null);

/** A scenario that draws its villain gets one; every other code comes back as it is. */
export function withVillain(scenarioCode: string, pools: Pools): string {
  if (!needsVillain(scenarioCode, pools.villainChoices)) {
    return scenarioCode;
  }
  const villain = pick(pools.villainChoices[scenarioCode] ?? []);
  return villain === null ? scenarioCode : composeFne(scenarioCode, villain);
}

/**
 * What the player wants *tonight*, as distinct from what they own.
 *
 * Two different questions, kept apart here as the app keeps them apart. The
 * collection says a modular set cannot be fielded — a second-hand box, a set
 * lent out — and that is a lasting fact stored in the database and carried in
 * a backup. These say "not this evening": no Expert, not Ultron again, nobody
 * plays Leadership. They live for as long as the page is open and are stored
 * nowhere, matching `RandomizerFilters`, which the app holds in a
 * `MutableStateFlow` and never persists.
 */
const isStandard = (id: DifficultyId): boolean =>
  DIFFICULTIES.find((entry) => entry.id === id)?.expert === false;

/**
 * The Standard set an Expert difficulty is played with, or null.
 *
 * Exported because choosing a difficulty by hand has to obey the same setup
 * rule as drawing one: an Expert set is shuffled in *with* a Standard, and a
 * draw that cannot be set up is not a draw. Preferring the allowed Standards
 * and falling back to any the collection has, because excluding every Standard
 * in the filter panel is a statement about what you want to play and cannot
 * repeal the rules of setup.
 */
export function standardSetFor(
  difficulty: DifficultyId | null,
  allowed: readonly DifficultyId[],
  owned: readonly DifficultyId[],
): DifficultyId | null {
  const expert =
    difficulty !== null &&
    DIFFICULTIES.find((entry) => entry.id === difficulty)?.expert === true;
  if (!expert) {
    return null;
  }
  return pick(allowed.filter(isStandard)) ?? pick(owned.filter(isStandard)) ?? null;
}

export interface DrawFilters {
  readonly allowedDifficulties: ReadonlySet<DifficultyId>;
  readonly excludedAspects: ReadonlySet<Aspect>;
  readonly excludedHeroes: ReadonlySet<string>;
  readonly excludedScenarios: ReadonlySet<string>;
  /**
   * Skip scenarios already beaten, per the saved draws.
   *
   * Held here for the panel's sake but merged into `excludedScenarios` before
   * the draw sees it, exactly as the app's `effectiveFilters()` does — the
   * pools have no business knowing *why* a scenario is out.
   */
  readonly excludeBeaten: boolean;
}

/** Everything allowed, which is what an untouched filter panel means. */
export function noFilters(pools: Pools): DrawFilters {
  return {
    allowedDifficulties: new Set(pools.difficulties),
    excludedAspects: new Set(),
    excludedHeroes: new Set(),
    excludedScenarios: new Set(),
    excludeBeaten: false,
  };
}

/**
 * Narrows the pools by the evening's filters.
 *
 * A separate pass rather than another argument to `buildPools`, so the two
 * kinds of exclusion cannot be confused for one another: what you own is
 * rebuilt when the collection changes, what you fancy is applied on top.
 */
export function applyFilters(pools: Pools, filters: DrawFilters): Pools {
  return {
    scenarios: pools.scenarios.filter(
      (rule) => !filters.excludedScenarios.has(rule.code),
    ),
    modularSets: pools.modularSets,
    heroes: pools.heroes.filter((hero) => !filters.excludedHeroes.has(hero.code)),
    difficulties: pools.difficulties.filter((id) =>
      filters.allowedDifficulties.has(id),
    ),
    aspects: pools.aspects.filter((aspect) => !filters.excludedAspects.has(aspect)),
    // Deliberately untouched: what the collection allows is not a preference.
    ownedDifficulties: pools.ownedDifficulties,
    // Nor is which villains a job draws from; excluding a job excludes it whole.
    villainChoices: pools.villainChoices,
  };
}

export interface RollInput {
  readonly pools: Pools;
  readonly previous: Draw;
  readonly locked: ReadonlySet<DrawField>;
  readonly playerCount: number;
  /**
   * Modular sets on top of what the scenario takes. 0 to MAX_EXTRA_MODULARS,
   * default 0, and the default must stay what the randomiser has always done.
   * See docs/spec/ratings-and-modular-sets.md §1.1.
   */
  readonly extraModularSets?: number;
}

export const MAX_EXTRA_MODULARS = 5;

/**
 * The modular sets a scenario may draw from, in this collection.
 *
 * Owned sets, minus the ones the scenario mandates — those are placed, not
 * drawn — restricted to the scenario's own packs when it names them. This is
 * the one pool for the scenario's own count and for any extras on top: a
 * MojoMania scenario's extras come only from MojoMania, and a Civil War set
 * never turns up as an extra elsewhere, because the pool already says so.
 */
export function modularCandidatesFor(pools: Pools, rule: ScenarioRule): readonly CardSet[] {
  const restrictedTo = rule.modularPacks ?? [];
  return pools.modularSets.filter(
    (set) =>
      !rule.mandatoryModulars.includes(set.code) &&
      (restrictedTo.length === 0 || restrictedTo.includes(set.packCode)),
  );
}

/**
 * How many sets short the collection is for this scenario at this table, with
 * this many extras asked for. Zero means the draw can be made.
 *
 * What the page uses to say so *before* the roll: the randomiser never
 * silently draws fewer than it was asked for.
 */
export function modularShortfall(
  pools: Pools,
  rule: ScenarioRule,
  playerCount: number,
  extras: number,
): number {
  // A scenario that takes no modular set is never short of one, extras or
  // not: the extras are a wish about the encounter deck, and this one's is
  // fixed by its own rules.
  if (rule.noModulars === true) {
    return 0;
  }
  const mandatoryHere = rule.mandatoryModulars.filter((code) =>
    pools.modularSets.some((set) => set.code === code),
  ).length;
  const needed = Math.max(0, modularCountFor(rule, playerCount) - mandatoryHere) + extras;
  return Math.max(0, needed - modularCandidatesFor(pools, rule).length);
}

/**
 * The scenarios that cannot take this many extras from this collection.
 *
 * The scenario is drawn, not known, so "can the collection supply K extras"
 * has no single answer before the roll: Rhino draws from everything and
 * MojoMania from three sets. With extras asked for, these are left out of the
 * draw and the page says how many — the alternative, drawing them with fewer,
 * is exactly the silent shortfall the rule forbids.
 */
export function scenariosShortOfExtras(
  pools: Pools,
  playerCount: number,
  extras: number,
): readonly ScenarioRule[] {
  if (extras <= 0) {
    return [];
  }
  return pools.scenarios.filter((rule) => modularShortfall(pools, rule, playerCount, extras) > 0);
}

/**
 * How many modular sets this scenario takes at this table size.
 *
 * Two scenarios scale with the number of heroes — MojoMania and Thunderbolts —
 * which is why the count is a function of the table rather than a constant.
 */
function modularCountFor(rule: ScenarioRule, playerCount: number): number {
  return rule.modularCount + (rule.modularCountPerHero ?? 0) * playerCount;
}

export function roll(input: RollInput): Draw {
  const { pools, previous, locked, playerCount } = input;
  const extras = Math.max(0, Math.min(MAX_EXTRA_MODULARS, input.extraModularSets ?? 0));

  // Nothing both ownable and allowed means the filter and the collection
  // disagree. The collection wins: a draw the player cannot put on the table
  // is not a draw.
  const difficulty = locked.has('difficulty')
    ? previous.difficulty
    : (pick(pools.difficulties) ?? pick(pools.ownedDifficulties));

  /*
   * An Expert set is never played on its own: Expert mode is the Expert set
   * shuffled into the encounter deck *with* a Standard one, not in place of
   * it. So drawing Expert leaves a second draw to make.
   *
   * The companion is preferred from the allowed Standards, but falls back to
   * any Standard the collection has. Excluding every Standard in the filter
   * panel is a statement about what you want to *play*, and it cannot repeal
   * the setup rules — the game still needs one, and a draw that cannot be set
   * up is not a draw.
   */
  const keepStandard = locked.has('difficulty') ? previous.standardSet : null;
  const standardSet =
    keepStandard ?? standardSetFor(difficulty, pools.difficulties, pools.ownedDifficulties);

  // With extras asked for, only scenarios that can take them are drawn; see
  // scenariosShortOfExtras. A locked scenario is the player's choice and is
  // kept even if it is short — the page has already told them.
  const short = new Set(scenariosShortOfExtras(pools, playerCount, extras).map((r) => r.code));
  const scenarioRule = locked.has('scenario')
    ? ruleFor(pools, previous.scenarioCode)
    : pick(pools.scenarios.filter((rule) => !short.has(rule.code)));
  // A job of Fear No Evil is played against a villain drawn with it; the
  // draw is not complete without one. A locked scenario keeps the villain
  // it has.
  const scenarioCode =
    scenarioRule === null
      ? null
      : locked.has('scenario')
        ? previous.scenarioCode
        : withVillain(scenarioRule.code, pools);

  const heroes = locked.has('heroes')
    ? previous.heroes
    : sample(pools.heroes, playerCount).map((hero) => ({
        code: hero.code,
        name: hero.name,
        // Aspect per seat, drawn independently: two players may bring the
        // same aspect, and the game allows it.
        aspect: pick(pools.aspects) ?? 'justice',
      }));

  let mandatory: readonly string[] = [];
  let drawn: readonly string[] = [];

  if (scenarioRule !== null) {
    // A mandatory set from a pack the player does not own, or one they have
    // told the collection is missing, cannot go on the table — so it is
    // dropped rather than silently pretended.
    mandatory = scenarioRule.mandatoryModulars.filter((code) =>
      pools.modularSets.some((set) => set.code === code),
    );

    if (locked.has('modularSets')) {
      drawn = previous.modularSetCodes;
    } else {
      // The one pool, for the scenario's own count and the extras alike:
      // sampled without replacement, so no set is drawn twice and none that
      // is mandated is drawn at all.
      const candidates = modularCandidatesFor(pools, scenarioRule);
      const wanted = scenarioRule.noModulars === true
        ? 0
        : modularCountFor(scenarioRule, playerCount) - mandatory.length + extras;
      drawn = sample(candidates, wanted).map((set) => set.code);
    }
  }

  return {
    scenarioCode,
    difficulty,
    standardSet,
    playerCount,
    heroes,
    modularSetCodes: drawn,
    mandatoryModularCodes: mandatory,
  };
}
