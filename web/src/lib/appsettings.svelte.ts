import { liveQuery } from 'dexie';
import { db, SETTINGS_KEY, type StoredSettings } from './db';

/**
 * The app's own preferences, as the account carries them.
 *
 * Five keys, matching the Android app field for field, and the same five the
 * `settings` collection syncs. Two of them had no control on this site until
 * now: they arrived from a phone, sat in the row, and nothing here could read
 * or change them.
 *
 * Held in IndexedDB rather than `localStorage` because that is what syncs and
 * what a backup carries. The interface language and the theme stay in
 * `localStorage` deliberately: they have to be known before the database opens,
 * or the first paint is the wrong language on the wrong ground.
 */

const BLANK: StoredSettings = {
  id: SETTINGS_KEY,
  cardLocale: '',
  themeChoice: '',
  playLocation: '',
  /*
   * Off by default, because the Android app is off by default.
   *
   * `AppPreferences` reads `KEY_TRACK_ENCOUNTER ?: false` and `BackupSettings`
   * declares `trackEncounter: Boolean = false`, so an account that has never
   * answered the question means no. This browser used to read an absent value
   * as yes, which meant the same account showed a tracker here and not on the
   * phone — the two ends disagreeing about a setting neither of them had.
   */
  trackEncounter: false,
  dismissedPacks: [],
};

export const appSettings = $state<{ value: StoredSettings; loaded: boolean }>({
  value: BLANK,
  loaded: false,
});

/** Subscribes for the life of the app. Returns the unsubscribe. */
export function watchAppSettings(): () => void {
  const subscription = liveQuery(() => db.appSettings.get(SETTINGS_KEY)).subscribe((row) => {
    appSettings.value = row ?? BLANK;
    appSettings.loaded = true;
  });
  return () => subscription.unsubscribe();
}

/**
 * Writes one or more keys, leaving the rest alone.
 *
 * Read-modify-write rather than a partial update, because the row is one
 * record on the wire: the sync engine hashes the whole body, and a write that
 * dropped a key it did not know about would upload that loss to every device.
 */
export async function setAppSettings(patch: Partial<Omit<StoredSettings, 'id'>>): Promise<void> {
  const current = (await db.appSettings.get(SETTINGS_KEY)) ?? BLANK;
  await db.appSettings.put({ ...current, ...patch, id: SETTINGS_KEY });
}
