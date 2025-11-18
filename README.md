# Sappho Audiobook Server

![Sappho Logo](logo.png)

A modern, self-hosted audiobook server with a beautiful web interface and native mobile app experience.

> ⚠️ **Early Development**: Sappho is currently in early development. While fully functional, you may encounter bugs or incomplete features. Please report any issues you find!

> 💯 **Vibe Check**: This entire project was architected, coded, and shipped in record time with [Claude Code](https://claude.com/claude-code). From zero to a fully-functional audiobook server with 115+ features, PWA support, real-time WebSockets, and a modern glass-morphism UI - all crafted through AI-assisted development. The future of coding is here, and it's absolutely fire. 🔥

## 📖 Table of Contents

- [Features](#-features)
- [Quick Start](#quick-start)
- [Mobile Installation](#mobile-installation-progressive-web-app)
- [Building from Source](#building-from-source)
- [Importing Existing Libraries](#importing-existing-libraries)
- [Supported Formats](#supported-audio-formats)
- [Technology Stack](#technology-stack)
- [Roadmap](#-roadmap)
- [Contributing](#-contributing)
- [Known Issues](#-known-issues)
- [License](#-license)

## ✨ Features

### 📚 Library Management
- **Automatic Metadata Extraction** - Reads title, author, narrator, series, cover art, and more from ID3 and Vorbis tags
- **Existing Library Import** - Mount your current audiobook collection and Sappho automatically detects and catalogs everything
- **Watch Directory** - Drop audiobooks into a folder for automatic processing and import
- **Periodic Scanning** - Automatically rescans library every 5 minutes (configurable) to detect new additions
- **Series & Author Organization** - Browse by series with proper ordering, or explore by author
- **Multi-format Support** - Handles M4B, MP3, M4A, FLAC, OGG, and more
- **Cover Art Extraction** - Automatically extracts and displays embedded cover images

### 🎧 Playback & Progress
- **Modern Audio Player** - Beautiful, responsive player with chapter support
- **Chapter Navigation** - Skip between chapters, view chapter list, see current chapter title
- **Progress Tracking** - Automatically saves your position, resume exactly where you left off
- **Cross-device Sync** - Continue listening on any device (same account)
- **Playback Speed Control** - Adjust speed to your preference
- **Sleep Timer** - Fall asleep without losing your place (coming soon)
- **Streaming Playback** - Direct audio streaming from server, no downloads required

### 📱 Mobile Experience
- **Progressive Web App (PWA)** - Install on iOS/Android for native app experience
- **Mobile-optimized UI** - Touch-friendly interface designed for phones and tablets
- **Fullscreen Player** - Immersive fullscreen mode with large controls and cover art
- **Offline Support** - App shell cached for instant loading (requires HTTPS)
- **Background Playback** - Continue listening while using other apps
- **Lock Screen Controls** - Control playback from your lock screen

### 👥 Multi-user & Security
- **Multi-user Accounts** - Create separate accounts for family members with individual progress tracking
- **JWT Authentication** - Secure token-based authentication
- **API Key Support** - Generate API keys for external integrations and automation
- **User Avatars** - Personalize accounts with custom profile pictures
- **Session Management** - Track active listening sessions across devices

### 🔍 Discovery & Organization
- **Powerful Search** - Instantly search by title, author, narrator, or series
- **Filter by Status** - View in-progress, completed, or unstarted audiobooks
- **Smart Sorting** - Sort by title, author, date added, duration, or progress
- **Detailed Metadata** - View comprehensive information including ISBN, publication year, genre, duration
- **Author & Series Pages** - Dedicated pages showing all works by an author or books in a series

### 🎨 User Interface
- **Modern Design** - Sleek, translucent glass-morphism UI with smooth animations
- **Dark Theme** - Easy on the eyes with a beautiful blue-tinted dark interface
- **Responsive Layout** - Optimized for desktop, tablet, and mobile
- **Real-time Updates** - WebSocket integration for live library updates
- **Accessibility** - Keyboard navigation and proper semantic HTML

### 🔧 Administration & Integration
- **Web Upload** - Upload audiobooks directly through the web interface
- **Bulk Operations** - Mark finished, clear progress, delete audiobooks
- **Library Statistics** - View total audiobooks, listening time, completion stats
- **WebSocket API** - Real-time integration with external services (e.g., OpsDec for Now Playing displays)
- **RESTful API** - Full-featured API for automation and third-party integrations
- **Docker-first** - Easy deployment with Docker Compose or standalone container
- **Unraid Support** - Community Applications template for one-click install

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

## 🗺️ Roadmap

Sappho is actively being developed! Here are some features planned for future releases:

### Near-term (v0.2.x)
- [ ] Sleep timer with auto-shutdown
- [ ] Playback queue/playlist support
- [ ] Bookmarks and notes
- [ ] Advanced filtering (by genre, narrator, duration)
- [ ] Batch metadata editing
- [ ] Import from Audible library
- [ ] User listening statistics and charts

### Mid-term (v0.3.x - v0.4.x)
- [ ] Smart recommendations based on listening history
- [ ] Collections and custom playlists
- [ ] Library sharing between users
- [ ] Podcast support
- [ ] Mobile apps (native iOS/Android)
- [ ] Chromecast/AirPlay support
- [ ] Audiobook ratings and reviews
- [ ] Multi-language support

### Long-term (v1.0+)
- [ ] AI-powered chapter detection for files without chapters
- [ ] Automatic audiobook organization and renaming
- [ ] Integration with Goodreads/Audible
- [ ] Social features (share recommendations with friends)
- [ ] Advanced audio processing (noise reduction, volume normalization)
- [ ] Plugin system for extensibility

**Want a feature?** Open an issue and let me know!

## 🤝 Contributing

Contributions are welcome! This project is in early development, so there's plenty of room for improvement.

### Ways to Contribute
- 🐛 **Report bugs** - Found an issue? Let me know!
- 💡 **Suggest features** - Have an idea? Open a feature request
- 📝 **Improve documentation** - Help make the docs better
- 🔧 **Submit pull requests** - Fix bugs or add features
- ⭐ **Star the repo** - Show your support!

### Development Setup
See the [Development](#development) section above for setup instructions.

## 📋 Known Issues

- Sleep timer not yet implemented
- Some metadata tags may not be recognized (working on expanding support)
- HTTPS required for full PWA functionality (service workers limitation)
- Large libraries (10,000+ books) may experience slower initial scans

See the [Issues](https://github.com/mondominator/sappho/issues) page for a complete list.

## 🙏 Acknowledgments

- Built with ❤️ using [Claude Code](https://claude.com/claude-code)
- Metadata extraction powered by [music-metadata](https://github.com/borewit/music-metadata)
- Icons from Feather Icons and Heroicons
- Inspired by projects like Audiobookshelf, Plex, and Jellyfin

## 📞 Support

- **Issues**: https://github.com/mondominator/sappho/issues
- **Discussions**: https://github.com/mondominator/sappho/discussions
- **Documentation**: https://github.com/mondominator/sappho

## 📄 License

MIT License - See [LICENSE](LICENSE) file for details.

---

**Note**: Sappho is a personal project and is not affiliated with or endorsed by any audiobook providers or services.
