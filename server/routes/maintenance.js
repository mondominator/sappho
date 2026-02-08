/**
 * Maintenance Routes
 *
 * API endpoints for library maintenance, scans, and system administration (admin only)
 */

const express = require('express');
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs');
const { generateContentHash } = require('../utils/contentHash');

/**
 * Default dependencies - used when route is required directly
 */
const defaultDependencies = {
  db: () => require('../database'),
  auth: () => require('../auth'),
  fileProcessor: () => require('../services/fileProcessor'),
  libraryScanner: () => require('../services/libraryScanner'),
  fileOrganizer: () => require('../services/fileOrganizer'),
};

// SECURITY: Rate limiting for maintenance endpoints
const maintenanceLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30, // 30 requests per minute per IP
  message: { error: 'Too many requests. Please slow down.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const maintenanceWriteLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10, // 10 maintenance operations per minute
  message: { error: 'Too many maintenance operations. Please slow down.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// In-memory log buffer for UI viewing
// Configure with LOG_BUFFER_SIZE env var (default 500, max 5000)
const LOG_BUFFER_SIZE = Math.min(parseInt(process.env.LOG_BUFFER_SIZE) || 500, 5000);
const logBuffer = [];
let logRotationCount = 0; // Track how many logs have been rotated out
const originalConsoleLog = console.log;
const originalConsoleError = console.error;

/**
 * Categorize log messages for better UI display
 */
function categorizeLogMessage(message) {
  const lowerMsg = message.toLowerCase();

  // Success indicators
  if (message.includes('✅') || message.includes('✓') ||
      lowerMsg.includes('complete') || lowerMsg.includes('success') ||
      lowerMsg.includes('imported:') || lowerMsg.includes('created')) {
    return 'success';
  }

  // Warning indicators
  if (message.includes('⚠') || lowerMsg.includes('warning') ||
      lowerMsg.includes('skipping') || lowerMsg.includes('skipped') ||
      lowerMsg.includes('already exists') || lowerMsg.includes('not found')) {
    return 'warning';
  }

  // Scan/Job related
  if (lowerMsg.includes('scan') || lowerMsg.includes('scanning') ||
      lowerMsg.includes('periodic') || lowerMsg.includes('starting') ||
      lowerMsg.includes('processing')) {
    return 'job';
  }

  // Import/Library related
  if (lowerMsg.includes('import') || lowerMsg.includes('library') ||
      lowerMsg.includes('audiobook') || lowerMsg.includes('metadata')) {
    return 'library';
  }

  // WebSocket/Session related
  if (lowerMsg.includes('websocket') || lowerMsg.includes('session') ||
      lowerMsg.includes('🔌') || lowerMsg.includes('📡') ||
      lowerMsg.includes('broadcast')) {
    return 'websocket';
  }

  // Auth related
  if (lowerMsg.includes('auth') || lowerMsg.includes('login') ||
      lowerMsg.includes('token') || lowerMsg.includes('user')) {
    return 'auth';
  }

  // Server/System
  if (lowerMsg.includes('server') || lowerMsg.includes('listening') ||
      lowerMsg.includes('initialized') || lowerMsg.includes('started')) {
    return 'system';
  }

  return 'info';
}

// Intercept console.log and console.error
console.log = (...args) => {
  const message = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
  const category = categorizeLogMessage(message);
  logBuffer.push({ timestamp: new Date().toISOString(), level: 'info', category, message });
  if (logBuffer.length > LOG_BUFFER_SIZE) {
    logBuffer.shift();
    logRotationCount++;
  }
  originalConsoleLog.apply(console, args);
};

console.error = (...args) => {
  const message = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
  logBuffer.push({ timestamp: new Date().toISOString(), level: 'error', category: 'error', message });
  if (logBuffer.length > LOG_BUFFER_SIZE) {
    logBuffer.shift();
    logRotationCount++;
  }
  originalConsoleError.apply(console, args);
};

/**
 * Get log buffer statistics
 */
function getLogStats() {
  const errorCount = logBuffer.filter(l => l.level === 'error').length;
  const warningCount = logBuffer.filter(l => l.category === 'warning').length;
  const oldestLog = logBuffer.length > 0 ? logBuffer[0].timestamp : null;

  return {
    bufferSize: LOG_BUFFER_SIZE,
    currentCount: logBuffer.length,
    rotatedCount: logRotationCount,
    errorCount,
    warningCount,
    oldestLog,
  };
}

/**
 * Clear the log buffer
 */
function clearLogBuffer() {
  const cleared = logBuffer.length;
  logBuffer.length = 0;
  logRotationCount = 0;
  console.log('Log buffer cleared');
  return cleared;
}

// Force rescan state - kept at module level since it's shared across routes
let forceRescanInProgress = false;

/**
 * Create maintenance routes with injectable dependencies
 * @param {Object} deps - Dependencies (for testing)
 * @param {Object} deps.db - Database module
 * @param {Object} deps.auth - Auth module
 * @param {Object} deps.fileProcessor - File processor service
 * @param {Object} deps.libraryScanner - Library scanner service
 * @param {Object} deps.fileOrganizer - File organizer service
 * @returns {express.Router}
 */
function createMaintenanceRouter(deps = {}) {
  const router = express.Router();

  // Resolve dependencies (use provided or defaults)
  const db = deps.db || defaultDependencies.db();
  const auth = deps.auth || defaultDependencies.auth();
  const fileProcessor = deps.fileProcessor || defaultDependencies.fileProcessor();
  const libraryScanner = deps.libraryScanner || defaultDependencies.libraryScanner();
  const fileOrganizer = deps.fileOrganizer || defaultDependencies.fileOrganizer();

  const { authenticateToken } = auth;
  const { extractFileMetadata } = fileProcessor;
  const { scanLibrary, lockScanning, unlockScanning, isScanningLocked, getJobStatus } = libraryScanner;
  const { organizeLibrary, getOrganizationPreview, organizeAudiobook } = fileOrganizer;

  // Get server logs
  router.get('/logs', maintenanceLimiter, authenticateToken, (req, res) => {
  if (!req.user.is_admin) {
    return res.status(403).json({ error: 'Admin access required' });
  }

  const limit = Math.min(parseInt(req.query.limit) || 100, LOG_BUFFER_SIZE);
  const logs = logBuffer.slice(-limit);

  res.json({
    logs,
    total: logBuffer.length,
    stats: getLogStats(),
    forceRescanInProgress,
    scanningLocked: isScanningLocked()
  });
});

// Clear server logs
router.delete('/logs', maintenanceWriteLimiter, authenticateToken, (req, res) => {
  if (!req.user.is_admin) {
    return res.status(403).json({ error: 'Admin access required' });
  }

  const cleared = clearLogBuffer();
  res.json({
    success: true,
    message: `Cleared ${cleared} log entries`,
    cleared
  });
});

// Get background jobs status
router.get('/jobs', maintenanceLimiter, authenticateToken, (req, res) => {
  if (!req.user.is_admin) {
    return res.status(403).json({ error: 'Admin access required' });
  }

  const jobs = getJobStatus();

  res.json({
    jobs,
    forceRefreshInProgress: forceRescanInProgress,
  });
});

// Get library statistics
router.get('/statistics', maintenanceLimiter, authenticateToken, async (req, res) => {
  if (!req.user.is_admin) {
    return res.status(403).json({ error: 'Admin access required' });
  }

  try {
    // Total storage and count
    const totals = await new Promise((resolve, reject) => {
      db.get(
        `SELECT
          COUNT(*) as totalBooks,
          COALESCE(SUM(file_size), 0) as totalSize,
          COALESCE(SUM(duration), 0) as totalDuration,
          COALESCE(AVG(duration), 0) as avgDuration
        FROM audiobooks`,
        (err, row) => {
          if (err) reject(err);
          else resolve(row);
        }
      );
    });

    // Storage by format - extract extension from file_path
    const byFormat = await new Promise((resolve, reject) => {
      db.all(
        `SELECT
          LOWER(REPLACE(file_path, RTRIM(file_path, REPLACE(file_path, '.', '')), '')) as format,
          COUNT(*) as count,
          COALESCE(SUM(file_size), 0) as size
        FROM audiobooks
        WHERE file_path IS NOT NULL AND file_path LIKE '%.%'
        GROUP BY format
        ORDER BY size DESC`,
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows || []);
        }
      );
    });

    // Top authors by storage
    const topAuthors = await new Promise((resolve, reject) => {
      db.all(
        `SELECT
          author,
          COUNT(*) as count,
          COALESCE(SUM(file_size), 0) as size,
          COALESCE(SUM(duration), 0) as duration
        FROM audiobooks
        WHERE author IS NOT NULL AND author != ''
        GROUP BY author
        ORDER BY size DESC
        LIMIT 10`,
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows || []);
        }
      );
    });

    // Top series by storage
    const topSeries = await new Promise((resolve, reject) => {
      db.all(
        `SELECT
          series,
          COUNT(*) as count,
          COALESCE(SUM(file_size), 0) as size,
          COALESCE(SUM(duration), 0) as duration
        FROM audiobooks
        WHERE series IS NOT NULL AND series != ''
        GROUP BY series
        ORDER BY count DESC
        LIMIT 10`,
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows || []);
        }
      );
    });

    // Books added over time (last 12 months)
    const addedOverTime = await new Promise((resolve, reject) => {
      db.all(
        `SELECT
          strftime('%Y-%m', created_at) as month,
          COUNT(*) as count,
          COALESCE(SUM(file_size), 0) as size
        FROM audiobooks
        WHERE created_at >= date('now', '-12 months')
        GROUP BY month
        ORDER BY month ASC`,
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows || []);
        }
      );
    });

    // User statistics
    const userStats = await new Promise((resolve, reject) => {
      db.all(
        `SELECT
          u.username,
          COUNT(DISTINCT pp.audiobook_id) as booksStarted,
          SUM(CASE WHEN pp.completed = 1 THEN 1 ELSE 0 END) as booksCompleted,
          COALESCE(SUM(pp.position), 0) as totalListenTime
        FROM users u
        LEFT JOIN playback_progress pp ON u.id = pp.user_id
        GROUP BY u.id
        ORDER BY totalListenTime DESC`,
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows || []);
        }
      );
    });

    // Narrator statistics
    const topNarrators = await new Promise((resolve, reject) => {
      db.all(
        `SELECT
          narrator,
          COUNT(*) as count,
          COALESCE(SUM(duration), 0) as duration
        FROM audiobooks
        WHERE narrator IS NOT NULL AND narrator != ''
        GROUP BY narrator
        ORDER BY count DESC
        LIMIT 10`,
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows || []);
        }
      );
    });

    res.json({
      totals: {
        books: totals.totalBooks,
        size: totals.totalSize,
        duration: totals.totalDuration,
        avgDuration: totals.avgDuration,
      },
      byFormat,
      topAuthors,
      topSeries,
      topNarrators,
      addedOverTime,
      userStats,
    });
  } catch (error) {
    console.error('Error fetching statistics:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get audiobooks by file format
router.get('/books-by-format/:format', authenticateToken, async (req, res) => {
  if (!req.user.is_admin) {
    return res.status(403).json({ error: 'Admin access required' });
  }

  try {
    const format = req.params.format.toLowerCase();
    const books = await new Promise((resolve, reject) => {
      db.all(
        `SELECT id, title, author, cover_image, file_size, duration
         FROM audiobooks
         WHERE LOWER(REPLACE(file_path, RTRIM(file_path, REPLACE(file_path, '.', '')), '')) = ?
         ORDER BY title ASC`,
        [format],
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows || []);
        }
      );
    });
    res.json(books);
  } catch (error) {
    console.error('Error fetching books by format:', error);
    res.status(500).json({ error: error.message });
  }
});

