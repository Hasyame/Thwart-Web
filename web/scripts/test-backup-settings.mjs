/**
 * The settings block survives a round trip through this site.
 *
 * The app started carrying it in 1.39.0. Dropping it here would make the
 * README's claim that a round trip loses nothing false, and would do it
 * silently: a phone reading a file with no settings leaves its own alone, so
 * nothing looks broken, the preferences just quietly stop travelling.
 *
 * Run against a real export by passing its path.
 */
import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import Dexie from 'dexie';
import { readFile, writeFile } from 'node:fs/promises';
import { parseBackup, importBackup, exportBackup, backupDownload } from '../src/lib/backup.ts';
import { readBackupArchive } from '../src/lib/backupArchive.ts';
import { db, clearEverything } from '../src/lib/db.ts';
import { SETTINGS, COLLECTIONS } from '../src/lib/sync/collections.ts';

let failures = 0;
function check(label, ok, detail = '') {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
  if (!ok) {
    failures += 1;
  }
}

const withSettings = JSON.stringify({
  formatVersion: 1,
  createdAt: 1,
  appVersion: '1.39.0',
  settings: {
    cardLocale: 'fr',
    themeChoice: 'dark',
    playLocation: 'chez Ben',
    trackEncounter: true,
    dismissedPacks: ['mts', 'jj'],
  },
});

const parsed = parseBackup(withSettings);
check('settings parse', parsed.settings !== null && parsed.settings !== undefined);
check('cardLocale kept', parsed.settings?.cardLocale === 'fr', parsed.settings?.cardLocale);
check('booleans kept', parsed.settings?.trackEncounter === true);
check('dismissedPacks kept', parsed.settings?.dismissedPacks.length === 2);
check('free text kept', parsed.settings?.playLocation === 'chez Ben');

// Absent and null both mean "this file carries none", which the app reads as
// leave the device alone. Anything else would reset somebody's language.
check('absent becomes null', parseBackup(JSON.stringify({ formatVersion: 1, createdAt: 1 })).settings === null);
check('explicit null stays null', parseBackup(JSON.stringify({ formatVersion: 1, createdAt: 1, settings: null })).settings === null);

// A wrong type must not throw; the file is otherwise fine and the rest of it is
// worth importing.
check('a list is refused, not fatal', parseBackup(JSON.stringify({ formatVersion: 1, createdAt: 1, settings: [] })).settings === null);

const real = process.argv.find((a, i) => i > 1 && a.endsWith('.zip'));
if (real !== undefined) {
  const { readBackupDocument } = await import('../src/lib/backupArchive.ts');
  const doc = await readBackupDocument(new File([await readFile(real)], 'real.zip'));
  const backup = parseBackup(doc);
  console.log(`  real export ${backup.appVersion}: settings ${backup.settings === null ? 'absent' : 'present'}`);
}

