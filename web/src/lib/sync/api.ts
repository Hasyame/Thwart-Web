import type { Locale } from '../types';

/**
 * The eleven endpoints, typed.
 *
 * A thin layer on purpose: it knows the wire format and nothing about what the
 * records mean. The protocol's whole shape rests on the server not
 * understanding the data (doc 02), and a client library that started parsing
 * bodies here would be the first crack in that.
 *
 * Every failure arrives as `ApiError` carrying the server's machine-readable
 * `code`. The code is the contract and the message is for whoever is holding
 * curl; anything the reader sees is translated on this side.
 */

const BASE = '/api/v1';

/** The codes the server can return, from doc 02 §7. */
export type ApiErrorCode =
  | 'unauthorized'
  | 'invalid_credentials'
  | 'handle_taken'
  | 'email_taken'
  | 'invalid_handle'
  | 'invalid_email'
  | 'weak_password'
  | 'registration_closed'
  | 'invalid_recovery_code'
  /** The address on the account has not been confirmed, so nothing works yet. */
  | 'email_not_verified'
  | 'invalid_verification'
  | 'verification_expired'
  | 'cursor_too_old'
  | 'batch_too_large'
  | 'record_too_large'
  | 'malformed_record'
  | 'rate_limited'
  /**
   * The server is saturated, not the caller misbehaving.
   *
   * It caps how many password hashes run at once, because each costs 64 MiB and
   * enough of them at the same moment is an out-of-memory kill. A caller who
   * cannot get a slot is told to come back rather than queued.
   */
  | 'server_busy'
  | 'not_found'
  | 'server_error'
  /**
   * The BoardGameGeek relay, server/bgg.go: the password was refused, BGG
   * refused or could not be reached, or this instance has the relay off.
   */
  | 'bgg_bad_credentials'
  | 'bgg_rejected'
  | 'bgg_unreachable'
  | 'bgg_disabled'
  /** Not the server's: the request never arrived. */
  | 'offline';

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(code: ApiErrorCode, status: number, message: string, details = {}) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export interface Session {
  readonly accountId: string;
  readonly handle: string;
  /**
   * The address on the account.
   *
   * Optional because a server older than the address migration does not send
   * it, and because the account created before addresses existed does not have
   * one until it is set.
   */
  readonly email?: string;
  readonly token: string;
  readonly recoveryCodeIssuedAt: string;
  /**
   * Whether the address has been confirmed.
   *
   * Absent from a server older than confirmation, and absent means yes: such a
   * server confirms nothing and disables nothing, so treating a missing field
   * as "not confirmed" would lock this browser out of a working account.
   */
  readonly emailVerified?: boolean;
}

/** Only ever returned once, by register and recover. */
export interface Registration extends Session {
  readonly recoveryCode: string;
}

export interface DeviceInfo {
  readonly id: string;
  readonly name: string;
  readonly createdAt: string;
  readonly lastSeen: string;
  /**
   * True for the token this request was made with, so the list can say "this
   * device" rather than making somebody work out which line is the phone they
   * are holding.
   */
  readonly current: boolean;
}

/** One record as the server stores it: a body it never parses, and its metadata. */
export interface ServerRecord {
  readonly collection: string;
  readonly id: string;
  readonly revision: number;
  readonly updatedAt: string;
  readonly deleted: boolean;
  readonly body: Record<string, unknown> | null;
}

export interface OutgoingRecord {
  readonly collection: string;
  readonly id: string;
  readonly updatedAt: string;
  readonly deleted: boolean;
  /** What the client last saw for this record; absent when it is new. */
  readonly baseRevision?: number;
  readonly body: Record<string, unknown> | null;
}

export interface PullPage {
  readonly changes: readonly ServerRecord[];
  readonly cursor: number;
  readonly hasMore: boolean;
  /** The tombstone horizon. Below it, a client has been away too long. */
  readonly minCursor: number;
}

/**
 * `rejected` is the one that is not a success. The server did not store the
 * record and will not on a retry: a rating for something this account never
 * played, or malformed. The client's only correct move is to drop its copy.
 * docs/spec/ratings-and-modular-sets.md §2.4.
 */
export type PushOutcome = 'applied' | 'applied_over_conflict' | 'already_present' | 'rejected';

export interface PushResult {
  readonly id: string;
  readonly collection: string;
  readonly revision: number;
  readonly outcome: PushOutcome;
  /** Named when this write went over one the client had not seen. */
  readonly supersededRevision?: number;
  /** Why, when the outcome is `rejected`. */
  readonly reason?: string;
}

