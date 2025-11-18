# Sappho Audiobook Server

![Sappho Logo](logo.png)

A modern, self-hosted audiobook server with a beautiful web interface and native mobile app experience.

## Features

- 📚 **Automatic Metadata Extraction** - Reads metadata from audiobook files (ID3, Vorbis tags)
- 🎨 **Series & Author Organization** - Organize your library by series and authors
- 📱 **Progressive Web App** - Install on your phone for a native app experience
- 🎧 **Built-in Audio Player** - Stream and listen to your audiobooks
- 📊 **Progress Tracking** - Keep track of where you left off
- 🔍 **Search & Filter** - Find audiobooks quickly
- 👥 **Multi-user Support** - Create accounts for family members
- 📂 **Watch Directory** - Auto-import audiobooks from a folder
- 🔄 **Automatic Library Import** - Mount existing libraries and auto-detect audiobooks
- 🌓 **Modern Dark UI** - Beautiful teal-themed interface
- 🔄 **Real-time Updates** - WebSocket integration for live updates

## Quick Start

### Docker Compose

```yaml
version: '3.8'

services:
  sapho:
    image: ghcr.io/mondominator/sappho:latest
    container_name: sapho
    ports:
      - "3002:3002"
    environment:
      - JWT_SECRET=your-secure-random-string-here
      - NODE_ENV=production
    volumes:
      - /path/to/appdata/sapho:/app/data
      - /path/to/audiobooks:/app/data/audiobooks
      - /path/to/audiobooks/watch:/app/data/watch
    restart: unless-stopped
```

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `JWT_SECRET` | Yes | - | Secret key for authentication (generate with `openssl rand -base64 32`) |
| `NODE_ENV` | No | `production` | Node environment |
| `PORT` | No | `3002` | Server port |
| `AUDIOBOOKS_DIR` | No | `/app/data/audiobooks` | Audiobook library path |
| `WATCH_DIR` | No | `/app/data/watch` | Watch directory for auto-import |
| `LIBRARY_SCAN_INTERVAL` | No | `5` | Minutes between library rescans for new audiobooks |
| `DATABASE_PATH` | No | `/app/data/sapho.db` | SQLite database location |

## Unraid Installation

1. **Add Template Repository:**
   - Go to Docker tab in Unraid
   - Click "Add Template Repository"
   - Add: `https://github.com/mondominator/sappho/blob/main/unraid-template.xml`

2. **Install Sappho:**
   - Search for "Sappho" in Community Applications
   - Click Install
   - Configure paths and JWT_SECRET
   - Start container

3. **First Time Setup:**
   - Access at `http://your-server-ip:3002`
   - Default admin credentials will be shown in container logs
   - Change your password immediately

## Mobile Installation (Progressive Web App)

Sappho is a full-featured Progressive Web App (PWA) that can be installed on your mobile device for a native app experience.

### Requirements for Full PWA Installation
- **HTTPS**: Full PWA functionality requires HTTPS (service workers won't register on HTTP)
- **For local/HTTP access**: You can still "Add to Home Screen" which creates a bookmark with the app icon

### iOS Installation
1. Open **Safari** and navigate to Sappho (must use Safari, not Chrome)
2. Tap the **Share button** (square with arrow pointing up)
3. Scroll down and select **"Add to Home Screen"**
4. Tap **"Add"** in the top right
5. The Sappho icon will appear on your home screen

**Note**: On HTTP (non-HTTPS), iOS will create a web clip (bookmark) rather than a full PWA. The app will still work but won't have offline capabilities.

### Android Installation
1. Open **Chrome** and navigate to Sappho
2. Tap the **menu** (3 vertical dots) in the top right
3. Select **"Install app"** or **"Add to Home Screen"**
4. Tap **"Install"** in the popup
5. Launch Sappho from your home screen or app drawer

**Note**: Chrome on Android may show a banner prompting you to install the app automatically.

### PWA Features
- **Standalone mode**: Opens in its own window without browser UI
- **Home screen icon**: Launches like a native app
- **Offline support**: Service worker caches app shell for offline use (requires HTTPS)
- **Fast loading**: Cached resources load instantly
- **Native feel**: Optimized mobile interface with proper touch targets

## Building from Source

```bash
# Clone the repository
git clone https://github.com/mondominator/sappho.git
cd sapho

# Build with Docker
docker-compose build

# Run
docker-compose up -d
```

## Development

```bash
# Install dependencies
npm install
cd client && npm install

# Start development server
npm run dev

# Start client dev server
cd client && npm run dev
```

## Directory Structure

```
/app/data/
├── sapho.db              # SQLite database
├── audiobooks/           # Audiobook library (can mount existing library here)
│   ├── Author Name/
│   │   └── Book Title/
│   │       ├── book.m4b
│   │       └── cover.jpg
├── watch/                # Drop audiobooks here for auto-import
└── uploads/              # Temporary upload storage
```

## Importing Existing Libraries

Sappho can automatically detect and import audiobooks from an existing library:

1. **Mount your existing library** to `/app/data/audiobooks`
2. **Server starts immediately** - library scanning happens in the background
3. **Periodic rescanning** - automatically detects new audiobooks every 5 minutes (configurable)
4. **Files are NOT moved or reorganized** - they stay in their original location
5. **Already imported files are skipped** - safe to restart the container

Example Docker Compose for existing library:

```yaml
services:
  sapho:
    image: ghcr.io/mondominator/sappho:latest
    environment:
      - LIBRARY_SCAN_INTERVAL=5  # Scan every 5 minutes (optional)
    volumes:
      - /path/to/your/existing/audiobooks:/app/data/audiobooks:ro  # Read-only mount
      - /path/to/appdata/sapho:/app/data
```

The library scanner will:
- Run in the background on startup (server starts immediately)
- Recursively scan all subdirectories
- Rescan periodically to detect new audiobooks
- Detect supported audio files (M4B, MP3, M4A, FLAC, OGG)
- Extract metadata from each file
- Skip files already in the database
- Log import statistics after each scan

## Supported Audio Formats

- M4B (Apple Audiobook)
- M4A (AAC Audio)
- MP3
- FLAC
- OGG
- And more...

## Metadata Support

Sappho extracts metadata from:
- **ID3v2 tags** (MP3, M4B, M4A)
- **Vorbis comments** (FLAC, OGG)
- **Custom fields**: Series, Narrator, Position

Supported metadata fields:
- Title, Author, Narrator
- Series, Series Position
- Duration, Genre, Year
- ISBN, Description
- Cover Art

## Technology Stack

- **Backend**: Node.js, Express, SQLite
- **Frontend**: React, Vite
- **Audio**: music-metadata
- **Containerization**: Docker

## Support

- **Issues**: https://github.com/mondominator/sappho/issues
- **Documentation**: https://github.com/mondominator/sappho

## License

MIT License - See LICENSE file for details

## Credits

Built with ❤️ using Claude Code
