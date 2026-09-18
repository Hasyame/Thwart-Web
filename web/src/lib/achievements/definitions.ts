import {
  DEFINITIONS_SCHEMA_VERSION,
  DIFFICULTY_SCALE_VERSION,
  PLAY_MODES,
  type AchievementDefinition,
  type DefinitionsFile,
  type DifficultyLevel,
  type Predicate,
  type Tier,
} from './types';

/**
 * The definitions file, read and refused as docs/spec/achievements/sync.md §4
 * says: a `schemaVersion` above this build's, or another difficulty scale,
 * and the file is not loaded at all — the page says why, the rest of the
 * app is untouched. Any `definitionsVersion` loads. A malformed entry
 * refuses the whole file rather than half of it: a catalogue with a gap is
 * a catalogue somebody will report as "my achievement disappeared".
 */

const DEFINITIONS_URL = '/achievements.json';

const LEVELS: readonly string[] = ['unknown', 'standard', 'expert'];
const CATEGORIES: readonly string[] = ['coverage', 'difficulty', 'volume', 'table', 'campaign', 'mode'];
const TIER_NAMES: readonly string[] = ['bronze', 'silver', 'gold', 'platinum'];
const COUNTS: readonly string[] = ['plays', 'wins', 'heroes_played', 'distinct_days'];

const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);

const levelOrUndefined = (v: unknown): DifficultyLevel | undefined | null =>
  v === undefined ? undefined : typeof v === 'string' && LEVELS.includes(v) ? (v as DifficultyLevel) : null;

function predicateOf(raw: unknown): Predicate | null {
  if (!isRecord(raw) || typeof raw['kind'] !== 'string') {
    return null;
  }
  const min = levelOrUndefined(raw['minDifficulty']);
  if (min === null) {
    return null;
  }
  switch (raw['kind']) {
    case 'scenarios_won':
    case 'heroes_won':
      return typeof raw['pack'] === 'string' && raw['pack'] !== ''
        ? { kind: raw['kind'], pack: raw['pack'], ...(min === undefined ? {} : { minDifficulty: min }) }
        : null;
    case 'aspects_won':
      if (raw['scenario'] !== undefined && typeof raw['scenario'] !== 'string') {
        return null;
      }
      return {
        kind: 'aspects_won',
        ...(typeof raw['scenario'] === 'string' ? { scenario: raw['scenario'] } : {}),
        ...(min === undefined ? {} : { minDifficulty: min }),
      };
    case 'first_win':
      return min === undefined ? null : { kind: 'first_win', minDifficulty: min };
    case 'count':
      return typeof raw['what'] === 'string' && COUNTS.includes(raw['what'])
        ? { kind: 'count', what: raw['what'] as 'plays' | 'wins' | 'heroes_played' | 'distinct_days' }
        : null;
    case 'table_win': {
      const players = raw['players'];
      if (players !== 1 && players !== 2 && players !== 3 && players !== 4) {
        return null;
      }
      return { kind: 'table_win', players, ...(raw['distinctAspects'] === true ? { distinctAspects: true } : {}) };
    }
    case 'campaign':
      return raw['finished'] === true
        ? {
            kind: 'campaign',
            finished: true,
            ...(raw['noDefeat'] === true ? { noDefeat: true } : {}),
            ...(min === undefined ? {} : { minDifficulty: min }),
          }
        : null;
    case 'mode_win':
      return typeof raw['mode'] === 'string' && PLAY_MODES.includes(raw['mode'])
        ? { kind: 'mode_win', mode: raw['mode'] as Predicate extends { mode: infer M } ? M : never }
        : null;
    default:
      return null;
  }
}

function tiersOf(raw: unknown): readonly Tier[] | null | undefined {
  if (raw === undefined) {
    return undefined;
  }
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 4) {
    return null;
  }
  const out: Tier[] = [];
  for (const entry of raw) {
    if (!isRecord(entry) || typeof entry['tier'] !== 'string' || !TIER_NAMES.includes(entry['tier']) || typeof entry['n'] !== 'number') {
      return null;
    }
    const last = out[out.length - 1];
    if (last !== undefined && entry['n'] <= last.n) {
      return null;
    }
    out.push({ tier: entry['tier'] as Tier['tier'], n: entry['n'] });
  }
  return out;
}

function definitionOf(raw: unknown): AchievementDefinition | null {
  if (!isRecord(raw)) {
    return null;
  }
  const id = raw['id'];
  const category = raw['category'];
  const scope = raw['scope'];
  if (typeof id !== 'string' || !/^[a-z0-9_]+$/.test(id)) {
    return null;
  }
  if (typeof category !== 'string' || !CATEGORIES.includes(category)) {
    return null;
  }
  if (scope !== 'owned' && scope !== 'global') {
    return null;
  }
  const predicate = predicateOf(raw['predicate']);
  const tiers = tiersOf(raw['tiers']);
  if (predicate === null || tiers === null || (predicate.kind === 'count') !== (tiers !== undefined)) {
    return null;
  }
  return {
    id,
    category: category as AchievementDefinition['category'],
    scope,
    hidden: raw['hidden'] === true,
    ...(tiers === undefined ? {} : { tiers }),
    predicate,
  };
}

/** The file, validated, or null when this build must not read it. */
export function parseDefinitions(raw: unknown): DefinitionsFile | null {
  if (!isRecord(raw)) {
    return null;
  }
  const schema = raw['schemaVersion'];
  const scale = raw['difficultyScaleVersion'];
  const version = raw['definitionsVersion'];
  if (typeof schema !== 'number' || schema > DEFINITIONS_SCHEMA_VERSION || schema < 1) {
    return null;
  }
  if (scale !== DIFFICULTY_SCALE_VERSION || typeof version !== 'number') {
    return null;
  }
  if (!Array.isArray(raw['achievements'])) {
    return null;
  }
  const achievements: AchievementDefinition[] = [];
  const seen = new Set<string>();
  for (const entry of raw['achievements']) {
    const definition = definitionOf(entry);
    if (definition === null || seen.has(definition.id)) {
      return null;
    }
    seen.add(definition.id);
    achievements.push(definition);
  }
  return { schemaVersion: schema, definitionsVersion: version, difficultyScaleVersion: scale, achievements };
}

let filePromise: Promise<DefinitionsFile | null> | null = null;

/**
 * The definitions as the site serves them, fetched once and kept. Null
 * when the file cannot be read or must not be: the page says which.
 */
export function loadDefinitions(): Promise<DefinitionsFile | null> {
  filePromise ??= fetch(DEFINITIONS_URL)
    .then((response) => (response.ok ? response.json() : null))
    .then((raw: unknown) => (raw === null ? null : parseDefinitions(raw)))
    .catch(() => {
      filePromise = null;
      return null;
    });
  return filePromise;
}
