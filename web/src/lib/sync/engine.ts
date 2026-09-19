import type { Limits, OutgoingRecord, PullPage, PushResponse, PushResult, ServerRecord } from './api';
import { FALLBACK_LIMITS } from './api';
import type { CollectionName } from './collections';
import { COLLECTIONS, collectionByName } from './collections';
import { digestOf, type SyncRecordState } from './state';

/**
 * Pull, merge, push.
 *
 * Everything here takes its world as an argument. The decisions are pure
 * functions over plain data — what is dirty, how a page applies, where the
 * cursor may move to — and the parts that touch IndexedDB and the network sit
 * behind {@link SyncPorts}. That is not architecture for its own sake: this is
 * the code that can lose somebody's campaign log, and the only way to assert
 * what it does in the cases that matter (a batch that fails halfway, a device
 * that writes while this one is pushing, a body that does not survive a round
 * trip) is to be able to construct those cases without a browser.
 *
 * What this file deliberately does **not** do is adopt. Signing in on a browser
 * that already holds data is a merge that has to be counted and confirmed
 * before anything is written, and it belongs in its own flow rather than
 * happening as a side effect of the first sync.
 */

// --- what the engine needs from the world ------------------------------------

/** One row as it currently exists locally, already mapped to its body. */
export interface LocalRow {
  readonly collection: CollectionName;
  readonly id: string;
  readonly body: Record<string, unknown>;
  readonly updatedAt: string;
}

export interface SyncPorts {
  /** Every row in every synced collection, mapped through the collection. */
  readonly readLocal: () => Promise<readonly LocalRow[]>;
  /** What the server last confirmed, for every record it has confirmed. */
  readonly readStates: () => Promise<readonly SyncRecordState[]>;
  /**
   * Write a pulled page into the local tables and record the new states, in
   * one transaction.
   *
   * One call rather than two so a browser closed mid-apply cannot leave a row
   * written with no state beside it, which would make it look edited and push
   * straight back.
   */
  readonly applyPulled: (changes: readonly ServerRecord[]) => Promise<void>;
  /** Record what the server said about records this browser pushed. */
  readonly confirmPushed: (
    records: readonly OutgoingRecord[],
    results: readonly PushResult[],
  ) => Promise<void>;
  readonly readCursor: () => Promise<number>;
  readonly writeCursor: (cursor: number) => Promise<void>;
  /** The transport, narrowed to what the engine uses. */
  readonly pull: (since: number, limit: number, resync: boolean) => Promise<PullPage>;
  readonly push: (batchId: string, records: readonly OutgoingRecord[]) => Promise<PushResponse>;
  readonly limits: () => Promise<Limits>;
  /** Injected so a test can make ids and timestamps predictable. */
  readonly newBatchId: () => string;
  readonly now: () => string;
}

export interface SyncOutcome {
  readonly pulled: number;
  readonly pushed: number;
  readonly cursor: number;
  /** Records the server applied over a revision this browser had not seen. */
  readonly conflicts: number;
  /**
   * Records the server refused and this browser has dropped.

   * Each is gone from its table by the time this is read: the engine's ports
   * delete them on confirmation. Reported so the screen can say so once.
   */
  readonly rejected: readonly RejectedRecord[];
  /** Set when the run stopped early. The remaining work is still pending. */
  readonly stoppedBecause?: 'push_failed' | 'cursor_too_old';
}

// --- deciding what to send ----------------------------------------------------

const keyOf = (collection: string, id: string): string => `${collection}\u0000${id}`;

/**
 * The records this browser owes the server.
 *
 * There is no dirty flag anywhere in this app. A row counts as changed when its
 * body hashes differently from the digest the server confirmed, which no write
 * can forget to set, and a state with no row beside it is a deletion. The cost
 * of that is one scan; the benefit is that the two dozen places which write
 * rows need to know nothing about sync.
 */
