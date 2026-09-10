import { loadUiLocale } from '../preferences';
import { session } from './session.svelte';
import { runSync, sync } from './sync.svelte';

/**
 * Learning about a change the moment it happens somewhere else.
 *
 * # The rule everything here follows
 *
 * **The stream is an optimisation over the pull endpoint and never a source of
 * truth.** It carries a revision number; receiving one means "there is
 * something to fetch", and the fetching is the ordinary sync that already
 * exists. So every failure mode here — a dropped connection, a proxy that
 * buffers, a browser that suspends a background tab, the whole feature being
 * switched off — produces data that is *stale*, never data that is *wrong*.
 *
 * That is also why there is no queue of events to replay and no ordering to
 * preserve. Two events that arrive out of order do the same thing as one.
 *
 * # One connection per browser, not per tab
 *
 * Four open tabs holding four streams is four sockets, four upstream
 * connections and four times the fan-out for the same person. A lock decides
 * which tab holds it. The others do nothing at all: the leader applies changes
 * to IndexedDB and every tab's `liveQuery` observes the write, so followers
 * re-render without hearing anything.
 *
 * The Web Locks API does the election. Holding a lock for the tab's lifetime
 * means the browser releases it when the tab closes, crashes or is discarded —
 * no heartbeat, no lease, no stale leader to detect. Where it is missing, every
 * tab connects: wasteful and correct, which is the right way round.
 */

export type LiveState = 'off' | 'connecting' | 'live' | 'offline';

export const live = $state<{
  /** What to show, if anything. See the connection indicator. */
  state: LiveState;
  /** Changes this browser has seen arrive from elsewhere, for the tests. */
  received: number;
  /** True while this tab is the one holding the connection. */
  leading: boolean;
}>({ state: 'off', received: 0, leading: false });

const LOCK = 'thwart-live-sync';
const CHANNEL = 'thwart-live-sync';

/**
 * How long to wait before reconnecting, in milliseconds.
 *
 * Exponential with full jitter. The jitter matters more than the growth: when a
 * server restarts, every client that was connected reconnects at once, and a
 * fixed backoff would have them all arrive together — repeatedly. Randomising
 * the whole interval spreads them out.
 *
 * Capped at half a minute. This is a companion app; nobody is waiting on a
 * push, and a client that has been retrying for an hour should not be hammering
 * a server that may be down for maintenance.
 */
const BASE_DELAY = 1_000;
const MAX_DELAY = 30_000;

function delayFor(attempt: number): number {
  const ceiling = Math.min(MAX_DELAY, BASE_DELAY * 2 ** Math.min(attempt, 6));
  return Math.random() * ceiling;
}

let stop: (() => void) | null = null;

/**
 * Starts listening, if there is an account to listen for.
 *
 * Returns the teardown. Safe to call when signed out, when storage is
 * unavailable, and in a browser with none of the APIs this uses: each of those
 * leaves the state `off` and does nothing.
 */
export function watchLive(): () => void {
  let cancelled = false;
  let channel: BroadcastChannel | null = null;
  let source: EventSource | null = null;
  let retry: ReturnType<typeof setTimeout> | null = null;
  let attempt = 0;

  const teardown = (): void => {
    cancelled = true;
    if (retry !== null) {
      clearTimeout(retry);
      retry = null;
    }
    source?.close();
    source = null;
    channel?.close();
    channel = null;
    live.state = 'off';
    live.leading = false;
  };

  if (typeof EventSource === 'undefined' || session.account === null) {
    return teardown;
  }

  /*
    A follower hears about changes from the leader rather than from the server.

    In practice it needs to do nothing with them: the leader has already written
    to IndexedDB and this tab's queries observed it. The message is here so a
    follower can show the same connection state, and so the leader's existence
    is observable at all.
  */
  if (typeof BroadcastChannel !== 'undefined') {
    channel = new BroadcastChannel(CHANNEL);
    channel.onmessage = (event: MessageEvent<{ state?: LiveState }>) => {
      if (!live.leading && event.data?.state !== undefined) {
        live.state = event.data.state;
      }
    };
  }

  const announce = (state: LiveState): void => {
    live.state = state;
    channel?.postMessage({ state });
  };

  const connect = (): void => {
    const account = session.account;
    if (cancelled || account === null) {
      return;
    }

    announce('connecting');

    /*
      The token in the query string, not a header.

      `EventSource` cannot set headers — the API has no option for it — so this
      is the one endpoint whose credential travels in the URL. It is a
      device token over TLS to the same origin, it is never logged by this
      server, and the alternative is a second authentication mechanism. Worth
      naming as the one place the pattern is broken deliberately.
    */
    const since = account.cursor ?? 0;
    const url = `/api/v1/sync/stream?since=${since}&token=${encodeURIComponent(account.token)}`;

    source = new EventSource(url);

    source.onopen = () => {
      attempt = 0;
      announce('live');
    };

    source.addEventListener('changed', () => {
      live.received += 1;
      /*
        The event says only that something changed. What to do about it is the
        ordinary sync, which pulls by revision, merges per collection and
        advances the cursor — the same path a manual sync takes, so the two
        cannot drift.
      */
      const current = session.account;
      if (current !== null && sync.adopted) {
        void runSync(current.token, loadUiLocale());
      }
    });

    source.onerror = () => {
      /*
        `EventSource` reconnects on its own, and its own attempt is the thing to
        prevent: it would use the URL this connection was opened with, whose
        `since` is now stale. Closing and reconnecting by hand keeps the cursor
        current and puts the backoff under this code's control.
      */
      source?.close();
      source = null;
      if (cancelled) {
        return;
      }
      announce('offline');
      attempt += 1;
      retry = setTimeout(connect, delayFor(attempt));
    };
  };

  /*
    Take the lock, and hold it for as long as this tab is the leader.

    The promise passed to `request` is resolved only on teardown, so the lock is
    held for the tab's lifetime. A second tab waits inside `request` without
    spinning, and takes over the instant this one goes away — including if it
    crashes, because the browser releases the lock on its own.
  */
  if (typeof navigator !== 'undefined' && navigator.locks !== undefined) {
    void navigator.locks
      .request(LOCK, () => {
        if (cancelled) {
          return Promise.resolve();
        }
        live.leading = true;
        connect();
        return new Promise<void>((resolve) => {
          const check = setInterval(() => {
            if (cancelled) {
              clearInterval(check);
              resolve();
            }
          }, 250);
        });
      })
      .catch(() => undefined);
  } else {
    // No Web Locks: every tab connects. More connections than necessary, and
    // never a wrong answer.
    live.leading = true;
    connect();
  }

  stop = teardown;
  return teardown;
}

/** Closes the connection, for signing out. */
export function stopLive(): void {
  stop?.();
  stop = null;
}
