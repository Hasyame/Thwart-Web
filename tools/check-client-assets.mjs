/** Compare the independently buildable clients' shared definitions, vectors and logo geometry. */
import { readFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const web = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const android = process.argv[2];
if (!android) throw new Error('Pass the Android checkout path.');
for (const [left, right] of [
  ['web/public/achievements.json', 'app/src/main/assets/achievements.json'],
  ['docs/spec/achievements/test-vectors.json', 'app/src/test/resources/achievements/test-vectors.json'],
]) assert.deepEqual(readFileSync(join(web, left)), readFileSync(join(android, right)), left);
const normal = (path) => path.replace(/[\s,]+/g, '');
const xml = readFileSync(join(android, 'app/src/main/res/drawable/ic_launcher_foreground.xml'), 'utf8');
const paths = [...xml.matchAll(/android:pathData="([^"]+)"/g)].map((m) => normal(m[1]));
for (const file of ['web/public/icon.svg', 'web/src/components/Logo.svelte']) {
  const svg = readFileSync(join(web, file), 'utf8');
  assert.deepEqual([...svg.matchAll(/\sd="([^"]+)"/g)].map((m) => normal(m[1])), paths, `${file}: geometry`);
  assert.match(svg, /#FCC200/, `${file}: gold`);
  assert.match(svg, /-12/, `${file}: card rotation`);
}
console.log('Shared definitions, vectors and logo geometry agree.');
