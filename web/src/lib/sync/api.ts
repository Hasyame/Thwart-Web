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
  | 'registration_closed'
  | 'invalid_recovery_code'
  | 'cursor_too_old'
  | 'batch_too_large'
  | 'record_too_large'
  | 'malformed_record'
  | 'rate_limited'
  | 'not_found'
  | 'server_error'
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
  readonly token: string;
  readonly recoveryCodeIssuedAt: string;
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

export type PushOutcome = 'applied' | 'applied_over_conflict';

export interface PushResult {
  readonly id: string;
  readonly collection: string;
  readonly revision: number;
  readonly outcome: PushOutcome;
  /** Named when this write went over one the client had not seen. */
  readonly supersededRevision?: number;
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
  password: string,
  deviceName: string,
  locale?: Locale,
): Promise<Registration> =>
  call('/auth/register', { method: 'POST', body: { handle, password, deviceName }, locale });

export const login = (
  handle: string,
  password: string,
  deviceName: string,
  locale?: Locale,
): Promise<Session> =>
  call('/auth/login', { method: 'POST', body: { handle, password, deviceName }, locale });

export const recover = (
  handle: string,
  recoveryCode: string,
  newPassword: string,
  deviceName: string,
  locale?: Locale,
): Promise<Registration> =>
  call('/auth/recover', {
    method: 'POST',
    body: { handle, recoveryCode, newPassword, deviceName },
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

export const deleteAccount = (token: string, password: string, locale?: Locale): Promise<void> =>
  call('/account', { method: 'DELETE', body: { password }, token, locale });

// --- sync ---------------------------------------------------------------------

export const pull = (
  token: string,
  since: number,
  limit: number,
  locale?: Locale,
  signal?: AbortSignal,
): Promise<PullPage> =>
  call(`/sync/changes?since=${since}&limit=${limit}`, { token, locale, signal });

export const push = (
  token: string,
  batchId: string,
  records: readonly OutgoingRecord[],
  locale?: Locale,
): Promise<PushResponse> =>
  call('/sync/changes', { method: 'POST', body: { batchId, records }, token, locale });

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
