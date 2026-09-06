import { db } from '../db';
import type { Locale } from '../types';
import * as api from './api';
import { SYNC_STATE_KEY, type StoredSyncState } from './state';

/**
 * Who is signed in on this browser.
 *
 * A module-level store because the answer is the same everywhere and is asked
 * from the top bar as well as from the account screen. It is read from
 * IndexedDB once at startup and written back on every change, so a reload does
 * not sign anybody out.
 *
 * **Nothing here syncs.** Signing in records a token and stops. Moving data is
 * the engine's job and it is not wired up yet — deliberately, because the first
 * sign-in on a browser that already holds data has to run the adoption flow in
 * doc 02 §6, and a sign-in that quietly synced before that existed is exactly
 * the accident the flow is there to prevent.
 */

export type SessionStatus = 'unknown' | 'signed-out' | 'signed-in';

interface State {
  status: SessionStatus;
  account: StoredSyncState | null;
  /** Set while a request is in flight, so a form can refuse to submit twice. */
  busy: boolean;
}

export const session = $state<State>({ status: 'unknown', account: null, busy: false });

/**
 * A name for this browser in the account's device list.
 *
 * Guessed from the user agent, and editable before signing in, because a list
 * of four rows all reading "Chrome" is a list nobody can revoke safely.
 */
export function suggestDeviceName(): string {
  const agent = navigator.userAgent;
  const browser =
    /Firefox\//.test(agent) ? 'Firefox'
    : /Edg\//.test(agent) ? 'Edge'
    : /OPR\//.test(agent) ? 'Opera'
    : /Chrome\//.test(agent) ? 'Chrome'
    : /Safari\//.test(agent) ? 'Safari'
    : 'Navigateur';
  const platform =
    /iPhone|iPad/.test(agent) ? 'iOS'
    : /Android/.test(agent) ? 'Android'
    : /Mac OS X/.test(agent) ? 'Mac'
    : /Windows/.test(agent) ? 'Windows'
    : /Linux/.test(agent) ? 'Linux'
    : '';
  return platform === '' ? browser : `${browser} · ${platform}`;
}

/** Read once at startup. Failing means no storage, which means signed out. */
export async function loadSession(): Promise<void> {
  try {
    const stored = await db.syncState.get(SYNC_STATE_KEY);
    session.account = stored ?? null;
    session.status = stored === undefined ? 'signed-out' : 'signed-in';
  } catch {
    session.account = null;
    session.status = 'signed-out';
  }
}

async function remember(
  result: api.Session,
  deviceName: string,
): Promise<void> {
  const stored: StoredSyncState = {
    id: SYNC_STATE_KEY,
    accountId: result.accountId,
    handle: result.handle,
    email: result.email,
    token: result.token,
    // Nothing has been read yet. Zero is "everything" on the next pull, which
    // is both first sign-in and a full resync — one code path for both.
    cursor: 0,
    recoveryCodeIssuedAt: result.recoveryCodeIssuedAt,
    lastSyncedAt: null,
    deviceName,
  };
  await db.syncState.put(stored);
  session.account = stored;
  session.status = 'signed-in';
}

export async function register(
  handle: string,
  email: string,
  password: string,
  deviceName: string,
  locale: Locale,
): Promise<api.Registration> {
  session.busy = true;
  try {
    const result = await api.register(handle, email, password, deviceName, locale);
    /*
      An account waiting on its address is not a signed-in account.

      The server issues a device token here and refuses every request made with
      it until the link is opened, so remembering it would put the app in a
      state where the top bar says somebody is signed in, the account screen
      agrees, and nothing works. That was reported from production as "I was
      logged in without confirming", and the reporter was right about what they
      saw even though the account really was disabled.

      The token is not lost: it is returned to the caller, which shows the
      recovery code and then says to go and open the link. Signing in
      afterwards is what stores a session.

      `emailVerified` is absent on a server older than confirmation, and absent
      means yes — such a server disables nothing, so treating it as unconfirmed
      would leave that account permanently unable to sign in.
    */
    if (result.emailVerified !== false) {
      await remember(result, deviceName);
    }
    return result;
  } finally {
    session.busy = false;
  }
}

/** `identifier` is the address, or a pseudonym on an account that predates them. */
export async function signIn(
  identifier: string,
  password: string,
  deviceName: string,
  locale: Locale,
): Promise<void> {
  session.busy = true;
  try {
    await remember(await api.login(identifier, password, deviceName, locale), deviceName);
  } finally {
    session.busy = false;
  }
}

export async function recover(
  identifier: string,
  recoveryCode: string,
  newPassword: string,
  deviceName: string,
  locale: Locale,
): Promise<api.Registration> {
  session.busy = true;
  try {
    const result = await api.recover(identifier, recoveryCode, newPassword, deviceName, locale);
    await remember(result, deviceName);
    return result;
  } finally {
    session.busy = false;
  }
}

/**
 * Signs out, and leaves everything else alone.
 *
 * Doc 02 §6: local data stays, the sync state is cleared, the browser goes back
 * to being anonymous with everything intact. Erasing what is stored here is a
 * separate, clearly labelled action and never a side effect of this one.
 *
 * The token is revoked server-side first, but a failure there does not stop the
 * local half: somebody who has pressed sign out on a shared computer must end
 * up signed out of it whatever the network is doing.
 */
export async function signOut(locale: Locale): Promise<void> {
  const account = session.account;
  session.busy = true;
  try {
    if (account !== null) {
      const devices = await api.listDevices(account.token, locale).catch(() => []);
      const own = devices.find((device) => device.current);
      if (own !== undefined) {
        await api.revokeDevice(account.token, own.id, locale).catch(() => undefined);
      }
    }
  } finally {
    await forgetLocally();
    session.busy = false;
  }
}

/** Drops the token and the cursor. Everything the app holds stays. */
export async function forgetLocally(): Promise<void> {
  await db.syncState.delete(SYNC_STATE_KEY);
  // The per-record revisions go too: they describe an account this browser is
  // no longer signed in to, and keeping them would have a later sign-in to a
  // different account believe it had already sent rows it had not.
  await db.syncRecords.clear();
  session.account = null;
  session.status = 'signed-out';
}
