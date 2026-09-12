import type { Locale } from '../types';
import { db } from '../db';
import { asRemote } from './auto.svelte';
import * as api from './api';
import type { Limits, OutgoingRecord, PullPage, PushResponse, PushResult, ServerRecord } from './api';
import { COLLECTIONS, collectionByName, type CollectionName } from './collections';
import { digestForPulled, isUnknown, KNOWN_COLLECTIONS, type LocalRow, type SyncPorts } from './engine';
import { LOCAL_ONLY_FIELDS } from './merge';
import { digestOf, SYNC_STATE_KEY, type SyncRecordState } from './state';
import type { AdoptionPlan } from './adoption';

/** The collections this build reads, as the cursor records them. */
const DECLARED_COLLECTIONS = [...KNOWN_COLLECTIONS].sort().join(',');

/**
 * The engine's world, made of IndexedDB and the network.
 *
 * Everything that decides anything lives in `engine.ts` and `merge.ts`, where it
 * can be asserted without a browser. This file is the part that cannot: it
 * reads tables, writes tables, and calls the API. Keeping it thin is the point —
 * a bug here is the expensive kind to find, so there is as little here as
 * possible and none of it chooses anything.
 */

/** Rows and their states, written together or not at all. */
/** The tables whose rows travel: what a write to counts as an edit worth syncing. */
export const SYNCED_TABLES = () => [
  db.appSettings,
  db.ownedPacks,
  db.excludedModularSets,
  db.excludedScenarios,
  db.favouriteCards,
  db.favouritePlays,
  db.ratings,
  db.decks,
  db.campaignRuns,
  db.campaignEvents,
  db.plays,
  db.randomizerHistory,
];

const TABLES = () => [
  db.appSettings,
  db.ownedPacks,
  db.excludedModularSets,
  db.excludedScenarios,
  db.favouriteCards,
  db.favouritePlays,
  db.ratings,
  db.decks,
  db.campaignRuns,
  db.campaignEvents,
  db.plays,
  db.randomizerHistory,
  db.syncRecords,
  db.syncState,
];

/**
 * Carries this device's own columns across a record arriving from elsewhere.
 *
 * `rowOf` builds a row from a body, and the body does not contain the campaign
 * timer columns — so a run that already exists here would have its recorded
 * time reset to zero by a sync that was only meant to rename it. Merged onto
 * the row that is already there rather than replacing it.
 */
function keepLocalColumns(
  collection: string,
  existing: Record<string, unknown> | undefined,
  incoming: Record<string, unknown>,
): Record<string, unknown> {
  const keep = LOCAL_ONLY_FIELDS[collection];
  if (keep === undefined || existing === undefined) {
    return incoming;
  }
  const out = { ...incoming };
  for (const field of keep) {
    if (field in existing) {
      out[field] = existing[field];
    }
  }
  return out;
}

