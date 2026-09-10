import { loadUiLocale } from '../preferences';
import { session } from './session.svelte';
import { runSync, sync } from './sync.svelte';

/**
 * Syncing without being asked, at the moments where it matters.
 *
 * The point is not to sync often. It is to sync at the handful of moments
 * where somebody is about to pick the other device up: a scenario has just
 * ended, a campaign is finished, a game has been put away for the evening, a
 * deck has just been built. Syncing on a timer would move the same data and
 * still miss those moments, because the one that counts is always the last one
 * before the screen goes dark.
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

function stored(): boolean {
  try {
    return localStorage.getItem(KEY) === 'on';
  } catch {
    // A browser that refuses storage cannot remember an answer, so it has none.
    return false;
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

  if (sync.phase.kind === 'failed' && !retried) {
    retried = true;
    owed = true;
    rememberOwed(true);
    schedule(RETRY_MS);
  } else if (sync.phase.kind !== 'failed') {
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
