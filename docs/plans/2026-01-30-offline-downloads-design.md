# Offline Downloads for PWA

**Issue:** #47
**Date:** 2026-01-30
**Status:** Approved

## Overview

Enable offline listening in the PWA by downloading audiobooks for offline playback with full queue management and storage UI.

## Scope

**Included:**
- Download audiobooks to device storage (OPFS)
- Download queue with pause/resume/cancel
- Storage usage display and management
- Offline playback via service worker intercept
- Progress sync when back online with notification

**Not included (future):**
- Auto-download next book in series
- Wi-Fi only download option
- Quality/transcoding options

## Technical Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Storage API | OPFS only | Modern browser support (2+ years), IndexedDB too slow for large files |
| Browser fallback | None | Show "not supported" on older browsers |
| Download execution | Web Worker | Background downloads, responsive UI |
| Concurrent downloads | 1 at a time | Audiobooks are large, avoid overwhelming |
| Storage limits | None | Show usage, let users manage manually |
| Progress sync | Automatic + toast | Convenient with confirmation |

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      React App                               │
├─────────────────────────────────────────────────────────────┤
│  DownloadContext (React Context)                            │
│  - Exposes: downloads, downloadBook(), pauseDownload(),     │
│    resumeDownload(), cancelDownload(), deleteDownload()     │
│  - Tracks download state, progress, queue                   │
├─────────────────────────────────────────────────────────────┤
│  offlineStorage.js          │  download.worker.js           │
│  - OPFS wrapper             │  - Fetch + stream to OPFS     │
│  - Storage estimates        │  - Progress reporting         │
│                             │  - Pause/resume via Range     │
├─────────────────────────────────────────────────────────────┤
│  IndexedDB                                                  │
│  - Download metadata (status, progress, bytes)              │
│  - Offline progress queue                                   │
├─────────────────────────────────────────────────────────────┤
│  Service Worker (sw.js)                                     │
│  - Intercept /api/audiobooks/:id/stream                     │
│  - Serve from OPFS if available, else network               │
└─────────────────────────────────────────────────────────────┘
```

## Data Model

### IndexedDB: `downloads` store

```javascript
{
  id: "123",                     // audiobook ID
  status: "downloading",         // queued | downloading | paused | completed | error
  progress: 0.45,                // 0-1 percentage
  bytesDownloaded: 52428800,     // for resume support
  totalBytes: 116508800,
  startedAt: "2026-01-30T...",
  completedAt: null,
  error: null,
  // Cached metadata for offline display:
  title: "Project Hail Mary",
  author: "Andy Weir",
  narrator: "Ray Porter",
  duration: 58320,
  coverUrl: "/api/audiobooks/123/cover"
}
```

### IndexedDB: `offlineProgress` store

```javascript
{
  id: "progress-123-1706648400",
  audiobookId: "123",
  position: 3845,
  timestamp: "2026-01-30T...",
  synced: false
}
```

## Download Flow

1. User taps "Download" on book details page
2. `DownloadContext.downloadBook(audiobookId)` called
3. Fetch audiobook metadata, store in IndexedDB with status `queued`
4. Download and cache cover image to OPFS
5. Spawn/message Web Worker with download task
6. Worker fetches `/api/audiobooks/:id/stream` with auth token
7. Worker streams to OPFS via `FileSystemWritableFileStream`
8. Worker posts progress updates → Context → UI re-renders
9. On complete, update IndexedDB status to `completed`

### Pause/Resume

- **Pause:** Abort fetch, save `bytesDownloaded`, status → `paused`
- **Resume:** Fetch with `Range: bytes={bytesDownloaded}-`, append to OPFS file

### Queue Behavior

- Max 1 concurrent download
- FIFO order, auto-start next on complete
- Users can reorder from Download Manager

## Offline Playback

Service worker intercepts stream requests:

```javascript
self.addEventListener('fetch', (event) => {
  const match = url.pathname.match(/^\/api\/audiobooks\/(\d+)\/stream$/);
  if (match) {
    event.respondWith(serveFromOPFSOrNetwork(match[1], event.request));
    return;
  }
});
```

If book exists in OPFS, serve directly. Otherwise fetch from network. Player is unaware of the difference.

## Progress Sync

1. Listen to `online` event in DownloadContext
2. Query `offlineProgress` for unsynced records
3. POST each to `/api/audiobooks/:id/progress`
4. Delete on success
5. Show toast: "Synced progress for N books"

## UI Components

### DownloadButton (BookDetails page)

| State | Display |
|-------|---------|
| Not downloaded | "Download" button |
| Queued | "Queued (#N)", cancel option |
| Downloading | Progress bar, pause button |
| Paused | Resume/cancel buttons |
| Completed | "Downloaded ✓", delete option |
| Error | "Retry" button, error message |

### DownloadManager (profile dropdown → Downloads page)

- Storage bar: "2.3 GB used of 14.8 GB available"
- Downloading section: Active + queued downloads with controls
- Downloaded section: Completed books with size and delete button

### OfflineBadge

Small cloud-with-checkmark icon on book card thumbnails for downloaded books.

## Files

### New Files

```
client/src/
├── contexts/DownloadContext.jsx
├── services/offlineStorage.js
├── workers/download.worker.js
├── components/
│   ├── DownloadButton.jsx
│   ├── DownloadButton.css
│   ├── DownloadManager.jsx
│   ├── DownloadManager.css
│   └── OfflineBadge.jsx
├── pages/Downloads.jsx
└── pages/Downloads.css
```

### Modified Files

```
client/public/sw.js              # OPFS intercept for streams
client/src/App.jsx               # Route for /downloads
client/src/components/Navbar.jsx # Downloads link in profile dropdown
client/src/pages/BookDetails.jsx # Add DownloadButton
client/src/components/BookCard.jsx # Add OfflineBadge
```

## Implementation Order

1. `offlineStorage.js` - OPFS wrapper with basic tests
2. `download.worker.js` - Download worker with queue logic
3. `DownloadContext.jsx` - Wire together storage + worker
4. `DownloadButton.jsx` - Add to BookDetails page
5. `Downloads.jsx` - Page + navbar link
6. `sw.js` - Intercept for offline playback
7. Progress sync on reconnect
8. `OfflineBadge` - Add to book cards
