import type { CardSet, IndexRow } from './types';

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

  const scenarios = rules.scenarios.filter(
    (rule) =>
      ownedPackCodes.has(rule.packCode) && !input.excludedScenarios.has(rule.code),
  );

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

  return { scenarios, modularSets, heroes, difficulties, aspects };
}

export interface RollInput {
  readonly pools: Pools;
  readonly previous: Draw;
  readonly locked: ReadonlySet<DrawField>;
  readonly playerCount: number;
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

  const difficulty = locked.has('difficulty')
    ? previous.difficulty
    : pick(pools.difficulties);

  // An Expert set is never played on its own: Expert mode is the Expert set
  // shuffled in *with* a Standard one, so choosing Expert leaves a second
  // question to answer.
  const isExpert =
    DIFFICULTIES.find((entry) => entry.id === difficulty)?.expert === true;
  const standards = pools.difficulties.filter(
    (id) => DIFFICULTIES.find((entry) => entry.id === id)?.expert === false,
  );
  const standardSet = isExpert
    ? locked.has('difficulty') && previous.standardSet !== null
      ? previous.standardSet
      : pick(standards)
    : null;

  const scenarioRule = locked.has('scenario')
    ? (pools.scenarios.find((rule) => rule.code === previous.scenarioCode) ?? null)
    : pick(pools.scenarios);

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
    mandatory = scenarioRule.mandatoryModulars;

    if (locked.has('modularSets')) {
      drawn = previous.modularSetCodes;
    } else {
      // A scenario that names its own pool draws only from it. MojoMania is
      // read this way, and versus packs work the same, because their sets are
      // illegal anywhere else.
      const restrictedTo = scenarioRule.modularPacks ?? [];
      const candidates = pools.modularSets.filter(
        (set) =>
          !mandatory.includes(set.code) &&
          (restrictedTo.length === 0 || restrictedTo.includes(set.packCode)),
      );
      const wanted = modularCountFor(scenarioRule, playerCount) - mandatory.length;
      drawn = sample(candidates, wanted).map((set) => set.code);
    }
  }

  return {
    scenarioCode: scenarioRule?.code ?? null,
    difficulty,
    standardSet,
    playerCount,
    heroes,
    modularSetCodes: drawn,
    mandatoryModularCodes: mandatory,
  };
}
