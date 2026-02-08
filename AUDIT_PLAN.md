# Sappho Comprehensive Audit & Improvement Plan

This plan was created from a full-app audit covering metadata, scanning, covers, embedding, security, frontend, API, database, and infrastructure. Issues are tracked on GitHub (#256-#316).

## Phase 1: Critical Fixes ✅ COMPLETE

### 1A: Database Foundation ✅
- [x] #268 Enable `PRAGMA foreign_keys = ON` (`database.js`)
- [x] #273 Enable WAL journal mode (`database.js`)
- [x] #269 Add 13 performance indexes (`migrations/023_add_performance_indexes.js`)
- [x] #270 Wrap force-rescan in transaction (`maintenance.js`)

### 1B: Security Hardening ✅
- [x] #280 Docker non-root user (`Dockerfile`)
- [x] #283 Docker HEALTHCHECK (`Dockerfile`)
- [x] #284 Create `.dockerignore`
- [x] #281 Remove default JWT_SECRET (`docker-compose.yml`)
- [x] #282 Graceful shutdown handlers (`index.js` — SIGTERM/SIGINT)

### 1C: Broken Features ✅
- [x] #279 Fix WebSocket API key auth (async callbacks in `websocketManager.js`)
- [x] #256 Add missing audio format extensions (.opus, .aac, .wav, .wma)

### 1D: Crash Prevention ✅
- [x] #257 Fix genre array assumption (`fileProcessor.js`)
- [x] #294 Add stream error handlers (`audiobooks.js`)
- [x] #295 Validate range requests — return 416 for invalid ranges
- [x] #297 Cap API limit parameter to max 200

---

## Phase 2: Metadata & Scanner Fixes

### 2A: Tag Reading ✅ COMPLETE
- [x] #259 Fix title fallback / encoding issues for non-UTF-8 tags
- [x] #258 Remove ISRC-as-ISBN fallback
- [x] #265 Smart comment tag handling for descriptions (detect chapters vs prose)
- [x] #266 Loosen series detection genre filter
- [x] #260 Extract chapters from all formats (not just M4B/M4A)

### 2B: Tag Writing ✅ COMPLETE
- [x] #261 Fix MP3 series tag round-trip (write TXXX:SERIES, not album/grouping)
- [x] #262 Extend ffmpeg embedding to parity with tone (chapters, subtitle, ASIN, ISBN, etc.)
- [x] #263 Add backup before metadata embedding
- [x] #264 Implement tag preservation (merge, don't overwrite)

### 2C: Scanner & Covers ✅ COMPLETE
- [x] #274 Fix M4B subdirectory merging (remove `!hasM4BFiles` condition)
- [x] #275 Batch DB queries during scan (load paths into memory Set)
- [x] #276 Fix cover filename collision (use audiobook ID or content hash)
- [x] #277 Add HTTP caching headers on cover endpoint

---

## Phase 3: Code Architecture

### 3A: Backend Split (3-4 days)
- [x] #303 Split `audiobooks.js` (3,259 lines) into 7 route modules:
  - `routes/audiobooks/index.js` — Core CRUD
  - `routes/audiobooks/metadata.js` — External API searches, refresh, embed
  - `routes/audiobooks/stream.js` — Stream and download
  - `routes/audiobooks/conversion.js` — M4B conversion jobs
  - `routes/audiobooks/progress.js` — Progress tracking
  - `routes/audiobooks/aggregates.js` — Meta endpoints (series, authors, genres)
  - `routes/audiobooks/batch.js` — Batch operations, favorites, recaps
- [x] #305 Create `utils/db.js` abstraction layer (promisified queries, async/await everywhere)
- [x] #307 Extract duplicated query helpers
- [x] #306 Split `maintenance.js` (1,655 lines) into 5 route modules:
  - `routes/maintenance/logs.js` — Log viewing, clearing, job status
  - `routes/maintenance/statistics.js` — Library statistics, format breakdowns
  - `routes/maintenance/library.js` — Consolidate, clear, scan, migrate, force rescan
  - `routes/maintenance/duplicates.js` — Duplicate detection and merging
  - `routes/maintenance/cleanup.js` — Orphan directories, library organization

### 3B: Frontend Split (2-3 days)
- [x] #304 Extract `AudioPlayer.jsx` (1,845→1,373 lines) into sub-components:
  - `player/PlaybackControls.jsx` — Reusable play/pause/skip (desktop + fullscreen)
  - `player/FullscreenPlayer.jsx` — Fullscreen view with progress bar
  - `player/ChapterModal.jsx` — Chapter list modal
  - `player/SpeedMenu.jsx` — Playback speed selection
  - `player/SleepTimerMenu.jsx` — Sleep timer selection
  - `player/useProgressSync.js` — 5s progress sync hook
- [ ] #308 Remove debug console.logs from client
- [ ] #309 Fix timeupdate re-render (use rAF + refs instead of state)

---

## Phase 4: Performance & Polish

### 4A: API Hardening (2 days)
- [ ] #296 Add transaction to multi-file upload
- [ ] #298 Stop leaking DB errors to clients (generic messages)
- [ ] #299 Add timeouts to external API calls (AbortController)
- [ ] #300 Fix progress update race condition (keep furthest position)
- [ ] #272 Replace O(n²) duplicate detection with SQL GROUP BY

### 4B: Frontend Performance (2 days)
- [ ] #278 Thumbnail generation with sharp (120px, 300px, 600px)
- [ ] #292 Add `loading="lazy"` to cover images
- [ ] #293 Route-based code splitting (React.lazy)
- [ ] #312 Add compression middleware

### 4C: Infrastructure (2 days)
- [ ] #285 Re-enable Helmet security headers with Vite-compatible CSP
- [ ] #286 WebSocket ping/pong heartbeat (30s interval, remove dead connections)
- [ ] #287 Add ffmpeg conversion process limit (max 2 concurrent)
- [ ] #302 Add structured logging (pino or winston)
- [ ] #301 Resource limits in docker-compose

---

## Phase 5: Enhancements

### 5A: PWA & Offline (high priority — iOS users depend on this)
- [ ] #288 Fix service worker (remove unregister code, proper caching strategy)
  - Re-enable sw.js registration in main.jsx
  - Fix API bypass so audio streams are cacheable
  - Strip tokens from cache keys
  - Add cache eviction (LRU, configurable size limit)
  - Add "Download for offline" UI per audiobook
  - Background download with progress indication
  - Show cached/offline status in library
  - Queue progress updates offline, replay on reconnect (#290)
- [ ] #290 Offline progress queue (IndexedDB + sendBeacon)
- [ ] #289 Media error recovery (retry on network, notify on decode errors)

### 5B: Metadata Enhancements
- [ ] #267 External metadata file support (desc.txt, reader.txt, .opf)

### 5C: Frontend Enhancements
- [ ] #291 Progress sync debouncing (AbortController)
- [ ] #310 Virtual scrolling for large libraries (react-window)
- [ ] #311 Accessibility (ARIA labels, keyboard shortcuts, screen reader)
- [ ] #313 SQLite FTS5 full-text search
- [ ] #314 Vite build optimization (manual chunks)

### 5D: Security Polish
- [ ] #315 Trust proxy configuration
- [ ] #316 Password minimum increase (6 → 8 chars)

---

## Key Files Reference

### Largest Files (refactoring targets)
| File | Lines | Issue |
|------|-------|-------|
| `server/routes/audiobooks.js` | 3,259 | #303 ✅ Split into 7 modules |
| `client/src/components/AudioPlayer.jsx` | 1,373 | #304 ✅ |
| `server/routes/maintenance.js` | 1,655 | #306 ✅ Split into 5 modules |
| `server/services/libraryScanner.js` | 1,042 | OK for now |
| `client/src/pages/AudiobookDetail.jsx` | 877 | Could split later |

### Core Metadata Pipeline
- `server/services/fileProcessor.js` — Tag reading (music-metadata)
- `server/services/libraryScanner.js` — File discovery, chapter extraction (ffprobe)
- `server/services/metadataScraper.js` — Google Books API enrichment
- `server/routes/audiobooks/metadata.js` — Tag writing (tone for M4B, ffmpeg for MP3)

### Database
- `server/database.js` — Schema, connection, migrations runner
- `server/migrations/` — 23 migration files

### Frontend Player
- `client/src/components/AudioPlayer.jsx` — Full player implementation
- `client/src/api.js` — API client, auth interceptors
- `client/public/sw.js` — Service worker (currently disabled)
- `client/src/main.jsx` — Entry point (unregisters SW on line 15-23)
