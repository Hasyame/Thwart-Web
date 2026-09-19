import {
  CLASSIC_ASPECTS,
  DIFFICULTY_SCALE_VERSION,
  LEVEL_RANK,
  type AchievementDefinition,
  type AchievementState,
  type AchievementStatus,
  type Cell,
  type DeriveInput,
  type DifficultyLevel,
  type PlayFact,
  type RunFact,
  type Tally,
  type TierName,
  type Unlock,
} from './types';

/**
 * The derivation, docs/spec/achievements/algorithm.md, step for step.
 *
 * Pure and total: the same input gives the same state, field for field, in
 * the same order, whatever order the records came in. No clock, no random
 * draw, no storage; the test vectors are the contract with the Android
 * port. Anything a client wants to remember about this state is a cache.
 */

const DAY = 86_400_000;

const byPlay = (a: PlayFact, b: PlayFact): number =>
  a.playedAt - b.playedAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

const later = (a: PlayFact, b: PlayFact): PlayFact => (byPlay(a, b) >= 0 ? a : b);

const atLeast = (level: DifficultyLevel, min: DifficultyLevel | undefined): boolean =>
  LEVEL_RANK[level] >= LEVEL_RANK[min ?? 'unknown'];

/*
 * Every seat at the table counts (decided 2026-09-19): most of a history is
 * one person playing two hands, and a hero they played is a hero they
 * played. `isOwner` stays on the record and in the cells' owner tally, for
 * reading; nothing here decides by it.
 */
const heroesOf = (fact: PlayFact): string[] => fact.seats.map((seat) => seat.heroCode);
const aspectsOf = (fact: PlayFact): Set<string> => new Set(fact.seats.flatMap((seat) => seat.aspects));

interface MutableTally {
  attempts: number;
  wins: number;
  best: 'played' | 'won' | null;
  bestLevelWon: DifficultyLevel | null;
  firstWonAt: number | null;
  lastPlayedAt: number | null;
}

const tally = (): MutableTally => ({
  attempts: 0,
  wins: 0,
  best: null,
  bestLevelWon: null,
  firstWonAt: null,
  lastPlayedAt: null,
});

function touch(t: MutableTally, fact: PlayFact): void {
  t.attempts += 1;
  if (fact.won) {
    t.wins += 1;
    if (t.bestLevelWon === null || LEVEL_RANK[fact.level] > LEVEL_RANK[t.bestLevelWon]) {
      t.bestLevelWon = fact.level;
    }
    t.firstWonAt ??= fact.playedAt;
  }
  t.best = t.wins > 0 ? 'won' : 'played';
  t.lastPlayedAt = fact.playedAt;
}

const frozen = (t: MutableTally): Tally => ({ ...t });

interface Verdict {
  readonly done: boolean;
  readonly current: number;
  readonly target: number;
  readonly unlock: PlayFact | null;
  /** True when done without a play to date it: a finished run with no games. */
  readonly undated?: boolean;
  readonly tier?: TierName | null;
}

/** Coverage over a list of targets: each met by the first fact that satisfies it. */
function coverage<T>(targets: readonly T[], metBy: (target: T) => PlayFact | undefined): Verdict {
  const met: PlayFact[] = [];
  for (const target of targets) {
    const fact = metBy(target);
    if (fact !== undefined) {
      met.push(fact);
    }
  }
  const done = targets.length > 0 && met.length === targets.length;
  return {
    done,
    current: met.length,
    target: targets.length,
    unlock: done ? met.reduce(later) : null,
  };
}