export function dexiePorts(token: string, locale: Locale): SyncPorts {
  return {
    async readLocal(): Promise<readonly LocalRow[]> {
      const out: LocalRow[] = [];
      for (const collection of COLLECTIONS) {
        const rows = await collection.table().toArray();
        for (const row of rows) {
          out.push({
            collection: collection.name as CollectionName,
            id: collection.idOf(row),
            body: collection.bodyOf(row),
            updatedAt: collection.updatedAt(row),
          });
        }
      }
      return out;
    },

    readStates: () => db.syncRecords.toArray(),

    /**
     * One transaction for the whole page.
     *
     * A browser closed halfway through must not leave a row written with no
     * state beside it: that row would hash differently from nothing, look
     * edited on the next scan, and be pushed straight back over the record it
     * had just arrived from.
     */
    async applyPulled(changes: readonly ServerRecord[]): Promise<void> {
      const usable = changes.filter((record) => !isUnknown(record));
      if (usable.length === 0) {
        return;
      }
      await asRemote(() => db.transaction('rw', TABLES(), async () => {
        for (const record of usable) {
          const mapping = collectionByName(record.collection);
          if (mapping === undefined) {
            continue;
          }
          const table = mapping.table();

          if (record.deleted || record.body === null) {
            await table.delete(record.id);
            // The state goes with it. Keeping one would make this a deletion
            // this device owes the server on its very next scan, for ever.
            await db.syncRecords.delete([record.collection, record.id]);
            continue;
          }

          /*
            Already applied at this revision or a later one: nothing to do.

            A pull from zero on a browser that has data — the set of
            collections it reads has grown — sends every record again. Without
            this, a row edited here since would be put back to the server's
            older body and the edit lost, whereas an ordinary pull would never
            have re-sent a revision below the cursor.
          */
          const known = await db.syncRecords.get([record.collection, record.id]);
          if (known !== undefined && known.revision >= record.revision) {
            continue;
          }

          const existing = (await table.get(record.id)) as Record<string, unknown> | undefined;
          const row = keepLocalColumns(
            record.collection,
            existing,
            mapping.rowOf(record.id, record.body) as Record<string, unknown>,
          );
          await table.put(row);
          await db.syncRecords.put({
            collection: record.collection,
            id: record.id,
            revision: record.revision,
            // Of the body after the round trip, not off the wire: this build
            // may drop a field a newer one sent, and recording what the row
            // will actually hash to is what stops it bouncing back stripped.
            digest: digestForPulled(record),
          });
        }
      }));
    },

    /**
     * Records stay dirty until the server names them.
     *
     * Matched by id rather than by position: a response that omits a record is
     * a record this device still owes, and assuming the order lines up would
     * mark it clean on the strength of somebody else's result.
     */
    async confirmPushed(
      records: readonly OutgoingRecord[],
      results: readonly PushResult[],
    ): Promise<void> {
      const sent = new Map(records.map((record) => [`${record.collection} ${record.id}`, record]));
      await asRemote(() => db.transaction('rw', [...TABLES(), db.syncRecords], async () => {
        for (const result of results) {
          const key = `${result.collection} ${result.id}`;
          const record = sent.get(key);
          if (record === undefined) {
            continue;
          }
          if (record.deleted) {
            await db.syncRecords.delete([result.collection, result.id]);
            continue;
          }
          /*
            Refused. Not stored on the server and never will be, so the only
            state that is not a lie is none: the row goes, and its bookkeeping
            with it, so nothing tries to send it again. Marking it synced here
            — which is what every other outcome gets — would leave this browser
            showing a rating that does not exist, permanently.
          */
          if (result.outcome === 'rejected') {
            await collectionByName(result.collection)?.table().delete(result.id);
            await db.syncRecords.delete([result.collection, result.id]);
            continue;
          }
          await db.syncRecords.put({
            collection: result.collection,
            id: result.id,
            revision: result.revision,
            digest: digestOf(record.body),
          });
        }
      }));
    },

    async readCursor(): Promise<number> {
      const state = await db.syncState.get(SYNC_STATE_KEY);
      // A cursor read with another set of collections is a position among
      // records this build did not ask for; from zero, once, is the only
      // cursor that means the same thing to both.
      if (state === undefined || state.collections !== DECLARED_COLLECTIONS) {
        return 0;
      }
      return state.cursor;
    },

    async writeCursor(cursor: number): Promise<void> {
      const state = await db.syncState.get(SYNC_STATE_KEY);
      if (state === undefined) {
        return;
      }
      await db.syncState.put({
        ...state,
        cursor,
        collections: DECLARED_COLLECTIONS,
        lastSyncedAt: Date.now(),
      });
    },

    pull: (since: number, limit: number, resync: boolean): Promise<PullPage> =>
      api.pull(token, since, limit, [...KNOWN_COLLECTIONS], locale, undefined, resync),

    push: (batchId: string, records: readonly OutgoingRecord[]): Promise<PushResponse> =>
      api.push(token, batchId, records, locale),

    async limits(): Promise<Limits> {
      const version = await api.version(locale);
      return version.limits;
    },

    newBatchId: () => crypto.randomUUID(),
    now: () => new Date().toISOString(),
  };
}

/** Kept for the adoption flow, which reads states without running a sync. */
export const readSyncStates = (): Promise<SyncRecordState[]> => db.syncRecords.toArray();

/**
 * Everything the account holds, read into memory and written nowhere.
 *
 * The staging half of adoption. It is a full pull from revision zero, so every
 * page carries `resync=1` — including the pages after the first, which is where
 * the server used to refuse a large account and leave it unable to sync at all.
 *
 * Held in memory deliberately: nothing may touch the live tables until somebody
 * has been shown what the merge would do and said yes to it.
 */
export async function stageAccount(
  token: string,
  locale: Locale,
  limits: Limits,
): Promise<{ readonly records: readonly ServerRecord[]; readonly cursor: number }> {
  const records: ServerRecord[] = [];
  let cursor = 0;
  for (;;) {
    const page = await api.pull(token, cursor, limits.pageSize, [...KNOWN_COLLECTIONS], locale, undefined, true);
    records.push(...page.changes);
    cursor = page.cursor;
    if (!page.hasMore) {
      return { records, cursor };
    }
  }
}

/**
 * Carries out an adoption that has been agreed to.
 *
 * One transaction over every table. A browser closed halfway must leave either
 * the whole merge or none of it: a partial one would be a set of rows with no
 * states beside them, which the next scan would read as edits and upload over
 * the account they had just come from.
 *
 * The cursor is written last and only here. Until it moves, this browser has
 * read nothing, which is the correct thing for it to believe if any of the
 * above failed.
 */
export async function applyAdoption(plan: AdoptionPlan, cursor: number): Promise<void> {
  await asRemote(() => db.transaction('rw', TABLES(), async () => {
    for (const write of plan.writes) {
      const mapping = collectionByName(write.collection);
      if (mapping === undefined) {
        continue;
      }
      const table = mapping.table();
      await table.put(write.row as never);
      await db.syncRecords.put({
        collection: write.collection,
        id: write.id,
        revision: write.revision,
        digest: write.digest,
      });
      if (write.forked !== undefined) {
        // The fork is new to the account, so it gets a row and deliberately no
        // state: the next scan finds it unknown and uploads it as its own deck.
        await table.put(write.forked.row as never);
      }
    }

    const state = await db.syncState.get(SYNC_STATE_KEY);
    if (state !== undefined) {
      await db.syncState.put({
        ...state,
        cursor,
        collections: DECLARED_COLLECTIONS,
        lastSyncedAt: Date.now(),
      });
    }
  }));
}