export interface PushResponse {
  readonly cursor: number;
  readonly results: readonly PushResult[];
}

export interface Limits {
  readonly batchRecords: number;
  readonly batchBytes: number;
  readonly recordBytes: number;
  readonly pageSize: number;
}

export interface ServerVersion {
  readonly build: string;
  readonly protocol: number;
  readonly limits: Limits;
  /**
   * Whether this instance takes new accounts.
   *
   * Not a security boundary — the server refuses a closed registration itself,
   * because the endpoint is one curl away from anybody who reads the
   * JavaScript. This only lets the screen stop offering a form that would be
   * turned down. Absent on an older server, and then the form is offered and
   * the refusal explains itself.
   */
  readonly registrationOpen?: boolean;
  /**
   * Whether this instance relays plays to BoardGameGeek. Absent on an older
   * server, and then the form is offered and the refusal explains itself.
   */
  readonly bggRelay?: boolean;
}

interface CallOptions {
  readonly method?: string;
  readonly body?: unknown;
  readonly token?: string;
  readonly locale?: Locale;
  readonly signal?: AbortSignal;
}

async function call<T>(path: string, options: CallOptions = {}): Promise<T> {
  const headers: Record<string, string> = {
    // The server honours this for its own small fixed set of messages. It never
    // translates anything about the data, because it does not know what the
    // data is.
    'Accept-Language': options.locale === 'fr' ? 'fr' : 'en',
  };
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  if (options.token !== undefined) {
    headers.Authorization = `Bearer ${options.token}`;
  }

  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, {
      method: options.method ?? 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal,
    });
  } catch (cause) {
    // A request that never arrived is not a server error, and the difference
    // matters: one is worth retrying quietly and the other is worth saying.
    throw new ApiError('offline', 0, String(cause));
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const text = await response.text();
  let parsed: unknown = null;
  if (text !== '') {
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new ApiError('server_error', response.status, 'the response was not JSON');
    }
  }

  if (!response.ok) {
    const envelope = (parsed as { error?: { code?: string; message?: string; details?: object } })
      ?.error;
    throw new ApiError(
      (envelope?.code as ApiErrorCode) ?? 'server_error',
      response.status,
      envelope?.message ?? `HTTP ${response.status}`,
      envelope?.details ?? {},
    );
  }

  return parsed as T;
}

// --- accounts -----------------------------------------------------------------

export const register = (
  handle: string,
  email: string,
  password: string,
  deviceName: string,
  locale?: Locale,
): Promise<Registration> =>
  call('/auth/register', { method: 'POST', body: { handle, email, password, deviceName }, locale });

/**
 * Signing in.
 *
 * `identifier` is whatever was typed: an address, or a pseudonym on an account
 * that predates addresses. The server resolves either, so this does not have to
 * guess which it was given.
 *
 * Sent as `handle` alone. An earlier version of this sent it in both fields and
 * claimed that kept a pre-address server working; the opposite is true, and the
 * Android client caught it. Every account endpoint decodes with
 * `DisallowUnknownFields`, so an `email` key against such a server is refused
 * outright. `handle` alone reaches the same account on both builds, because the
 * newer one falls back to it and resolves an address through it.
 */
export const login = (
  identifier: string,
  password: string,
  deviceName: string,
  locale?: Locale,
): Promise<Session> =>
  call('/auth/login', {
    method: 'POST',
    body: { handle: identifier, password, deviceName },
    locale,
  });

export const recover = (
  identifier: string,
  recoveryCode: string,
  newPassword: string,
  deviceName: string,
  locale?: Locale,
): Promise<Registration> =>
  call('/auth/recover', {
    method: 'POST',
    body: { handle: identifier, recoveryCode, newPassword, deviceName },
    locale,
  });

/**
 * Confirms an address from the link in the message.
 *
 * No token: the link is opened wherever the mailbox is, which is usually not the
 * browser that registered. That is the whole point of sending it.
 */
export const verifyEmail = (
  token: string,
  locale?: Locale,
): Promise<{ handle: string; email: string }> =>
  call('/auth/verify', { method: 'POST', body: { token }, locale });

/** Asks for the link again. Behind the password, so it cannot mail strangers. */
export const resendVerification = (
  identifier: string,
  password: string,
  locale?: Locale,
): Promise<{ sent: boolean; alreadyVerified?: boolean }> =>
  call('/auth/verify/resend', {
    method: 'POST',
    body: { handle: identifier, email: identifier, password },
    locale,
  });

