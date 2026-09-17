import { isFne } from './fearNoEvil';
import { liveQuery } from 'dexie';
import { db } from './db';
import { modularOverallKey, modularSubject, scenarioSubject } from './ratings';
import { summariesFor, type RatingSummary } from './ratingsApi';

/**
 * The averages a screen shows beside a choice, and the player's own beside
 * them.
 *
 * One object per screen: it is told which scenario and which sets are in
 * view, fetches the summaries for exactly those, and watches the player's own
 * ratings live. A drawn set is looked up first for *this* pairing and, when
 * that has nothing to show, for the set overall — the pairing is the better
 * signal when it exists, and the set alone is what there is otherwise.
 */
export class RatingsInView {
  summaries = $state.raw<ReadonlyMap<string, RatingSummary>>(new Map());
  own = $state.raw<ReadonlyMap<string, number>>(new Map());
  private stop: (() => void) | null = null;

  /** Refetches for a new scenario and its sets. Safe to call on every change. */
  async show(scenario: string | null, sets: readonly string[], storageOk: boolean): Promise<void> {
    this.stop?.();
    this.stop = null;
    // Fear No Evil played on its own names no set: nothing to ask for.
    if (scenario === null || scenario === '' || isFne(scenario)) {
      this.summaries = new Map();
      this.own = new Map();
      return;
    }
    const keys = [
      scenarioSubject(scenario).key,
      ...sets.map((code) => modularSubject(code, scenario).key),
      ...sets.map((code) => modularOverallKey(code)),
    ];
    if (storageOk) {
      const sub = liveQuery(() => db.ratings.bulkGet(keys)).subscribe((rows) => {
        this.own = new Map(rows.flatMap((row, i) => (row === undefined ? [] : [[keys[i] as string, row.score] as const])));
      });
      this.stop = () => sub.unsubscribe();
    }
    this.summaries = await summariesFor(keys);
  }

  /** The summary to show for a set drawn with the scenario in view. */
  forSet(scenario: string, code: string): RatingSummary | undefined {
    const paired = this.summaries.get(modularSubject(code, scenario).key);
    return paired?.mean !== undefined ? paired : this.summaries.get(modularOverallKey(code));
  }

  forScenario(scenario: string): RatingSummary | undefined {
    return this.summaries.get(scenarioSubject(scenario).key);
  }

  ownFor(key: string): number | null {
    return this.own.get(key) ?? null;
  }

  dispose(): void {
    this.stop?.();
    this.stop = null;
  }
}
