# Sapho - Audiobook Server

A modern audiobook server with streaming, metadata scraping, and library management.

## Features

- Upload audiobooks via web interface
- Watch directory for automatic book imports
- Stream audiobooks directly from the browser
- Download audiobooks
- Delete books from library
- Automatic metadata scraping
- User authentication
- Modern web UI

## Tech Stack

- **Backend**: Node.js + Express
- **Frontend**: React + Vite
- **Database**: SQLite
- **Audio**: HTML5 Audio with streaming support
- **Deployment**: Docker

## Getting Started

### Development

1. Install dependencies:
```bash
npm install
cd client && npm install
```

2. Copy `.env.example` to `.env` and configure:
```bash
cp .env.example .env
```

3. Start the backend:
```bash
npm run dev
```

4. Start the frontend (in another terminal):
```bash
npm run client
```

### Production (Docker)

```bash
docker-compose up -d
```

## Directory Structure

- `server/` - Backend API code
- `client/` - React frontend
- `data/` - SQLite database and media files
  - `uploads/` - User-uploaded audiobooks
  - `watch/` - Auto-import directory
  - `audiobooks/` - Organized library