export const changePassword = (
  token: string,
  currentPassword: string,
  newPassword: string,
  locale?: Locale,
): Promise<void> =>
  call('/auth/password', {
    method: 'POST',
    body: { currentPassword, newPassword },
    token,
    locale,
  });

export const listDevices = (token: string, locale?: Locale): Promise<readonly DeviceInfo[]> =>
  call<{ devices: readonly DeviceInfo[] }>('/auth/devices', { token, locale }).then(
    (page) => page.devices ?? [],
  );

/** Revoking the token you are holding is how signing out reaches the server. */
export const revokeDevice = (token: string, id: string, locale?: Locale): Promise<void> =>
  call(`/auth/devices/${encodeURIComponent(id)}`, { method: 'DELETE', token, locale });

/**
 * Everything the account holds, as the backup file shape.
 *
 * The server has had this endpoint since sync existed and nothing ever called
 * it. Being able to leave with your data is not a feature to add later.
 */
export const exportAccount = (
  token: string,
  locale?: Locale,
): Promise<Record<string, unknown>> => call('/account/export', { token, locale });

export const deleteAccount = (token: string, password: string, locale?: Locale): Promise<void> =>
  call('/account', { method: 'DELETE', body: { password }, token, locale });

// --- sync ---------------------------------------------------------------------

/**
 * One page of changes.
 *
 * `resync` says this page belongs to a full resynchronisation that started at
 * zero, and it must be set on **every** page of one, not only the first. The
 * server exempts `since=0` from the tombstone horizon, but page two resumes
 * from a real revision, and a live record untouched since before the last
 * sweep sits below that horizon — so a large account was refused on its own
 * second page with no way forward. It is a claim only the client can make: the
 * server cannot tell resuming from resyncing. Setting it while genuinely
 * resuming only serves this browser an incomplete feed.
 */
export const pull = (
  token: string,
  since: number,
  limit: number,
  collections: readonly string[],
  locale?: Locale,
  signal?: AbortSignal,
  resync = false,
): Promise<PullPage> =>
  call(
    `/sync/changes?since=${since}&limit=${limit}` +
      // Which collections this build reads. The server serves only those, so
      // a collection added later never reaches a build that cannot store it;
      // one that names nothing gets the set from before the parameter.
      `&collections=${encodeURIComponent(collections.join(','))}` +
      `${resync ? '&resync=1' : ''}`,
    { token, locale, signal },
  );

export const push = (
  token: string,
  batchId: string,
  records: readonly OutgoingRecord[],
  locale?: Locale,
): Promise<PushResponse> =>
  call('/sync/changes', { method: 'POST', body: { batchId, records }, token, locale });

// --- BoardGameGeek, relayed -------------------------------------------------------

/** One seat on a BGG play, as `geekplay.php` records it. */
export interface BggPlayer {
  readonly username: string;
  readonly name: string;
  readonly score: number;
  readonly won: boolean;
  /** BGG shows this beside the name; the hero played is what belongs there. */
  readonly color: string;
}

/** A finished game, in the shape BoardGameGeek records one. See lib/bggPayload. */
export interface BggPlay {
  readonly playedOn: string;
  readonly lengthMinutes: number;
  readonly location: string;
  readonly comment: string;
  readonly players: readonly BggPlayer[];
}

/**
 * Checks a BGG username and password, through the relay, storing nothing on
 * either side. Only for a signed-in account: the relay is behind the token.
 */
export const bggVerify = (
  token: string,
  username: string,
  password: string,
  locale?: Locale,
): Promise<void> =>
  call('/bgg/verify', { method: 'POST', body: { username, password }, token, locale });

/** Posts one play to BGG through the relay. Signs in, posts, forgets. */
export const bggReportPlay = (
  token: string,
  username: string,
  password: string,
  play: BggPlay,
  locale?: Locale,
): Promise<void> =>
  call('/bgg/plays', { method: 'POST', body: { username, password, play }, token, locale });

// --- the instance itself --------------------------------------------------------

export const version = (locale?: Locale): Promise<ServerVersion> => call('/version', { locale });

/**
 * The limits, asked for rather than assumed.
 *
 * Doc 02 §3 publishes them precisely so a client does not have to guess, and a
 * self-hosted instance may set them differently. These are the deployed
 * values, used only until the real ones arrive.
 */
export const FALLBACK_LIMITS: Limits = {
  batchRecords: 500,
  batchBytes: 2 * 1024 * 1024,
  recordBytes: 256 * 1024,
  pageSize: 1000,
};
