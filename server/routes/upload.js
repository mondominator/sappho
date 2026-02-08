/**
 * Upload Routes
 *
 * API endpoints for audiobook file uploads
 */

const express = require('express');
const rateLimit = require('express-rate-limit');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// SECURITY: Sanitize uploaded filename to prevent path traversal
function sanitizeFilename(name) {
  // Strip directory components, then remove null bytes and control characters
  const basename = path.basename(name);
  // eslint-disable-next-line no-control-regex
  return basename.replace(/[\x00-\x1f]/g, '');
}

/**
 * Default dependencies - used when route is required directly
 */
const defaultDependencies = {
  auth: () => require('../auth'),
  fileProcessor: () => require('../services/fileProcessor'),
  db: () => require('../database'),
  websocketManager: () => require('../services/websocketManager'),
  contentHash: () => require('../utils/contentHash'),
};

// SECURITY: Rate limiting for upload endpoints
const uploadLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10, // 10 upload attempts per minute
  message: { error: 'Too many upload attempts. Please slow down.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const uploadDir = process.env.UPLOAD_DIR || path.join(__dirname, '../../data/uploads');

// Ensure upload directory exists
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + '-' + sanitizeFilename(file.originalname));
  }
});

const fileFilter = (req, file, cb) => {
  const allowedTypes = [
    'audio/mpeg',
    'audio/mp3',
    'audio/m4a',
    'audio/m4b',
    'audio/x-m4a',
    'audio/x-m4b',
    'audio/mp4',
    'audio/ogg',
    'audio/flac',
  ];

  const allowedExtensions = ['.mp3', '.m4a', '.m4b', '.mp4', '.ogg', '.flac'];
  const ext = path.extname(sanitizeFilename(file.originalname)).toLowerCase();

  if (allowedTypes.includes(file.mimetype) || allowedExtensions.includes(ext)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Only audio files are allowed.'), false);
  }
};

const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024 * 1024, // 5GB limit
  },
});

/**
 * Create upload routes with injectable dependencies
 * @param {Object} deps - Dependencies (for testing)
 * @param {Object} deps.auth - Auth module
 * @param {Object} deps.fileProcessor - File processor service
 * @param {Object} deps.db - Database module
 * @param {Object} deps.websocketManager - WebSocket manager
 * @param {Object} deps.contentHash - Content hash utility
 * @returns {express.Router}
 */
