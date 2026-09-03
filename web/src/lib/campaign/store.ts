import { db } from '../db';
import type { CampaignEvent as StoredEvent, CampaignRun } from '../records';
import { environmentOfferFor, setupDrawsFor, villainAssignmentFor } from './deal';
import { expandTemplate, fold, type HeroCardStats } from './engine';
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
 *
 * Stored raw and expanded here, exactly as the app does it: the JSON on disk
 * still has its `setupFragments` and its `include` steps, and everything that
 * reads a template gets them spelled out.
 */
export function templateOf(run: CampaignRun): CampaignTemplate | null {
  if (run.templateJson === '') {
    return null;
  }
  try {
    return expandTemplate(JSON.parse(run.templateJson) as CampaignTemplate);
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
  // The scenario is over, so its clock is too. The next one starts from zero;
  // the time just played is in the event, and the campaign's total is folded
  // from those.
  await clearTimer(run);
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

/**
 * Makes every random pick the campaign owes the players, once.
 *
 * Idempotent, so it runs on every load: a draw already in the log is left
 * alone. Drawing here rather than on screen is what makes a pick stable —
 * recorded as an event, it survives leaving the page and cannot change while
 * somebody is reading the setup off it.
 *
 * Returns true when anything was appended, which is the caller's cue to fold
 * again.
 */
export async function ensureDealt(
  run: CampaignRun,
  template: CampaignTemplate,
  state: CampaignState,
): Promise<boolean> {
  let dealt = false;

  for (const draw of setupDrawsFor(template, state)) {
    await recordDraw(run, draw.scenarioId, draw.drawId, draw.cardCodes);
    dealt = true;
  }

  const villain = villainAssignmentFor(template, state);
  if (villain !== null) {
    await recordDraw(run, villain.scenarioId, villain.drawId, villain.cardCodes);
    dealt = true;
  }

  // Only ever between scenarios, where a setup draw never is, so this cannot
  // be reading a state the loop above has just made stale.
  const offered = environmentOfferFor(template, state);
  if (offered !== null) {
    await append(run.id, {
      id: newId(),
      timestamp: Date.now(),
      type: 'environments_offered',
      offered,
    });
    dealt = true;
  }

  return dealt;
}

/**
 * Keeps one card out of an offer, returning the rest to the pool.
 *
 * The kept card replaces the offer, so everything downstream reads one card
 * without knowing a choice happened.
 */
export async function keepDrawnCard(
  run: CampaignRun,
  scenarioId: string,
  drawId: string,
  cardCode: string,
): Promise<void> {
  await append(run.id, {
    id: newId(),
    timestamp: Date.now(),
    type: 'setup_choice',
    scenarioId,
    drawId,
    cardCode,
  });
}

/**
 * Files the rotation's draw, so the next load does not deal another pair.
 *
 * Nothing is chosen here — the rules draw two and tick the jobs they name.
 * This only records that the table has read it.
 */
export async function acknowledgeEnvironments(run: CampaignRun): Promise<void> {
  await append(run.id, {
    id: newId(),
    timestamp: Date.now(),
    type: 'environment_chosen',
    environmentId: '',
  });
}

// --- the clock ------------------------------------------------------------------

/**
 * How long the scenario in progress has taken.
 *
 * Wall-clock based and stored on the run rather than held in the page, so
 * closing the tab mid-scenario loses nothing: the moment the clock started is
 * written down, and the elapsed time is worked out from it on the way back.
 */
export const timerElapsed = (run: CampaignRun, now: number): number =>
  run.timerRunningSince === null
    ? run.timerAccumulatedMillis
    : run.timerAccumulatedMillis + Math.max(0, now - run.timerRunningSince);

export const timerRunning = (run: CampaignRun): boolean => run.timerRunningSince !== null;

async function writeTimer(run: CampaignRun, next: Partial<CampaignRun>): Promise<CampaignRun> {
  const updated = { ...run, ...next };
  await db.campaignRuns.put(updated);
  return updated;
}

/**
 * Starts, or picks up, the clock for a scenario.
 *
 * The clock the run already has, not a new one: a scenario put away on a long
 * break and picked up again was starting from zero, which threw away
 * everything already played.
 */
export const startTimer = (run: CampaignRun, scenarioId: string | null): Promise<CampaignRun> =>
  run.timerRunningSince !== null
    ? Promise.resolve(run)
    : writeTimer(run, { timerRunningSince: Date.now(), timerScenarioId: scenarioId });

export const pauseTimer = (run: CampaignRun): Promise<CampaignRun> =>
  run.timerRunningSince === null
    ? Promise.resolve(run)
    : writeTimer(run, {
        timerAccumulatedMillis: timerElapsed(run, Date.now()),
        timerRunningSince: null,
      });

/** Manual correction, because the stop button gets forgotten. */
export const setTimerElapsed = (run: CampaignRun, millis: number): Promise<CampaignRun> =>
  writeTimer(run, {
    timerAccumulatedMillis: Math.max(0, millis),
    // Running stays running: correcting the total should not stop the game.
    timerRunningSince: run.timerRunningSince === null ? null : Date.now(),
  });

/** Back to zero for the next scenario, once this one is filed. */
export const clearTimer = (run: CampaignRun): Promise<CampaignRun> =>
  writeTimer(run, {
    timerAccumulatedMillis: 0,
    timerRunningSince: null,
    timerScenarioId: null,
  });

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
  // Read back rather than written from the copy the caller holds: that copy
  // predates the clock this same call may just have stopped, and writing it
  // whole would put the old time back.
  const current = (await db.campaignRuns.get(run.id)) ?? run;
  const state = await stateOf(current);
  if (state !== null && state.finished !== current.finished) {
    await db.campaignRuns.put({ ...current, finished: state.finished });
  }
}

/** Deletes a run and its whole log. Only ever asked for explicitly. */
export async function deleteRun(runId: string): Promise<void> {
  await db.transaction('rw', db.campaignRuns, db.campaignEvents, async () => {
    await db.campaignEvents.where('runId').equals(runId).delete();
    await db.campaignRuns.delete(runId);
  });
}
