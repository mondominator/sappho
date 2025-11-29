const express = require('express');
const router = express.Router();
const db = require('../database');
const path = require('path');
const fs = require('fs');
const { authenticateToken } = require('../auth');
const { extractFileMetadata } = require('../services/fileProcessor');
const { scanLibrary, lockScanning, unlockScanning, isScanningLocked } = require('../services/libraryScanner');

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
          // Get all audiobooks from database
          const audiobooks = await new Promise((resolve, reject) => {
            db.all('SELECT id, file_path FROM audiobooks', (err, rows) => {
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

              // Update database
              await new Promise((resolve, reject) => {
                db.run(
                  `UPDATE audiobooks SET
                    title = ?, author = ?, narrator = ?, description = ?,
                    duration = ?, genre = ?, published_year = ?, isbn = ?,
                    series = ?, series_position = ?, cover_image = ?,
                    updated_at = CURRENT_TIMESTAMP
                  WHERE id = ?`,
                  [
                    metadata.title, metadata.author, metadata.narrator, metadata.description,
                    metadata.duration, metadata.genre, metadata.published_year, metadata.isbn,
                    metadata.series, metadata.series_position, metadata.cover_image,
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
      console.log('Force rescan: backing up user progress...');

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

      console.log(`✅ Force rescan complete: ${stats.imported} imported, ${stats.skipped} skipped, ${stats.errors} errors`);
      console.log(`✅ Restored progress for ${restored} audiobooks`);
    } catch (error) {
      console.error('❌ Error in force rescan:', error);
    } finally {
      forceRescanInProgress = false;
      unlockScanning();  // Unlock periodic scans
    }
  });
});

module.exports = router;
