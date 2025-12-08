const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const db = require('../database');
const path = require('path');
const fs = require('fs');
const { authenticateToken } = require('../auth');
const { extractFileMetadata } = require('../services/fileProcessor');
const { scanLibrary, lockScanning, unlockScanning, isScanningLocked, getJobStatus } = require('../services/libraryScanner');

// SECURITY: Rate limiter for debug endpoints to prevent abuse
const debugLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30, // 30 requests per minute
  message: { error: 'Too many debug requests. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// In-memory log buffer for UI viewing
const LOG_BUFFER_SIZE = 500;
const logBuffer = [];
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
  if (logBuffer.length > LOG_BUFFER_SIZE) logBuffer.shift();
  originalConsoleLog.apply(console, args);
};

console.error = (...args) => {
  const message = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
  logBuffer.push({ timestamp: new Date().toISOString(), level: 'error', category: 'error', message });
  if (logBuffer.length > LOG_BUFFER_SIZE) logBuffer.shift();
  originalConsoleError.apply(console, args);
};

// Get server logs
router.get('/logs', authenticateToken, (req, res) => {
  if (!req.user.is_admin) {
    return res.status(403).json({ error: 'Admin access required' });
  }

  const limit = Math.min(parseInt(req.query.limit) || 100, LOG_BUFFER_SIZE);
  const logs = logBuffer.slice(-limit);

  res.json({
    logs,
    total: logBuffer.length,
    forceRescanInProgress,
    scanningLocked: isScanningLocked()
  });
});

