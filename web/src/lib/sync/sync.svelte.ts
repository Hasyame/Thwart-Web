import { db } from '../db';
import type { Locale } from '../types';
import { ApiError } from './api';
import { FALLBACK_LIMITS, version } from './api';
import { planAdoption, type AdoptionPlan, type AdoptionWrite } from './adoption';
import { syncOnce, type RejectedRecord, type SyncOutcome } from './engine';
import { applyAdoption, dexiePorts, stageAccount } from './ports';
import { hasAdopted, SYNC_STATE_KEY } from './state';

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
  enabled: boolean;
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
let inFlight: Promise<void> | null = null;
let generation = 0;

export const sync = $state<State>({
  phase: { kind: 'off' },
  adopted: false,
  enabled: false,
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
    sync.adopted = hasAdopted(state);
    sync.enabled = sync.adopted && state?.syncEnabled !== false;
    sync.lastSyncedAt = state?.lastSyncedAt ?? null;
    sync.phase = sync.enabled ? { kind: 'on', last: null } : { kind: 'off' };
  } catch {
    sync.adopted = false;
    sync.enabled = false;
    sync.lastSyncedAt = null;
    sync.phase = { kind: 'off' };
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
  const started = ++generation;
  if (sync.adopted) {
    await db.syncState.update(SYNC_STATE_KEY, { syncEnabled: true });
    if (started !== generation) return;
    sync.enabled = true;
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
    if (started !== generation) return;
    const { writes, ...summary } = planAdoption(local, staged.records, {
      forkSuffix: locale === 'fr' ? ' (cet appareil)' : ' (this device)',
    });
    pendingWrites = writes;
    sync.phase = { kind: 'asking', summary, cursor: staged.cursor };
  } catch (cause) {
    if (started === generation) sync.phase = { kind: 'failed', code: codeOf(cause) };
  }
}

/** Cancels an adoption that was offered. Nothing was written, so nothing undoes. */
export function cancelAdoption(): void {
  generation += 1;
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
  const started = generation;
  sync.phase = { kind: 'working' };
  inFlight = exclusive(async () => {
    if (started !== generation || (await db.syncState.get(SYNC_STATE_KEY))?.token !== token) return;
    await applyAdoption({ ...phase.summary, writes }, phase.cursor);
    if (started !== generation) return;
    pendingWrites = [];
    sync.adopted = true;
    await db.syncState.update(SYNC_STATE_KEY, { syncEnabled: true });
    if (started !== generation) {
      await db.syncState.update(SYNC_STATE_KEY, { syncEnabled: false });
      return;
    }
    sync.enabled = true;
    await performSync(token, locale);
  }).catch((cause: unknown) => {
    if (started === generation) sync.phase = { kind: 'failed', code: codeOf(cause) };
  }).finally(() => { inFlight = null; });
  await inFlight;
}

async function exclusive(work: () => Promise<void>): Promise<void> {
  if (typeof navigator !== 'undefined' && navigator.locks !== undefined) {
    await navigator.locks.request('thwart-sync', work);
  } else {
    await work();
  }
}

/** One synchronisation, on a browser that has already adopted. */
export async function runSync(token: string, locale: Locale): Promise<void> {
  if (!sync.enabled || !sync.adopted) return;
  if (inFlight !== null) return inFlight;
  const run = async (): Promise<void> => {
    // The lock covers manual, live and automatic runs across tabs. Recheck
    // the account after waiting so a queued run cannot use an old session.
    const stored = await db.syncState.get(SYNC_STATE_KEY);
    if (!sync.enabled || stored?.token !== token || stored.syncEnabled === false) return;
    await performSync(token, locale);
  };
  inFlight = exclusive(run).catch((cause: unknown) => {
    if (sync.enabled) sync.phase = { kind: 'failed', code: codeOf(cause) };
  }).finally(() => { inFlight = null; });
  return inFlight;
}

async function performSync(token: string, locale: Locale): Promise<void> {
  sync.phase = { kind: 'working' };
  try {
    const outcome = await syncOnce(dexiePorts(token, locale));
    if (outcome.rejected.length > 0) {
      sync.rejected = [...sync.rejected, ...outcome.rejected];
    }
    if (!sync.enabled) return;
    if (outcome.stoppedBecause !== undefined) {
      sync.phase = { kind: 'failed', code: outcome.stoppedBecause };
      return;
    }
    sync.lastSyncedAt = Date.now();
    await db.syncState.update(SYNC_STATE_KEY, { lastSyncedAt: sync.lastSyncedAt });
    if (sync.enabled) sync.phase = { kind: 'on', last: outcome };
  } catch (cause) {
    if (sync.enabled) sync.phase = { kind: 'failed', code: codeOf(cause) };
  }
}

/**
 * Turns syncing off.
 *
 * Local data stays and so does the account: this stops the browser reaching for
 * the server, and nothing else. It is not signing out and it is not erasing.
 */
export async function turnOff(): Promise<void> {
  generation += 1;
  sync.enabled = false;
  pendingWrites = [];
  sync.phase = { kind: 'off' };
  // Let an already-sent batch settle before sign-out can clear its records.
  await db.syncState.update(SYNC_STATE_KEY, { syncEnabled: false });
  await inFlight;
  // Another tab may have held the lock before the persisted switch changed.
  // Wait for it as well before sign-out can remove shared IndexedDB rows.
  await exclusive(async () => {});
}

export async function resetSync(): Promise<void> {
  await turnOff();
  sync.adopted = false;
  sync.lastSyncedAt = null;
  sync.rejected = [];
}
