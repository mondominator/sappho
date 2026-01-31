// Service Worker for Sappho PWA
const CACHE_NAME = 'sappho-v1.6.0';
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

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
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

  // Check for audiobook stream requests - serve from OPFS if available
  const streamMatch = event.request.url.match(/\/api\/audiobooks\/(\d+)\/stream/);
  if (streamMatch) {
    event.respondWith(serveAudioFromOPFSOrNetwork(streamMatch[1], event.request));
    return;
  }

  // IMPORTANT: Never cache API requests - they contain auth tokens and dynamic data
  // This includes progress updates and all authenticated endpoints
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
// OPFS Audio Streaming for Offline Playback
// ============================================================================

const AUDIO_DIR = 'audiobooks';

/**
 * Get audio file from OPFS
 * @param {string} audiobookId - Audiobook ID
 * @returns {Promise<File|null>} File object or null if not found
 */
async function getAudioFromOPFS(audiobookId) {
  try {
    const root = await navigator.storage.getDirectory();
    const dir = await root.getDirectoryHandle(AUDIO_DIR);
    const fileName = `${audiobookId}.audio`;
    const fileHandle = await dir.getFileHandle(fileName);
    return await fileHandle.getFile();
  } catch (error) {
    if (error.name === 'NotFoundError') {
      return null;
    }
    console.error('Error getting audio from OPFS:', error);
    return null;
  }
}

/**
 * Serve audio from OPFS if available, otherwise fall back to network
 * Supports Range requests for seeking
 * @param {string} audiobookId - Audiobook ID
 * @param {Request} request - Original request
 * @returns {Promise<Response>}
 */
async function serveAudioFromOPFSOrNetwork(audiobookId, request) {
  try {
    const file = await getAudioFromOPFS(audiobookId);

    if (file) {
      console.log(`Serving audiobook ${audiobookId} from OPFS (offline)`);

      // Check for Range header (seeking)
      const rangeHeader = request.headers.get('Range');

      if (rangeHeader) {
        // Parse range request
        const match = rangeHeader.match(/bytes=(\d+)-(\d*)/);
        if (match) {
          const start = parseInt(match[1], 10);
          const end = match[2] ? parseInt(match[2], 10) : file.size - 1;
          const chunkSize = end - start + 1;

          // Create a slice of the file
          const chunk = file.slice(start, end + 1);

          return new Response(chunk, {
            status: 206,
            statusText: 'Partial Content',
            headers: {
              'Content-Type': file.type || 'audio/mpeg',
              'Content-Length': chunkSize,
              'Content-Range': `bytes ${start}-${end}/${file.size}`,
              'Accept-Ranges': 'bytes'
            }
          });
        }
      }

      // Full file response
      return new Response(file, {
        status: 200,
        headers: {
          'Content-Type': file.type || 'audio/mpeg',
          'Content-Length': file.size,
          'Accept-Ranges': 'bytes'
        }
      });
    }

    // File not in OPFS, fall back to network
    console.log(`Audiobook ${audiobookId} not in OPFS, fetching from network`);
    return fetch(request);

  } catch (error) {
    console.error('Error serving audio:', error);
    // Fall back to network on any error
    return fetch(request);
  }
}
