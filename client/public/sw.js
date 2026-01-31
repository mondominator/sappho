// Service Worker for Sappho PWA
const CACHE_NAME = 'sappho-v1.7.0';
const AUDIO_CACHE_NAME = 'sappho-audio-v1';

const urlsToCache = [
  '/',
  '/index.html',
  '/logo.svg',
  '/icon-192.png',
  '/icon-512.png',
  '/manifest.json'
];

// Install event - cache assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('Opened cache');
        return cache.addAll(urlsToCache);
      })
      .catch((err) => {
        console.log('Cache failed:', err);
      })
  );
  self.skipWaiting();
});

// Activate event - clean up old caches (but keep audio cache)
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          // Keep the current app cache and audio cache
          if (cacheName !== CACHE_NAME && cacheName !== AUDIO_CACHE_NAME) {
            console.log('Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// Fetch event - network first, falling back to cache
self.addEventListener('fetch', (event) => {
  // Skip chrome extension requests
  if (event.request.url.startsWith('chrome-extension://')) {
    return;
  }

  // Skip cross-origin requests
  if (!event.request.url.startsWith(self.location.origin)) {
    return;
  }

  // Check for audiobook stream requests - serve from cache if available
  const streamMatch = event.request.url.match(/\/api\/audiobooks\/(\d+)\/stream/);
  if (streamMatch) {
    event.respondWith(serveAudioFromCacheOrNetwork(streamMatch[1], event.request));
    return;
  }

  // IMPORTANT: Never cache API requests - they contain auth tokens and dynamic data
  if (event.request.url.includes('/api/')) {
    event.respondWith(fetch(event.request));
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // Don't cache non-successful responses
        if (!response || response.status !== 200 || response.type !== 'basic') {
          return response;
        }

        // Clone the response
        const responseToCache = response.clone();

        caches.open(CACHE_NAME)
          .then((cache) => {
            cache.put(event.request, responseToCache);
          });

        return response;
      })
      .catch(() => {
        // Network failed, try cache
        return caches.match(event.request)
          .then((response) => {
            if (response) {
              return response;
            }
            // If not in cache and network failed, return offline page
            return caches.match('/index.html');
          });
      })
  );
});

// ============================================================================
// Cache-based Audio Streaming for Offline Playback
// ============================================================================

/**
 * Serve audio from Cache API if available, otherwise fall back to network
 * Supports Range requests for seeking
 * @param {string} audiobookId - Audiobook ID
 * @param {Request} request - Original request
 * @returns {Promise<Response>}
 */
async function serveAudioFromCacheOrNetwork(audiobookId, request) {
  try {
    // Check the audio cache
    const cache = await caches.open(AUDIO_CACHE_NAME);
    const cacheUrl = `/api/audiobooks/${audiobookId}/stream`;
    const cachedResponse = await cache.match(cacheUrl);

    if (cachedResponse) {
      console.log(`Serving audiobook ${audiobookId} from cache (offline)`);

      // Check for Range header (seeking)
      const rangeHeader = request.headers.get('Range');

      if (rangeHeader) {
        // We need to handle range requests manually for cached responses
        const blob = await cachedResponse.clone().blob();
        const match = rangeHeader.match(/bytes=(\d+)-(\d*)/);

        if (match) {
          const start = parseInt(match[1], 10);
          const end = match[2] ? parseInt(match[2], 10) : blob.size - 1;
          const chunkSize = end - start + 1;

          // Create a slice of the blob
          const chunk = blob.slice(start, end + 1);

          return new Response(chunk, {
            status: 206,
            statusText: 'Partial Content',
            headers: {
              'Content-Type': blob.type || 'audio/mpeg',
              'Content-Length': chunkSize,
              'Content-Range': `bytes ${start}-${end}/${blob.size}`,
              'Accept-Ranges': 'bytes'
            }
          });
        }
      }

      // Return full cached response (clone it since responses can only be used once)
      const blob = await cachedResponse.blob();
      return new Response(blob, {
        status: 200,
        headers: {
          'Content-Type': blob.type || 'audio/mpeg',
          'Content-Length': blob.size,
          'Accept-Ranges': 'bytes'
        }
      });
    }

    // Not in cache, fall back to network
    console.log(`Audiobook ${audiobookId} not cached, fetching from network`);
    return fetch(request);

  } catch (error) {
    console.error('Error serving audio:', error);
    // Fall back to network on any error
    return fetch(request);
  }
}
