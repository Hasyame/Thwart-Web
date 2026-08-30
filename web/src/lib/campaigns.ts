import type { CampaignEvent, CampaignRun } from './records';
import type { Locale } from './types';

/**
 * Reading a campaign's log.
 *
 * **This is not a port of `CampaignEngine`.** That engine is about 3,000 lines
 * of Kotlin — the fold, the template model, the condition evaluator and the
 * validator — and it runs counters, flags, card lists, market purchases,
 * setup draws, questionnaires and conditional branching. Doc 04 W5 is where
 * that belongs, and says it is the phase worth abandoning if it looks too big.
 *
 * What this does instead is read the two events that need no interpretation:
 * a campaign was started, and a scenario ended in victory or defeat. That is
 * enough to answer "where are we and what did we beat", which is what somebody
 * looking at a laptop wants to know.
 *
 * It is deliberately **read-only**. The campaign log is append-only and is the
 * single source of truth for a run — `CampaignRunEntity` stores no state at
 * all, because "storing it would let the two disagree". Writing a partial
 * event stream into it from here, without the questionnaire answers the
 * effects are conditioned on, would produce a run that folds to plausible
 * nonsense in the app. Starting and playing campaigns stays in the app until
 * the engine is ported.
 */

/** Only the fields a progress view needs. Templates carry far more. */
interface TemplateScenario {
  readonly id: string;
  readonly name?: Record<string, string>;
}

interface Template {
  readonly id?: string;
  readonly name?: Record<string, string>;
  readonly notice?: Record<string, string>;
  readonly startScenarioId?: string;
  readonly scenarios?: readonly TemplateScenario[];
}

/**
 * The template as it was when the run started.
 *
 * Read from the run rather than from a shipped file, which is exactly why the
 * app embeds it: a run stays readable if the template moves or changes.
 */
export function parseTemplate(run: CampaignRun): Template | null {
  if (run.templateJson.trim() === '') {
    return null;
  }
  try {
    return JSON.parse(run.templateJson) as Template;
  } catch {
    return null;
  }
}

export function localised(
  value: Record<string, string> | undefined,
  locale: Locale,
): string {
  if (value === undefined) {
    return '';
  }
  return value[locale] ?? value['en'] ?? Object.values(value)[0] ?? '';
}

interface ParsedEvent {
  readonly type: string;
  readonly id: string;
  readonly timestamp: number;
  readonly scenarioId?: string;
  readonly victory?: boolean;
  readonly revokedEventId?: string;
  readonly elapsedMillis?: number;
}

function parseEvent(event: CampaignEvent): ParsedEvent | null {
  try {
    const payload = JSON.parse(event.payload) as Record<string, unknown>;
    const type = payload['type'];
    if (typeof type !== 'string') {
      return null;
    }
    return {
      type,
      id: event.id,
      timestamp: event.timestamp,
      scenarioId:
        typeof payload['scenarioId'] === 'string' ? payload['scenarioId'] : undefined,
      victory: typeof payload['victory'] === 'boolean' ? payload['victory'] : undefined,
      revokedEventId:
        typeof payload['revokedEventId'] === 'string'
          ? payload['revokedEventId']
          : undefined,
      elapsedMillis:
        typeof payload['elapsedMillis'] === 'number'
          ? payload['elapsedMillis']
          : undefined,
    };
  } catch {
    // A payload written by a newer app than this one is not a reason to fail
    // the whole campaign view; the events it does understand still read.
    return null;
  }
}

export interface ScenarioProgress {
  readonly id: string;
  readonly name: string;
  readonly attempts: number;
  readonly won: boolean;
  readonly lastPlayedAt: number | null;
}

export interface CampaignProgress {
  readonly run: CampaignRun;
  readonly title: string;
  readonly notice: string;
  readonly scenarios: readonly ScenarioProgress[];
  readonly completed: number;
  readonly conceded: boolean;
  /** Events the fold did not recognise, counted rather than hidden. */
  readonly unreadEvents: number;
  readonly startedAt: number;
}

export function foldCampaign(
  run: CampaignRun,
  events: readonly CampaignEvent[],
  locale: Locale,
): CampaignProgress {
  const template = parseTemplate(run);
  const parsed = events
    .map(parseEvent)
    .filter((e): e is ParsedEvent => e !== null)
    .sort((a, b) => a.timestamp - b.timestamp);

  // A revoke marks an earlier result as superseded. The original stays in the
  // log and the fold ignores it, which is how the app's undo works and why
  // these logs merge without conflict.
  const revoked = new Set(
    parsed
      .filter((e) => e.type === 'revoke' && e.revokedEventId !== undefined)
      .map((e) => e.revokedEventId as string),
  );

  const results = parsed.filter(
    (e) => e.type === 'scenario_result' && !revoked.has(e.id),
  );

  const byScenario = new Map<string, { attempts: number; won: boolean; at: number }>();
  for (const result of results) {
    if (result.scenarioId === undefined) {
      continue;
    }
    const entry = byScenario.get(result.scenarioId) ?? {
      attempts: 0,
      won: false,
      at: 0,
    };
    entry.attempts += 1;
    entry.won = entry.won || result.victory === true;
    entry.at = Math.max(entry.at, result.timestamp);
    byScenario.set(result.scenarioId, entry);
  }

  const listed = template?.scenarios ?? [];
  const scenarios: ScenarioProgress[] = listed.map((scenario) => {
    const entry = byScenario.get(scenario.id);
    return {
      id: scenario.id,
      name: localised(scenario.name, locale) || scenario.id,
      attempts: entry?.attempts ?? 0,
      won: entry?.won ?? false,
      lastPlayedAt: entry === undefined || entry.at === 0 ? null : entry.at,
    };
  });

  const known = new Set([
    'setup',
    'scenario_result',
    'revoke',
    'campaign_conceded',
    'timer',
    'scenario_chosen',
  ]);

  return {
    run,
    // The run's own name if the players gave it one; two groups can be part
    // way through the same campaign, so the template name alone would not
    // identify it.
    title: run.name !== '' ? run.name : localised(template?.name, locale) || run.templateName,
    notice: localised(template?.notice, locale),
    scenarios,
    completed: scenarios.filter((s) => s.won).length,
    conceded: parsed.some((e) => e.type === 'campaign_conceded'),
    unreadEvents: parsed.filter((e) => !known.has(e.type)).length,
    startedAt: run.createdAt,
  };
}
