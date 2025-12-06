# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Sappho is a modern, self-hosted audiobook streaming server with automatic metadata extraction, progress tracking, and a Progressive Web App (PWA) interface. It provides a native-like mobile experience with offline capabilities and supports multi-user accounts.

**Tech Stack:**
- **Backend:** Node.js + Express, SQLite (sqlite3), WebSocket for real-time updates
- **Frontend:** React + Vite, modern mobile-first UI with PWA support
- **Media Processing:** music-metadata for ID3/Vorbis tag extraction
- **File Watching:** chokidar for automatic library scanning
- **Authentication:** JWT tokens with bcrypt password hashing

## Development Commands

**IMPORTANT: This project is containerized and runs in Docker in production. For local development, you can run it directly with npm commands below.**

### Running the Application

```bash
# Install dependencies (both server and client)
npm install
cd client && npm install

# Development - server only (API on port 3001/3002)
npm run dev

# Development - client only (frontend with hot reload)
npm run client
# OR
cd client && npm run dev

# Build frontend for production
npm run build
# OR
cd client && npm run build

# Production - server serves built frontend
npm start
```

### Docker Commands

```bash
# Build and start
docker-compose build
docker-compose up -d

# Rebuild without cache (required after code changes)
docker-compose build --no-cache
docker-compose up -d

# View logs
docker-compose logs -f
# OR
docker logs sappho-container-name --follow

# Stop
docker-compose down
```

**Important:** Like all Docker deployments, source code is not mounted - it's baked into the image. After code changes, rebuild with `--no-cache` to ensure changes are included.

## Architecture

### High-Level Data Flow

1. **File System Layer** - Audiobook storage and monitoring:
   - `AUDIOBOOKS_DIR` (default `/app/data/audiobooks`) - Main library, can mount existing collections
   - `WATCH_DIR` (default `/app/data/watch`) - Drop folder for auto-import
   - **Library Scanner** (`services/libraryScanner.js`) - Periodic background scan (every 5 min default)
   - **File Watcher** (`services/fileWatcher.js`) - Real-time monitoring of watch directory with chokidar
   - **File Processor** (`services/fileProcessor.js`) - Handles file moves, metadata extraction

2. **Metadata Extraction** (`services/metadataScraper.js`):
   - Uses `music-metadata` library to parse audio files
   - Supports: ID3v2 (MP3, M4B, M4A), Vorbis comments (FLAC, OGG)
   - Extracts: title, author, narrator, series, duration, cover art, ISBN, year
   - Custom fields: series position, narrator (from TXXX/comment tags)
   - Saves extracted cover art as separate file in audiobook directory

3. **Database Layer** (`server/database.js`):
   - SQLite with async callback API (sqlite3 package, not better-sqlite3)
   - Tables: `users`, `audiobooks`, `progress`, `api_keys`, `sessions`, `migrations`
   - Migration system: `server/migrations/` directory with numbered .js files
   - Migrations run automatically on startup (via `runMigrations()` in database.js)
   - Manual trigger available via POST `/api/maintenance/migrate` endpoint

4. **Authentication** (`server/auth.js`):
   - JWT-based authentication with configurable secret (`JWT_SECRET` env var)
   - Three authentication middlewares:
     - **`authenticateToken()`** - Standard Bearer token auth via Authorization header
     - **`authenticateMediaToken()`** - Query string token auth for media endpoints (covers, streams, avatars)
     - **API key validation** - Long-lived keys for external integrations (e.g., OpsDec)
   - Token types:
     - **Session tokens** - Short-lived, returned on login for browser/app use
     - **API keys** - Long-lived, managed via `/api/api-keys` for external integrations
   - Default admin created on first startup with password "admin" (forced password change on first login)
   - Password requirements: 12+ characters, uppercase, lowercase, number, special character

5. **Session Management** (`services/sessionManager.js`):
   - In-memory tracking of active playback sessions (not persisted to DB)
   - Maps: `sessions` (sessionId → session data), `userSessions` (userId → Set of sessionIds)
   - Session timeout: 5 minutes of inactivity marks session as stale
   - Cleanup interval: Every 15 seconds removes stale sessions
   - Tracks: position, progress %, state (playing/paused/stopped), client info (IP, platform)

6. **WebSocket Layer** (`services/websocketManager.js`):
   - Real-time bidirectional communication for live updates
   - Events:
     - `session.update` - Active session state changed
     - `session.start` - New session started
     - `session.stop` - Session ended
     - `library.update` - New audiobook added to library
   - OpsDec integration: Connects as WebSocket client, receives session updates

7. **Progress Tracking** (`routes/audiobooks.js`):
   - POST `/api/audiobooks/:id/progress` - Update playback position
   - Stores in `progress` table per user
   - Updates session in SessionManager (triggers WebSocket broadcast)
   - Returns updated progress and session state

