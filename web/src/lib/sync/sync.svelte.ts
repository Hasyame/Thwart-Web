import { db } from '../db';
import type { Locale } from '../types';
import { ApiError } from './api';
import { FALLBACK_LIMITS, version } from './api';
import { planAdoption, type AdoptionPlan, type AdoptionWrite } from './adoption';
import { syncOnce, type RejectedRecord, type SyncOutcome } from './engine';
import { applyAdoption, dexiePorts, stageAccount } from './ports';
import { SYNC_STATE_KEY } from './state';

/**
 * Whether this browser keeps in step with the account, and what happens first.
 *
 * Signing in and syncing are two separate acts, deliberately. Signing in
 * answers *who are you* and records a token. This answers *should this browser
 * stay in step*, and it is off until somebody turns it on — because the first
 * sync on a browser that already holds data is a merge, and firing a merge at
 * somebody who only meant to sign in is how a feature earns a reputation before
 * it has done anything.
 *
 * So turning it on stages the account, works out what the merge would do, and
 * stops to ask. Nothing is written until the answer is yes.
 */

export type SyncPhase =
  | { readonly kind: 'off' }
  | { readonly kind: 'staging' }
  /** Staged and counted, waiting for an answer. Nothing has been written. */
  | { readonly kind: 'asking'; readonly summary: AdoptionSummary; readonly cursor: number }
  | { readonly kind: 'working' }
  | { readonly kind: 'on'; readonly last: SyncOutcome | null }
  | { readonly kind: 'failed'; readonly code: string };

interface State {
  phase: SyncPhase;
  /** Set once adoption has happened, so it is never offered twice. */
  adopted: boolean;
  lastSyncedAt: number | null;
  /**
   * Records the server refused, kept until somebody has seen them.

   * Not on `phase.last`, which the next sync replaces — and the next sync is
   * often seconds later, because the live stream answers a push by asking for
   * a pull. A refusal must outlive that, or it is never seen at all.
   */
  rejected: readonly RejectedRecord[];
}

/** Everything about a staged adoption except the rows it would write. */
export type AdoptionSummary = Omit<AdoptionPlan, 'writes'>;

/*
 * The rows themselves, deliberately outside the reactive store.
 *
 * `$state` proxies deeply, and a proxy cannot be structured-cloned — which is
 * exactly what IndexedDB does to every row on the way in. Held here, the plan's
 * writes reach Dexie as the plain objects they were built as, and the store
 * keeps only what the screen actually renders: counts and collection names.
 *
 * Found the hard way: the merge worked when called directly and failed from the
 * button, with the failure surfacing as a server error it had nothing to do
 * with.
 */
let pendingWrites: readonly AdoptionWrite[] = [];

export const sync = $state<State>({
  phase: { kind: 'off' },
  adopted: false,
  lastSyncedAt: null,
  rejected: [],
});

/** Once the notice has been read. */
export function dismissRejected(): void {
  sync.rejected = [];
}

const codeOf = (cause: unknown): string =>
  cause instanceof ApiError ? cause.code : 'server_error';

/** Read at startup: a browser that has adopted does not ask again. */
export async function loadSyncState(): Promise<void> {
  try {
    const state = await db.syncState.get(SYNC_STATE_KEY);
    sync.adopted = (state?.cursor ?? 0) > 0 || state?.lastSyncedAt !== null;
    sync.lastSyncedAt = state?.lastSyncedAt ?? null;
  } catch {
    sync.adopted = false;
  }
}

/**
 * Turns syncing on.
 *
 * On a browser that has already adopted this account, that is simply a sync. On
 * one that has not, it stages and asks — and staging touches nothing, so
 * cancelling leaves the browser exactly as it was.
 */
export async function turnOn(token: string, locale: Locale): Promise<void> {
  if (sync.adopted) {
    await runSync(token, locale);
    return;
  }

  sync.phase = { kind: 'staging' };
  try {
    const limits = await version(locale)
      .then((info) => info.limits)
      .catch(() => FALLBACK_LIMITS);
    const staged = await stageAccount(token, locale, limits);
    const local = await dexiePorts(token, locale).readLocal();
    const { writes, ...summary } = planAdoption(local, staged.records);
    pendingWrites = writes;
    sync.phase = { kind: 'asking', summary, cursor: staged.cursor };
  } catch (cause) {
    sync.phase = { kind: 'failed', code: codeOf(cause) };
  }
}

/** Cancels an adoption that was offered. Nothing was written, so nothing undoes. */
export function cancelAdoption(): void {
  pendingWrites = [];
  sync.phase = { kind: 'off' };
}

/** Carries out the merge the reader has just been shown, then syncs. */
export async function acceptAdoption(token: string, locale: Locale): Promise<void> {
  const phase = sync.phase;
  if (phase.kind !== 'asking') {
    return;
  }
  const writes = pendingWrites;
  sync.phase = { kind: 'working' };
  try {
    await applyAdoption({ ...phase.summary, writes }, phase.cursor);
    pendingWrites = [];
    sync.adopted = true;
    await runSync(token, locale);
  } catch (cause) {
    sync.phase = { kind: 'failed', code: codeOf(cause) };
  }
}

/** One synchronisation, on a browser that has already adopted. */
export async function runSync(token: string, locale: Locale): Promise<void> {
  sync.phase = { kind: 'working' };
  try {
    const outcome = await syncOnce(dexiePorts(token, locale));
    sync.adopted = true;
    sync.lastSyncedAt = Date.now();
    sync.phase = { kind: 'on', last: outcome };
    if (outcome.rejected.length > 0) {
      sync.rejected = [...sync.rejected, ...outcome.rejected];
    }
  } catch (cause) {
    sync.phase = { kind: 'failed', code: codeOf(cause) };
  }
}

/**
 * Turns syncing off.
 *
 * Local data stays and so does the account: this stops the browser reaching for
 * the server, and nothing else. It is not signing out and it is not erasing.
 */
export function turnOff(): void {
  pendingWrites = [];
  sync.phase = { kind: 'off' };
}
