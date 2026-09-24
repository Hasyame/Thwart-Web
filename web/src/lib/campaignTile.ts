import type { CampaignEvent as EventRow, CampaignRun } from './records';
import type { CampaignEvent, CampaignState, CampaignTemplate, ScenarioTemplate } from './campaign/types';
import { fold } from './campaign/engine';

/**
 * What a campaign's tile shows: a face, a status, a score.
 *
 * ## The face
 *
 * What stands for a campaign is its **final villain**, the card the whole
 * box builds towards — Red Skull, Thanos's Loki, Magneto, Apocalypse — read
 * from the last scenario in the template that names a villain deck, and
 * drawn from MarvelCDB through the same image pipeline every card view uses.
 * Nothing of the boxes themselves is re-hosted.
 *
 * Fear No Evil is the exception: its villains are on no database, so it
 * carries the box's key art instead, the one picture this site bundles
 * (`public/art/campaigns/fne.jpg`, © 2025 Marvel, Fantasy Flight's
 * announcement art). A campaign with neither gets a colour field; every tile
 * has to look finished with no image at all anyway, since offline means the
 * art will sometimes not arrive.
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
  /** Bundled key art, for the one campaign whose villains are on no database. */
  readonly boxArt: string | null;
  /** The folded state, for anything else a caller wants to read. */
  readonly state: CampaignState | null;
}

/** The key art bundled for a campaign, by template id. Fear No Evil only. */
const BOX_ART: Readonly<Record<string, string>> = { fne: '/art/campaigns/fne.jpg' };

export const boxArtOf = (templateId: string): string | null => BOX_ART[templateId] ?? null;

/** A scenario's villain, the first card of its villain deck, or null. */
export function scenarioFaceOf(scenario: ScenarioTemplate): string | null {
  const decks = scenario.baseSetup?.villainDeck ?? {};
  const codes = decks['standard'] ?? decks['expert'] ?? Object.values(decks)[0] ?? [];
  const first = codes[0];
  return first !== undefined && first !== '' ? first : null;
}

/** The last villain the template names, read the way the tracker reads decks. */
export function faceCardOf(template: CampaignTemplate | null): string | null {
  if (template === null) {
    return null;
  }
  for (const scenario of [...(template.scenarios ?? [])].reverse()) {
    const face = scenarioFaceOf(scenario);
    if (face !== null) {
      return face;
    }
  }
  return null;
}

/**
 * When a campaign last moved: its latest logged event, or its creation.
 *
 * Read from the log rather than stored, so a campaign synced from the phone
 * says when it was last played there too.
 */
export function lastUpdatedOf(run: CampaignRun, events: readonly EventRow[]): number {
  return events.reduce((latest, event) => Math.max(latest, event.timestamp), run.createdAt);
}

/**
 * "today", "yesterday", the weekday within a week, else the date.
 *
 * What a shelf of campaigns needs: which one was played last, in words, not
 * a timestamp to decode.
 */
export function updatedWords(at: number, locale: string, now = Date.now()): string {
  const day = (ms: number): number => Math.floor(new Date(ms).setHours(0, 0, 0, 0) / 86_400_000);
  const days = day(now) - day(at);
  if (days <= 1) {
    return new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(-Math.max(0, days), 'day');
  }
  if (days < 7) {
    return new Intl.DateTimeFormat(locale, { weekday: 'long' }).format(at);
  }
  return new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(at);
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

  return { status, beaten, total, results, faceCode: faceCardOf(template), boxArt: boxArtOf(run.templateId), state };
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