// Exercise the actual IndexedDB boundary, including an upgrade from the previous
// schema. These fixtures are synthetic; no personal backup or account is used.
try {
  for (const version of [10, 11]) {
    await db.delete();
    const old = new Dexie('thwart');
    old.version(version).stores(Object.fromEntries(db.tables
      .filter(table => table.name !== 'photos' && (version >= 11 || table.name !== 'backupMetadata'))
      .map(table => [table.name, [table.schema.primKey.src, ...table.schema.indexes.map(i => i.src)].join(', ')])));
    await old.open();
    await old.table('ownedPacks').put({ packCode: 'core', quantity: 1 });
    await old.table('appSettings').put({ ...parsed.settings, id: 'app' });
    if (version === 11) await old.table('backupMetadata').put({ id: 'app', extra: { retained: true }, settingsExtra: { retainedSetting: 0 } });
    old.close();
    await db.open();
    assert.equal((await db.ownedPacks.get('core')).quantity, 1);
    assert.equal((await exportBackup()).settings.cardLocale, 'fr');
    assert.equal(await db.photos.count(), 0);
    if (version === 11) {
      assert.equal((await exportBackup()).retained, true);
      assert.equal((await exportBackup()).settings.retainedSetting, 0);
    } else assert.equal(await db.backupMetadata.count(), 0);
    check(`v${version} to v12 upgrade keeps collection, settings and existing metadata`, true);
  }

  const android = JSON.parse(await readFile(new URL('./fixtures/backup-android-v2.json', import.meta.url), 'utf8'));
  const future = parseBackup(JSON.stringify({
    ...android,
    futureCollection: [{ id: 'opaque', nested: { enabled: false, value: null } }],
    futureFlag: null,
    // This is a wire key, not the metadata row's internal primary key.
    id: 'future-backup-id',
    settings: { ...parsed.settings, id: 'future-settings-id', futurePreference: { levels: [0, 2] } },
  }));
  await importBackup(future, 'replace');
  db.close();
  await db.open();
  const result = await exportBackup();
  assert.deepEqual(result.futureCollection, future.futureCollection);
  assert.equal(result.futureFlag, null);
  assert.equal(result.id, 'future-backup-id');
  assert.deepEqual(result.settings, future.settings);
  assert.deepEqual(result.ownedPacks, future.ownedPacks);
  assert.equal(result.plays.length, future.plays.length);
  assert.equal(result.formatVersion, 2);
  check('Android fixture and unknown root/settings fields survive storage and reopen', true);
  // Optional artifact for the Android repository's real restore/export test.
  // Only the synthetic fixture above is written, never a supplied personal file.
  if (process.env.THWART_BACKUP_ROUNDTRIP_OUTPUT) {
    await writeFile(process.env.THWART_BACKUP_ROUNDTRIP_OUTPUT, JSON.stringify(result, null, 2) + '\n');
  }

  // Sync may replace its known settings row; local opaque backup fields must
  // survive without entering any outgoing account collection.
  const remote = SETTINGS.rowOf('app', { ...parsed.settings, cardLocale: 'en' });
  await db.appSettings.put(remote);
  assert.deepEqual(SETTINGS.bodyOf(remote), { ...parsed.settings, cardLocale: 'en' });
  assert.ok(COLLECTIONS.every((mapping) => mapping.table().name !== 'backupMetadata'));
  assert.equal((await exportBackup()).settings.id, 'future-settings-id');
  assert.equal((await exportBackup()).settings.cardLocale, 'en');
  check('opaque fields remain local when known settings change through sync', true);

  const incoming = parseBackup(JSON.stringify({ formatVersion: 2, futureFlag: false, anotherField: 0 }));
  await importBackup(incoming, 'merge');
  await importBackup(incoming, 'merge');
  const merged = await exportBackup();
  assert.deepEqual(merged.futureCollection, future.futureCollection);
  assert.equal(merged.futureFlag, false);
  assert.equal(merged.anotherField, 0);
  assert.equal(merged.settings.id, 'future-settings-id');
  assert.equal(await db.backupMetadata.count(), 1);
  check('merge retains absent extras and incoming values win idempotently', true);

  const beforeFailure = await db.backupMetadata.get('app');
  await assert.rejects(importBackup({ ...future, newField: 'must roll back', ownedPacks: [{}] }, 'replace'));
  assert.deepEqual(await db.backupMetadata.get('app'), beforeFailure);
  assert.equal((await exportBackup()).settings.cardLocale, 'en');
  check('failed replacement restores metadata and existing rows atomically', true);

  const photo = { name: 'table.jpg', data: new Uint8Array([255, 216, 255, 217]) };
  const photoBackup = { ...future, photos: ['table.jpg', 'missing.jpg'], favouritePlays: [{ playId: future.plays[0].id, addedAt: 42 }] };
  await importBackup(photoBackup, 'replace', [photo, { name: 'unlisted.jpg', data: photo.data }]);
  db.close(); await db.open();
  assert.equal(await db.photos.count(), 1);
  assert.ok(COLLECTIONS.every(mapping => mapping.table().name !== 'photos'));
  const downloaded = await backupDownload();
  assert.equal(downloaded.extension, 'zip');
  const archive = await readBackupArchive(new File([downloaded.blob], 'backup.zip'));
  assert.deepEqual(archive.photos, [photo]);
  assert.deepEqual(JSON.parse(archive.document).photos, ['table.jpg']);
  assert.deepEqual(JSON.parse(archive.document).favouritePlays, photoBackup.favouritePlays);
  if (process.env.THWART_PHOTO_ROUNDTRIP_OUTPUT) {
    await writeFile(process.env.THWART_PHOTO_ROUNDTRIP_OUTPUT, new Uint8Array(await downloaded.blob.arrayBuffer()));
  }
  await importBackup(photoBackup, 'merge', [{ ...photo, data: new Uint8Array([1, 2]) }]);
  assert.deepEqual((await db.photos.get('table.jpg')).data, new Uint8Array([1, 2]));
  await assert.rejects(importBackup({ ...future, ownedPacks: [{}] }, 'replace', []));
  assert.equal(await db.photos.count(), 1);
  check('photo bytes survive reopen/export, stay local and merge/rollback atomically', true);

  await importBackup(parseBackup('{"formatVersion":2}'), 'replace');
  assert.equal(await db.photos.count(), 0);
  const replaced = await exportBackup();
  assert.equal('futureCollection' in replaced, false);
  assert.equal('id' in replaced, false);
  assert.equal(replaced.settings, null);
  check('replacement drops metadata from the replaced backup', true);

  await importBackup(future, 'merge');
  await clearEverything();
  assert.equal(await db.backupMetadata.count(), 0);
  assert.equal('futureCollection' in await exportBackup(), false);
  check('erase clears local backup metadata too', true);
} finally {
  await db.delete();
}

process.exit(failures === 0 ? 0 : 1);
