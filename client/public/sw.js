// Service Worker for Sappho PWA
// Vanilla service worker with tiered caching strategies

// ---------------------------------------------------------------------------
// Cache names - bump version to invalidate
// ---------------------------------------------------------------------------
const APP_SHELL_CACHE = 'app-shell-v3';
const API_CACHE = 'api-cache-v1';
const COVER_CACHE = 'cover-cache-v2';

const EXPECTED_CACHES = [APP_SHELL_CACHE, API_CACHE, COVER_CACHE];

// Cache size limits (LRU eviction when exceeded)
const API_CACHE_MAX = 50;
const COVER_CACHE_MAX = 1000;

// Resources to pre-cache during install
const PRECACHE_URLS = [
  '/',
  '/manifest.json'
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Strip authentication tokens from URLs so cached responses are keyed by
 * resource identity rather than per-session credentials.
 */
function getCacheKey(request) {
  const url = new URL(request.url);
  url.searchParams.delete('token');
  return url.toString();
}

/**
 * Evict the oldest entries when a cache exceeds maxItems (simple LRU).
 * Cache API stores entries in insertion order, so keys()[0] is the oldest.
 */
async function trimCache(cacheName, maxItems) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  const excess = keys.length - maxItems;
  if (excess > 0) {
    await Promise.all(keys.slice(0, excess).map(key => cache.delete(key)));
  }
}

/**
 * Check whether a request URL matches an app-shell asset
 * (HTML navigation, JS, CSS, fonts, or the root path).
 */
function isAppShellRequest(url) {
  const path = url.pathname;
  // Root navigation
  if (path === '/' || path === '/index.html') return true;
  // Vite-built assets and fonts
  if (path.match(/\.(js|css|woff2?)$/)) return true;
  // Static assets in public/
  if (path === '/manifest.json') return true;
  if (path.match(/\.(svg|png|ico)$/) && !path.startsWith('/api/')) return true;
  return false;
}

/**
 * Check whether a request is for an audiobook stream.
 */
function isAudioStreamRequest(url) {
  return /\/api\/audiobooks\/[^/]+\/stream/.test(url.pathname);
}

/**
 * Check whether a request is for a cover image.
 */
function isCoverRequest(url) {
  return /\/api\/audiobooks\/[^/]+\/cover/.test(url.pathname);
}

/**
 * Check whether a request is an API call.
 */
function isApiRequest(url) {
  return url.pathname.startsWith('/api/');
}

// ---------------------------------------------------------------------------
// Strategies
// ---------------------------------------------------------------------------

/**
 * Cache-first: Serve from cache if available, otherwise fetch from network
 * and store in cache. Used for app shell assets that rarely change.
 */
async function cacheFirst(request, cacheName) {
  const cacheKey = getCacheKey(request);
  const cache = await caches.open(cacheName);
  const cachedResponse = await cache.match(cacheKey);

  if (cachedResponse) {
    // Update cache in background (stale-while-revalidate for freshness)
    const fetchPromise = fetch(request).then(response => {
      if (response && response.status === 200) {
        cache.put(cacheKey, response.clone());
      }
      return response;
    }).catch(() => {});
    // Don't await - let it update in background
    return cachedResponse;
  }

  // Not in cache - fetch and store
  const response = await fetch(request);
  if (response && response.status === 200) {
    cache.put(cacheKey, response.clone());
  }
  return response;
}

/**
 * Network-first: Try the network, fall back to cache if offline.
 * Used for API responses where freshness matters but offline access is useful.
 */
async function networkFirst(request, cacheName, maxItems) {
  const cacheKey = getCacheKey(request);

  try {
    const response = await fetch(request);
    if (response && response.status === 200) {
      const cache = await caches.open(cacheName);
      cache.put(cacheKey, response.clone());
      // Trim cache in background
      trimCache(cacheName, maxItems).catch(() => {});
    }
    return response;
  } catch (err) {
    // Network failed - try cache
    const cache = await caches.open(cacheName);
    const cachedResponse = await cache.match(cacheKey);
    if (cachedResponse) {
      return cachedResponse;
    }
    // Nothing in cache either - throw so caller gets an error
    throw err;
  }
}

