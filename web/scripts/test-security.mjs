import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { safeCardMarkup } from '../src/lib/safeMarkup.js';
import { cardHtml } from '../src/lib/cardText.ts';
import { routeFromPath } from '../src/lib/router.ts';

// Browser-valid malformed tags must not survive an importer or stale cache.
for (const input of ['<img/src=x/onerror=alert(1)>', '<svg/onload=alert(1)>', '<script>alert(1)</script>', '<iframe srcdoc="<script>alert(1)</script>">', '<img src=x', '<!--><img src=x onerror=alert(1)>']) {
  assert.ok(!/<(?:img|svg|script|iframe|!)/i.test(safeCardMarkup(input)), input);
  assert.ok(!/<(?:img|svg|script|iframe|!)/i.test(cardHtml(input)), input);
}
assert.equal(safeCardMarkup('<b onclick="alert(1)">Text</b>'), '<b>Text</b>');
assert.equal(cardHtml('[[AERIAL]] <em>Text</em>'), '<b><i>AERIAL</i></b> <em>Text</em>');
assert.equal(safeCardMarkup('<span data-icon="energy"></span>'), '<span data-icon="energy"></span>');
assert.ok(safeCardMarkup('<span data-icon="energy" onclick="alert(1)">').startsWith('&lt;'));
assert.equal(safeCardMarkup('&lt;img&gt;'), '&lt;img&gt;');
for (const path of ['/card/%E0%A4%A', '/decks/%ZZ', '/decks/%ZZ/edit']) {
  assert.equal(routeFromPath(path, '/').name, 'notFound');
}
assert.equal(routeFromPath('/decks/a%20b/edit', '/').id, 'a b');
const policy = readFileSync(new URL('../../deploy/nginx-thwart-security.conf', import.meta.url), 'utf8');
assert.match(policy, /script-src 'self';/);
assert.match(policy, /img-src 'self' data: blob:/);
console.log('Security regressions: malformed markup, cached text, malformed routes and image CSP passed.');
