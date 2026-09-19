/**
 * What this browser remembers about syncing.
 *
 * Two things, and they are deliberately separate. `StoredSyncState` is one row
 * saying who is signed in and how far the feed has been read.
 * `SyncRecordState` is one row per record saying what the server last gave it.
 *
 * Neither is in the backup file. A device token is this browser's, not the
 * account's, and exporting one into a file somebody mails themselves would be
 * handing over a credential; the cursor means nothing anywhere else.
 */

/** The account this browser is signed in to, if any. */
export interface StoredSyncState {
  /** Always `current`. One row. */
  readonly id: string;
  readonly accountId: string;
  readonly handle: string;
  /**
   * The address on the account, when the server reports one.
   *
   * Kept only so the account screen can show which address is signed in.
   * Optional because the row may have been written before addresses existed.
   */
  readonly email?: string;
  /**
   * The device token.
   *
   * Held in IndexedDB rather than localStorage for one reason: everything else
   * this app owns is there, so signing out and clearing data is one place
   * rather than two that can disagree.
   */
  readonly token: string;
  /** The highest revision this browser has read. Zero means nothing yet. */
  readonly cursor: number;
  /**
   * The collections the cursor was read with, sorted and comma-joined.
   *
   * The server serves a pull only the collections it names, so the cursor is
   * a position among those and no other. A build that reads more than the
   * one before it finds this differs from its own list and pulls from zero
   * once: the records it never asked for are exactly the ones its cursor has
   * already passed. Absent on a row written before this existed, which reads
   * as "different" and costs one resync, the honest price of not knowing.
   */
  readonly collections?: string;
  readonly recoveryCodeIssuedAt: string;
  readonly lastSyncedAt: number | null;
  /** Device-local switch; never included in sync bodies or backups. */
  readonly syncEnabled?: boolean;
  /**
   * The name this browser registered itself under, so the device list is
   * readable rather than a column of identical rows.
   */
  readonly deviceName: string;
}

/**
 * What the server last confirmed about one record.
 *
 * `digest` is of the body as it was sent. A row whose current body hashes
 * differently has been edited since; a row with a state and no table row has
 * been deleted. That is the whole of change detection, and it needs no hook,
 * no dirty column and no cooperation from the two dozen places that write.
 */
export interface SyncRecordState {
  readonly collection: string;
  readonly id: string;
  readonly revision: number;
  readonly digest: string;
}

export const SYNC_STATE_KEY = 'current';

export function hasAdopted(state: StoredSyncState | undefined): boolean {
  return state !== undefined && (state.cursor > 0 || state.lastSyncedAt != null);
}

/**
 * A stable digest of a record body.
 *
 * FNV-1a over the body's canonical JSON. Not a cryptographic hash and not
 * trying to be: it decides whether to re-send a record. A collision can hide
 * an edit, so this compact digest is change detection, not proof of equality.
 *
 * The canonical part matters more than the hash. `JSON.stringify` preserves
 * insertion order, so two objects with the same fields written in a different
 * order would hash differently and every record would look permanently dirty.
 */
export function digestOf(body: Record<string, unknown> | null): string {
  const text = body === null ? '' : canonical(body);
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    // The FNV prime, as a sum of shifts: a plain multiply overflows into a
    // float and stops being the same function on either side of 2^31.
    hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'null';
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonical).join(',')}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    // Undefined is absent, not null: a field the app has not set must hash the
    // same as one it never had, or adding an optional field marks every
    // existing record dirty.
    .filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
}
