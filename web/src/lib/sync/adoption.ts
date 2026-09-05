import type { ServerRecord } from './api';
import { collectionByName } from './collections';
import { digestForPulled, type LocalRow } from './engine';
import { mergeBodies, type Body } from './merge';

/**
 * Signing in on a browser that already holds data.
 *
 * The one flow it is unforgivable to get wrong: somebody's two years of play
 * history either duplicated or gone. So it is a **merge, never a replace**, and
 * it is counted and confirmed before a single row is written.
 *
 * The shape is deliberate. `planAdoption` is pure — it takes what is here and
 * what the account holds and returns the writes it would make, without making
 * any — so the counts a person is shown are computed by the same code that will
 * do the work, rather than by a second implementation that can disagree with it.
 * A dialogue that promises one thing and does another is worse than no dialogue.
 */

export interface AdoptionWrite {
  readonly collection: string;
  readonly id: string;
  /** The row to store, already merged. */
  readonly row: Record<string, unknown>;
  /** What the server called this record, so an edit knows what it is editing. */
  readonly revision: number;
  /**
   * The digest of the body **the server holds**, not of the row being written.
   *
   * That difference is the whole mechanism. Where the merge kept the server's
   * record the two match and the row is clean; where the merge kept something
   * of this browser's, the row hashes differently from the state beside it,
   * which is precisely what marks it as owed and uploads it — with the right
   * baseRevision, because the state carries it.
   */
  readonly digest: string;
  /** A deck the merge could not reconcile, re-keyed so both survive. */
  readonly forked?: { readonly id: string; readonly row: Record<string, unknown> };
}

export interface CollectionTally {
  readonly collection: string;
  /** On the account and not here: these arrive. */
  readonly incoming: number;
  /** Here and not on the account: these upload. */
  readonly local: number;
  /** On both, and not the same: these merge. */
  readonly merged: number;
  /** On both and identical: nothing happens. */
  readonly same: number;
}

export interface AdoptionPlan {
  readonly writes: readonly AdoptionWrite[];
  readonly tallies: readonly CollectionTally[];
  readonly incoming: number;
  readonly local: number;
  readonly merged: number;
  /** Decks the merge had to fork, which is the one outcome worth naming. */
  readonly forks: number;
  /** Every record the account holds, for "this account has N plays". */
  readonly accountTotals: Readonly<Record<string, number>>;
}

const keyOf = (collection: string, id: string): string => `${collection} ${id}`;

/**
 * What adopting this account would do, without doing any of it.
 *
 * `local` is every row on this browser, mapped through its collection.
 * `staged` is a full pull from revision zero, held in memory and not written.
 */
export function planAdoption(
  local: readonly LocalRow[],
  staged: readonly ServerRecord[],
  options: { readonly newId?: () => string; readonly forkSuffix?: string } = {},
): AdoptionPlan {
  const localByKey = new Map(local.map((row) => [keyOf(row.collection, row.id), row]));
  const seen = new Set<string>();

  const writes: AdoptionWrite[] = [];
  const tally = new Map<string, { incoming: number; local: number; merged: number; same: number }>();
  const accountTotals: Record<string, number> = {};
  let forks = 0;

  const bucket = (collection: string) => {
    const existing = tally.get(collection);
    if (existing !== undefined) {
      return existing;
    }
    const fresh = { incoming: 0, local: 0, merged: 0, same: 0 };
    tally.set(collection, fresh);
    return fresh;
  };

  for (const record of staged) {
    const mapping = collectionByName(record.collection);
    if (mapping === undefined) {
      // A collection this build has never heard of. Skipped without a state, so
      // a later build picks it up rather than believing it already applied it.
      continue;
    }
    // A tombstone describes a record that is already absent from a browser that
    // has never synced. Nothing to delete, and nothing to count.
    if (record.deleted || record.body === null) {
      continue;
    }

    accountTotals[record.collection] = (accountTotals[record.collection] ?? 0) + 1;

    const key = keyOf(record.collection, record.id);
    seen.add(key);
    const here = localByKey.get(key);
    const counts = bucket(record.collection);
    const digest = digestForPulled(record);

    if (here === undefined) {
      counts.incoming += 1;
      writes.push({
        collection: record.collection,
        id: record.id,
        row: mapping.rowOf(record.id, record.body) as Record<string, unknown>,
        revision: record.revision,
        digest,
      });
      continue;
    }

    /*
     * Both sides have it. Identical content is the common case, and it needs a
     * state written and nothing else: without one the row looks like an edit
     * this browser owes and is uploaded straight back.
     *
     * Both sides are hashed through the same round trip through the collection,
     * or they are not comparable at all — one would carry a field this build
     * drops and the other would not, and every record would read as a conflict.
     */
    if (digestOfBody(here.body, record) === digest) {
      counts.same += 1;
      writes.push({
        collection: record.collection,
        id: record.id,
        row: mapping.rowOf(record.id, record.body) as Record<string, unknown>,
        revision: record.revision,
        digest,
      });
      continue;
    }

    counts.merged += 1;
    const decision = mergeBodies(record.collection, here.body, record.body as Body, {
      firstMerge: true,
      newId: options.newId,
      forkSuffix: options.forkSuffix,
    });

    const write: AdoptionWrite = {
      collection: record.collection,
      id: record.id,
      row: mapping.rowOf(record.id, decision.body) as Record<string, unknown>,
      revision: record.revision,
      digest,
    };

    if (decision.kind === 'fork') {
      forks += 1;
      writes.push({
        ...write,
        forked: {
          id: decision.forkedId,
          row: mapping.rowOf(decision.forkedId, decision.forkedBody) as Record<string, unknown>,
        },
      });
      continue;
    }
    writes.push(write);
  }

  for (const row of local) {
    if (seen.has(keyOf(row.collection, row.id))) {
      continue;
    }
    // Here and nowhere else. Nothing is written: with no state beside it the
    // very next scan sees an unknown record and uploads it, which is the whole
    // of "adopt". Counted so the reader is told it will happen.
    bucket(row.collection).local += 1;
  }

  const tallies = [...tally.entries()]
    .map(([collection, counts]) => ({ collection, ...counts }))
    .filter((entry) => entry.incoming + entry.local + entry.merged > 0)
    .sort((a, b) => b.incoming + b.local + b.merged - (a.incoming + a.local + a.merged));

  return {
    writes,
    tallies,
    incoming: tallies.reduce((sum, entry) => sum + entry.incoming, 0),
    local: tallies.reduce((sum, entry) => sum + entry.local, 0),
    merged: tallies.reduce((sum, entry) => sum + entry.merged, 0),
    forks,
    accountTotals,
  };
}

/**
 * The digest of what this browser holds, expressed through the same round trip
 * the server's copy goes through, so the two are comparable at all.
 */
function digestOfBody(body: Body, like: ServerRecord): string {
  return digestForPulled({ ...like, body });
}
