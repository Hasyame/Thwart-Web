import * as api from './sync/api';
import type { Locale } from './types';
import type { Play } from './records';
import { db } from './db';
import { session } from './sync/session.svelte';
import { bggPlayOf } from './bggPayload';

/**
 * BoardGameGeek, connected the way the phone connects it.
 *
 * **This browser cannot talk to BoardGameGeek.** BGG has no write API: the
 * Android app records a play by posting to `geekplay.php` with the account's
 * own password. From a page that is not on boardgamegeek.com, the browser will
 * not send that request — `geekplay.php` answers a preflight with 403 and no
 * CORS headers at all, and the login endpoint answers 204 with no
 * `Access-Control-Allow-Origin` either. Both were checked rather than assumed.
 *
 * So the play goes through thwart.app's own server, which signs in to BGG with
 * the credentials the browser sends, posts the play, and forgets both
 * (server/bgg.go). That relay is only open to an account signed in here,
 * which is the one thing keeping it from being a password-guessing tool
 * against BGG through this project's address. Without a Thwart account, or on
 * an instance with the relay off, the web does the part it honestly can on
 * its own: it remembers who you are on BGG, hands you the page to log the play
 * on, and puts the details on the clipboard.
 *
 * **Nothing here is synced or backed up.** Not a key in the `settings` record,
 * not a table in the collections, not a field in the backup file. The
 * username, the password and the mode live in this browser's `localStorage`
 * and stay there. A browser has no keystore, so the password is kept as the
 * page is served — the same trust as the site's own session token, and the
 * reason the connection is per device: disconnecting drops it from this
 * browser and nothing else needs telling.
 *
 * **Off is the default and stays the default.** Sending plays means handing a
 * password to a third party's undocumented endpoint, which nobody should end
 * up doing because they did not read a settings screen carefully.
 */

const KEY_USERNAME = 'thwart.bgg.username';
const KEY_PASSWORD = 'thwart.bgg.password';
const KEY_MODE = 'thwart.bgg.mode';

/**
 * When a finished game gets sent to BoardGameGeek. The phone's
 * `BggReportingMode`, code for code.
 */
export type BggMode = 'off' | 'ask' | 'always';

export const BGG_MODES: readonly BggMode[] = ['off', 'ask', 'always'];

/**
 * The BoardGameGeek game entry for Marvel Champions.
 *
 * The base game, not the scenario: BGG files scenarios as expansions with ids
 * of their own, and there is no mapping from a MarvelCDB pack code to one. The
 * base game's page is where the Log Play button is, and its form is where the
 * expansion gets chosen — by the reader, who knows which box it came out of.
 */
export const BGG_GAME_ID = 285774;

function stored(key: string): string {
  try {
    return localStorage.getItem(key) ?? '';
  } catch {
    return '';
  }
}

function store(key: string, value: string): void {
  try {
    if (value === '') {
      localStorage.removeItem(key);
    } else {
      localStorage.setItem(key, value);
    }
  } catch {
    // No storage means no memory of it, and it still works this session.
  }
}

const modeOf = (code: string): BggMode =>
  (BGG_MODES as readonly string[]).includes(code) ? (code as BggMode) : 'off';

export const bgg = $state<{ username: string; password: string; mode: BggMode }>({
  username: stored(KEY_USERNAME),
  password: stored(KEY_PASSWORD),
  mode: modeOf(stored(KEY_MODE)),
});

/** Who you are on BGG, for the hand-off to its form. Kept even without a password. */
export function setBggUsername(username: string): void {
  const trimmed = username.trim();
  bgg.username = trimmed;
  store(KEY_USERNAME, trimmed);
}

/**
 * Stores the connection. The caller is expected to have verified it through
 * the relay first, so a typo is caught while the person is still looking at
 * the form rather than at the end of a game.
 */
export function connectBgg(username: string, password: string): void {
  const trimmed = username.trim();
  bgg.username = trimmed;
  bgg.password = password;
  store(KEY_USERNAME, trimmed);
  store(KEY_PASSWORD, password);
}

/** Forgets the account entirely, the mode included. */
export function disconnectBgg(): void {
  bgg.username = '';
  bgg.password = '';
  bgg.mode = 'off';
  store(KEY_USERNAME, '');
  store(KEY_PASSWORD, '');
  store(KEY_MODE, '');
}

export function setBggMode(mode: BggMode): void {
  bgg.mode = mode;
  store(KEY_MODE, mode === 'off' ? '' : mode);
}

/** Whether this browser has been told who you are on BGG. */
export const bggConnected = (): boolean => bgg.username !== '';

/** Whether this browser holds a connection that can post through the relay. */
export const bggRelayReady = (): boolean => bgg.username !== '' && bgg.password !== '';

/**
 * Whether a play can be sent from here right now: a connection, and a Thwart
 * account signed in for the relay to be open to.
 */
export const bggCanSend = (): boolean =>
  bggRelayReady() && session.status === 'signed-in' && session.account !== null;

/** That account's own page, so the name can be checked rather than trusted. */
export const bggProfileUrl = (username: string): string =>
  `https://boardgamegeek.com/user/${encodeURIComponent(username)}`;

/** The game's page, which is where the Log Play form lives. */
export const bggLogPlayUrl = (): string =>
  `https://boardgamegeek.com/boardgame/${BGG_GAME_ID}`;

/** Checks the credentials against BGG, through the relay. Throws an ApiError. */
export async function verifyBgg(username: string, password: string, locale: Locale): Promise<void> {
  const account = session.account;
  if (account === null) {
    throw new api.ApiError('unauthorized', 401, 'not signed in');
  }
  await api.bggVerify(account.token, username.trim(), password, locale);
}

/**
 * Sends one play to BGG and marks it as reported.
 *
 * Marked only once BGG has it: a play marked before the post would sit as
 * logged on every device while BGG had never heard of it. Throws an ApiError
 * on any failure, which the caller says out loud — a play silently not
 * appearing is worse than one that says why.
 */
export async function sendPlayToBgg(
  play: Play,
  difficultyLabel: (id: string) => string,
  locale: Locale,
): Promise<void> {
  const account = session.account;
  if (account === null || !bggRelayReady()) {
    throw new api.ApiError('unauthorized', 401, 'not connected');
  }
  await api.bggReportPlay(
    account.token,
    bgg.username,
    bgg.password,
    bggPlayOf(play, bgg.username, difficultyLabel),
    locale,
  );
  await db.plays.update(play.id, { reportedToBgg: true });
}
