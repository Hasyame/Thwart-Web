import { db } from '../db';
import type { CampaignEvent as StoredEvent, CampaignRun } from '../records';
import { fold, type HeroCardStats } from './engine';
import type { AnswerSet, CampaignEvent, CampaignHero, CampaignState, CampaignTemplate } from './types';

/**
 * Campaign runs in the browser, and the log each one is made of.
 *
 * Two tables, both the app's own shapes so a backup round trips: a run row with
 * its template snapshotted into it, and an append-only list of events whose
 * payload is the serialised event.
 *
 * Nothing here derives anything. Reading a run means folding its log, every
 * time, which is what makes undo a matter of appending a revocation rather than
 * unpicking a change.
 */

const TEMPLATE_INDEX = '/data/campaigns/index.json';

export interface TemplateSummary {
  readonly id: string;
  readonly name: { readonly fr?: string; readonly en?: string };
  readonly packCode: string | null;
  readonly scenarios: number;
}

let indexPromise: Promise<readonly TemplateSummary[]> | null = null;

export function loadTemplateIndex(): Promise<readonly TemplateSummary[]> {
  indexPromise ??= fetch(TEMPLATE_INDEX)
    .then((response) => {
      if (!response.ok) {
        throw new Error(`${response.status}`);
      }
      return response.json();
    })
    .then((file: { templates: readonly TemplateSummary[] }) => file.templates)
    .catch((error: unknown) => {
      indexPromise = null;
      throw error;
    });
  return indexPromise;
}

const templateCache = new Map<string, Promise<CampaignTemplate>>();

export function loadTemplate(id: string): Promise<CampaignTemplate> {
  const cached = templateCache.get(id);
  if (cached !== undefined) {
    return cached;
  }
  const promise = fetch(`/data/campaigns/${encodeURIComponent(id)}.json`)
    .then((response) => {
      if (!response.ok) {
        throw new Error(`${response.status}`);
      }
      return response.json() as Promise<CampaignTemplate>;
    })
    .catch((error: unknown) => {
      templateCache.delete(id);
      throw error;
    });
  templateCache.set(id, promise);
  return promise;
}

/**
 * The template a run is actually played against.
 *
 * The run carries its own copy, snapshotted when it started, which is what the
 * app stores and what makes a run readable years later whatever has changed
 * since. The fetched template is only the fallback, for a run whose copy is
 * missing or unreadable.
 */
export function templateOf(run: CampaignRun): CampaignTemplate | null {
  if (run.templateJson === '') {
    return null;
  }
  try {
    return JSON.parse(run.templateJson) as CampaignTemplate;
  } catch {
    return null;
  }
}

// --- reading ------------------------------------------------------------------

export const listRuns = (): Promise<CampaignRun[]> => db.campaignRuns.toArray();

export const eventsOf = async (runId: string): Promise<CampaignEvent[]> => {
  const rows = await db.campaignEvents.where('runId').equals(runId).toArray();
  return rows
    .map((row) => {
      try {
        return JSON.parse(row.payload) as CampaignEvent;
      } catch {
        // A row this build cannot read is skipped rather than fatal: the rest
        // of the campaign is still worth showing.
        return null;
      }
    })
    .filter((event): event is CampaignEvent => event !== null);
};

export async function stateOf(
  run: CampaignRun,
  heroStats: Readonly<Record<string, HeroCardStats>> = {},
): Promise<CampaignState | null> {
  const template = templateOf(run);
  if (template === null) {
    return null;
  }
  return fold(template, await eventsOf(run.id), heroStats);
}

// --- writing ------------------------------------------------------------------

const newId = (): string => crypto.randomUUID();

/**
 * Appends one event.
 *
 * Ids are generated once and never reused, which is what makes appending the
 * same event twice a no-op rather than a duplicate when this eventually syncs.
 */
export async function append(runId: string, event: CampaignEvent): Promise<void> {
  const row: StoredEvent = {
    id: event.id,
    runId,
    timestamp: event.timestamp,
    payload: JSON.stringify(event),
  };
  await db.campaignEvents.put(row);
}

export interface StartInput {
  readonly template: CampaignTemplate;
  readonly name: string;
  readonly difficulty: string;
  readonly standardSet: string;
  readonly heroes: readonly CampaignHero[];
  readonly choices: Readonly<Record<string, string>>;
  readonly startScenarioId: string;
}