function createUploadRouter(deps = {}) {
  const router = express.Router();

  // Resolve dependencies (use provided or defaults)
  const auth = deps.auth || defaultDependencies.auth();
  const fileProcessor = deps.fileProcessor || defaultDependencies.fileProcessor();
  const db = deps.db || defaultDependencies.db();
  const websocketManager = deps.websocketManager || defaultDependencies.websocketManager();
  const contentHash = deps.contentHash || defaultDependencies.contentHash();

  const { authenticateToken } = auth;
  const { processAudiobook, extractFileMetadata } = fileProcessor;
  const { generateBestHash } = contentHash;

  // Upload audiobook
  router.post('/', uploadLimiter, authenticateToken, upload.single('audiobook'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const filePath = req.file.path;
    const userId = req.user.id;

    // Process the audiobook (extract metadata, move to library, etc.)
    const audiobook = await processAudiobook(filePath, userId, req.body);

    res.json({
      message: 'Audiobook uploaded successfully',
      audiobook: audiobook,
    });
  } catch (error) {
    console.error('Upload error:', error);
    // Clean up the uploaded file if processing failed
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Upload multiple audiobooks (each file as separate book)
router.post('/batch', uploadLimiter, authenticateToken, upload.array('audiobooks', 10), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No files uploaded' });
    }

    const results = [];
    const userId = req.user.id;

    for (const file of req.files) {
      try {
        const audiobook = await processAudiobook(file.path, userId);
        results.push({ success: true, filename: sanitizeFilename(file.originalname), audiobook });
      } catch (error) {
        results.push({ success: false, filename: sanitizeFilename(file.originalname), error: error.message });
        // Clean up failed file
        if (fs.existsSync(file.path)) {
          fs.unlinkSync(file.path);
        }
      }
    }

    res.json({
      message: 'Batch upload completed',
      results: results,
    });
  } catch (error) {
    console.error('Batch upload error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Upload multiple files as a single audiobook (multi-file book with chapters)
router.post('/multifile', uploadLimiter, authenticateToken, upload.array('audiobooks', 100), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No files uploaded' });
    }

    const userId = req.user.id;
    const bookName = req.body.bookName || null;
    const audiobooksDir = process.env.AUDIOBOOKS_DIR || path.join(__dirname, '../../data/audiobooks');

    // Sort files by original name to maintain order
    const sortedFiles = req.files.sort((a, b) =>
      sanitizeFilename(a.originalname).localeCompare(sanitizeFilename(b.originalname), undefined, { numeric: true, sensitivity: 'base' })
    );

    console.log(`Processing multi-file upload: ${sortedFiles.length} files`);

    // Extract metadata from first file to get book info
    const firstFileMetadata = await extractFileMetadata(sortedFiles[0].path);

    // Use provided book name, or metadata title, or directory name from original path
    let title = bookName || firstFileMetadata.title;

    // If title looks like a chapter/part name, try to get a better title
    if (title && /^(chapter|part|track|disc|cd)[\s_-]*\d+/i.test(title)) {
      // Try to extract from the first file's original path
      const originalPath = sanitizeFilename(sortedFiles[0].originalname);
      const pathParts = originalPath.split('/');
      if (pathParts.length > 1) {
        title = pathParts[0]; // Use folder name
      }
    }

    const author = firstFileMetadata.author || 'Unknown Author';

    // Create organized directory structure
    const sanitize = (str) => str.replace(/[^a-z0-9\s]/gi, '_').trim();
    const authorDir = path.join(audiobooksDir, sanitize(author));
    const bookDir = path.join(authorDir, sanitize(title));

    if (!fs.existsSync(bookDir)) {
      fs.mkdirSync(bookDir, { recursive: true });
    }

    // Move all files to the book directory and collect chapter info
    const chapterMetadata = [];
    let totalDuration = 0;
    let totalSize = 0;
    const movedFiles = [];

    for (let i = 0; i < sortedFiles.length; i++) {
      const file = sortedFiles[i];
      const safeName = sanitizeFilename(file.originalname);
      const ext = path.extname(safeName);
      // Use original filename to preserve chapter naming
      const originalBasename = path.basename(safeName, ext);
      const newFilename = `${String(i + 1).padStart(2, '0')} - ${originalBasename}${ext}`;
      const newPath = path.join(bookDir, newFilename);

      // Move file
      try {
        fs.copyFileSync(file.path, newPath);
        fs.unlinkSync(file.path);
        movedFiles.push(newPath);
      } catch (moveError) {
        console.error(`Failed to move file ${safeName}:`, moveError);
        // Clean up already moved files
        for (const movedFile of movedFiles) {
          if (fs.existsSync(movedFile)) fs.unlinkSync(movedFile);
        }
        throw new Error(`Failed to move file: ${moveError.message}`);
      }

      // Extract metadata for this chapter
      const fileMetadata = await extractFileMetadata(newPath);
      const stats = fs.statSync(newPath);

      totalDuration += fileMetadata.duration || 0;
      totalSize += stats.size;

      chapterMetadata.push({
        file_path: newPath,
        duration: fileMetadata.duration || 0,
        file_size: stats.size,
        title: fileMetadata.title || originalBasename,
      });
    }

    // Move cover if exists
    let coverPath = firstFileMetadata.cover_image;
    if (coverPath && fs.existsSync(coverPath)) {
      const coverExt = path.extname(coverPath);
      const newCoverPath = path.join(bookDir, `cover${coverExt}`);
      try {
        fs.copyFileSync(coverPath, newCoverPath);
        coverPath = newCoverPath;
      } catch (e) {
        console.log('Could not move cover:', e.message);
      }
    }

    // Generate content hash for stable identification
    const contentHash = generateBestHash({
      title,
      author,
      duration: totalDuration
    }, movedFiles[0]);

    // Save audiobook to database
    const audiobook = await new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO audiobooks
         (title, author, narrator, description, duration, file_path, file_size,
          genre, published_year, isbn, series, series_position, cover_image, is_multi_file, added_by,
          tags, publisher, copyright_year, asin, language, rating, abridged, subtitle,
          content_hash, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        [
          title,
          author,
          firstFileMetadata.narrator,
          firstFileMetadata.description,
          totalDuration,
          movedFiles[0], // First file as reference
          totalSize,
          firstFileMetadata.genre,
          firstFileMetadata.published_year,
          firstFileMetadata.isbn,
          firstFileMetadata.series,
          firstFileMetadata.series_position,
          coverPath,
          userId,
          firstFileMetadata.tags,
          firstFileMetadata.publisher,
          firstFileMetadata.copyright_year,
          firstFileMetadata.asin,
          firstFileMetadata.language,
          firstFileMetadata.rating,
          firstFileMetadata.abridged ? 1 : 0,
          firstFileMetadata.subtitle,
          contentHash,
        ],
        function (err) {
          if (err) {
            reject(err);
          } else {
            const audiobookId = this.lastID;

            // Calculate cumulative start times and insert chapters
            let cumulativeTime = 0;
            const chapterInsertPromises = chapterMetadata.map((chapter, index) => {
              const startTime = cumulativeTime;
              cumulativeTime += chapter.duration;

              return new Promise((resolveChapter, rejectChapter) => {
                db.run(
                  `INSERT INTO audiobook_chapters
                   (audiobook_id, chapter_number, file_path, duration, file_size, title, start_time)
                   VALUES (?, ?, ?, ?, ?, ?, ?)`,
                  [
                    audiobookId,
                    index + 1,
                    chapter.file_path,
                    chapter.duration,
                    chapter.file_size,
                    chapter.title,
                    startTime,
                  ],
                  (err) => {
                    if (err) rejectChapter(err);
                    else resolveChapter();
                  }
                );
              });
            });

            Promise.all(chapterInsertPromises)
              .then(() => {
                db.get('SELECT * FROM audiobooks WHERE id = ?', [audiobookId], (err, book) => {
                  if (err) reject(err);
                  else resolve(book);
                });
              })
              .catch(reject);
          }
        }
      );
    });

    console.log(`Created multi-file audiobook: ${title} (${chapterMetadata.length} chapters)`);

    // Broadcast to connected clients
    websocketManager.broadcastLibraryUpdate('library.add', audiobook);

    res.json({
      message: 'Multi-file audiobook uploaded successfully',
      audiobook: audiobook,
    });

  } catch (error) {
    console.error('Multi-file upload error:', error);
    // Clean up any uploaded files on error
    if (req.files) {
      for (const file of req.files) {
        if (fs.existsSync(file.path)) {
          fs.unlinkSync(file.path);
        }
      }
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

  return router;
}

// Export default router for backwards compatibility with index.js
module.exports = createUploadRouter();
// Export factory function for testing
module.exports.createUploadRouter = createUploadRouter;
