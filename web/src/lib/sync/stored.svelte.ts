import { liveQuery } from 'dexie';
import { db } from '../db';

/**
 * Which rows the server has, and which exist only here.
 *
 * Once an account is signed in, the same list can hold both: games recorded
 * before signing in and never uploaded, and games the account holds and would
 * get back on any device. Those two look identical, and they behave completely
 * differently — signing out keeps the first and takes the second — so the
 * difference has to be visible rather than inferred.
 *
 * Read from `syncRecords`, which is the honest answer and needs nothing new
 * stored. That table holds one row per record the server has acknowledged,
 * keyed `[collection+id]`; a record with no row there has never reached the
 * server, whatever else is true. It is also what sync itself consults, so the
 * badge cannot disagree with the behaviour.
 *
 * Shown only while signed in. Signed out, everything is local and a badge on
 * every row would say nothing.
 */

export const storedOnServer = $state<{
  plays: Set<string>;
  campaigns: Set<string>;
  loaded: boolean;
}>({ plays: new Set(), campaigns: new Set(), loaded: false });

/** The collection names are the Android app's. See lib/sync/collections.ts. */
const PLAYS = 'plays';
const CAMPAIGN_RUNS = 'campaign_runs';

/** Subscribes for the life of the app. Returns the unsubscribe. */
export function watchStoredOnServer(): () => void {
  const subscription = liveQuery(() =>
    db.syncRecords.where('collection').anyOf([PLAYS, CAMPAIGN_RUNS]).toArray(),
  ).subscribe(
    (rows) => {
      const plays = new Set<string>();
      const campaigns = new Set<string>();
      for (const row of rows) {
        if (row.collection === PLAYS) {
          plays.add(row.id);
        } else if (row.collection === CAMPAIGN_RUNS) {
          campaigns.add(row.id);
        }
      }
      storedOnServer.plays = plays;
      storedOnServer.campaigns = campaigns;
      storedOnServer.loaded = true;
    },
    () => {
      // No storage, or the table will not open. Say nothing rather than
      // labelling every row wrongly: a badge that lies about where somebody's
      // campaign is stored is worse than no badge.
      storedOnServer.loaded = false;
    },
  );
  return () => subscription.unsubscribe();
}
