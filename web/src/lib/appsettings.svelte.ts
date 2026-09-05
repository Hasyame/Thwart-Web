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
   * On by default.
   *
   * The tracker is most of why somebody opens a companion during a game, and a
   * browser that has never seen this row should show it. Absent therefore has
   * to read as true, which means the stored value is only ever consulted when
   * the row exists.
   */
  trackEncounter: true,
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
