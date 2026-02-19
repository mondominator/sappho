# Sappho

![Sappho Logo](client/public/sappho-logo-navbar.png)

Self-hosted audiobook server with a PWA interface. Mount your existing library, and Sappho handles metadata extraction, progress tracking, and multi-device sync.

## Quick Start

```yaml
services:
  sappho:
    image: ghcr.io/mondominator/sappho:latest
    ports:
      - "3002:3002"
    environment:
      - JWT_SECRET=your-secure-random-string-here  # openssl rand -base64 32
    volumes:
      - /path/to/appdata:/app/data
      - /path/to/audiobooks:/app/data/audiobooks:ro
    restart: unless-stopped
```

Default login: `admin` / `admin` (forced password change on first login).

Also available as an [Unraid Community App](unraid-template.xml).

## Key Features

- **Library scanning** — background scan auto-imports books, extracts metadata from ID3/Vorbis/iTunes tags, pulls covers
- **External metadata** — searches Audible, Google Books, and Open Library; reads sidecar files (desc.txt, reader.txt, .opf)
- **Series recaps** — AI-powered "Catch Me Up" summaries via OpenAI or Gemini
- **Multi-user** — separate accounts with individual progress, JWT auth, API keys for integrations
- **PWA** — installable on iOS/Android, offline-capable with service worker caching and IndexedDB progress queue
- **M4B conversion** — convert loose MP3/chapter files into single M4B with embedded metadata via tone + ffmpeg

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `JWT_SECRET` | *required* | Auth signing key |
| `PORT` | `3002` | Server port |
| `AUDIOBOOKS_DIR` | `/app/data/audiobooks` | Library path |
| `LIBRARY_SCAN_INTERVAL` | `5` | Minutes between scans |
| `AI_PROVIDER` | `openai` | `openai` or `gemini` for series recaps |
| `OPENAI_API_KEY` | — | OpenAI key (for recaps) |
| `GEMINI_API_KEY` | — | Gemini key (free tier available) |

## Tech Stack

Node.js + Express, SQLite, React + Vite, WebSocket for real-time updates. Runs in Docker with ffmpeg and [tone](https://github.com/sandreas/tone) for media processing.

## Development

```bash
npm install && cd client && npm install && cd ..

# Rebuild container after changes:
docker-compose build --no-cache && docker-compose up -d
```

## Contributors

<!-- ALL-CONTRIBUTORS-LIST:START - Do not remove or modify this section -->
<table>
  <tbody>
    <tr>
      <td align="center" valign="top" width="25%"><b>Roberto&nbsp;Diaz</b><br />🧪 Testing</td>
      <td align="center" valign="top" width="25%"><b>Kev&nbsp;Beaudin</b><br />🧪 Testing</td>
      <td align="center" valign="top" width="25%"><b>Chad&nbsp;Beaudin</b><br />🧪 Testing</td>
      <td align="center" valign="top" width="25%"><b>Sara&nbsp;Johnson</b><br />🧪 Testing</td>
    </tr>
  </tbody>
</table>

<!-- ALL-CONTRIBUTORS-LIST:END -->

## License

MIT