export async function startCampaign(input: StartInput): Promise<CampaignRun> {
  const now = Date.now();
  const run: CampaignRun = {
    id: newId(),
    templateId: input.template.id,
    templateName: input.template.name.fr ?? input.template.name.en ?? input.template.id,
    name: input.name,
    difficulty: input.difficulty,
    standardSet: input.standardSet,
    createdAt: now,
    finished: false,
    // Snapshotted, as the app does: the run stays readable whatever the
    // published template does afterwards.
    templateJson: JSON.stringify(input.template),
    timerAccumulatedMillis: 0,
    timerRunningSince: null,
    timerScenarioId: null,
  };

  await db.campaignRuns.put(run);
  await append(run.id, {
    id: newId(),
    timestamp: now,
    type: 'setup',
    templateId: input.template.id,
    difficulty: input.difficulty,
    heroes: input.heroes,
    startScenarioId: input.startScenarioId,
    choices: input.choices,
  });
  return run;
}

/**
 * Files a scenario result.
 *
 * The run's `finished` flag is written from the fold rather than guessed, so
 * the row and the log can never disagree about whether a campaign is over.
 */
export async function recordResult(
  run: CampaignRun,
  scenarioId: string,
  victory: boolean,
  answers: AnswerSet,
  elapsedMillis: number,
): Promise<void> {
  await append(run.id, {
    id: newId(),
    timestamp: Date.now(),
    type: 'scenario_result',
    scenarioId,
    victory,
    answers,
    elapsedMillis,
  });
  await refreshFinished(run);
}

export async function chooseScenario(run: CampaignRun, scenarioId: string): Promise<void> {
  await append(run.id, {
    id: newId(),
    timestamp: Date.now(),
    type: 'scenario_chosen',
    scenarioId,
  });
}

export async function continueOutcome(
  run: CampaignRun,
  scenarioId: string,
  victory: boolean,
): Promise<void> {
  await append(run.id, {
    id: newId(),
    timestamp: Date.now(),
    type: 'continued',
    scenarioId,
    victory,
  });
  await refreshFinished(run);
}

export async function takeSetupAction(
  run: CampaignRun,
  scenarioId: string,
  actionId: string,
  heroId: string | null = null,
): Promise<void> {
  await append(run.id, {
    id: newId(),
    timestamp: Date.now(),
    type: 'setup_action',
    scenarioId,
    actionId,
    heroId,
  });
}

export async function recordDraw(
  run: CampaignRun,
  scenarioId: string,
  drawId: string,
  cardCodes: readonly string[],
): Promise<void> {
  await append(run.id, {
    id: newId(),
    timestamp: Date.now(),
    type: 'setup_draw',
    scenarioId,
    drawId,
    cardCodes,
  });
}

export async function buy(
  run: CampaignRun,
  heroId: string,
  cardCode: string,
  cost: number,
  cardListId: string,
): Promise<void> {
  await append(run.id, {
    id: newId(),
    timestamp: Date.now(),
    type: 'purchase',
    heroId,
    cardCode,
    cost,
    cardListId,
  });
}

export async function refund(run: CampaignRun, purchaseEventId: string): Promise<void> {
  await append(run.id, {
    id: newId(),
    timestamp: Date.now(),
    type: 'purchase_refund',
    purchaseEventId,
  });
}

/**
 * Undoes a result by appending, never by deleting.
 *
 * The original stays in the log and the fold ignores it, so the history still
 * says what happened and a second device merging later sees the same thing.
 */
export async function revoke(
  run: CampaignRun,
  eventId: string,
  note: string | null = null,
): Promise<void> {
  await append(run.id, {
    id: newId(),
    timestamp: Date.now(),
    type: 'revoke',
    revokedEventId: eventId,
    note,
  });
  await refreshFinished(run);
}

export async function concede(run: CampaignRun): Promise<void> {
  await append(run.id, { id: newId(), timestamp: Date.now(), type: 'campaign_conceded' });
  await refreshFinished(run);
}

async function refreshFinished(run: CampaignRun): Promise<void> {
  const state = await stateOf(run);
  if (state !== null && state.finished !== run.finished) {
    await db.campaignRuns.put({ ...run, finished: state.finished });
  }
}

/** Deletes a run and its whole log. Only ever asked for explicitly. */
export async function deleteRun(runId: string): Promise<void> {
  await db.transaction('rw', db.campaignRuns, db.campaignEvents, async () => {
    await db.campaignEvents.where('runId').equals(runId).delete();
    await db.campaignRuns.delete(runId);
  });
}
