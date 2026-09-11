/**
 * BoardGameGeek, kept deliberately at arm's length.
 *
 * Two constraints shape everything here, and neither is negotiable.
 *
 * **This browser cannot talk to BoardGameGeek.** BGG has no write API: the
 * Android app records a play by posting to `geekplay.php` with the account's
 * own password. From a page that is not on boardgamegeek.com, the browser will
 * not send that request — `geekplay.php` answers a preflight with 403 and no
 * CORS headers at all, and the login endpoint answers 204 with no
 * `Access-Control-Allow-Origin` either. Both were checked rather than assumed.
 * Routing it through thwart.app instead would mean a BGG password travelling
 * through this project's server, which is exactly what should not happen.
 *
 * So the web does the part it honestly can: it remembers **who you are on
 * BGG**, hands you the page to log the play on, and puts the details on the
 * clipboard so filling the form is a paste. You are signed in to BGG yourself,
 * in your own browser, and nothing here ever sees a BGG password.
 *
 * **Nothing here is synced or backed up.** Not a key in the `settings` record,
 * not a table in the ten collections, not a field in the backup file. It lives
 * in this browser's `localStorage` and it stays there. Connecting to BGG is
 * something each device does for itself.
 */

const KEY = 'thwart.bgg.username';

/**
 * The BoardGameGeek game entry for Marvel Champions.
 *
 * The base game, not the scenario: BGG files scenarios as expansions with ids
 * of their own, and there is no mapping from a MarvelCDB pack code to one. The
 * base game's page is where the Log Play button is, and its form is where the
 * expansion gets chosen — by the reader, who knows which box it came out of.
 */
export const BGG_GAME_ID = 285774;

function stored(): string {
  try {
    return localStorage.getItem(KEY) ?? '';
  } catch {
    return '';
  }
}

export const bgg = $state<{ username: string }>({ username: stored() });

export function setBggUsername(username: string): void {
  const trimmed = username.trim();
  bgg.username = trimmed;
  try {
    if (trimmed === '') {
      localStorage.removeItem(KEY);
    } else {
      localStorage.setItem(KEY, trimmed);
    }
  } catch {
    // No storage means no memory of it, and the field still works this session.
  }
}

/** Whether this browser has been told who you are on BGG. */
export const bggConnected = (): boolean => bgg.username !== '';

/** That account's own page, so the name can be checked rather than trusted. */
export const bggProfileUrl = (username: string): string =>
  `https://boardgamegeek.com/user/${encodeURIComponent(username)}`;

/** The game's page, which is where the Log Play form lives. */
export const bggLogPlayUrl = (): string =>
  `https://boardgamegeek.com/boardgame/${BGG_GAME_ID}`;
