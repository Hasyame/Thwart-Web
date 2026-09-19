/**
 * The achievements, as docs/spec/achievements/data-model.md declares them.
 *
 * Everything here is either read from the definitions file or derived from
 * the game history; nothing is stored. The names are the specification's,
 * so the Android port and this one can be read side by side.
 */

export type DifficultyLevel = 'unknown' | 'standard' | 'expert';

/** The scale's explicit total order. `difficultyScaleVersion` 1. */
export const LEVEL_RANK: Readonly<Record<DifficultyLevel, number>> = { unknown: 0, standard: 1, expert: 2 };
export const DIFFICULTY_SCALE_VERSION = 1;
export const DEFINITIONS_SCHEMA_VERSION = 2;

export const CLASSIC_ASPECTS = ['aggression', 'justice', 'leadership', 'protection'] as const;

export type AchievementCategory = 'coverage' | 'difficulty' | 'volume' | 'table' | 'campaign' | 'mode';
export type AchievementScope = 'owned' | 'global';
export type TierName = 'bronze' | 'silver' | 'gold' | 'platinum';
export type PlayMode = 'draft' | 'sealed' | 'daily' | 'shared';
export const PLAY_MODES: readonly string[] = ['draft', 'sealed', 'daily', 'shared'];

export interface Tier {
  readonly tier: TierName;
  readonly n: number;
}

export type Predicate =
  | { readonly kind: 'scenarios_won'; readonly pack: string; readonly minDifficulty?: DifficultyLevel }
  | { readonly kind: 'heroes_won'; readonly pack: string; readonly minDifficulty?: DifficultyLevel }
  | { readonly kind: 'aspects_won'; readonly scenario?: string; readonly minDifficulty?: DifficultyLevel }
  | { readonly kind: 'first_win'; readonly minDifficulty: DifficultyLevel }
  | { readonly kind: 'count'; readonly what: 'plays' | 'wins' | 'heroes_played' | 'distinct_days' }
  | { readonly kind: 'table_win'; readonly players: 1 | 2 | 3 | 4; readonly distinctAspects?: boolean }
  | { readonly kind: 'campaign'; readonly finished: true; readonly noDefeat?: boolean; readonly minDifficulty?: DifficultyLevel }
  | { readonly kind: 'mode_win'; readonly mode: PlayMode; readonly n?: number }
  | { readonly kind: 'loss_count'; readonly n: number };

export interface AchievementDefinition {
  readonly id: string;
  readonly category: AchievementCategory;
  readonly scope: AchievementScope;
  readonly hidden: boolean;
  readonly tiers?: readonly Tier[];
  readonly predicate: Predicate;
}

export interface DefinitionsFile {
  readonly schemaVersion: number;
  readonly definitionsVersion: number;
  readonly difficultyScaleVersion: number;
  readonly achievements: readonly AchievementDefinition[];
}

// --- the input of the derivation ------------------------------------------------

export interface Seat {
  readonly heroCode: string;
  /** Lowercase codes, deduplicated, sorted. */
  readonly aspects: readonly string[];
  readonly isOwner: boolean;
}

export interface PlayFact {
  readonly id: string;
  readonly playedAt: number;
  readonly scenarioKey: string;
  readonly level: DifficultyLevel;
  readonly won: boolean;
  readonly players: number;
  readonly seats: readonly Seat[];
  readonly campaignRunId: string | null;
  readonly mode: string | null;
}

export interface RunFact {
  readonly id: string;
  readonly templateId: string;
  readonly level: DifficultyLevel;
  readonly finished: boolean;
  readonly lost: boolean;
}

export interface HeroRef {
  readonly code: string;
  readonly packCode: string;
}

export interface ScenarioRef {
  readonly key: string;
  readonly packCode: string;
}

export interface Catalogue {
  readonly heroes: readonly HeroRef[];
  readonly scenarios: readonly ScenarioRef[];
}

export interface DeriveInput {
  readonly definitions: readonly AchievementDefinition[];
  readonly definitionsVersion: number;
  readonly catalogue: Catalogue;
  readonly ownedPacks: readonly string[];
  readonly facts: readonly PlayFact[];
  readonly runs: readonly RunFact[];
}

// --- the output -------------------------------------------------------------------

export interface Tally {
  readonly attempts: number;
  readonly wins: number;
  readonly best: 'played' | 'won' | null;
  readonly bestLevelWon: DifficultyLevel | null;
  readonly firstWonAt: number | null;
  readonly lastPlayedAt: number | null;
}

export interface Cell extends Tally {
  readonly heroCode: string;
  readonly scenarioKey: string;
  /** The same tally over every seat at the table, not only the owner's. */
  readonly anySeat: Tally;
}

export type AchievementStatusKind = 'locked' | 'unlocked' | 'unavailable';

export interface AchievementStatus {
  readonly id: string;
  readonly status: AchievementStatusKind;
  readonly progress: { readonly current: number; readonly target: number };
  readonly tier: TierName | null;
  readonly unlockedAt: number | null;
  readonly unlockedByPlayId: string | null;
}

export interface Completion {
  readonly won: number;
  readonly cells: number;
}

export interface Unlock {
  readonly id: string;
  readonly unlockedAt: number;
  readonly unlockedByPlayId: string | null;
}

export interface AchievementState {
  readonly definitionsVersion: number;
  readonly scaleVersion: number;
  readonly cells: readonly Cell[];
  readonly achievements: readonly AchievementStatus[];
  readonly completion: { readonly owned: Completion; readonly global: Completion };
  readonly recent: readonly Unlock[];
}
