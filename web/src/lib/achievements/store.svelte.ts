import { liveQuery } from 'dexie';
import { db } from '../db';
import type { CampaignRun, Play } from '../records';
import type { IndexRow } from '../types';
import { fold } from '../campaign/engine';
import { loadTemplate, templateOf } from '../campaign/store';
import { trackedSetCode } from '../campaign/encounter';
import { loadScenarioRules } from '../data';
import { FNE_TEMPLATE_ID, isFne } from '../fearNoEvil';
import type { CampaignEvent } from '../campaign/types';
import { buildCatalogue } from './catalogue';
import { loadDefinitions } from './definitions';
import { derive } from './derive';
import { factOf, runFactOf } from './normalise';
import type { AchievementState, Catalogue, DefinitionsFile, PlayFact, RunFact } from './types';

/**
 * The achievement state, live.
 *
 * Derived, never stored: recomputed from the plays, the runs, their logs
 * and the collection whenever any of them changes, and from the definitions
 * and the card data once they are read. What the page shows is always what
 * the history says, and a backup import or a sync arrives here through the
 * same live queries as a game recorded a second ago.
 *
 * The one thing kept between computations is the last state, so a game's
 * recording can compare before and after for the toast; that is a
 * comparison, not a cache the state depends on.
 */

interface Store {
  /** Null until the definitions and the history have both been read. */
  state: AchievementState | null;
  /** The definitions file, or null when unreadable / refused; see `refused`. */
  definitions: DefinitionsFile | null;
  /** True when the file was read and this build must not load it. */
  refused: boolean;
  catalogue: Catalogue | null;
  loaded: boolean;
}

export const achievements = $state<Store>({ state: null, definitions: null, refused: false, catalogue: null, loaded: false });

interface Inputs {
  plays: readonly Play[];
  runs: readonly CampaignRun[];
  events: ReadonlyMap<string, readonly CampaignEvent[]>;
  ownedPacks: readonly string[];
}

let inputs: Inputs | null = null;
let index: readonly IndexRow[] = [];

/**
 * A campaign play's scenario key, through its run's template: Fear No Evil
 * keeps its scenario id under the one-off prefix; every other box resolves
 * to the card set of the villain the template names for that run.
 */
function resolveCampaign(play: Pick<Play, 'scenarioCode' | 'campaignRunId'>, runs: ReadonlyMap<string, CampaignRun>, events: Inputs['events']): string | null {
  const run = play.campaignRunId === null ? undefined : runs.get(play.campaignRunId);
  if (run === undefined) {
    return null;
  }
  if (run.templateId === FNE_TEMPLATE_ID) {
    return isFne(play.scenarioCode) ? play.scenarioCode : `fne_${play.scenarioCode}`;
  }
  const template = templateOf(run);
  if (template === null) {
    return null;
  }
  const scenario = (template.scenarios ?? []).find((s) => s.id === play.scenarioCode) ?? null;
  return trackedSetCode(scenario, fold(template, events.get(run.id) ?? []), index);
}

function recompute(): void {
  const definitions = achievements.definitions;
  const catalogue = achievements.catalogue;
  if (inputs === null || definitions === null || catalogue === null) {
    return;
  }
  const runsById = new Map(inputs.runs.map((run) => [run.id, run] as const));
  const facts: PlayFact[] = [];
  for (const play of inputs.plays) {
    const fact = factOf(play, (p) => resolveCampaign(p, runsById, (inputs as Inputs).events));
    if (fact !== null) {
      facts.push(fact);
    }
  }
  const runs: RunFact[] = inputs.runs.map((run) => {
    const template = templateOf(run);
    const state = template === null ? null : fold(template, inputs?.events.get(run.id) ?? []);
    return runFactOf(run, state);
  });
  achievements.state = derive({
    definitions: definitions.achievements,
    definitionsVersion: definitions.definitionsVersion,
    catalogue,
    ownedPacks: inputs.ownedPacks,
    facts,
    runs,
  });
  achievements.loaded = true;
}

/**
 * Reads the definitions, the catalogue and the history, and keeps the state
 * current for the life of the app. Returns the unsubscribe. `cardIndex` is
 * the card index as the root holds it, for the catalogue and the campaign
 * resolution.
 */
export function watchAchievements(cardIndex: readonly IndexRow[]): () => void {
  index = cardIndex;
  let live = true;
  void loadDefinitions().then((file) => {
    if (!live) {
      return;
    }
    achievements.definitions = file;
    achievements.refused = file === null;
    recompute();
  });
  void Promise.all([loadScenarioRules().catch(() => null), loadTemplate(FNE_TEMPLATE_ID).catch(() => null)]).then(
    ([rules, fne]) => {
      if (!live) {
        return;
      }
      achievements.catalogue = buildCatalogue(index, rules, fne);
      recompute();
    },
  );
  const subscription = liveQuery(async () => {
    const [plays, runs, eventRows, packs] = await Promise.all([
      db.plays.toArray(),
      db.campaignRuns.toArray(),
      db.campaignEvents.toArray(),
      db.ownedPacks.toArray(),
    ]);
    const events = new Map<string, CampaignEvent[]>();
    for (const row of eventRows) {
      try {
        const list = events.get(row.runId) ?? [];
        list.push(JSON.parse(row.payload) as CampaignEvent);
        events.set(row.runId, list);
      } catch {
        // A row this build cannot read is skipped; the rest of the run stands.
      }
    }
    return { plays, runs, events, ownedPacks: packs.filter((p) => p.quantity > 0).map((p) => p.packCode) };
  }).subscribe((next) => {
    inputs = next;
    recompute();
  });
  return () => {
    live = false;
    subscription.unsubscribe();
  };
}
