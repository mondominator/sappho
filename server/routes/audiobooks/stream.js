/**
 * Stream & File Routes
 *
 * Handles audio streaming, downloading, cover art serving,
 * and directory file management for audiobooks.
 */

const fs = require('fs');
const path = require('path');
const { getAudioMimeType } = require('./helpers');
const { isValidWidth, getOrGenerateThumbnail } = require('../../services/thumbnailService');

function register(router, { db, authenticateToken, authenticateMediaToken, requireAdmin }) {

  // Get all files in the audiobook's directory
  router.get('/:id/directory-files', authenticateToken, (req, res) => {
    db.get('SELECT file_path FROM audiobooks WHERE id = ?', [req.params.id], (err, audiobook) => {
      if (err) {
        return res.status(500).json({ error: 'Internal server error' });
      }
      if (!audiobook || !audiobook.file_path) {
        return res.status(404).json({ error: 'Audiobook not found' });
      }

      try {
        // Get the directory containing the audiobook file
        const directory = path.dirname(audiobook.file_path);

        // List all files in the directory
        const files = fs.readdirSync(directory);

        // Filter to only audio files and sort them
        const audioExtensions = ['.mp3', '.m4a', '.m4b', '.flac', '.ogg', '.wav'];
        const audioFiles = files
          .filter(file => {
            const ext = path.extname(file).toLowerCase();
            return audioExtensions.includes(ext);
          })
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
          .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

        res.json(audioFiles);
      } catch (error) {
        console.error('Error reading directory:', error);
        res.status(500).json({ error: 'Failed to read directory' });
      }
    });
  });

  // Delete a specific file from an audiobook directory (admin only)
  router.delete('/:id/files', authenticateToken, requireAdmin, (req, res) => {
    const { file_path } = req.body;
    if (!file_path) {
      return res.status(400).json({ error: 'file_path is required' });
    }

    db.get('SELECT * FROM audiobooks WHERE id = ?', [req.params.id], (err, audiobook) => {
      if (err) {
        return res.status(500).json({ error: 'Internal server error' });
      }
      if (!audiobook) {
        return res.status(404).json({ error: 'Audiobook not found' });
      }

      // Verify the file is in the audiobook's directory (security check)
      const audiobookDir = path.dirname(audiobook.file_path);

      if (!file_path.startsWith(audiobookDir)) {
        return res.status(403).json({ error: 'Cannot delete files outside audiobook directory' });
      }

      // Prevent deleting the main audiobook file
      if (file_path === audiobook.file_path) {
        return res.status(400).json({ error: 'Cannot delete the main audiobook file. Use delete audiobook instead.' });
      }

      try {
        if (!fs.existsSync(file_path)) {
          return res.status(404).json({ error: 'File not found' });
        }

        fs.unlinkSync(file_path);
        console.log(`Deleted file: ${file_path}`);
        res.json({ message: 'File deleted successfully' });
      } catch (error) {
        console.error('Error deleting file:', error);
        res.status(500).json({ error: 'Failed to delete files' });
      }
    });
  });

  // Stream audiobook (uses authenticateMediaToken to allow query string tokens for <audio> tags)
  router.get('/:id/stream', authenticateMediaToken, (req, res) => {
    db.get('SELECT * FROM audiobooks WHERE id = ?', [req.params.id], (err, audiobook) => {
      if (err) {
        return res.status(500).json({ error: 'Internal server error' });
      }
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
          console.error('Stream read error:', streamErr.message);
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
          console.error('Stream read error:', streamErr.message);
          if (!res.headersSent) res.status(500).end();
          else res.end();
        });
        file.pipe(res);
      }
    });
  });

  // Download audiobook
  router.get('/:id/download', authenticateToken, (req, res) => {
    db.get('SELECT * FROM audiobooks WHERE id = ?', [req.params.id], (err, audiobook) => {
      if (err) {
        return res.status(500).json({ error: 'Internal server error' });
      }
      if (!audiobook) {
        return res.status(404).json({ error: 'Audiobook not found' });
      }

      const filePath = audiobook.file_path;

      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'Audio file not found' });
      }

      const filename = path.basename(filePath);
      res.download(filePath, `${audiobook.title}.${filename.split('.').pop()}`);
    });
  });

  // Get cover art (uses authenticateMediaToken to allow query string tokens for <img> tags)
  // Supports optional ?width=120|300|600 query parameter for resized thumbnails
  router.get('/:id/cover', authenticateMediaToken, (req, res) => {
    const audiobookId = parseInt(req.params.id, 10);
    if (isNaN(audiobookId)) {
      return res.status(400).json({ error: 'Invalid audiobook ID' });
    }

    db.get('SELECT cover_image, cover_path FROM audiobooks WHERE id = ?', [audiobookId], async (err, audiobook) => {
      if (err) {
        return res.status(500).json({ error: 'Internal server error' });
      }
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

      // SECURITY: Validate that cover path is within allowed directories
      const dataDir = path.resolve(process.env.DATA_DIR || path.join(__dirname, '../../../data'));
      const audiobooksDir = path.resolve(process.env.AUDIOBOOKS_DIR || path.join(dataDir, 'audiobooks'));
      const coversDir = path.resolve(path.join(dataDir, 'covers'));

      const resolvedPath = path.resolve(coverPath);

      // Cover must be within covers directory OR audiobooks directory
      const isInCoversDir = resolvedPath.startsWith(coversDir + path.sep);
      const isInAudiobooksDir = resolvedPath.startsWith(audiobooksDir + path.sep);

      if (!isInCoversDir && !isInAudiobooksDir) {
        console.warn(`Cover path escapes allowed directories: ${coverPath}`);
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

          res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
          res.setHeader('ETag', etag);
          res.setHeader('Content-Type', 'image/jpeg');
          return res.sendFile(path.resolve(thumbPath));
        } catch (thumbErr) {
          console.error(`Thumbnail generation failed for audiobook ${audiobookId} at width ${requestedWidth}:`, thumbErr.message);
          // Fall through to serve the original cover on thumbnail failure
        }
      }

      // Serve original cover (no width requested, or invalid width, or thumbnail generation failed)
      res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
      res.sendFile(resolvedPath);
    });
  });

}

module.exports = { register };
