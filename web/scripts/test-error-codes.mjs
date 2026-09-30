// Every error code the server can send has a message in both languages.
//
// The bug hunt of 2026-09-30 found eight codes that fell through to "Something
// went wrong on the server", among them an expired confirmation link and a
// refused sync cursor. This reads the codes out of the Go source, so a new one
// fails here until somebody writes what it means.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { en } from '../src/lib/strings/en.ts';
import { fr } from '../src/lib/strings/fr.ts';

const server = join(import.meta.dirname, '..', '..', 'server');
const codes = new Set();
for (const file of readdirSync(server)) {
  if (!file.endsWith('.go') || file.endsWith('_test.go')) continue;
  for (const m of readFileSync(join(server, file), 'utf8').matchAll(/code:\s+"([a-z_]+)"/g)) {
    codes.add(m[1]);
  }
}
assert.ok(codes.size >= 20, `found only ${codes.size} codes; is the pattern still right?`);

// Where a code is shown decides which map must know it.
const BGG = (code) => code.startsWith('bgg_');
// The generic sentence is the right one for these.
const GENERIC = new Set(['server_error']);

let checked = 0;
for (const strings of [en, fr]) {
  const genericAccount = strings.accountError('no_such_code');
  const genericBgg = strings.bggError('no_such_code');
  for (const code of codes) {
    if (GENERIC.has(code)) continue;
    if (code === 'bgg_uncertain') {
      assert.ok(strings.bggUncertain.length > 0, 'bgg_uncertain has its own sentence');
    } else if (BGG(code)) {
      assert.notEqual(strings.bggError(code), genericBgg, `bggError has no message for ${code}`);
    } else {
      assert.notEqual(strings.accountError(code), genericAccount, `accountError has no message for ${code}`);
    }
    checked += 1;
  }
}
console.log(`ok   ${checked / 2} server error codes have a message in en and fr`);