export function derive(input: DeriveInput): AchievementState {
  const facts = [...input.facts].sort(byPlay);
  const runs = [...input.runs].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const owned = new Set(input.ownedPacks);

  // 4.1 cells
  const cells = new Map<string, { scenarioKey: string; heroCode: string; owner: MutableTally; any: MutableTally }>();
  for (const fact of facts) {
    for (const seat of fact.seats) {
      const key = `${fact.scenarioKey}\u0000${seat.heroCode}`;
      let cell = cells.get(key);
      if (cell === undefined) {
        cell = { scenarioKey: fact.scenarioKey, heroCode: seat.heroCode, owner: tally(), any: tally() };
        cells.set(key, cell);
      }
      touch(cell.any, fact);
      if (seat.isOwner) {
        touch(cell.owner, fact);
      }
    }
  }

  // 4.2 completion
  const heroes = new Map(input.catalogue.heroes.map((h) => [h.code, h.packCode] as const));
  const scenarios = new Map(input.catalogue.scenarios.map((s) => [s.key, s.packCode] as const));
  const ownedHeroes = new Set([...heroes].filter(([, pack]) => owned.has(pack)).map(([code]) => code));
  const ownedScenarios = new Set([...scenarios].filter(([, pack]) => owned.has(pack)).map(([key]) => key));
  let ownedWon = 0;
  let globalWon = 0;
  for (const cell of cells.values()) {
    if (cell.any.wins > 0) {
      if (heroes.has(cell.heroCode) && scenarios.has(cell.scenarioKey)) {
        globalWon += 1;
      }
      if (ownedHeroes.has(cell.heroCode) && ownedScenarios.has(cell.scenarioKey)) {
        ownedWon += 1;
      }
    }
  }

  const wins = facts.filter((fact) => fact.won);

  // 4.3 predicates
  const verdictOf = (definition: AchievementDefinition): Verdict => {
    const p = definition.predicate;
    switch (p.kind) {
      case 'scenarios_won': {
        const targets = [...scenarios].filter(([, pack]) => p.pack === '*' || pack === p.pack).map(([key]) => key);
        return coverage(targets, (key) =>
          wins.find((f) => f.scenarioKey === key && atLeast(f.level, p.minDifficulty)),
        );
      }
      case 'heroes_won': {
        const targets = [...heroes].filter(([, pack]) => p.pack === '*' || pack === p.pack).map(([code]) => code);
        return coverage(targets, (code) =>
          wins.find((f) => heroesOf(f).includes(code) && atLeast(f.level, p.minDifficulty)),
        );
      }
      case 'aspects_won':
        return coverage(CLASSIC_ASPECTS, (aspect) =>
          wins.find(
            (f) =>
              (p.scenario === undefined || f.scenarioKey === p.scenario) &&
              aspectsOf(f).has(aspect) &&
              atLeast(f.level, p.minDifficulty),
          ),
        );
      case 'first_win': {
        const fact = wins.find((f) => atLeast(f.level, p.minDifficulty)) ?? null;
        return { done: fact !== null, current: fact === null ? 0 : 1, target: 1, unlock: fact };
      }
      case 'count': {
        const tiers = definition.tiers ?? [];
        const top = tiers[tiers.length - 1]?.n ?? 1;
        let value = 0;
        const seen = new Set<string | number>();
        let reached: PlayFact | null = null;
        for (const fact of facts) {
          switch (p.what) {
            case 'plays':
              value += 1;
              break;
            case 'wins':
              value += fact.won ? 1 : 0;
              break;
            case 'heroes_played':
              for (const hero of heroesOf(fact)) {
                seen.add(hero);
              }
              value = seen.size;
              break;
            case 'distinct_days':
              seen.add(Math.floor(fact.playedAt / DAY));
              value = seen.size;
              break;
          }
          if (reached === null && value >= top) {
            reached = fact;
          }
        }
        let tier: TierName | null = null;
        for (const t of tiers) {
          if (value >= t.n) {
            tier = t.tier;
          }
        }
        return { done: value >= top, current: Math.min(value, top), target: top, unlock: reached, tier };
      }
      case 'table_win': {
        const qualifies = (f: PlayFact): boolean => {
          if (!f.won || f.players !== p.players) {
            return false;
          }
          if (p.distinctAspects === true) {
            const sets = f.seats.map((seat) => new Set(seat.aspects));
            if (sets.some((s) => s.size === 0)) {
              return false;
            }
            for (let i = 0; i < sets.length; i += 1) {
              for (let j = i + 1; j < sets.length; j += 1) {
                for (const aspect of sets[i] as Set<string>) {
                  if ((sets[j] as Set<string>).has(aspect)) {
                    return false;
                  }
                }
              }
            }
          }
          return true;
        };
        const fact = facts.find(qualifies) ?? null;
        return { done: fact !== null, current: fact === null ? 0 : 1, target: 1, unlock: fact };
      }
      case 'campaign': {
        for (const run of runs) {
          if (!(run.finished && !run.lost && atLeast(run.level, p.minDifficulty))) {
            continue;
          }
          const ofRun = facts.filter((f) => f.campaignRunId === run.id);
          if (p.noDefeat === true && ofRun.some((f) => !f.won)) {
            continue;
          }
          const last = ofRun.length === 0 ? null : ofRun.reduce(later);
          return { done: true, current: 1, target: 1, unlock: last, undated: last === null };
        }
        return { done: false, current: 0, target: 1, unlock: null };
      }
      case 'mode_win': {
        const matching = wins.filter((f) => f.mode === p.mode);
        const target = p.n ?? 1;
        return { done: matching.length >= target, current: Math.min(matching.length, target), target, unlock: matching[target - 1] ?? null };
      }
      case 'loss_count': {
        const matching = facts.filter((f) => !f.won);
        return { done: matching.length >= p.n, current: Math.min(matching.length, p.n), target: p.n, unlock: matching[p.n - 1] ?? null };
      }
    }
  };

  // 4.4 status
  const unavailable = (definition: AchievementDefinition): boolean => {
    if (definition.scope !== 'owned') {
      return false;
    }
    const p = definition.predicate;
    if (p.kind === 'scenarios_won' || p.kind === 'heroes_won') {
      const table = p.kind === 'scenarios_won' ? scenarios : heroes;
      return p.pack === '*' ? [...table.values()].some((pack) => !owned.has(pack)) : !owned.has(p.pack);
    }
    if (p.kind === 'aspects_won' && p.scenario !== undefined) {
      const pack = scenarios.get(p.scenario);
      return pack === undefined || !owned.has(pack);
    }
    return false;
  };

  const achievements: AchievementStatus[] = input.definitions.map((definition) => {
    const verdict = verdictOf(definition);
    const dated = verdict.done && verdict.unlock !== null;
    return {
      id: definition.id,
      status: verdict.done ? 'unlocked' : unavailable(definition) ? 'unavailable' : 'locked',
      progress: { current: verdict.current, target: verdict.target },
      tier: verdict.tier ?? null,
      unlockedAt: dated ? (verdict.unlock as PlayFact).playedAt : null,
      unlockedByPlayId: dated ? (verdict.unlock as PlayFact).id : null,
    };
  });

  // 4.5 recent
  const recent: Unlock[] = achievements
    .filter((a): a is AchievementStatus & { unlockedAt: number } => a.status === 'unlocked' && a.unlockedAt !== null)
    .map((a) => ({ id: a.id, unlockedAt: a.unlockedAt, unlockedByPlayId: a.unlockedByPlayId }))
    .sort((a, b) => b.unlockedAt - a.unlockedAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  // 5 output ordering
  const outCells: Cell[] = [...cells.values()]
    .sort((a, b) =>
      a.scenarioKey < b.scenarioKey ? -1 : a.scenarioKey > b.scenarioKey ? 1 : a.heroCode < b.heroCode ? -1 : a.heroCode > b.heroCode ? 1 : 0,
    )
    .map((cell) => ({ heroCode: cell.heroCode, scenarioKey: cell.scenarioKey, ...frozen(cell.owner), anySeat: frozen(cell.any) }));

  return {
    definitionsVersion: input.definitionsVersion,
    scaleVersion: DIFFICULTY_SCALE_VERSION,
    cells: outCells,
    achievements,
    completion: {
      owned: { won: ownedWon, cells: ownedHeroes.size * ownedScenarios.size },
      global: { won: globalWon, cells: heroes.size * scenarios.size },
    },
    recent,
  };
}

/** Which achievements went from not unlocked to unlocked: what a toast celebrates. */
export function newlyUnlocked(before: AchievementState | null, after: AchievementState): readonly Unlock[] {
  const was = new Set((before?.achievements ?? []).filter((a) => a.status === 'unlocked').map((a) => a.id));
  return after.achievements
    .filter((a) => a.status === 'unlocked' && !was.has(a.id))
    .map((a) => ({ id: a.id, unlockedAt: a.unlockedAt ?? 0, unlockedByPlayId: a.unlockedByPlayId }));
}

void (0 as unknown as RunFact);
