import { db } from '../db';
import { COLLECTIONS, SETTINGS } from './collections';
import { digestOf } from './state';

/**
 * Whose data is on this machine, and what signing out takes with it.
 *
 * The rule, in the operator's words: an account's games, decks and campaigns
 * are the account's, they live on the server, and they come back by signing in.
 * What somebody made on this browser belongs to the browser and stays.
 *
 * John plays without an account and records games A and B and a campaign. He
 * signs in, plays C and D, runs three more campaigns, and signs out: A, B and
 * the campaign remain and the account's do not. He signs back in and they
 * return. Somebody else signing in on the same machine sees A, B and the
 * campaign — the machine's — and never John's.
 *
 * **Unless he chose to sync them.** Turning sync on offers to upload what is
 * already here, and agreeing is the moment A, B and the campaign stop being the
 * machine's and become his. After that, signing out takes them too, because
 * they are on the server now.
 *
 * # Only what the server can give back
 *
 * A row is removed if, and only if, the server holds a copy identical to this
 * one. Nothing else is touched. That single rule produces every case above
 * without needing to remember anything:
 *
 *   - A, B and the campaign, made before signing in and never uploaded: the
 *     server has no copy, so they stay.
 *   - The same rows once adoption has uploaded them: the server has them, so
 *     they go, and signing in brings them back.
 *   - C and D, made while signed in and synced: the server has them, so they go.
 *   - C and D **made while signed in and never synced** — signing in and turning
 *     sync on are separate acts here, so this is an ordinary situation, not an
 *     edge case. The server has no copy. They stay. Deleting them would destroy
 *     somebody's evening with no way to get it back, which is a far worse
 *     failure than the one this is preventing.
 *   - A row edited since it was last pushed: the digests differ, so the copy on
 *     the server is not this row. It stays, edits and all.
 *
 * `syncRecords` is the authority, because it is already the authority: the sync
 * engine decides what to push by comparing exactly these digests. The badges on
 * games and campaigns read the same table, so what a row says about itself and
 * what happens to it cannot disagree.
 */

export const key = (collection: string, id: string): string => `${collection} ${id}`;

/**
 * Which of a collection's rows the account holds, and which are this device's.
 *
 * Pure and exported, so the rule can be tested without a database. It is the
 * whole of the policy; everything around it is reading tables and deleting
 * rows.
 */
export interface Partitionable<Row> {
  readonly name: string;
  readonly idOf: (row: Row) => string;
  readonly bodyOf: (row: Row) => Record<string, unknown>;
}

export function partition<Row>(
  collection: Partitionable<Row>,
  rows: readonly Row[],
  onServer: ReadonlyMap<string, string>,
): { readonly release: string[]; readonly keep: string[] } {
  const release: string[] = [];
  const keep: string[] = [];
  for (const row of rows) {
    const id = collection.idOf(row);
    const theirs = onServer.get(key(collection.name, id));
    if (theirs !== undefined && theirs === digestOf(collection.bodyOf(row))) {
      release.push(id);
    } else {
      keep.push(id);
    }
  }
  return { release, keep };
}

export interface ReleaseOutcome {
  readonly removed: number;
  readonly kept: number;
}

/**
 * Removes the rows the account holds, and leaves everything else.
 *
 * Called on sign-out, before the session and the per-record revisions are
 * cleared, because it needs both.
 */
export async function releaseAccountData(): Promise<ReleaseOutcome> {
  const onServer = new Map<string, string>();
  for (const state of await db.syncRecords.toArray()) {
    onServer.set(key(state.collection, state.id), state.digest);
  }

  // No bookkeeping means this browser never synced anything, so nothing here
  // came from an account and nothing may be removed.
  if (onServer.size === 0) {
    return { removed: 0, kept: 0 };
  }

  let removed = 0;
  let kept = 0;

  await db.transaction('rw', db.tables, async () => {
    for (const collection of COLLECTIONS) {
      /*
        Preferences are left alone on purpose.

        `settings` is one record and it is as much this device's as the
        account's: the card language, the play location, whether the tracker is
        shown. Clearing it would reset the browser rather than release somebody
        else's data, and the next sync overwrites it anyway.
      */
      if (collection.name === SETTINGS.name) {
        continue;
      }

      const table = collection.table();
      const decided = partition(collection, await table.toArray(), onServer);
      kept += decided.keep.length;

      if (decided.release.length > 0) {
        await table.bulkDelete(decided.release);
        removed += decided.release.length;
      }
    }
  });

  return { removed, kept };
}