8. **API Routes**:
   - `/api/auth` - Login, register, token refresh
   - `/api/audiobooks` - Library CRUD, streaming, progress updates, cover art
   - `/api/sessions` - Active sessions query (for OpsDec)
   - `/api/upload` - Audiobook upload (multipart/form-data)
   - `/api/api-keys` - API key management for external integrations
   - `/api/users` - User management (admin only)
   - `/api/profile` - Current user profile and settings
   - `/api/settings` - Server settings
   - `/api/maintenance` - Database migrations, cleanup tasks

### Library Import Flow

1. **Mount existing library** to `/app/data/audiobooks` (can be read-only)
2. **Server starts immediately** - doesn't block on initial scan
3. **Background scan** (`libraryScanner.js`):
   - Recursively walks directory tree
   - Checks each file against database (by file path)
   - If not found: extract metadata with `metadataScraper.js`, insert into DB
   - If found: skip (no duplicate imports)
4. **Periodic rescanning** (configurable via `LIBRARY_SCAN_INTERVAL` in minutes)
5. **Watch directory** (`fileWatcher.js`):
   - Real-time monitoring of `/app/data/watch`
   - On file added: process immediately, move to library
   - Processes one file at a time (queued)

### Client IP Detection

For integrations like OpsDec that need real client IPs behind reverse proxies:

**Implementation** (`routes/audiobooks.js` - `getClientIP()` function):
```javascript
function getClientIP(req) {
  // 1. Check X-Forwarded-For (proxy/load balancer)
  const xForwardedFor = req.headers['x-forwarded-for'];
  if (xForwardedFor) {
    const ips = xForwardedFor.split(',').map(ip => ip.trim());
    return ips[0]; // First IP is original client
  }

  // 2. Check X-Real-IP (reverse proxy)
  const xRealIP = req.headers['x-real-ip'];
  if (xRealIP) return xRealIP;

  // 3. Check CF-Connecting-IP (Cloudflare)
  const cfConnectingIP = req.headers['cf-connecting-ip'];
  if (cfConnectingIP) return cfConnectingIP;

  // 4. Fallback to direct connection
  return req.ip || req.connection.remoteAddress || null;
}
```

Used in:
- Progress updates (stored in session)
- Session tracking (broadcasted to OpsDec)

### Progressive Web App (PWA)

**Manifest** (`client/public/manifest.json`):
- App name, icons, theme colors
- `display: standalone` - Opens without browser UI
- `start_url: /` - Landing page

**Service Worker** (`client/public/sw.js`):
- Caches app shell (HTML, JS, CSS) for offline access
- **Requires HTTPS** for full PWA features (service worker registration)
- On HTTP: Still installable as "Add to Home Screen" bookmark

**Installation**:
- iOS: Safari → Share → Add to Home Screen
- Android: Chrome → Menu → Install app

## Important Implementation Details

### Database Operations

Sappho uses async callback-based sqlite3 (not synchronous better-sqlite3 like OpsDec):

```javascript
// Queries with callbacks
db.get('SELECT * FROM users WHERE id = ?', [userId], (err, row) => {
  if (err) return callback(err);
  callback(null, row);
});

// Promises wrapper pattern
const getUserById = (userId) => {
  return new Promise((resolve, reject) => {
    db.get('SELECT * FROM users WHERE id = ?', [userId], (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
};
```

### Migrations

Located in `server/migrations/`:
- Numbered files: `001_create_chapters.js`, `002_add_columns.js`, `003_clean_descriptions.js`
- Run automatically on startup via `runMigrations()` in `database.js`
- Manual trigger available via POST `/api/maintenance/migrate` endpoint
- Tracks applied migrations in `migrations` table
- Each migration exports `up(db)` and `down(db)` functions

### Authentication Middleware

Two authentication middlewares in `server/auth.js`:

**`authenticateToken()`** - For API endpoints:
- Checks `Authorization: Bearer <token>` header
- Validates JWT signature with `JWT_SECRET`
- Distinguishes between session tokens and API keys by payload structure
- Sets `req.user` object with user info for downstream handlers
- **Security**: Does NOT accept query string tokens (OWASP API2:2023 compliance)

**`authenticateMediaToken()`** - For media endpoints (covers, streams, avatars):
- Accepts token via query string (`?token=...`) for `<img>` and `<audio>` tag compatibility
- Falls back to Authorization header if no query token
- Used for: `/api/audiobooks/:id/cover`, `/api/audiobooks/:id/stream`, `/api/profile/avatar`
- **Note**: Query string tokens are logged in server access logs - acceptable tradeoff for media delivery

### Session Broadcasting

When playback position updates:
1. `POST /api/audiobooks/:id/progress` receives position
2. Updates `progress` table for user
3. Calls `sessionManager.updateSession()` with full audiobook + user data
4. SessionManager updates in-memory map
5. Returns updated session object
6. Route handler broadcasts via `websocketManager.broadcastSessionUpdate(session, 'session.update')`
7. Connected WebSocket clients (including OpsDec) receive event

### Metadata Extraction Edge Cases

