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
  }
  clone() {
    return new FakeResponse(this.body, { status: this.status, tag: this.tag });
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
let networkFails = false;
const networkCalls = [];

const self = {
  location: { origin: 'https://thwart.app' },
  addEventListener: (type, fn) => listeners.set(type, fn),
  skipWaiting: async () => undefined,
  clients: { claim: async () => undefined },
};

async function fakeFetch(request) {
  const url = typeof request === 'string' ? request : request.url;
  networkCalls.push(url);
  if (networkFails) {
    throw new Error('offline');
  }
  return new FakeResponse('fresh', { tag: 'network' });
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
  let waited;
  let responded;
  handler({
    ...event,
    waitUntil: (p) => {
      waited = p;
    },
    respondWith: (p) => {
      responded = p;
    },
  });
  await waited;
  return responded === undefined ? undefined : await responded;
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