/**
 * Pure cache-first for cover images.
 * Serves from cache if available; fetches from network only on miss.
 * No background revalidation — covers are immutable (cache-busted via URL
 * parameter when they change), so re-fetching cached covers is wasteful.
 */
async function coverCacheFirst(request, cacheName, maxItems) {
  const cacheKey = getCacheKey(request);
  const cache = await caches.open(cacheName);
  const cachedResponse = await cache.match(cacheKey);

  if (cachedResponse) {
    return cachedResponse;
  }

  // Not cached — fetch, cache, and return
  const response = await fetch(request);
  if (response && response.status === 200) {
    cache.put(cacheKey, response.clone());
    trimCache(cacheName, maxItems).catch(() => {});
  }
  return response;
}

// ---------------------------------------------------------------------------
// Install event - pre-cache app shell
// ---------------------------------------------------------------------------
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(APP_SHELL_CACHE)
      .then(cache => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

// ---------------------------------------------------------------------------
// Activate event - clean old caches, claim clients
// ---------------------------------------------------------------------------
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then(cacheNames => {
        return Promise.all(
          cacheNames
            .filter(name => !EXPECTED_CACHES.includes(name))
            .map(name => {
              console.log('[SW] Deleting old cache:', name);
              return caches.delete(name);
            })
        );
      })
      .then(() => self.clients.claim())
  );
});

// ---------------------------------------------------------------------------
// Fetch event - route to appropriate strategy
// ---------------------------------------------------------------------------
self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Only handle GET requests
  if (request.method !== 'GET') return;

  // Skip chrome-extension and other non-http(s) schemes
  const url = new URL(request.url);
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return;

  // Skip cross-origin requests
  if (url.origin !== self.location.origin) return;

  // --- Audio streams: network-only (too large to cache) ---
  if (isAudioStreamRequest(url)) {
    // Let the browser handle it directly (no respondWith = passthrough)
    return;
  }

  // --- Cover images: pure cache-first (no background revalidation) ---
  if (isCoverRequest(url)) {
    event.respondWith(
      coverCacheFirst(request, COVER_CACHE, COVER_CACHE_MAX)
        .catch(() => new Response('', { status: 404, statusText: 'Not Found' }))
    );
    return;
  }

  // --- API calls: network-first with cache fallback ---
  if (isApiRequest(url)) {
    event.respondWith(
      networkFirst(request, API_CACHE, API_CACHE_MAX)
        .catch(() => new Response(
          JSON.stringify({ error: 'Offline and no cached data available' }),
          { status: 503, headers: { 'Content-Type': 'application/json' } }
        ))
    );
    return;
  }

  // --- App shell (HTML, JS, CSS, fonts, static assets): cache-first ---
  if (isAppShellRequest(url)) {
    event.respondWith(
      cacheFirst(request, APP_SHELL_CACHE)
        .catch(() => {
          // For navigation requests, try returning cached root page (SPA fallback)
          if (request.mode === 'navigate') {
            return caches.match('/');
          }
          return new Response('', { status: 503 });
        })
    );
    return;
  }

  // --- Navigation requests (SPA routes like /library, /player/1): cache-first on root ---
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(response => {
          if (response && response.status === 200) {
            const cache = caches.open(APP_SHELL_CACHE);
            cache.then(c => c.put(getCacheKey(request), response.clone()));
          }
          return response;
        })
        .catch(() => caches.match('/'))
        .then(response => response || new Response('Offline', { status: 503 }))
    );
    return;
  }

  // --- Everything else: network-first ---
  event.respondWith(
    fetch(request)
      .then(response => response)
      .catch(() => caches.match(getCacheKey(request)))
      .then(response => response || new Response('', { status: 503 }))
  );
});