// Get background jobs status
router.get('/jobs', authenticateToken, (req, res) => {
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
router.get('/statistics', authenticateToken, async (req, res) => {
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

// Consolidate multi-file audiobooks
router.post('/consolidate-multifile', authenticateToken, async (req, res) => {
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
router.post('/clear-library', authenticateToken, async (req, res) => {
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
router.post('/scan-library', authenticateToken, async (req, res) => {
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

              // Update database with all metadata fields including extended metadata
              await new Promise((resolve, reject) => {
                db.run(
                  `UPDATE audiobooks SET
                    title = ?, author = ?, narrator = ?, description = ?,
                    duration = ?, genre = ?, published_year = ?, isbn = ?,
                    series = ?, series_position = ?, cover_image = ?,
                    tags = ?, publisher = ?, copyright_year = ?, asin = ?,
                    language = ?, rating = ?, abridged = ?, subtitle = ?,
                    updated_at = CURRENT_TIMESTAMP
                  WHERE id = ?`,
                  [
                    metadata.title, metadata.author, metadata.narrator, metadata.description,
                    metadata.duration, metadata.genre, metadata.published_year, metadata.isbn,
                    metadata.series, metadata.series_position, finalCoverImage,
                    metadata.tags, metadata.publisher, metadata.copyright_year, metadata.asin,
                    metadata.language, metadata.rating, metadata.abridged ? 1 : 0, metadata.subtitle,
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
router.post('/migrate', authenticateToken, async (req, res) => {
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

// Force rescan - clear and reimport all audiobooks (preserves user progress)
// Uses a lock to prevent concurrent scans
let forceRescanInProgress = false;

router.post('/force-rescan', authenticateToken, async (req, res) => {
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
      console.log('Force rescan: backing up user data...');

      // Backup playback progress with file paths
      const progressBackup = await new Promise((resolve, reject) => {
        db.all(
          `SELECT pp.user_id, pp.position, pp.completed, pp.updated_at, a.file_path
           FROM playback_progress pp
           JOIN audiobooks a ON pp.audiobook_id = a.id`,
          (err, rows) => {
            if (err) reject(err);
            else resolve(rows || []);
          }
        );
      });

      console.log(`Backed up progress for ${progressBackup.length} audiobooks`);

      // Backup user-set covers (cover_path) - these are custom covers downloaded from search
      const coverBackup = await new Promise((resolve, reject) => {
        db.all(
          'SELECT file_path, cover_path FROM audiobooks WHERE cover_path IS NOT NULL AND cover_path != \'\'',
          (err, rows) => {
            if (err) reject(err);
            else resolve(rows || []);
          }
        );
      });

      console.log(`Backed up ${coverBackup.length} user-set covers`);
      console.log('Force rescan: clearing library metadata...');

      // Use a transaction-like approach - serialize all deletes
      await new Promise((resolve, reject) => {
        db.serialize(() => {
          db.run('DELETE FROM audiobook_chapters', (err) => {
            if (err) console.error('Error deleting chapters:', err);
          });
          db.run('DELETE FROM playback_progress', (err) => {
            if (err) console.error('Error deleting progress:', err);
          });
          db.run('DELETE FROM audiobooks', (err) => {
            if (err) {
              reject(err);
            } else {
              resolve();
            }
          });
        });
      });

      // Verify audiobooks table is empty before scanning
      const count = await new Promise((resolve, reject) => {
        db.get('SELECT COUNT(*) as count FROM audiobooks', (err, row) => {
          if (err) reject(err);
          else resolve(row.count);
        });
      });

      if (count > 0) {
        throw new Error(`Failed to clear audiobooks table. ${count} records remain.`);
      }

      console.log('Library metadata cleared, rescanning...');
      const stats = await scanLibrary();

      // Restore playback progress
      console.log('Restoring user progress...');
      let restored = 0;
      for (const progress of progressBackup) {
        try {
          // Find audiobook by file path
          const audiobook = await new Promise((resolve, reject) => {
            db.get(
              'SELECT id FROM audiobooks WHERE file_path = ?',
              [progress.file_path],
              (err, row) => {
                if (err) reject(err);
                else resolve(row);
              }
            );
          });

          if (audiobook) {
            // Restore progress - use INSERT OR REPLACE to avoid duplicates
            await new Promise((resolve, reject) => {
              db.run(
                `INSERT OR REPLACE INTO playback_progress (audiobook_id, user_id, position, completed, updated_at)
                 VALUES (?, ?, ?, ?, ?)`,
                [audiobook.id, progress.user_id, progress.position, progress.completed, progress.updated_at],
                (err) => {
                  if (err) reject(err);
                  else resolve();
                }
              );
            });
            restored++;
          }
        } catch (error) {
          console.error(`Failed to restore progress for ${progress.file_path}:`, error.message);
        }
      }

      // Restore user-set covers
      console.log('Restoring user-set covers...');
      let coversRestored = 0;
      for (const cover of coverBackup) {
        try {
          // Verify cover file still exists
          if (!fs.existsSync(cover.cover_path)) {
            console.log(`Cover file no longer exists: ${cover.cover_path}`);
            continue;
          }

          // Find audiobook by file path
          const audiobook = await new Promise((resolve, reject) => {
            db.get(
              'SELECT id FROM audiobooks WHERE file_path = ?',
              [cover.file_path],
              (err, row) => {
                if (err) reject(err);
                else resolve(row);
              }
            );
          });

          if (audiobook) {
            // Restore cover_path
            await new Promise((resolve, reject) => {
              db.run(
                'UPDATE audiobooks SET cover_path = ?, cover_image = ? WHERE id = ?',
                [cover.cover_path, cover.cover_path, audiobook.id],
                (err) => {
                  if (err) reject(err);
                  else resolve();
                }
              );
            });
            coversRestored++;
            console.log(`Restored cover for audiobook ${audiobook.id}: ${cover.cover_path}`);
          }
        } catch (error) {
          console.error(`Failed to restore cover for ${cover.file_path}:`, error.message);
        }
      }

      console.log(`✅ Force rescan complete: ${stats.imported} imported, ${stats.skipped} skipped, ${stats.errors} errors`);
      console.log(`✅ Restored progress for ${restored} audiobooks`);
      console.log(`✅ Restored ${coversRestored} user-set covers`);
    } catch (error) {
      console.error('❌ Error in force rescan:', error);
    } finally {
      forceRescanInProgress = false;
      unlockScanning();  // Unlock periodic scans
    }
  });
});

// Detect duplicate audiobooks
router.get('/duplicates', authenticateToken, async (req, res) => {
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
router.post('/duplicates/merge', authenticateToken, async (req, res) => {
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

// Diagnostic endpoint to inspect raw metadata from an audiobook file
// This helps debug why certain tags (like series) might not be extracted
router.get('/debug-metadata/:id', debugLimiter, authenticateToken, async (req, res) => {
  if (!req.user.is_admin) {
    return res.status(403).json({ error: 'Admin access required' });
  }

  try {
    const audiobookId = parseInt(req.params.id);

    // Get audiobook from database
    const audiobook = await new Promise((resolve, reject) => {
      db.get('SELECT * FROM audiobooks WHERE id = ?', [audiobookId], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });

    if (!audiobook) {
      return res.status(404).json({ error: 'Audiobook not found' });
    }

    if (!audiobook.file_path || !fs.existsSync(audiobook.file_path)) {
      return res.status(404).json({ error: 'Audio file not found', file_path: audiobook.file_path });
    }

    // Parse the audio file to get raw metadata
    const mm = await import('music-metadata');
    const rawMetadata = await mm.parseFile(audiobook.file_path);

    // Also get our extracted metadata for comparison
    const extractedMetadata = await extractFileMetadata(audiobook.file_path);

    // Extract just the relevant series-related tags for easier debugging
    const nativeTags = rawMetadata.native || {};
    const seriesRelatedTags = {};

    // Check all tag formats for series-related info
    for (const [format, tags] of Object.entries(nativeTags)) {
      const relevantTags = tags.filter(tag =>
        tag.id.toLowerCase().includes('series') ||
        tag.id.toLowerCase().includes('mvn') ||
        tag.id.toLowerCase().includes('mvi') ||
        tag.id.toLowerCase().includes('movement') ||
        tag.id.toLowerCase().includes('part') ||
        tag.id.toLowerCase().includes('tvsh') ||
        tag.id.toLowerCase().includes('sosn') ||
        tag.id.toLowerCase().includes('grp') ||
        tag.id.toLowerCase().includes('st3') ||
        tag.id === 'tves' ||
        tag.id === 'tvsn' ||
        tag.id === 'disk'
      );
      if (relevantTags.length > 0) {
        seriesRelatedTags[format] = relevantTags;
      }
    }

    res.json({
      audiobook: {
        id: audiobook.id,
        title: audiobook.title,
        author: audiobook.author,
        series: audiobook.series,
        series_position: audiobook.series_position,
        file_path: audiobook.file_path,
      },
      extracted_metadata: {
        series: extractedMetadata.series,
        series_position: extractedMetadata.series_position,
        title: extractedMetadata.title,
        author: extractedMetadata.author,
      },
      common_tags: {
        title: rawMetadata.common.title,
        artist: rawMetadata.common.artist,
        album: rawMetadata.common.album,
        albumartist: rawMetadata.common.albumartist,
        movementName: rawMetadata.common.movementName,
        movementIndex: rawMetadata.common.movementIndex,
        disk: rawMetadata.common.disk,
        track: rawMetadata.common.track,
      },
      series_related_native_tags: seriesRelatedTags,
      all_native_tag_formats: Object.keys(nativeTags),
      // Include first 50 native tags from each format for detailed inspection
      native_tags_sample: Object.fromEntries(
        Object.entries(nativeTags).map(([format, tags]) => [
          format,
          tags.slice(0, 50).map(t => ({
            id: t.id,
            value: Buffer.isBuffer(t.value) ? `<Buffer ${t.value.length} bytes>` : t.value
          }))
        ])
      ),
    });
  } catch (error) {
    console.error('Error debugging metadata:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
