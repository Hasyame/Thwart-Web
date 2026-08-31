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
import { readFile } from 'node:fs/promises';
import { parseBackup } from '../src/lib/backup.ts';

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

process.exit(failures === 0 ? 0 : 1);
