import type { CampaignEvent as EventRow, CampaignRun } from './records';
import type { CampaignEvent, CampaignState, CampaignTemplate } from './campaign/types';
import { fold } from './campaign/engine';

/**
 * What a campaign's tile shows: a face, a status, a score.
 *
 * ## The face
 *
 * No box art: the boxes are Fantasy Flight's product photography and nothing
 * here bundles or re-hosts it. What stands for a campaign is its **final
 * villain**, the card the whole box builds towards — Red Skull, Thanos's
 * Loki, Magneto, Apocalypse — read from the last scenario in the template
 * that names a villain deck, and drawn from MarvelCDB through the same image
 * pipeline every card view uses. Fear No Evil's villains are on no database,
 * so it has no face and gets a colour field instead; every tile has to look
 * finished with no image at all anyway, since offline means the art will
 * sometimes not arrive.
 *
 * ## The status, and what "lost" means
 *
 * A campaign is **lost** only when the engine says so: a `lose` next step
 * (Fear No Evil's finale on Expert with nothing left to sacrifice), a job
 * that fell under `losesWhenScenarioFails`, or conceding. It is **won** when
 * it is finished and not lost — whatever games were lost along the way,
 * because most campaigns let a table lose a scenario and carry on, and a
 * campaign is not the result of its last game. Otherwise it is **in
 * progress**, or **not started** while no scenario has been played. The
 * rule is the engine's, folded from the log, not a reading of `run.finished`
 * alone: that flag says the run is over, not how.
 *
 * Every status carries a glyph and a word as well as a colour (WCAG 1.4.1).
 */

export type CampaignStatus = 'not-started' | 'in-progress' | 'won' | 'lost' | 'conceded';

export interface CampaignTile {
  readonly status: CampaignStatus;
  /** Scenarios beaten, out of those the template lists. */
  readonly beaten: number;
  readonly total: number;
  /** Every result in the order it was played: true for a victory. */
  readonly results: readonly boolean[];
  /** The card standing for the campaign, or null when it has none. */
  readonly faceCode: string | null;
  /** The folded state, for anything else a caller wants to read. */
  readonly state: CampaignState | null;
}

/** The last villain the template names, read the way the tracker reads decks. */
export function faceCardOf(template: CampaignTemplate | null): string | null {
  if (template === null) {
    return null;
  }
  for (const scenario of [...(template.scenarios ?? [])].reverse()) {
    const decks = scenario.baseSetup?.villainDeck ?? {};
    const codes = decks['standard'] ?? decks['expert'] ?? Object.values(decks)[0] ?? [];
    const first = codes[0];
    if (first !== undefined && first !== '') {
      return first;
    }
  }
  return null;
}

/** Rows as stored, to the events the engine folds. A row it cannot read is skipped. */
export function parseEventRows(rows: readonly EventRow[]): CampaignEvent[] {
  return rows
    .map((row) => {
      try {
        return JSON.parse(row.payload) as CampaignEvent;
      } catch {
        return null;
      }
    })
    .filter((event): event is CampaignEvent => event !== null);
}

export function tileOf(
  run: CampaignRun,
  template: CampaignTemplate | null,
  events: readonly CampaignEvent[],
): CampaignTile {
  const state = template === null ? null : fold(template, events);
  const total = template?.scenarios?.length ?? 0;
  const results = state?.completedScenarios.map((result) => result.victory) ?? [];
  const beaten = new Set(
    (state?.completedScenarios ?? []).filter((r) => r.victory).map((r) => r.scenarioId),
  ).size;

  const conceded = events.some((event) => event.type === 'campaign_conceded');
  let status: CampaignStatus;
  if (conceded) {
    status = 'conceded';
  } else if (state?.campaignLost === true) {
    status = 'lost';
  } else if (state?.finished === true || run.finished) {
    status = 'won';
  } else if (results.length === 0) {
    status = 'not-started';
  } else {
    status = 'in-progress';
  }

  return { status, beaten, total, results, faceCode: faceCardOf(template), state };
}

/**
 * A colour field for a campaign with no face, or whose face has not arrived.
 *
 * Derived from the template id so the same campaign is always the same
 * colour, and kept dark and desaturated so white text over it reads: the hue
 * turns, the lightness does not.
 */
export function fieldHue(templateId: string): number {
  let hash = 0;
  for (const char of templateId) {
    hash = (hash * 31 + char.charCodeAt(0)) % 360;
  }
  return hash;
}
