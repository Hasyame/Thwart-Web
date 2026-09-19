import type Dexie from 'dexie';
import { loadUiLocale } from '../preferences';
import { session } from './session.svelte';
import { runSync, sync } from './sync.svelte';

/**
 * Syncing without being asked.
 *
 * The first version synced at a handful of named moments -- a scenario
 * ended, a deck built -- on the reasoning that those are when somebody picks
 * up the other device. They are, and they were not enough: a deck *edited*
 * was not one of them, and the phone showed yesterday's list until somebody
 * pressed a button. So now every write to a synced table is a trigger, and
 * the named moments remain only as names for the settings screen. A settle
 * of two seconds turns a burst of writes into one request; the engine sends
 * only what changed, so a trigger with nothing behind it costs one small
 * round trip.
 *
 * The other direction is the live stream: the server tells every open
 * client about a change the moment it lands, so a deck built here is on the
 * phone before the hand leaves the mouse, provided the phone is open -- and
 * on its next foreground otherwise.
 *
 * **The preference is device-local and is never synced.** Two reasons, and
 * either alone would be enough:
 *
 * - The `settings` record is fixed at five keys by the contract with the
 *   Android app. A sixth would be dropped by the phone on its next write, so
 *   the toggle would silently turn itself off.
 * - It is a per-device answer anyway. A browser on a machine somebody else
 *   uses should not start reaching for the account because a phone said so.
 *
 * The matching triggers on Android are the same list, so the two ends agree on
 * *when* without having to agree on *whether*.
 */

/**
 * The moments worth syncing at.
 *
 * Named after what the person did, not after the table that changed, because
 * the names are the specification: the Android app fires on this same list and
 * the two have to be comparable by reading them.
 */
export type SyncTrigger =
  /** Any write to a synced table. The one that does the work; see `watchWrites`. */
  | 'edit'
  /** A scenario ended, campaign or not, so the game can be picked up elsewhere. */
  | 'scenario-end'
  /** A campaign reached its last scenario. */
  | 'campaign-end'
  /** Put away mid-game: the long break, which usually means another device. */
  | 'long-break'
  | 'deck-added'
  | 'collection-changed'
  | 'favourite-changed';

const KEY = 'thwart.autoSync';

/*
 * That a sync is owed, remembered across a reload.
 *
 * **There is no queue of writes here, and there does not need to be.** The
 * writes are already in IndexedDB the moment they happen, and the sync engine
 * works out what to send by comparing digests rather than by reading a dirty
 * flag — so the local database *is* the durable queue, and it survives a reload,
 * a crash and a flat battery without any help.
 *
 * What did not survive was the intention: record a game on a train, close the
 * tab, and nothing remembered that the account had not heard about it until
 * some later trigger happened to fire. One boolean fixes that, and building a
 * second queue beside the database would have been a second thing to keep in
 * step with it.
 */
const OWED_KEY = 'thwart.autoSync.owed';

function rememberOwed(value: boolean): void {
  try {
    if (value) {
      localStorage.setItem(OWED_KEY, '1');
    } else {
      localStorage.removeItem(OWED_KEY);
    }
  } catch {
    // No storage: the intention lives for this session only, which is what it
    // did before.
  }
}