export function pendingChanges(
  local: readonly LocalRow[],
  states: readonly SyncRecordState[],
  now: string,
): OutgoingRecord[] {
  const byKey = new Map(states.map((state) => [keyOf(state.collection, state.id), state]));
  const seen = new Set<string>();
  const out: OutgoingRecord[] = [];

  for (const row of local) {
    const key = keyOf(row.collection, row.id);
    seen.add(key);
    const state = byKey.get(key);
    if (state !== undefined && state.digest === digestOf(row.body)) {
      continue;
    }
    out.push({
      collection: row.collection,
      id: row.id,
      updatedAt: row.updatedAt,
      deleted: false,
      body: row.body,
      // Absent when the server has never seen this record. Present otherwise,
      // so the server can tell an ordinary edit from one written over a
      // revision this browser never read.
      ...(state === undefined ? {} : { baseRevision: state.revision }),
    });
  }

  for (const state of states) {
    const key = keyOf(state.collection, state.id);
    if (seen.has(key)) {
      continue;
    }
    /*
     * A confirmed record with no row beside it has been deleted here — unless
     * the collection is append-only, where it is never a deletion and this
     * refuses to treat it as one.
     *
     * Only campaign_events is append-only, and it is the one collection where
     * a false tombstone is unrecoverable: it would erase somebody's play
     * history on every device they own, from a bug they could not have seen
     * coming. The app never deletes an event — undo appends a revocation — so
     * a missing one is a local accident rather than an instruction, and the
     * cost of ignoring it is some orphaned rows on a server that charges
     * nothing for them.
     */
    if (collectionByName(state.collection)?.appendOnly === true) {
      continue;
    }
    out.push({
      collection: state.collection,
      id: state.id,
      updatedAt: now,
      deleted: true,
      body: null,
      baseRevision: state.revision,
    });
  }

  return out;
}

/**
 * Split into batches the server will accept.
 *
 * Both published limits, because either can bite first: five hundred tiny
 * favourites hit the count, and one campaign with a long log hits the bytes.
 * A single record larger than the whole batch budget still goes on its own —
 * the server will refuse it, and refusing loudly is better than this quietly
 * dropping it from every future run.
 */
export function batchesOf(
  records: readonly OutgoingRecord[],
  limits: Limits,
): OutgoingRecord[][] {
  const batches: OutgoingRecord[][] = [];
  let batch: OutgoingRecord[] = [];
  let bytes = 0;

  for (const record of records) {
    const size = new TextEncoder().encode(JSON.stringify(record)).byteLength;
    const full = batch.length >= limits.batchRecords || (batch.length > 0 && bytes + size > limits.batchBytes);
    if (full) {
      batches.push(batch);
      batch = [];
      bytes = 0;
    }
    batch.push(record);
    bytes += size;
  }
  if (batch.length > 0) {
    batches.push(batch);
  }
  return batches;
}

/**
 * Where the read cursor may move to after this browser's own push.
 *
 * A push creates revisions above the cursor, and the cursor cannot tell they
 * are its own: without this, every sync re-reads everything it just sent. The
 * Android client hit exactly that and pulled all 116 of its records straight
 * back down.
 *
 * It steps past them only while they are contiguous from where it stood. A gap
 * means another device wrote in between, and skipping that revision would lose
 * their record for good — so the walk stops at the gap and the next pull reads
 * from there, which costs re-reading a few of this browser's own records and
 * loses nothing.
 */
export interface RejectedRecord {
  readonly collection: string;
  readonly id: string;
  readonly reason: string;
}

export function cursorAfterPush(cursor: number, results: readonly PushResult[]): number {
  // A rejected record has no revision — the server spent none — and must not
  // stop the walk, or one refused rating would make the next pull re-read the
  // whole batch beside it.
  const revisions = results
    .filter((result) => result.outcome !== 'rejected')
    .map((result) => result.revision)
    .sort((a, b) => a - b);
  let next = cursor;
  for (const revision of revisions) {
    if (revision !== next + 1) {
      break;
    }
    next = revision;
  }
  return next;
}