- **Series detection**: Checks iTunes movement tags (`©mvn`), explicit SERIES tags, with genre/category filtering
- **Genre filtering**: Values with multiple commas or genre keywords are skipped as series candidates
- **Narrator**: Checks `TXXX:NARRATOR`, `PERFORMER`, `ARTIST` tags in order
- **Cover art**: Extracts embedded image, or looks for external cover.jpg/png in audiobook directory
- **Duration**: Read from audio metadata, stored in seconds
- **File size**: Used to estimate bitrate (`file_size / duration * 8 / 1000` = kbps)
- **Description**: HTML tags are stripped and entities decoded during extraction

### Metadata Embedding

Sappho can write metadata back to audio files via POST `/api/audiobooks/:id/embed-metadata`:

- **M4B/M4A files**: Uses `tone` CLI tool for proper audiobook tags:
  - Movement name/index for series info
  - Narrator field
  - Long description
  - Embedded cover art
  - Chapter markers
- **MP3 files**: Uses `ffmpeg` for ID3v2 tags

### Force Rescan

POST `/api/maintenance/force-rescan` clears and reimports all audiobooks:

1. Backs up playback progress (by file path)
2. Backs up user-set covers (cover_path)
3. Deletes all audiobook records
4. Rescans library from scratch
5. Restores progress by matching file paths
6. Restores user covers by matching file paths

This preserves user data while getting fresh metadata extraction.

## Key Files Reference

- `server/index.js` - Express app setup, route registration, WebSocket initialization, static file serving
- `server/database.js` - SQLite connection, schema initialization
- `server/auth.js` - JWT authentication, default admin creation, token verification middleware
- `server/services/sessionManager.js` - In-memory session tracking with timeout/cleanup
- `server/services/websocketManager.js` - WebSocket server, broadcasting to connected clients
- `server/services/libraryScanner.js` - Periodic background library scanning
- `server/services/fileWatcher.js` - Real-time watch directory monitoring
- `server/services/metadataScraper.js` - Audio file metadata extraction with music-metadata
- `server/routes/audiobooks.js` - Audiobook CRUD, streaming, progress tracking, cover art
- `server/routes/sessions.js` - Query active sessions (for OpsDec integration)
- `client/src/pages/Player.jsx` - Audio player component with progress sync

## CI/CD Pipeline

### Workflows (`.github/workflows/`)

**`security.yml`** - Security Checks (runs on PRs to main):
- **API2 - Broken Authentication**: OWASP API2:2023 scanner checks for auth vulnerabilities
- **Dependency Vulnerabilities**: npm audit for high/critical issues
- **Secret Detection**: Gitleaks scans for leaked secrets
- **CodeQL Analysis**: Static analysis for JavaScript security issues
- Required status check for merging to main (branch protection enabled)

**`docker.yml`** - Build Docker Image (runs on all pushes):
- Builds on every push to any branch
- Tags with branch name (e.g., `ghcr.io/mondominator/sappho:feature-branch`)
- On main branch, also tags as `latest`
- Pushes to GitHub Container Registry (ghcr.io)

### Branch Protection

Main branch requires:
- "API2 - Broken Authentication" check to pass before merge
- Strict mode: branch must be up to date with main

### Security Scanner

Custom OWASP API2:2023 scanner (`.github/scripts/owasp-api2-scanner.js`):
- Scans for broken authentication patterns
- Checks: hardcoded credentials, weak JWT config, missing auth middleware
- Intentionally allows `authenticateMediaToken` for query string tokens on media endpoints
- Fails CI on Critical/High/Medium findings

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 3001 | Server port |
| `JWT_SECRET` | (required) | Secret for signing JWTs |
| `DATABASE_PATH` | `/app/data/sapho.db` | SQLite database location |
| `AUDIOBOOKS_DIR` | `/app/data/audiobooks` | Audiobook library path |
| `UPLOAD_DIR` | `/app/data/uploads` | Temporary upload directory |
| `LIBRARY_SCAN_INTERVAL` | 5 | Minutes between library scans |
| `CORS_ORIGINS` | `http://localhost:3000,...` | Comma-separated allowed origins |

**CORS Configuration**: When deploying behind a reverse proxy with a custom domain, set `CORS_ORIGINS` to your domain (e.g., `https://audiobooks.example.com`).

## Common Pitfalls

1. **Docker cache issues**: Always rebuild with `--no-cache` after code changes
2. **Missing JWT_SECRET**: Server won't start without this env var - generate with `openssl rand -base64 32`
3. **File permissions**: Ensure audiobooks directory is readable by container user (UID 1000 default)
4. **PWA not installing**: Requires HTTPS (except localhost) - check service worker registration in browser console
5. **OpsDec not receiving sessions**:
   - Verify WebSocket connection to `/ws` endpoint
   - Check API key is valid and not expired
   - Ensure `getClientIP()` is used in progress update handler
6. **Library not scanning**: Check `LIBRARY_SCAN_INTERVAL` env var, verify audiobooks directory is mounted correctly
7. **Duplicate audiobooks**: Scanner checks file path - moving files will create duplicates; use maintenance endpoint to clean up
8. **CORS errors**: Set `CORS_ORIGINS` env var to your domain when using a reverse proxy
9. **Admin locked out**: Default admin password is "admin" - must be changed on first login
