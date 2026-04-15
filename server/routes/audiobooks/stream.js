/**
 * Stream & File Routes
 *
 * Handles audio streaming, downloading, cover art serving,
 * and directory file management for audiobooks.
 */
const logger = require('../../utils/logger');

const fs = require('fs');
const path = require('path');
const { getAudioMimeType } = require('./helpers');
const { isValidWidth, getOrGenerateThumbnail } = require('../../services/thumbnailService');
const { createDbHelpers } = require('../../utils/db');
const { createQueryHelpers } = require('../../utils/queryHelpers');

function register(router, { db, authenticateToken, authenticateMediaToken, requireAdmin }) {
  const { dbGet } = createDbHelpers(db);
  const { getAudiobookById } = createQueryHelpers(db);

  // Get all files in the audiobook's directory
  router.get('/:id/directory-files', authenticateToken, async (req, res) => {
    try {
      const audiobook = await dbGet('SELECT file_path FROM audiobooks WHERE id = ?', [req.params.id]);
      if (!audiobook || !audiobook.file_path) {
        return res.status(404).json({ error: 'Audiobook not found' });
      }

      // Get the directory containing the audiobook file
      const directory = path.dirname(audiobook.file_path);

      // List all files in the directory
      const files = fs.readdirSync(directory);

      // Audio extensions for sorting priority
      const audioExtensions = new Set(['.mp3', '.m4a', '.m4b', '.mp4', '.ogg', '.flac', '.opus', '.aac', '.wav', '.wma']);

      // Return all files in the directory, sorted: audio first, then non-audio
      const allFiles = files
        .map(file => {
          const fullPath = path.join(directory, file);
          const stats = fs.statSync(fullPath);
          return {
            name: file,
            path: fullPath,
            size: stats.size,
            extension: path.extname(file).toLowerCase()
          };
        })
        .sort((a, b) => {
          const aIsAudio = audioExtensions.has(a.extension);
          const bIsAudio = audioExtensions.has(b.extension);
          if (aIsAudio !== bIsAudio) return aIsAudio ? -1 : 1;
          return a.name.localeCompare(b.name, undefined, { numeric: true });
        });

      res.json(allFiles);
    } catch (error) {
      logger.error('Error reading directory:', error);
      res.status(500).json({ error: 'Failed to read directory' });
    }
  });

  // Delete a specific file from an audiobook directory (admin only)
  router.delete('/:id/files', authenticateToken, requireAdmin, async (req, res) => {
    const { file_path } = req.body;
    if (!file_path) {
      return res.status(400).json({ error: 'file_path is required' });
    }

    try {
      const audiobook = await getAudiobookById(req.params.id);
      if (!audiobook) {
        return res.status(404).json({ error: 'Audiobook not found' });
      }

      // SECURITY: Only allow deleting files within the audiobook's own directory
      // Extract basename to prevent path traversal (strips ../ and directory components)
      const audiobookDir = path.dirname(audiobook.file_path);
      const safeFilename = path.basename(file_path);
      const targetPath = path.join(audiobookDir, safeFilename);

      // Prevent deleting the main audiobook file
      if (targetPath === audiobook.file_path) {
        return res.status(400).json({ error: 'Cannot delete the main audiobook file. Use delete audiobook instead.' });
      }

      if (!fs.existsSync(targetPath)) {
        return res.status(404).json({ error: 'File not found' });
      }

      fs.unlinkSync(targetPath);
      logger.info('Deleted audiobook file in directory:', audiobookDir);
      res.json({ message: 'File deleted successfully' });
    } catch (error) {
      logger.error('Error deleting file:', error);
      res.status(500).json({ error: 'Failed to delete files' });
    }
  });

  // Stream audiobook (uses authenticateMediaToken to allow query string tokens for <audio> tags)
  router.get('/:id/stream', authenticateMediaToken, async (req, res) => {
    try {
      const audiobook = await getAudiobookById(req.params.id);
      if (!audiobook) {
        return res.status(404).json({ error: 'Audiobook not found' });
      }

      const filePath = audiobook.file_path;

      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'Audio file not found' });
      }

      const stat = fs.statSync(filePath);
      const fileSize = stat.size;
      const range = req.headers.range;
      const contentType = getAudioMimeType(filePath);

      // Generate ETag from file size and modification time for cache validation
      const etag = `"${stat.size}-${stat.mtime.getTime()}"`;
      const lastModified = stat.mtime.toUTCString();

      // Check if client has valid cached version
      if (req.headers['if-none-match'] === etag) {
        return res.status(304).end();
      }

      // Common headers for caching and buffering optimization
      const cacheHeaders = {
        'Accept-Ranges': 'bytes',
        'Content-Type': contentType,
        'ETag': etag,
        'Last-Modified': lastModified,
        // Allow caching for 1 hour, revalidate after
        'Cache-Control': 'private, max-age=3600, must-revalidate',
      };

      if (range) {
        const parts = range.replace(/bytes=/, '').split('-');
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

        // Validate range values
        if (isNaN(start) || start < 0 || start >= fileSize || end < start || end >= fileSize) {
          res.writeHead(416, { 'Content-Range': `bytes */${fileSize}` });
          return res.end();
        }

        const chunksize = (end - start) + 1;
        const file = fs.createReadStream(filePath, { start, end });
        file.on('error', (streamErr) => {
          logger.error('Stream read error:', streamErr.message);
          if (!res.headersSent) res.status(500).end();
          else res.end();
        });
        const head = {
          ...cacheHeaders,
          'Content-Range': `bytes ${start}-${end}/${fileSize}`,
          'Content-Length': chunksize,
        };
        res.writeHead(206, head);
        file.pipe(res);
      } else {
        const head = {
          ...cacheHeaders,
          'Content-Length': fileSize,
        };
        res.writeHead(200, head);
        const file = fs.createReadStream(filePath);
        file.on('error', (streamErr) => {
          logger.error('Stream read error:', streamErr.message);
          if (!res.headersSent) res.status(500).end();
          else res.end();
        });
        file.pipe(res);
      }
    } catch (_err) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Download audiobook — uses authenticateMediaToken (query string) because
  // the browser triggers downloads via <a href="...?token=..."> which can't
  // set Authorization headers.
  router.get('/:id/download', authenticateMediaToken, async (req, res) => {
    try {
      const audiobook = await getAudiobookById(req.params.id);
      if (!audiobook) {
        return res.status(404).json({ error: 'Audiobook not found' });
      }

      const filePath = audiobook.file_path;

      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'Audio file not found' });
      }

      const filename = path.basename(filePath);
      res.download(filePath, `${audiobook.title}.${filename.split('.').pop()}`);
    } catch (_err) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Get cover art (uses authenticateMediaToken to allow query string tokens for <img> tags)
  // Supports optional ?width=120|300|600 query parameter for resized thumbnails
  router.get('/:id/cover', authenticateMediaToken, async (req, res) => {
    const audiobookId = parseInt(req.params.id, 10);
    if (isNaN(audiobookId)) {
      return res.status(400).json({ error: 'Invalid audiobook ID' });
    }

    try {
      const audiobook = await dbGet('SELECT cover_image, cover_path FROM audiobooks WHERE id = ?', [audiobookId]);
      if (!audiobook) {
        return res.status(404).json({ error: 'Audiobook not found' });
      }

      // Check cover_path first (user-provided/external), then cover_image (extracted from audio)
      const coverPath = (audiobook.cover_path && fs.existsSync(audiobook.cover_path))
        ? audiobook.cover_path
        : (audiobook.cover_image && fs.existsSync(audiobook.cover_image))
          ? audiobook.cover_image
          : null;

      if (!coverPath) {
        return res.status(404).json({ error: 'Cover image not found' });
      }

      // SECURITY: Validate that cover path is within allowed directories.
      // `path.resolve` collapses `..` but does not follow symlinks. A
      // symlink inside the covers dir pointing at `/etc/passwd` would have
      // passed the old string-prefix check. `fs.realpathSync` resolves
      // symlinks so the comparison is against the actual file location.
      const dataDir = path.resolve(process.env.DATA_DIR || path.join(__dirname, '../../../data'));
      const audiobooksDir = path.resolve(process.env.AUDIOBOOKS_DIR || path.join(dataDir, 'audiobooks'));
      const coversDir = path.resolve(path.join(dataDir, 'covers'));

      let resolvedPath;
      try {
        resolvedPath = fs.realpathSync(coverPath);
      } catch (_err) {
        return res.status(404).json({ error: 'Cover image not found' });
      }

      // Also resolve symlinks on the allowlist directories so comparison is
      // consistent when DATA_DIR itself is a symlink.
      let realCoversDir = coversDir;
      let realAudiobooksDir = audiobooksDir;
      try { realCoversDir = fs.realpathSync(coversDir); } catch (_e) { /* dir may not exist yet */ }
      try { realAudiobooksDir = fs.realpathSync(audiobooksDir); } catch (_e) { /* dir may not exist yet */ }

      const isInCoversDir = resolvedPath === realCoversDir ||
        resolvedPath.startsWith(realCoversDir + path.sep);
      const isInAudiobooksDir = resolvedPath === realAudiobooksDir ||
        resolvedPath.startsWith(realAudiobooksDir + path.sep);

      if (!isInCoversDir && !isInAudiobooksDir) {
        logger.warn(`Cover path escapes allowed directories: ${coverPath} → ${resolvedPath}`);
        return res.status(403).json({ error: 'Invalid cover path' });
      }

      // Determine if a resized thumbnail was requested
      const requestedWidth = parseInt(req.query.width, 10);

      if (requestedWidth && isValidWidth(requestedWidth)) {
        try {
          const thumbPath = await getOrGenerateThumbnail(resolvedPath, audiobookId, requestedWidth);

          // Build ETag from original cover mtime + requested width for cache validation
          const originalStat = fs.statSync(resolvedPath);
          const etag = `"thumb-${originalStat.size}-${originalStat.mtime.getTime()}-${requestedWidth}"`;

          if (req.headers['if-none-match'] === etag) {
            return res.status(304).end();
          }

          res.setHeader('Cache-Control', 'public, no-cache');
          res.setHeader('ETag', etag);
          res.setHeader('Content-Type', 'image/jpeg');
          return res.sendFile(path.resolve(thumbPath));
        } catch (thumbErr) {
          logger.error(`Thumbnail generation failed for audiobook ${audiobookId} at width ${requestedWidth}:`, thumbErr.message);
          // Fall through to serve the original cover on thumbnail failure
        }
      }

      // Serve original cover (no width requested, or invalid width, or thumbnail generation failed)
      res.setHeader('Cache-Control', 'public, no-cache');
      res.sendFile(resolvedPath);
    } catch (_err) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

}

module.exports = { register };