/**
 * The digest to record for a body that has just arrived from the server.
 *
 * Taken from the body **after a round trip through the collection**, not from
 * the body as it came off the wire. The two differ whenever `rowOf` and
 * `bodyOf` are not exact inverses — a defaulted field, a number arriving as a
 * string — and the consequence is not a wrong digest but an infinite one: the
 * row is stored, hashes differently from what was recorded, looks edited, gets
 * pushed back, comes down again. Recording what the row will actually hash to
 * makes that impossible rather than unlikely.
 */
export function digestForPulled(record: ServerRecord): string {
  if (record.deleted || record.body === null) {
    return digestOf(null);
  }
  const mapping = collectionByName(record.collection);
  if (mapping === undefined) {
    return digestOf(record.body);
  }
  return digestOf(mapping.bodyOf(mapping.rowOf(record.id, record.body)));
}

/** Collections this build knows how to store. */
export const KNOWN_COLLECTIONS: ReadonlySet<string> = new Set(
  COLLECTIONS.map((collection) => collection.name),
);

/**
 * A record for a collection this build has never heard of.
 *
 * The Android app may ship a collection before this one learns to read it, and
 * the server stores bodies it never parses, so this will happen. Such records
 * are skipped rather than guessed at, and skipped **without** recording a
 * state, so that a later build picks them up on its next pull instead of
 * treating them as already applied.
 */
export const isUnknown = (record: ServerRecord): boolean =>
  !KNOWN_COLLECTIONS.has(record.collection);

// --- the run -------------------------------------------------------------------

/**
 * One synchronisation: read everything new, then send everything owed.
 *
 * Pull first, deliberately. Sending first would push a stale edit over a newer
 * one and only then discover it, whereas pulling first gives the local side a
 * chance to be current before it argues.
 */
export async function syncOnce(ports: SyncPorts): Promise<SyncOutcome> {
  const limits = await ports.limits().catch(() => FALLBACK_LIMITS);

  let cursor = await ports.readCursor();
  let pulled = 0;

  // A resync is a pull from zero, and every page of it carries the flag —
  // including the ones after the first, which is where this used to fail.
  const resync = cursor === 0;

  for (;;) {
    const page = await ports.pull(cursor, limits.pageSize, resync);
    if (page.changes.length > 0) {
      await ports.applyPulled(page.changes.filter((record) => !isUnknown(record)));
      pulled += page.changes.length;
    }
    cursor = page.cursor;
    await ports.writeCursor(cursor);
    if (!page.hasMore) {
      break;
    }
  }

  const local = await ports.readLocal();
  const states = await ports.readStates();
  const owed = pendingChanges(local, states, ports.now());

  let pushed = 0;
  let conflicts = 0;
  const rejected: RejectedRecord[] = [];

  /*
   * One batch at a time, in order, never in parallel.
   *
   * Two in flight can interleave two edits of the same record and land them in
   * an order this browser did not intend. And a batch that fails stops the
   * run: the next batch may depend on it, and the commonest real failure is
   * not a refusal but a lost response on a flaky connection — where the write
   * did land. A failed run leaves records dirty. The next run pulls first to
   * discover accepted writes, then builds new batches for what remains.
   */
  for (const batch of batchesOf(owed, limits)) {
    const batchId = ports.newBatchId();
    let response: PushResponse;
    try {
      response = await ports.push(batchId, batch);
    } catch {
      return { pulled, pushed, cursor, conflicts, rejected, stoppedBecause: 'push_failed' };
    }
    await ports.confirmPushed(batch, response.results);
    pushed += response.results.length;
    for (const result of response.results) {
      if (result.outcome === 'rejected') {
        rejected.push({ collection: result.collection, id: result.id, reason: result.reason ?? 'rejected' });
      }
    }
    conflicts += response.results.filter(
      (result) => result.outcome === 'applied_over_conflict',
    ).length;

    const advanced = cursorAfterPush(cursor, response.results);
    if (advanced !== cursor) {
      cursor = advanced;
      await ports.writeCursor(cursor);
    }
  }

  return { pulled, pushed, cursor, conflicts, rejected };
}
