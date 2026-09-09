import type { CampaignRun } from './records';
import type { Locale } from './types';
import { stateOf, templateOf } from './campaign/store';
import { counterOf, heroCounterOf, textOf } from './campaign/types';

/**
 * What a campaign was carrying, for a game's detail view.
 *
 * Galaxy's Most Wanted has credits, Sinister Motives has evidence, Mad Titan's
 * Shadow has infinity stones. None of these is a field on a play: they are
 * counters the campaign template defines, folded out of the run's event log,
 * which is also how the Android app produces its campaign figures.
 *
 * **Nothing is invented.** Only counters the template actually declares appear,
 * only with the label the template gives them, and only when the campaign has
 * defined a label at all — an internal counter with no name is bookkeeping, not
 * something to show a player. A campaign with no counters yields no rows and
 * the detail view simply has none.
 *
 * # A caveat worth stating
 *
 * These are the values **now**, not the values at the moment that scenario was
 * played. The event log is append-only and could be replayed to any point, but
 * nothing on a play records which event it sat after, so there is no honest way
 * to pin one to a game. Showing the run's current state on a game that belongs
 * to that run is the truthful version of what can be known; the label says the
 * campaign, not the game.
 */

export interface CampaignFigure {
  readonly label: string;
  readonly value: string;
}

export async function campaignFigures(
  run: CampaignRun,
  runId: string,
  locale: Locale,
): Promise<readonly CampaignFigure[]> {
  if (run.id !== runId) {
    return [];
  }

  const template = templateOf(run);
  if (template === null) {
    return [];
  }

  const state = await stateOf(run);
  if (state === null) {
    return [];
  }

  const out: CampaignFigure[] = [];

  for (const counter of template.counters ?? []) {
    const label = textOf(counter.label, locale);
    // No label means the campaign never meant this one to be read.
    if (label === '') {
      continue;
    }

    if (counter.scope === 'hero') {
      /*
        A per-hero counter, summed across the table.

        Credits in Galaxy's Most Wanted are held per hero and spent per hero,
        and the interesting number to a reader looking back is what the group
        had between them. The Android app sums them the same way.
      */
      const total = state.heroes.reduce(
        (sum, hero) => sum + heroCounterOf(state, counter.id, hero.id),
        0,
      );
      out.push({ label, value: String(total) });
      continue;
    }

    out.push({ label, value: String(counterOf(state, counter.id)) });
  }

  return out;
}
