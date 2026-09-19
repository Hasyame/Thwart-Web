/**
 * Exercises the built service worker's routing decisions in Node.
 *
 * The worker cannot be installed in every environment (an automated browser
 * often refuses to register one at all), and its interesting part is not the
 * install anyway. What matters is which strategy each kind of request gets,
 * because getting that wrong is silent: a stale card database, or a deck
 * import answered from a cache.
 *
 * So the globals a worker expects are stubbed, the built file is evaluated,
 * and each rule is asserted. Run with `npm run test:sw` after a build.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const HERE = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(HERE, '..', 'dist', 'sw.js'), 'utf8');

// --- the smallest believable service worker environment ---------------------

class FakeResponse {
  constructor(body = '', init = {}) {
    this.body = body;
    this.status = init.status ?? 200;
    this.ok = this.status >= 200 && this.status < 300;
    this.tag = init.tag;
    // A real Response always has these, and the worker reads Cache-Control to
    // decide whether a thing may be stored at all. A fake without them tests a
    // worker the browser will never run.
    this.headerBag = init.headers ?? {};
    this.headers = {
      get: (name) => {
        const key = Object.keys(this.headerBag).find(
          (k) => k.toLowerCase() === String(name).toLowerCase(),
        );
        return key === undefined ? null : this.headerBag[key];
      },
    };
  }
  clone() {
    return new FakeResponse(this.body, {
      status: this.status,
      tag: this.tag,
      headers: this.headerBag,
    });
  }
}

class FakeRequest {
  constructor(url, init = {}) {
    this.url = typeof url === 'string' ? url : url.url;
    this.method = init.method ?? 'GET';
    this.mode = init.mode ?? 'cors';
  }
}

class FakeCache {
  constructor() {
    this.store = new Map();
  }
  async match(request) {
    return this.store.get(typeof request === 'string' ? request : request.url);
  }
  async put(request, response) {
    this.store.set(typeof request === 'string' ? request : request.url, response);
  }
  async add(request) {
    const url = typeof request === 'string' ? request : request.url;
    if (url === failPrecache) throw new Error('asset unavailable');
    this.store.set(url, new FakeResponse('precached', { tag: 'precache' }));
  }
  async keys() {
    return [...this.store.keys()].map((url) => new FakeRequest(url));
  }
}

const cacheStorage = new Map();
const caches = {
  async open(name) {
    if (!cacheStorage.has(name)) {
      cacheStorage.set(name, new FakeCache());
    }
    return cacheStorage.get(name);
  },
  async keys() {
    return [...cacheStorage.keys()];
  },
  async delete(name) {
    return cacheStorage.delete(name);
  },
};

const listeners = new Map();
let failPrecache = null;
let skipWaitingCalls = 0;
let networkFails = false;
const networkCalls = [];

const self = {
  location: { origin: 'https://thwart.app' },
  addEventListener: (type, fn) => listeners.set(type, fn),
  skipWaiting: async () => { skipWaitingCalls += 1; },
  clients: { claim: async () => undefined },
};

/** Paths the fake network answers with a no-store header. */
const noStorePaths = new Set(['/private-thing']);

async function fakeFetch(request) {
  const url = typeof request === 'string' ? request : request.url;
  networkCalls.push(url);
  if (networkFails) {
    throw new Error('offline');
  }
  const headers = noStorePaths.has(new URL(url).pathname)
    ? { 'Cache-Control': 'no-store' }
    : {};
  return new FakeResponse('fresh', { tag: 'network', headers });
}

vm.createContext(
  Object.assign(globalThis, {
    self,
    caches,
    fetch: fakeFetch,
    Response: FakeResponse,
    Request: FakeRequest,
  }),
);
vm.runInThisContext(source, { filename: 'sw.js' });

/** Fires an event at the worker and returns what it answered with. */
async function fire(type, event) {
  const handler = listeners.get(type);
  assert.ok(handler, `no ${type} listener registered`);
  const waited = [];
  let responded;
  handler({
    ...event,
    waitUntil: (p) => {
      waited.push(p);
    },
    respondWith: (p) => {
      responded = p;
    },
  });
  const response = responded === undefined ? undefined : await responded;
  await Promise.all(waited);
  return response;
}

const results = [];
function check(name, fn) {
  try {
    fn();
    results.push(`  ok   ${name}`);
  } catch (error) {
    results.push(`  FAIL ${name}: ${error.message}`);
    process.exitCode = 1;
  }
}

// --- install: the shell, and only the shell ---------------------------------

await fire('install', {});
const shellName = (await caches.keys()).find((n) => n.startsWith('thwart-shell-'));
const shell = await caches.open(shellName);
const precached = (await shell.keys()).map((r) => r.url);

check('precaches the document', () => assert.ok(precached.includes('/index.html')));
check('precaches the manifest', () =>
  assert.ok(precached.includes('/manifest.webmanifest')));
check('precaches the hashed script', () =>
  assert.ok(precached.some((u) => u.startsWith('/assets/') && u.endsWith('.js'))));