function wasOwed(): boolean {
  try {
    return localStorage.getItem(OWED_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * How long to wait before going.
 *
 * Finishing a scenario in a campaign writes a play, advances the run, and
 * touches a deck, each of which is a trigger. Waiting a couple of seconds turns
 * those three into one request without being a delay anybody notices.
 */
const SETTLE_MS = 2_000;

/**
 * How long to wait before trying again after a failure.
 *
 * Once, and then it waits for the next trigger. A background action that keeps
 * retrying on its own is how a flaky network turns into a flat battery, and
 * the sync panel already shows the failure to anybody who looks.
 */
const RETRY_MS = 30_000;

/*
 * On unless switched off. It was off unless switched on, which meant every
 * new browser started by not syncing and nobody knew until a deck failed to
 * appear on the phone; the point of an account is that the devices agree
 * without being asked. Signing in is the consent.
 */
function stored(): boolean {
  try {
    return localStorage.getItem(KEY) !== 'off';
  } catch {
    // A browser that refuses storage cannot remember an answer; the default stands.
    return true;
  }
}

export const autoSync = $state<{
  enabled: boolean;
  /** What set the last run going, for the settings screen to name. */
  lastTrigger: SyncTrigger | null;
}>({ enabled: stored(), lastTrigger: null });

export function setAutoSync(enabled: boolean): void {
  autoSync.enabled = enabled;
  try {
    localStorage.setItem(KEY, enabled ? 'on' : 'off');
  } catch {
    // Nothing to do: the toggle still works for this session.
  }
  if (!enabled) {
    owed = false;
    rememberOwed(false);
    clear();
  }
}

let timer: ReturnType<typeof setTimeout> | null = null;
let running = false;
/** A trigger has fired and the sync it asked for has not happened yet. */
let owed = wasOwed();
let retried = false;

function clear(): void {
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
}

function schedule(delay: number): void {
  clear();
  timer = setTimeout(() => {
    timer = null;
    void flush();
  }, delay);
}

/**
 * Whether a sync would even be possible right now.
 *
 * Signed in, already adopted, and online. Adoption matters: the first sync on a
 * browser holding its own data is a merge that has to be shown and agreed to,
 * and firing that from a background trigger is precisely what the adoption flow
 * exists to prevent.
 */
function ready(): boolean {
  return (
    autoSync.enabled &&
    session.account !== null &&
    sync.adopted &&
    sync.enabled &&
    (typeof navigator === 'undefined' || navigator.onLine !== false)
  );
}

async function flush(): Promise<void> {
  if (!owed) {
    return;
  }
  if (running) {
    // Let the one in flight finish; what it misses, the next pass carries.
    schedule(SETTLE_MS);
    return;
  }
  const account = session.account;
  if (!ready() || account === null) {
    // Still owed. Coming back online, or the next trigger, will try again.
    return;
  }

  owed = false;
  rememberOwed(false);
  running = true;
  try {
    await runSync(account.token, loadUiLocale());
  } finally {
    running = false;
  }

  if (sync.phase.kind === 'failed') {
    owed = true;
    rememberOwed(true);
    if (!retried) {
      retried = true;
      schedule(RETRY_MS);
    }
  } else {
    retried = false;
  }
}

/**
 * Records that something worth syncing has happened.
 *
 * Deliberately returns nothing and never throws: every call site is a piece of
 * ordinary work — saving a game, ticking a pack — and none of them should fail
 * because the network did.
 */
export function syncAfter(trigger: SyncTrigger): void {
  if (!autoSync.enabled) {
    return;
  }
  autoSync.lastTrigger = trigger;
  owed = true;
  rememberOwed(true);
  retried = false;
  schedule(SETTLE_MS);
}

/*
 * Writes made by the sync itself -- a pull applied, an adoption, a refused
 * record dropped -- must not count as edits, or every pull would schedule a
 * push of nothing. The ports raise this around their own transactions.
 */
let remoteDepth = 0;

export async function asRemote<T>(work: () => Promise<T>): Promise<T> {
  remoteDepth += 1;
  try {
    return await work();
  } finally {
    remoteDepth -= 1;
  }
}

/**
 * Hooks every synced table so that any write is a trigger. Returns the
 * teardown. Dexie's hooks fire inside the transaction, synchronously; all
 * this does there is start a timer.
 */
export function watchWrites(tables: readonly Dexie.Table[]): () => void {
  const onWrite = (): void => {
    if (remoteDepth === 0) {
      syncAfter('edit');
    }
  };
  const offs = tables.flatMap((table) => {
    table.hook('creating', onWrite);
    table.hook('updating', onWrite);
    table.hook('deleting', onWrite);
    return [
      () => table.hook('creating').unsubscribe(onWrite),
      () => table.hook('updating').unsubscribe(onWrite),
      () => table.hook('deleting').unsubscribe(onWrite),
    ];
  });
  return () => {
    for (const off of offs) {
      off();
    }
  };
}

/**
 * Starts listening for the network coming back. Returns the teardown.
 *
 * A trigger that fired while offline stays owed, and this is what eventually
 * pays it: somebody records a game on a train and it goes up when they surface.
 */
export function watchAutoSync(): () => void {
  /*
    A sync owed from a previous visit is owed now.

    Scheduled rather than fired immediately: the app has just started, the
    session may still be loading, and the settle delay is what lets those
    finish first.
  */
  if (owed) {
    schedule(SETTLE_MS);
  }

  const wake = (): void => {
    if (owed) {
      schedule(SETTLE_MS);
    }
  };
  window.addEventListener('online', wake);
  return () => {
    window.removeEventListener('online', wake);
    clear();
  };
}