// Consolidate multi-file audiobooks
router.post('/consolidate-multifile', maintenanceWriteLimiter, authenticateToken, async (req, res) => {
  // Only allow admins to run this
  if (!req.user.is_admin) {
    return res.status(403).json({ error: 'Admin access required' });
  }

  try {
    console.log('Starting multi-file audiobook consolidation...');

    // Get all audiobooks that are not already multi-file
    const audiobooks = await new Promise((resolve, reject) => {
      db.all(
        `SELECT id, title, author, file_path, duration, file_size, cover_image,
                narrator, description, genre, published_year, isbn, series, series_position, added_by
         FROM audiobooks
         WHERE is_multi_file IS NULL OR is_multi_file = 0
         ORDER BY file_path`,
        (err, books) => {
          if (err) reject(err);
          else resolve(books);
        }
      );
    });

    // Group by directory
    const groups = new Map();
    for (const book of audiobooks) {
      if (!fs.existsSync(book.file_path)) {
        console.log(`Skipping missing file: ${book.file_path}`);
        continue;
      }

      const dir = path.dirname(book.file_path);
      if (!groups.has(dir)) {
        groups.set(dir, []);
      }
      groups.get(dir).push(book);
    }

    // Filter to only directories with multiple files
    const multiFileGroups = [];
    for (const [dir, books] of groups.entries()) {
      if (books.length > 1) {
        multiFileGroups.push({ dir, books });
      }
    }

    console.log(`Found ${multiFileGroups.length} directories with multiple files`);

    const results = {
      consolidated: 0,
      totalChapters: 0,
      errors: [],
    };

    // Process each group
    for (const { dir, books } of multiFileGroups) {
      try {
        // Sort by filename
        const sortedBooks = books.sort((a, b) => a.file_path.localeCompare(b.file_path));
        const primaryBook = sortedBooks[0];
        const dirName = path.basename(dir);

        // Calculate total duration and size
        let totalDuration = 0;
        let totalSize = 0;
        for (const book of sortedBooks) {
          totalDuration += book.duration || 0;
          totalSize += book.file_size || 0;
        }

        // Use directory name as title if primary book title looks like a chapter
        let title = primaryBook.title;
        if (title && /chapter|part|\d+/i.test(title)) {
          title = dirName;
        }

        console.log(`Consolidating ${sortedBooks.length} files into: ${title}`);

        // Update primary book
        await new Promise((resolve, reject) => {
          db.run(
            `UPDATE audiobooks
             SET title = ?, duration = ?, file_size = ?, is_multi_file = 1
             WHERE id = ?`,
            [title, totalDuration, totalSize, primaryBook.id],
            (err) => {
              if (err) reject(err);
              else resolve();
            }
          );
        });

        // Create chapter records
        for (let i = 0; i < sortedBooks.length; i++) {
          const book = sortedBooks[i];
          await new Promise((resolve, reject) => {
            db.run(
              `INSERT OR IGNORE INTO audiobook_chapters
               (audiobook_id, chapter_number, file_path, duration, file_size, title)
               VALUES (?, ?, ?, ?, ?, ?)`,
              [
                primaryBook.id,
                i + 1,
                book.file_path,
                book.duration,
                book.file_size,
                book.title,
              ],
              (err) => {
                if (err) reject(err);
                else resolve();
              }
            );
          });
        }

        // Delete other entries (keep only primary)
        if (sortedBooks.length > 1) {
          const idsToDelete = sortedBooks.slice(1).map(b => b.id);
          await new Promise((resolve, reject) => {
            db.run(
              `DELETE FROM audiobooks WHERE id IN (${idsToDelete.join(',')})`,
              (err) => {
                if (err) reject(err);
                else resolve();
              }
            );
          });
        }

        results.consolidated++;
        results.totalChapters += sortedBooks.length;
      } catch (error) {
        console.error(`Error consolidating ${dir}:`, error);
        results.errors.push({ dir, error: error.message });
      }
    }

    console.log('Consolidation complete:', results);
    res.json({
      success: true,
      ...results,
    });
  } catch (error) {
    console.error('Consolidation error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Clear all audiobooks from database
router.post('/clear-library', maintenanceWriteLimiter, authenticateToken, async (req, res) => {
  // Only allow admins to run this
  if (!req.user.is_admin) {
    return res.status(403).json({ error: 'Admin access required' });
  }

  try {
    console.log('Clearing library database...');

    // Delete all audiobook chapters first (due to foreign key constraint)
    await new Promise((resolve, reject) => {
      db.run('DELETE FROM audiobook_chapters', (err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    // Delete all playback progress
    await new Promise((resolve, reject) => {
      db.run('DELETE FROM playback_progress', (err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    // Delete all audiobooks
    await new Promise((resolve, reject) => {
      db.run('DELETE FROM audiobooks', (err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    console.log('Library database cleared successfully');
    res.json({
      success: true,
      message: 'Library database cleared. Audiobooks will be reimported on next scan.',
    });
  } catch (error) {
    console.error('Error clearing library:', error);
    res.status(500).json({ error: error.message });
  }
});

// Trigger immediate library scan (imports new files only)
router.post('/scan-library', maintenanceWriteLimiter, authenticateToken, async (req, res) => {
  // Only allow admins to run this
  if (!req.user.is_admin) {
    return res.status(403).json({ error: 'Admin access required' });
  }

  const refreshMetadata = req.body.refreshMetadata === true;

  try {
    if (refreshMetadata) {
      // Start metadata refresh in background - don't wait for it
      console.log('Starting metadata refresh for all audiobooks in background...');

      // Return immediately to prevent timeout
      res.json({
        success: true,
        message: 'Metadata refresh started in background. This may take several minutes for large libraries. Check Docker logs for progress.',
        stats: {
          imported: 0,
          skipped: 0,
          errors: 0,
          metadataRefreshed: 0,
          metadataErrors: 0,
          scanning: true
        },
      });

      // Continue processing in background
      setImmediate(async () => {
        try {
          // Get all audiobooks from database (include cover fields to preserve user-set covers)
          const audiobooks = await new Promise((resolve, reject) => {
            db.all('SELECT id, file_path, title, cover_path, cover_image FROM audiobooks', (err, rows) => {
              if (err) reject(err);
              else resolve(rows);
            });
          });

          let updated = 0;
          let errors = 0;

          console.log(`Refreshing metadata for ${audiobooks.length} audiobooks...`);

          for (const audiobook of audiobooks) {
            try {
              // Check if file still exists
              if (!fs.existsSync(audiobook.file_path)) {
                console.log(`File not found: ${audiobook.file_path}`);
                errors++;
                continue;
              }

              // Extract fresh metadata
              const metadata = await extractFileMetadata(audiobook.file_path);

              // Preserve user-downloaded covers (cover_path) - don't overwrite with extracted cover
              // If cover_path exists and is valid, keep it; otherwise use extracted cover
              let finalCoverImage = metadata.cover_image;
              if (audiobook.cover_path && fs.existsSync(audiobook.cover_path)) {
                // User has a custom cover, preserve it
                finalCoverImage = audiobook.cover_path;
                console.log(`Preserving user cover for ${audiobook.title}: ${audiobook.cover_path}`);
              } else if (metadata.cover_image) {
                console.log(`Using extracted cover for ${audiobook.title}: ${metadata.cover_image}`);
              }

              // Recalculate content hash to keep dedup in sync
              const contentHash = generateContentHash(metadata.title, metadata.author, metadata.duration);

              // Update database with all metadata fields including extended metadata
              await new Promise((resolve, reject) => {
                db.run(
                  `UPDATE audiobooks SET
                    title = ?, author = ?, narrator = ?, description = ?,
                    duration = ?, genre = ?, published_year = ?, isbn = ?,
                    series = ?, series_position = ?, cover_image = ?,
                    tags = ?, publisher = ?, copyright_year = ?, asin = ?,
                    language = ?, rating = ?, abridged = ?, subtitle = ?,
                    content_hash = ?,
                    updated_at = CURRENT_TIMESTAMP
                  WHERE id = ?`,
                  [
                    metadata.title, metadata.author, metadata.narrator, metadata.description,
                    metadata.duration, metadata.genre, metadata.published_year, metadata.isbn,
                    metadata.series, metadata.series_position, finalCoverImage,
                    metadata.tags, metadata.publisher, metadata.copyright_year, metadata.asin,
                    metadata.language, metadata.rating, metadata.abridged ? 1 : 0, metadata.subtitle,
                    contentHash,
                    audiobook.id
                  ],
                  (err) => {
                    if (err) reject(err);
                    else resolve();
                  }
                );
              });

              updated++;
              if (updated % 10 === 0) {
                console.log(`Metadata refresh progress: ${updated}/${audiobooks.length}`);
              }
            } catch (error) {
              console.error(`Error refreshing metadata for ${audiobook.file_path}:`, error.message);
              errors++;
            }
          }

          // Also scan for new files
          const scanStats = await scanLibrary();

          console.log(`✅ Metadata refresh complete: ${updated} updated, ${errors} errors`);
          console.log(`✅ New files scan: ${scanStats.imported} imported, ${scanStats.skipped} skipped`);
        } catch (error) {
          console.error('Error in background metadata refresh:', error);
        }
      });
    } else {
      // Normal scan (new files only) - this is fast, can be synchronous
      console.log('Manual library scan triggered');
      const stats = await scanLibrary();
      res.json({
        success: true,
        message: 'Library scan completed',
        stats,
      });
    }
  } catch (error) {
    console.error('Error scanning library:', error);
    res.status(500).json({ error: error.message });
  }
});

// Run database migrations
router.post('/migrate', maintenanceWriteLimiter, authenticateToken, async (req, res) => {
  // Only allow admins to run this
  if (!req.user.is_admin) {
    return res.status(403).json({ error: 'Admin access required' });
  }

  try {
    console.log('Running database migrations...');

    const migrationsDir = path.join(__dirname, '../migrations');

    // Ensure migrations table exists
    await new Promise((resolve, reject) => {
      db.run(
        `CREATE TABLE IF NOT EXISTS migrations (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          filename TEXT NOT NULL UNIQUE,
          applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`,
        (err) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });

    // Get applied migrations
    const appliedMigrations = await new Promise((resolve, reject) => {
      db.all('SELECT filename FROM migrations', (err, rows) => {
        if (err) reject(err);
        else resolve(rows.map(r => r.filename));
      });
    });

    // Get all migration files
    const files = fs.readdirSync(migrationsDir)
      .filter(f => f.endsWith('.js'))
      .sort();

    const results = {
      applied: [],
      skipped: [],
      errors: [],
    };

    // Run pending migrations
    for (const file of files) {
      if (appliedMigrations.includes(file)) {
        results.skipped.push(file);
        continue;
      }

      try {
        console.log(`Applying migration: ${file}`);
        const migration = require(path.join(migrationsDir, file));

        // Run the up function
        await migration.up(db);

        // Record migration
        await new Promise((resolve, reject) => {
          db.run(
            'INSERT INTO migrations (filename) VALUES (?)',
            [file],
            (err) => {
              if (err) reject(err);
              else resolve();
            }
          );
        });

        results.applied.push(file);
        console.log(`Migration ${file} applied successfully`);
      } catch (error) {
        console.error(`Error applying migration ${file}:`, error);
        results.errors.push({ file, error: error.message });
        // Stop on first error to prevent partial migrations
        break;
      }
    }

    console.log('Migration results:', results);
    res.json({
      success: results.errors.length === 0,
      ...results,
    });
  } catch (error) {
    console.error('Migration error:', error);
    res.status(500).json({ error: error.message });
  }
});

  // Force rescan - re-extract metadata for all audiobooks while preserving IDs
  // Marks all books unavailable, rescans library, restores by content_hash (same ID)
  // This preserves: audiobook IDs, user progress, favorites, ratings, user-set covers
  // External apps (like OpsDec) won't lose cached data that references book IDs
  router.post('/force-rescan', maintenanceWriteLimiter, authenticateToken, async (req, res) => {
  // Only allow admins to run this
  if (!req.user.is_admin) {
    return res.status(403).json({ error: 'Admin access required' });
  }

  // Prevent concurrent force rescans
  if (forceRescanInProgress) {
    return res.status(409).json({ error: 'Force rescan already in progress. Please wait.' });
  }

  // Check if periodic scan is running
  if (isScanningLocked()) {
    return res.status(409).json({ error: 'Library scan in progress. Please wait and try again.' });
  }

  forceRescanInProgress = true;
  lockScanning();  // Lock periodic scans while force rescan runs

  // Return immediately - run in background to prevent timeout on large libraries
  res.json({
    success: true,
    message: 'Force rescan started in background. Check Docker logs for progress.',
    stats: {
      imported: 0,
      skipped: 0,
      errors: 0,
      scanning: true,
    },
  });

  // Continue processing in background
  setImmediate(async () => {
    try {
      // ID-PRESERVING FORCE RESCAN
      // Instead of deleting audiobooks, mark them unavailable. The library scanner
      // will restore them by content_hash, preserving the original IDs. This keeps
      // external apps (like OpsDec) from losing cached data (covers, etc.) that
      // reference audiobook IDs.

      console.log('Force rescan: marking all audiobooks as unavailable (preserving IDs)...');

      // Get count before marking unavailable
      const beforeCount = await new Promise((resolve, reject) => {
        db.get('SELECT COUNT(*) as count FROM audiobooks', (err, row) => {
          if (err) reject(err);
          else resolve(row.count);
        });
      });

      console.log(`Found ${beforeCount} audiobooks to process`);

      // Mark all audiobooks as unavailable (instead of deleting)
      // This preserves: IDs, user progress, favorites, ratings, user-set covers
      await new Promise((resolve, reject) => {
        db.run(
          'UPDATE audiobooks SET is_available = 0, original_path = file_path',
          (err) => {
            if (err) reject(err);
            else resolve();
          }
        );
      });

      console.log('All audiobooks marked as unavailable');

      // Delete chapters - they will be recreated during rescan
      await new Promise((resolve, reject) => {
        db.run('DELETE FROM audiobook_chapters', (err) => {
          if (err) {
            console.error('Error deleting chapters:', err);
            reject(err);
          } else {
            resolve();
          }
        });
      });

      console.log('Chapters cleared, rescanning library...');

      // Rescan library - this will:
      // 1. Find all audio files
      // 2. Generate content_hash for each
      // 3. Check findUnavailableByHash() - if match found, RESTORE with original ID
      // 4. Only create new records for genuinely new files
      const stats = await scanLibrary();

      // Count how many were restored vs new
      const restoredCount = await new Promise((resolve, reject) => {
        db.get('SELECT COUNT(*) as count FROM audiobooks WHERE is_available = 1', (err, row) => {
          if (err) reject(err);
          else resolve(row.count);
        });
      });

      const stillUnavailable = await new Promise((resolve, reject) => {
        db.get('SELECT COUNT(*) as count FROM audiobooks WHERE is_available = 0', (err, row) => {
          if (err) reject(err);
          else resolve(row.count);
        });
      });

      // Now refresh metadata for all restored books (force rescan = re-extract metadata)
      console.log('Refreshing metadata for all restored audiobooks...');
      const audiobooks = await new Promise((resolve, reject) => {
        db.all('SELECT id, file_path, title, cover_path FROM audiobooks WHERE is_available = 1', (err, rows) => {
          if (err) reject(err);
          else resolve(rows || []);
        });
      });

      let metadataUpdated = 0;
      let metadataErrors = 0;

      for (const audiobook of audiobooks) {
        try {
          if (!fs.existsSync(audiobook.file_path)) {
            continue;
          }

          // Extract fresh metadata
          const metadata = await extractFileMetadata(audiobook.file_path);

          // Preserve user-set cover if it exists
          let finalCoverImage = metadata.cover_image;
          if (audiobook.cover_path && fs.existsSync(audiobook.cover_path)) {
            finalCoverImage = audiobook.cover_path;
          }

          // Recalculate content hash to keep dedup in sync
          const contentHash = generateContentHash(metadata.title, metadata.author, metadata.duration);

          // Update all metadata fields
          await new Promise((resolve, reject) => {
            db.run(
              `UPDATE audiobooks SET
                title = ?, author = ?, narrator = ?, description = ?,
                duration = ?, genre = ?, published_year = ?, isbn = ?,
                series = ?, series_position = ?, cover_image = ?,
                tags = ?, publisher = ?, copyright_year = ?, asin = ?,
                language = ?, rating = ?, abridged = ?, subtitle = ?,
                content_hash = ?,
                updated_at = CURRENT_TIMESTAMP
              WHERE id = ?`,
              [
                metadata.title, metadata.author, metadata.narrator, metadata.description,
                metadata.duration, metadata.genre, metadata.published_year, metadata.isbn,
                metadata.series, metadata.series_position, finalCoverImage,
                metadata.tags, metadata.publisher, metadata.copyright_year, metadata.asin,
                metadata.language, metadata.rating, metadata.abridged ? 1 : 0, metadata.subtitle,
                contentHash,
                audiobook.id
              ],
              (err) => {
                if (err) reject(err);
                else resolve();
              }
            );
          });

          metadataUpdated++;
          if (metadataUpdated % 25 === 0) {
            console.log(`Metadata refresh progress: ${metadataUpdated}/${audiobooks.length}`);
          }
        } catch (error) {
          console.error(`Error refreshing metadata for ${audiobook.file_path}:`, error.message);
          metadataErrors++;
        }
      }

      console.log('✅ Force rescan complete (ID-preserving mode):');
      console.log(`   - ${restoredCount} audiobooks restored/added (IDs preserved)`);
      console.log(`   - ${stillUnavailable} audiobooks still unavailable (files missing)`);
      console.log(`   - ${stats.imported} newly imported, ${stats.skipped} skipped, ${stats.errors} errors`);
      console.log(`   - ${metadataUpdated} metadata refreshed, ${metadataErrors} errors`);
      console.log('   - User progress, favorites, ratings, and covers preserved automatically');
    } catch (error) {
      console.error('❌ Error in force rescan:', error);
    } finally {
      forceRescanInProgress = false;
      unlockScanning();  // Unlock periodic scans
    }
  });
});

// Detect duplicate audiobooks
router.get('/duplicates', maintenanceLimiter, authenticateToken, async (req, res) => {
  if (!req.user.is_admin) {
    return res.status(403).json({ error: 'Admin access required' });
  }

  try {
    console.log('Scanning for duplicate audiobooks...');

    // Get all audiobooks with relevant fields
    const audiobooks = await new Promise((resolve, reject) => {
      db.all(
        `SELECT id, title, author, narrator, duration, file_size, file_path,
                isbn, asin, series, series_position, cover_image, cover_path,
                created_at
         FROM audiobooks
         ORDER BY title, author`,
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows || []);
        }
      );
    });

    // Get playback progress for each audiobook
    const progressMap = new Map();
    const progressData = await new Promise((resolve, reject) => {
      db.all(
        `SELECT audiobook_id, COUNT(*) as user_count, MAX(position) as max_position
         FROM playback_progress
         GROUP BY audiobook_id`,
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows || []);
        }
      );
    });
    for (const p of progressData) {
      progressMap.set(p.audiobook_id, { userCount: p.user_count, maxPosition: p.max_position });
    }

    const duplicateGroups = [];
    const processed = new Set();

    for (let i = 0; i < audiobooks.length; i++) {
      if (processed.has(audiobooks[i].id)) continue;

      const book = audiobooks[i];
      const matches = [book];

      for (let j = i + 1; j < audiobooks.length; j++) {
        if (processed.has(audiobooks[j].id)) continue;

        const candidate = audiobooks[j];
        let isDuplicate = false;
        let matchReason = '';

        // Match by ISBN/ASIN (exact match)
        if (book.isbn && candidate.isbn && book.isbn === candidate.isbn) {
          isDuplicate = true;
          matchReason = 'Same ISBN';
        } else if (book.asin && candidate.asin && book.asin === candidate.asin) {
          isDuplicate = true;
          matchReason = 'Same ASIN';
        }
        // Match by title + author (case-insensitive, trimmed)
        else if (book.title && candidate.title && book.author && candidate.author) {
          const titleMatch = book.title.toLowerCase().trim() === candidate.title.toLowerCase().trim();
          const authorMatch = book.author.toLowerCase().trim() === candidate.author.toLowerCase().trim();
          if (titleMatch && authorMatch) {
            isDuplicate = true;
            matchReason = 'Same title and author';
          }
        }
        // Match by similar duration + file size (within tolerance)
        else if (book.duration && candidate.duration && book.file_size && candidate.file_size) {
          const durationDiff = Math.abs(book.duration - candidate.duration) / Math.max(book.duration, candidate.duration);
          const sizeDiff = Math.abs(book.file_size - candidate.file_size) / Math.max(book.file_size, candidate.file_size);
          // Within 2% duration and 15% size could be same book different quality
          if (durationDiff < 0.02 && sizeDiff < 0.15) {
            // Also check if titles are similar (Levenshtein-like simple check)
            if (book.title && candidate.title) {
              const t1 = book.title.toLowerCase().replace(/[^a-z0-9]/g, '');
              const t2 = candidate.title.toLowerCase().replace(/[^a-z0-9]/g, '');
              if (t1 === t2 || t1.includes(t2) || t2.includes(t1)) {
                isDuplicate = true;
                matchReason = 'Similar duration and file size';
              }
            }
          }
        }

        if (isDuplicate) {
          candidate.matchReason = matchReason;
          matches.push(candidate);
          processed.add(candidate.id);
        }
      }

      if (matches.length > 1) {
        // Add progress info to each match
        const matchesWithProgress = matches.map(m => ({
          ...m,
          progress: progressMap.get(m.id) || { userCount: 0, maxPosition: 0 },
          hasCover: !!(m.cover_image || m.cover_path),
          hasUserCover: !!m.cover_path,
        }));

        // Sort by quality indicators (most metadata, user cover, most progress)
        matchesWithProgress.sort((a, b) => {
          // Prefer user-set cover
          if (a.hasUserCover !== b.hasUserCover) return b.hasUserCover - a.hasUserCover;
          // Prefer more user progress
          if (a.progress.userCount !== b.progress.userCount) return b.progress.userCount - a.progress.userCount;
          // Prefer larger file (higher quality)
          if (a.file_size !== b.file_size) return (b.file_size || 0) - (a.file_size || 0);
          // Prefer older (original)
          return new Date(a.created_at) - new Date(b.created_at);
        });

        duplicateGroups.push({
          id: `group-${duplicateGroups.length + 1}`,
          matchReason: matches[1].matchReason,
          books: matchesWithProgress,
          suggestedKeep: matchesWithProgress[0].id,
        });

        processed.add(book.id);
      }
    }

    console.log(`Found ${duplicateGroups.length} duplicate groups`);

    res.json({
      duplicateGroups,
      totalDuplicates: duplicateGroups.reduce((sum, g) => sum + g.books.length - 1, 0),
    });
  } catch (error) {
    console.error('Error detecting duplicates:', error);
    res.status(500).json({ error: error.message });
  }
});

// Merge duplicate audiobooks
router.post('/duplicates/merge', maintenanceWriteLimiter, authenticateToken, async (req, res) => {
  if (!req.user.is_admin) {
    return res.status(403).json({ error: 'Admin access required' });
  }

  const { keepId, deleteIds, deleteFiles } = req.body;

  if (!keepId || !Array.isArray(deleteIds) || deleteIds.length === 0) {
    return res.status(400).json({ error: 'Must specify keepId and deleteIds array' });
  }

  // Ensure keepId is not in deleteIds
  if (deleteIds.includes(keepId)) {
    return res.status(400).json({ error: 'Cannot delete the audiobook being kept' });
  }

  try {
    console.log(`Merging duplicates: keeping ${keepId}, deleting ${deleteIds.join(', ')}`);

    // Get the audiobook to keep
    const keepBook = await new Promise((resolve, reject) => {
      db.get('SELECT * FROM audiobooks WHERE id = ?', [keepId], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });

    if (!keepBook) {
      return res.status(404).json({ error: 'Audiobook to keep not found' });
    }

    // Get audiobooks to delete
    const deleteBooks = await new Promise((resolve, reject) => {
      db.all(
        `SELECT * FROM audiobooks WHERE id IN (${deleteIds.map(() => '?').join(',')})`,
        deleteIds,
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows || []);
        }
      );
    });

    if (deleteBooks.length === 0) {
      return res.status(404).json({ error: 'No audiobooks to delete found' });
    }

    // Transfer playback progress from deleted books to kept book
    let progressTransferred = 0;
    for (const deleteBook of deleteBooks) {
      // Get progress from the book being deleted
      const progressRecords = await new Promise((resolve, reject) => {
        db.all(
          'SELECT * FROM playback_progress WHERE audiobook_id = ?',
          [deleteBook.id],
          (err, rows) => {
            if (err) reject(err);
            else resolve(rows || []);
          }
        );
      });

      for (const progress of progressRecords) {
        // Check if user already has progress on the kept book
        const existingProgress = await new Promise((resolve, reject) => {
          db.get(
            'SELECT * FROM playback_progress WHERE user_id = ? AND audiobook_id = ?',
            [progress.user_id, keepId],
            (err, row) => {
              if (err) reject(err);
              else resolve(row);
            }
          );
        });

        if (existingProgress) {
          // Keep the more advanced progress
          if (progress.position > existingProgress.position) {
            await new Promise((resolve, reject) => {
              db.run(
                'UPDATE playback_progress SET position = ?, completed = ?, updated_at = ? WHERE user_id = ? AND audiobook_id = ?',
                [progress.position, progress.completed, progress.updated_at, progress.user_id, keepId],
                (err) => {
                  if (err) reject(err);
                  else resolve();
                }
              );
            });
            progressTransferred++;
          }
        } else {
          // Create new progress record for kept book
          await new Promise((resolve, reject) => {
            db.run(
              'INSERT INTO playback_progress (user_id, audiobook_id, position, completed, updated_at) VALUES (?, ?, ?, ?, ?)',
              [progress.user_id, keepId, progress.position, progress.completed, progress.updated_at],
              (err) => {
                if (err) reject(err);
                else resolve();
              }
            );
          });
          progressTransferred++;
        }
      }
    }

    // Delete progress records for deleted books
    await new Promise((resolve, reject) => {
      db.run(
        `DELETE FROM playback_progress WHERE audiobook_id IN (${deleteIds.map(() => '?').join(',')})`,
        deleteIds,
        (err) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });

    // Delete chapters for deleted books
    await new Promise((resolve, reject) => {
      db.run(
        `DELETE FROM audiobook_chapters WHERE audiobook_id IN (${deleteIds.map(() => '?').join(',')})`,
        deleteIds,
        (err) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });

    // Delete the duplicate audiobook records
    await new Promise((resolve, reject) => {
      db.run(
        `DELETE FROM audiobooks WHERE id IN (${deleteIds.map(() => '?').join(',')})`,
        deleteIds,
        (err) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });

    // Optionally delete the actual files
    let filesDeleted = 0;
    if (deleteFiles) {
      for (const deleteBook of deleteBooks) {
        try {
          if (deleteBook.file_path && fs.existsSync(deleteBook.file_path)) {
            // Delete the entire directory if it only contains this audiobook
            const dir = path.dirname(deleteBook.file_path);
            const files = fs.readdirSync(dir);
            const audioFiles = files.filter(f => /\.(m4b|m4a|mp3|flac|ogg)$/i.test(f));

            if (audioFiles.length === 1) {
              // Safe to delete entire directory
              fs.rmSync(dir, { recursive: true, force: true });
              console.log(`Deleted directory: ${dir}`);
            } else {
              // Just delete the audio file
              fs.unlinkSync(deleteBook.file_path);
              console.log(`Deleted file: ${deleteBook.file_path}`);
            }
            filesDeleted++;
          }
        } catch (error) {
          console.error(`Failed to delete file ${deleteBook.file_path}:`, error.message);
        }
      }
    }

    console.log(`✅ Merge complete: ${deleteBooks.length} duplicates removed, ${progressTransferred} progress records transferred`);

    res.json({
      success: true,
      kept: keepId,
      deleted: deleteIds,
      progressTransferred,
      filesDeleted,
    });
  } catch (error) {
    console.error('Error merging duplicates:', error);
    res.status(500).json({ error: error.message });
  }
});

// Detect orphan directories (directories with files not tracked as audiobooks)
router.get('/orphan-directories', maintenanceLimiter, authenticateToken, async (req, res) => {
  if (!req.user.is_admin) {
    return res.status(403).json({ error: 'Admin access required' });
  }

  try {
    console.log('Scanning for orphan directories...');

    const audiobooksDir = process.env.AUDIOBOOKS_DIR || path.join(__dirname, '../../data/audiobooks');

    // Get all tracked file paths from database (normalized)
    const trackedFilesRaw = await new Promise((resolve, reject) => {
      db.all(
        `SELECT file_path FROM audiobooks WHERE is_available = 1 OR is_available IS NULL
         UNION
         SELECT file_path FROM audiobook_chapters`,
        (err, rows) => {
          if (err) reject(err);
          else resolve((rows || []).map(r => r.file_path));
        }
      );
    });

    // Normalize paths and create a set of tracked directories
    const trackedFiles = new Set(trackedFilesRaw.map(f => path.normalize(f)));
    const trackedDirs = new Set(trackedFilesRaw.map(f => path.normalize(path.dirname(f))));

    // Audio file extensions to look for
    const audioExtensions = ['.m4b', '.m4a', '.mp3', '.flac', '.ogg', '.opus', '.wav', '.aac'];

    const orphanDirs = [];

    // Recursively scan directories
    function scanDirectory(dir, depth = 0) {
      if (depth > 10) return; // Prevent infinite recursion

      let entries;
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch (_err) {
        return;
      }

      const subdirs = [];
      const files = [];

      for (const entry of entries) {
        if (entry.name.startsWith('.')) continue; // Skip hidden files

        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          subdirs.push(fullPath);
        } else if (entry.isFile()) {
          files.push(fullPath);
        }
      }

      // Check if this directory has any tracked audio files
      const normalizedDir = path.normalize(dir);
      const audioFiles = files.filter(f =>
        audioExtensions.includes(path.extname(f).toLowerCase())
      );
      const trackedAudioFiles = audioFiles.filter(f => trackedFiles.has(path.normalize(f)));
      const untrackedAudioFiles = audioFiles.filter(f => !trackedFiles.has(path.normalize(f)));

      // Determine if this is an orphan directory:
      // 1. Has untracked audio files, OR
      // 2. Has files but no audio files AND is not a directory containing tracked books, OR
      // 3. Is completely empty (no files, no subdirs) and not a tracked book directory
      const hasFiles = files.length > 0;
      const hasSubdirs = subdirs.length > 0;
      const hasNoAudioFiles = audioFiles.length === 0;
      const isTrackedBookDir = trackedDirs.has(normalizedDir);
      const hasOnlyMetadata = hasFiles && hasNoAudioFiles && !isTrackedBookDir;
      const isEmpty = !hasFiles && !hasSubdirs && !isTrackedBookDir;

      if (untrackedAudioFiles.length > 0 || hasOnlyMetadata || isEmpty) {
        // Calculate total size
        let totalSize = 0;
        for (const f of files) {
          try {
            totalSize += fs.statSync(f).size;
          } catch (_err) {
            // Ignore stat errors
          }
        }

        // Determine orphan type for UI display
        let orphanType = 'untracked_audio';
        if (isEmpty) {
          orphanType = 'empty';
        } else if (hasOnlyMetadata) {
          orphanType = 'metadata_only';
        } else if (trackedAudioFiles.length > 0 && untrackedAudioFiles.length > 0) {
          orphanType = 'mixed'; // Some tracked, some not
        }

        orphanDirs.push({
          path: dir,
          relativePath: path.relative(audiobooksDir, dir),
          fileCount: files.length,
          audioFileCount: audioFiles.length,
          untrackedAudioCount: untrackedAudioFiles.length,
          trackedAudioCount: trackedAudioFiles.length,
          files: files.map(f => path.basename(f)),
          totalSize,
          orphanType,
        });
      }

      // Recurse into subdirectories
      for (const subdir of subdirs) {
        scanDirectory(subdir, depth + 1);
      }
    }

    scanDirectory(audiobooksDir);

    console.log(`Found ${orphanDirs.length} orphan directories`);

    res.json({
      orphanDirectories: orphanDirs,
      totalCount: orphanDirs.length,
      totalSize: orphanDirs.reduce((sum, d) => sum + d.totalSize, 0),
    });
  } catch (error) {
    console.error('Error scanning for orphan directories:', error);
    res.status(500).json({ error: error.message });
  }
});

// Delete orphan directories
router.delete('/orphan-directories', maintenanceWriteLimiter, authenticateToken, async (req, res) => {
  if (!req.user.is_admin) {
    return res.status(403).json({ error: 'Admin access required' });
  }

  const { paths } = req.body;

  if (!Array.isArray(paths) || paths.length === 0) {
    return res.status(400).json({ error: 'Must specify paths array' });
  }

  const audiobooksDir = process.env.AUDIOBOOKS_DIR || path.join(__dirname, '../../data/audiobooks');

  try {
    console.log(`Deleting ${paths.length} orphan directories...`);

    const results = {
      deleted: [],
      failed: [],
    };

    for (const dirPath of paths) {
      // Security check: ensure path is within audiobooks directory
      const fullPath = path.resolve(dirPath);
      const normalizedAudiobooksDir = path.resolve(audiobooksDir);

      if (!fullPath.startsWith(normalizedAudiobooksDir)) {
        results.failed.push({ path: dirPath, error: 'Path outside audiobooks directory' });
        continue;
      }

      // Don't delete the root audiobooks directory
      if (fullPath === normalizedAudiobooksDir) {
        results.failed.push({ path: dirPath, error: 'Cannot delete root audiobooks directory' });
        continue;
      }

      try {
        if (fs.existsSync(fullPath)) {
          fs.rmSync(fullPath, { recursive: true, force: true });
          console.log(`Deleted orphan directory: ${fullPath}`);
          results.deleted.push(dirPath);

          // Clean up empty parent directories
          let parentDir = path.dirname(fullPath);
          while (parentDir !== normalizedAudiobooksDir) {
            try {
              const contents = fs.readdirSync(parentDir);
              if (contents.length === 0) {
                fs.rmdirSync(parentDir);
                console.log(`Removed empty parent directory: ${parentDir}`);
                parentDir = path.dirname(parentDir);
              } else {
                break;
              }
            } catch (_err) {
              break;
            }
          }
        } else {
          results.failed.push({ path: dirPath, error: 'Directory not found' });
        }
      } catch (error) {
        results.failed.push({ path: dirPath, error: error.message });
      }
    }

    console.log(`Deleted ${results.deleted.length} directories, ${results.failed.length} failed`);

    res.json({
      success: true,
      ...results,
    });
  } catch (error) {
    console.error('Error deleting orphan directories:', error);
    res.status(500).json({ error: error.message });
  }
});

// Preview what would be organized (dry run)
router.get('/organize/preview', maintenanceLimiter, authenticateToken, async (req, res) => {
  if (!req.user.is_admin) {
    return res.status(403).json({ error: 'Admin access required' });
  }

  try {
    console.log('Getting organization preview...');
    const preview = await getOrganizationPreview();

    res.json({
      needsOrganization: preview.length,
      books: preview,
    });
  } catch (error) {
    console.error('Error getting organization preview:', error);
    res.status(500).json({ error: error.message });
  }
});

// Organize all audiobooks into correct directory structure
router.post('/organize', maintenanceWriteLimiter, authenticateToken, async (req, res) => {
  if (!req.user.is_admin) {
    return res.status(403).json({ error: 'Admin access required' });
  }

  // Check if any scan is in progress
  if (isScanningLocked()) {
    return res.status(409).json({ error: 'Library scan in progress. Please wait and try again.' });
  }

  lockScanning(); // Lock scans while organizing

  try {
    console.log('Starting manual library organization...');
    const stats = await organizeLibrary();

    res.json({
      success: true,
      message: 'Library organization complete',
      stats,
    });
  } catch (error) {
    console.error('Error organizing library:', error);
    res.status(500).json({ error: error.message });
  } finally {
    unlockScanning();
  }
});

// Organize a single audiobook
router.post('/organize/:id', maintenanceWriteLimiter, authenticateToken, async (req, res) => {
  if (!req.user.is_admin) {
    return res.status(403).json({ error: 'Admin access required' });
  }

  const { id } = req.params;

  try {
    // Get the audiobook
    const audiobook = await new Promise((resolve, reject) => {
      db.get('SELECT * FROM audiobooks WHERE id = ?', [id], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });

    if (!audiobook) {
      return res.status(404).json({ error: 'Audiobook not found' });
    }

    const result = await organizeAudiobook(audiobook);

    if (result.moved) {
      res.json({
        success: true,
        message: 'Audiobook organized successfully',
        newPath: result.newPath,
      });
    } else if (result.error) {
      res.status(400).json({ error: result.error });
    } else {
      res.json({
        success: true,
        message: 'Audiobook already in correct location',
      });
    }
  } catch (error) {
    console.error('Error organizing audiobook:', error);
    res.status(500).json({ error: error.message });
  }
});

// List all untracked audio files on disk (diagnostic)
router.get('/untracked-files', maintenanceLimiter, authenticateToken, async (req, res) => {
  if (!req.user.is_admin) {
    return res.status(403).json({ error: 'Admin access required' });
  }

  const audiobooksDir = process.env.AUDIOBOOKS_DIR || path.join(__dirname, '../../data/audiobooks');
  const audioExtensions = ['.mp3', '.m4a', '.m4b', '.mp4', '.ogg', '.flac', '.opus', '.wav', '.aac'];

  try {
    // Get all tracked file paths from DB
    const trackedFiles = await new Promise((resolve, reject) => {
      const db = defaultDependencies.db();
      db.all(
        `SELECT file_path FROM audiobooks
         UNION
         SELECT file_path FROM audiobook_chapters`,
        (err, rows) => {
          if (err) reject(err);
          else resolve(new Set((rows || []).map(r => path.normalize(r.file_path))));
        }
      );
    });

    // Recursively find all audio files on disk
    const allFiles = [];
    function walkDir(dir) {
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.name.startsWith('.')) continue;
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            walkDir(fullPath);
          } else if (entry.isFile()) {
            const ext = path.extname(entry.name).toLowerCase();
            if (audioExtensions.includes(ext)) {
              allFiles.push(fullPath);
            }
          }
        }
      } catch (_err) { /* skip inaccessible dirs */ }
    }
    walkDir(audiobooksDir);

    // Find untracked files
    const untrackedFiles = allFiles.filter(f => !trackedFiles.has(path.normalize(f)));

    // Group by parent directory
    const byDir = {};
    for (const f of untrackedFiles) {
      const rel = path.relative(audiobooksDir, f);
      const dir = path.dirname(rel);
      if (!byDir[dir]) byDir[dir] = [];
      byDir[dir].push(path.basename(f));
    }

    // Group ALL files by directory (showing file count per dir)
    const allByDir = {};
    for (const f of allFiles) {
      const rel = path.relative(audiobooksDir, f);
      const dir = path.dirname(rel);
      if (!allByDir[dir]) allByDir[dir] = { files: [], tracked: 0, untracked: 0 };
      const isTracked = trackedFiles.has(path.normalize(f));
      allByDir[dir].files.push({ name: path.basename(f), tracked: isTracked });
      if (isTracked) allByDir[dir].tracked++;
      else allByDir[dir].untracked++;
    }

    // Only include directories with 2+ files
    const multiFileDirs = {};
    for (const [dir, info] of Object.entries(allByDir)) {
      if (info.files.length > 1) {
        multiFileDirs[dir] = info;
      }
    }

    res.json({
      totalFilesOnDisk: allFiles.length,
      trackedFiles: trackedFiles.size,
      untrackedCount: untrackedFiles.length,
      untrackedByDirectory: byDir,
      multiFileDirectories: multiFileDirs,
      multiFileDirCount: Object.keys(multiFileDirs).length,
    });
  } catch (error) {
    console.error('Error scanning for untracked files:', error);
    res.status(500).json({ error: error.message });
  }
});

  return router;
}

// Export default router for backwards compatibility with index.js
module.exports = createMaintenanceRouter();
// Export factory function for testing
module.exports.createMaintenanceRouter = createMaintenanceRouter;
