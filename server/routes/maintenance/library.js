/**
 * Library Operation Routes
 * Consolidate multi-file books, clear library, scan, migrate, force rescan.
 */
const fs = require('fs');
const path = require('path');
const { maintenanceWriteLimiter, getForceRescanInProgress, setForceRescanInProgress } = require('./helpers');
const { createDbHelpers } = require('../../utils/db');

function register(router, { db, authenticateToken, extractFileMetadata, scanLibrary, lockScanning, unlockScanning, isScanningLocked }) {
  const { dbGet, dbAll, dbRun, dbTransaction } = createDbHelpers(db);

  // Consolidate multi-file audiobooks
  router.post('/consolidate-multifile', maintenanceWriteLimiter, authenticateToken, async (req, res) => {
    if (!req.user.is_admin) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    try {
      console.log('Starting multi-file audiobook consolidation...');

      const audiobooks = await dbAll(
        `SELECT id, title, author, file_path, duration, file_size, cover_image,
                narrator, description, genre, published_year, isbn, series, series_position, added_by
         FROM audiobooks
         WHERE is_multi_file IS NULL OR is_multi_file = 0
         ORDER BY file_path`
      );

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

      for (const { dir, books } of multiFileGroups) {
        try {
          const sortedBooks = books.sort((a, b) => a.file_path.localeCompare(b.file_path));
          const primaryBook = sortedBooks[0];
          const dirName = path.basename(dir);

          let totalDuration = 0;
          let totalSize = 0;
          for (const book of sortedBooks) {
            totalDuration += book.duration || 0;
            totalSize += book.file_size || 0;
          }

          let title = primaryBook.title;
          if (title && /chapter|part|\d+/i.test(title)) {
            title = dirName;
          }

          console.log(`Consolidating ${sortedBooks.length} files into: ${title}`);

          await dbRun(
            `UPDATE audiobooks
             SET title = ?, duration = ?, file_size = ?, is_multi_file = 1
             WHERE id = ?`,
            [title, totalDuration, totalSize, primaryBook.id]
          );

          for (let i = 0; i < sortedBooks.length; i++) {
            const book = sortedBooks[i];
            await dbRun(
              `INSERT OR IGNORE INTO audiobook_chapters
               (audiobook_id, chapter_number, file_path, duration, file_size, title)
               VALUES (?, ?, ?, ?, ?, ?)`,
              [primaryBook.id, i + 1, book.file_path, book.duration, book.file_size, book.title]
            );
          }

          if (sortedBooks.length > 1) {
            const idsToDelete = sortedBooks.slice(1).map(b => b.id);
            await dbRun(`DELETE FROM audiobooks WHERE id IN (${idsToDelete.join(',')})`);
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
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Clear all audiobooks from database
  router.post('/clear-library', maintenanceWriteLimiter, authenticateToken, async (req, res) => {
    if (!req.user.is_admin) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    try {
      console.log('Clearing library database...');

      await dbRun('DELETE FROM audiobook_chapters');
      await dbRun('DELETE FROM playback_progress');
      await dbRun('DELETE FROM audiobooks');

      console.log('Library database cleared successfully');
      res.json({
        success: true,
        message: 'Library database cleared. Audiobooks will be reimported on next scan.',
      });
    } catch (error) {
      console.error('Error clearing library:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Trigger immediate library scan (imports new files only)
  router.post('/scan-library', maintenanceWriteLimiter, authenticateToken, async (req, res) => {
    if (!req.user.is_admin) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const refreshMetadata = req.body.refreshMetadata === true;

    try {
      if (refreshMetadata) {
        console.log('Starting metadata refresh for all audiobooks in background...');

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

        setImmediate(async () => {
          try {
            const audiobooks = await dbAll('SELECT id, file_path, title, cover_path, cover_image FROM audiobooks');

            let updated = 0;
            let errors = 0;

            console.log(`Refreshing metadata for ${audiobooks.length} audiobooks...`);

            for (const audiobook of audiobooks) {
              try {
                if (!fs.existsSync(audiobook.file_path)) {
                  console.log(`File not found: ${audiobook.file_path}`);
                  errors++;
                  continue;
                }

                const metadata = await extractFileMetadata(audiobook.file_path);

                let finalCoverImage = metadata.cover_image;
                if (audiobook.cover_path && fs.existsSync(audiobook.cover_path)) {
                  finalCoverImage = audiobook.cover_path;
                  console.log(`Preserving user cover for ${audiobook.title}: ${audiobook.cover_path}`);
                } else if (metadata.cover_image) {
                  console.log(`Using extracted cover for ${audiobook.title}: ${metadata.cover_image}`);
                }

                await dbRun(
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
                  ]
                );

                updated++;
                if (updated % 10 === 0) {
                  console.log(`Metadata refresh progress: ${updated}/${audiobooks.length}`);
                }
              } catch (error) {
                console.error(`Error refreshing metadata for ${audiobook.file_path}:`, error.message);
                errors++;
              }
            }

            const scanStats = await scanLibrary();

            console.log(`Metadata refresh complete: ${updated} updated, ${errors} errors`);
            console.log(`New files scan: ${scanStats.imported} imported, ${scanStats.skipped} skipped`);
          } catch (error) {
            console.error('Error in background metadata refresh:', error);
          }
        });
      } else {
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
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Run database migrations
  router.post('/migrate', maintenanceWriteLimiter, authenticateToken, async (req, res) => {
    if (!req.user.is_admin) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    try {
      console.log('Running database migrations...');

      // __dirname is server/routes/maintenance, so migrations is ../../migrations
      const migrationsDir = path.join(__dirname, '../../migrations');

      await dbRun(
        `CREATE TABLE IF NOT EXISTS migrations (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          filename TEXT NOT NULL UNIQUE,
          applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`
      );

      const appliedRows = await dbAll('SELECT filename FROM migrations');
      const appliedMigrations = appliedRows.map(r => r.filename);

      const files = fs.readdirSync(migrationsDir)
        .filter(f => f.endsWith('.js'))
        .sort();

      const results = {
        applied: [],
        skipped: [],
        errors: [],
      };

      for (const file of files) {
        if (appliedMigrations.includes(file)) {
          results.skipped.push(file);
          continue;
        }

        try {
          console.log(`Applying migration: ${file}`);
          const migration = require(path.join(migrationsDir, file));

          await migration.up(db);

          await dbRun('INSERT INTO migrations (filename) VALUES (?)', [file]);

          results.applied.push(file);
          console.log(`Migration ${file} applied successfully`);
        } catch (error) {
          console.error(`Error applying migration ${file}:`, error);
          results.errors.push({ file, error: error.message });
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
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Force rescan - re-extract metadata for all audiobooks while preserving IDs
  router.post('/force-rescan', maintenanceWriteLimiter, authenticateToken, async (req, res) => {
    if (!req.user.is_admin) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    if (getForceRescanInProgress()) {
      return res.status(409).json({ error: 'Force rescan already in progress. Please wait.' });
    }

    if (isScanningLocked()) {
      return res.status(409).json({ error: 'Library scan in progress. Please wait and try again.' });
    }

    setForceRescanInProgress(true);
    lockScanning();

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

    setImmediate(async () => {
      try {
        console.log('Force rescan: marking all audiobooks as unavailable (preserving IDs)...');

        const countRow = await dbGet('SELECT COUNT(*) as count FROM audiobooks');
        console.log(`Found ${countRow.count} audiobooks to process`);

        // Mark all audiobooks as unavailable and delete chapters atomically
        await dbTransaction(async ({ dbRun: txRun }) => {
          await txRun('UPDATE audiobooks SET is_available = 0, original_path = file_path');
          await txRun('DELETE FROM audiobook_chapters');
        });

        console.log('All audiobooks marked as unavailable, chapters cleared (transaction committed)');
        console.log('Chapters cleared, rescanning library...');

        const stats = await scanLibrary();

        const restoredRow = await dbGet('SELECT COUNT(*) as count FROM audiobooks WHERE is_available = 1');
        const unavailableRow = await dbGet('SELECT COUNT(*) as count FROM audiobooks WHERE is_available = 0');

        // Refresh metadata for all restored books
        console.log('Refreshing metadata for all restored audiobooks...');
        const audiobooks = await dbAll('SELECT id, file_path, title, cover_path FROM audiobooks WHERE is_available = 1');

        let metadataUpdated = 0;
        let metadataErrors = 0;

        for (const audiobook of audiobooks) {
          try {
            if (!fs.existsSync(audiobook.file_path)) {
              continue;
            }

            const metadata = await extractFileMetadata(audiobook.file_path);

            let finalCoverImage = metadata.cover_image;
            if (audiobook.cover_path && fs.existsSync(audiobook.cover_path)) {
              finalCoverImage = audiobook.cover_path;
            }

            await dbRun(
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
              ]
            );

            metadataUpdated++;
            if (metadataUpdated % 25 === 0) {
              console.log(`Metadata refresh progress: ${metadataUpdated}/${audiobooks.length}`);
            }
          } catch (error) {
            console.error(`Error refreshing metadata for ${audiobook.file_path}:`, error.message);
            metadataErrors++;
          }
        }

        console.log('Force rescan complete (ID-preserving mode):');
        console.log(`   - ${restoredRow.count} audiobooks restored/added (IDs preserved)`);
        console.log(`   - ${unavailableRow.count} audiobooks still unavailable (files missing)`);
        console.log(`   - ${stats.imported} newly imported, ${stats.skipped} skipped, ${stats.errors} errors`);
        console.log(`   - ${metadataUpdated} metadata refreshed, ${metadataErrors} errors`);
        console.log('   - User progress, favorites, ratings, and covers preserved automatically');
      } catch (error) {
        console.error('Error in force rescan:', error);
      } finally {
        setForceRescanInProgress(false);
        unlockScanning();
      }
    });
  });
}

module.exports = { register };
