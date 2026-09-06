/// <reference lib="webworker" />

/**
 * The service worker.
 *
 * Hand-written rather than generated, because the interesting part here is not
 * the plumbing but deciding what may be served stale, and that decision is
 * different for each kind of thing this site serves.
 *
 * Three rules, and the reasoning for each:
 *
 * 1. **The shell is precached.** One HTML file, one script, one stylesheet and
 *    the icons: about 300 KB, with hashed names, so it can be cached hard and
 *    replaced wholesale when the hash changes. This is what makes the site open
 *    offline at all.
 *
 * 2. **Card data is stale-while-revalidate.** It is 18 MB in total, so
 *    precaching it is out of the question; it is cached as it is used, and a
 *    cached copy is served immediately while a fresh one is fetched in the
 *    background. That last part matters because the nightly job rewrites these
 *    files *without changing their names*. Cache-first would pin somebody to
 *    the card database they first loaded, for ever.
 *
 * 3. **Nothing cross-origin is touched.** MarvelCDB serves the card images and
 *    the deck import API. Images are the browser's own HTTP cache to manage,
 *    and caching them here would be re-hosting somebody else's artwork in a
 *    place we control. The deck API must never be served stale: importing a
 *    deck is a request for what MarvelCDB has *now*.
 *
 * 4. **The account API is never touched, at all.** Not cached, not read from
 *    cache, not revalidated. This was a real leak and not a precaution: every
 *    same-origin GET that was not a navigation or card data fell through to
 *    cacheFirst, which includes /api/v1/auth/devices, /api/v1/sync/changes and
 *    /api/v1/account/export. Those were stored keyed by URL alone — the Cache
 *    API does not know that `Authorization` exists — so one account's device
 *    list, records and export were served to whoever used the browser next.
 *    Reported from production: a newly registered account was shown a phone
 *    belonging to a different account.
 *
 *    The server had already said `Cache-Control: no-store` on every one of
 *    those responses. **The Cache API ignores cache directives**: `cache.put`
 *    stores whatever it is handed. That is the whole trap, and it is why the
 *    rule below is a path check and not a header check.
 */

const BUILD = '__BUILD_ID__';
const SHELL_CACHE = `thwart-shell-${BUILD}`;
const DATA_CACHE = 'thwart-data';

/** Written by the build. Hashed asset names, so they are safe to cache hard. */
const SHELL = __PRECACHE_MANIFEST__;

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      // Individually rather than addAll, so one missing file cannot fail the
      // whole install and leave the site with no worker at all.
      await Promise.all(
        SHELL.map((url) =>
          cache.add(new Request(url, { cache: 'reload' })).catch(() => undefined),
        ),
      );
      // Safe here: the build emits a single script and a single stylesheet, so
      // there are no lazily-loaded chunks for an open page to ask for after the
      // new worker has taken over.
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => name.startsWith('thwart-shell-') && name !== SHELL_CACHE)
          .map((name) => caches.delete(name)),
      );
      await self.clients.claim();
    })(),
  );
});

/** Serve from cache at once, and refresh the cache behind the reader's back. */
async function staleWhileRevalidate(request) {
  const cache = await caches.open(DATA_CACHE);
  const cached = await cache.match(request);

  const network = fetch(request)
    .then((response) => {
      if (response.ok && mayStore(response)) {
        cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => undefined);

  if (cached !== undefined) {
    // Deliberately not awaited: the point is to answer now.
    void network;
    return cached;
  }
  const fresh = await network;
  if (fresh !== undefined) {
    return fresh;
  }
  return new Response('', { status: 504, statusText: 'Offline' });
}

async function cacheFirst(request) {
  const cache = await caches.open(SHELL_CACHE);
  const cached = await cache.match(request);
  if (cached !== undefined) {
    return cached;
  }
  const response = await fetch(request);
  if (response.ok && mayStore(response)) {
    cache.put(request, response.clone());
  }
  return response;
}

/**
 * Whether a response may be written to a cache at all.
 *
 * The Cache API does not consult cache directives — `cache.put` stores whatever
 * it is given — so anything that says `no-store` has to be refused here or the
 * header means nothing. The rule above already keeps the account API out; this
 * is the second lock, so that a path added later cannot quietly reintroduce the
 * same leak.
 */
function mayStore(response) {
  const directive = response.headers.get('Cache-Control') ?? '';
  return !/no-store/i.test(directive);
}

/**
 * Every client-side route is the same document.
 *
 * Network first, so a deploy lands on the next visit rather than whenever the
 * cache happens to be evicted; the cached shell is the fallback, which is what
 * makes /decks work on a train.
 */
async function handleNavigation(request) {
  try {
    return await fetch(request);
  } catch {
    const cache = await caches.open(SHELL_CACHE);
    const shell = await cache.match('/index.html');
    return shell ?? new Response('Offline', { status: 503 });
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;

  if (request.method !== 'GET') {
    return;
  }

  const url = new URL(request.url);

  // MarvelCDB's images and its deck API. Left entirely alone: see the header.
  if (url.origin !== self.location.origin) {
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(handleNavigation(request));
    return;
  }

  /*
    The account API, left to the network entirely.

    Before any other rule, because the cost of getting this wrong is one
    person's data shown to another. `return` rather than respondWith: the
    request goes to the network exactly as if there were no worker.
  */
  if (url.pathname.startsWith('/api/')) {
    return;
  }

  if (url.pathname.startsWith('/data/')) {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }

  event.respondWith(cacheFirst(request));
});