check('precaches the hashed stylesheet', () =>
  assert.ok(precached.some((u) => u.startsWith('/assets/') && u.endsWith('.css'))));
check('precaches no card data', () =>
  assert.ok(!precached.some((u) => u.startsWith('/data/'))));

check('waits for old clients to close before activating', () => assert.equal(skipWaitingCalls, 0));
await caches.open('thwart-shell-old-build');
failPrecache = '/index.html';
await assert.rejects(fire('install', {}), /asset unavailable/);
check('failed install retains the old shell', () => assert.ok(cacheStorage.has('thwart-shell-old-build')));
failPrecache = null;
await fire('activate', {});
check('retires the old shell only on activation', () => assert.ok(!cacheStorage.has('thwart-shell-old-build')));

// --- fetch: one rule per kind of thing --------------------------------------

networkCalls.length = 0;
const crossOrigin = await fire('fetch', {
  request: new FakeRequest('https://marvelcdb.com/api/public/decklist/30000'),
});
check('leaves the MarvelCDB deck API alone', () =>
  assert.equal(crossOrigin, undefined));

const image = await fire('fetch', {
  request: new FakeRequest('https://marvelcdb.com/bundles/cards/01001a.png'),
});
check('leaves MarvelCDB images alone', () => assert.equal(image, undefined));

const post = await fire('fetch', {
  request: new FakeRequest('https://thwart.app/data/index.en.json', { method: 'POST' }),
});
check('ignores non-GET requests', () => assert.equal(post, undefined));

// Card data: first visit goes to the network, second is served from cache and
// refreshed behind the reader.
networkCalls.length = 0;
const dataFirst = await fire('fetch', {
  request: new FakeRequest('https://thwart.app/data/index.en.json'),
});
check('card data falls back to the network when uncached', () =>
  assert.equal(dataFirst.tag, 'network'));

// Mark the stored copy so the next answer can be told apart from a fresh
// fetch. Without this the assertion cannot fail: a cached response and a
// network one would both be tagged the same.
const dataCache = await caches.open('thwart-data');
const stored = await dataCache.match('https://thwart.app/data/index.en.json');
stored.tag = 'cached';

const dataSecond = await fire('fetch', {
  request: new FakeRequest('https://thwart.app/data/index.en.json'),
});
check('card data is served from cache once seen', () =>
  assert.equal(dataSecond.tag, 'cached'));
check('card data is still revalidated in the background', () =>
  assert.equal(networkCalls.filter((u) => u.endsWith('index.en.json')).length, 2));

/*
 * The account API, which must never be touched.
 *
 * This is a regression test for a real leak, not a precaution. Every
 * same-origin GET that was not a navigation or card data fell through to
 * cacheFirst, so /api/v1/auth/devices was stored keyed by URL alone — the Cache
 * API has no notion of an Authorization header — and the next account to use
 * the browser was served the previous one's device list. It was reported from
 * production: a freshly registered account was shown somebody else's phone.
 */
for (const path of [
  '/api/v1/auth/devices',
  '/api/v1/sync/changes?since=0',
  '/api/v1/account/export',
  '/api/v1/version',
]) {
  const handled = await fire('fetch', {
    request: new FakeRequest(`https://thwart.app${path}`),
  });
  check(`leaves ${path} to the network`, () => assert.equal(handled, undefined));
}

// And nothing of the account API may be sitting in a cache afterwards.
{
  const names = await caches.keys();
  let found = null;
  for (const name of names) {
    const cache = await caches.open(name);
    for (const key of await cache.keys()) {
      const url = typeof key === 'string' ? key : key.url;
      if (url.includes('/api/')) {
        found = `${name} holds ${url}`;
      }
    }
  }
  check('no account response is left in any cache', () => assert.equal(found, null));
}

/*
 * The second lock. The Cache API ignores cache directives — cache.put stores
 * whatever it is handed — so a response saying no-store has to be refused by
 * the worker itself or the header means nothing at all.
 */
{
  const before = (await caches.keys()).length;
  const secret = await fire('fetch', {
    request: new FakeRequest('https://thwart.app/private-thing'),
  });
  check('a no-store response is still served', () => assert.ok(secret !== undefined));

  let stored = false;
  for (const name of await caches.keys()) {
    const cache = await caches.open(name);
    for (const key of await cache.keys()) {
      const url = typeof key === 'string' ? key : key.url;
      if (url.includes('/private-thing')) {
        stored = true;
      }
    }
  }
  check('a no-store response is not written to a cache', () => assert.equal(stored, false));
  void before;
}

// A navigation offline must fall back to the precached document, which is what
// makes a client-side route work on a train.
networkFails = true;
const navigation = await fire('fetch', {
  request: new FakeRequest('https://thwart.app/decks', { mode: 'navigate' }),
});
check('serves the shell for a route when offline', () =>
  assert.equal(navigation.tag, 'precache'));
networkFails = false;

console.log('service worker routing:');
console.log(results.join('\n'));
console.log(process.exitCode === 1 ? '\nFAILED' : '\nall rules hold');
