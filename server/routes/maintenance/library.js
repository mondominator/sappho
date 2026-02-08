/**
 * Library Operation Routes
 * Consolidate multi-file books, clear library, scan, migrate, force rescan.
 */
const fs = require('fs');
const path = require('path');
const { maintenanceWriteLimiter, getForceRescanInProgress, setForceRescanInProgress } = require('./helpers');

function register(router, { db, authenticateToken, extractFileMetadata, scanLibrary, lockScanning, unlockScanning, isScanningLocked }) {
  // Consolidate multi-file audiobooks
  router.post('/consolidate-multifile', maintenanceWriteLimiter, authenticateToken, async (req, res) => {
    if (!req.user.is_admin) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    try {
      console.log('Starting multi-file audiobook consolidation...');

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

          // Use directory name as title if primary book title looks like a chapter
          let title = primaryBook.title;
          if (title && /chapter|part|\d+/i.test(title)) {
            title = dirName;
          }

          console.log(`Consolidating ${sortedBooks.length} files into: ${title}`);

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

          for (let i = 0; i < sortedBooks.length; i++) {
            const book = sortedBooks[i];
            await new Promise((resolve, reject) => {
              db.run(
                `INSERT OR IGNORE INTO audiobook_chapters
                 (audiobook_id, chapter_number, file_path, duration, file_size, title)
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [primaryBook.id, i + 1, book.file_path, book.duration, book.file_size, book.title],
                (err) => {
                  if (err) reject(err);
                  else resolve();
                }
              );
            });
          }

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
    if (!req.user.is_admin) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    try {
      console.log('Clearing library database...');

      await new Promise((resolve, reject) => {
        db.run('DELETE FROM audiobook_chapters', (err) => {
          if (err) reject(err);
          else resolve();
        });
      });

      await new Promise((resolve, reject) => {
        db.run('DELETE FROM playback_progress', (err) => {
          if (err) reject(err);
          else resolve();
        });
      });

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
                if (!fs.existsSync(audiobook.file_path)) {
                  console.log(`File not found: ${audiobook.file_path}`);
                  errors++;
                  continue;
                }

                const metadata = await extractFileMetadata(audiobook.file_path);

                // Preserve user-downloaded covers
                let finalCoverImage = metadata.cover_image;
                if (audiobook.cover_path && fs.existsSync(audiobook.cover_path)) {
                  finalCoverImage = audiobook.cover_path;
                  console.log(`Preserving user cover for ${audiobook.title}: ${audiobook.cover_path}`);
                } else if (metadata.cover_image) {
                  console.log(`Using extracted cover for ${audiobook.title}: ${metadata.cover_image}`);
                }

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
      res.status(500).json({ error: error.message });
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

      const appliedMigrations = await new Promise((resolve, reject) => {
        db.all('SELECT filename FROM migrations', (err, rows) => {
          if (err) reject(err);
          else resolve(rows.map(r => r.filename));
        });
      });

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

        const beforeCount = await new Promise((resolve, reject) => {
          db.get('SELECT COUNT(*) as count FROM audiobooks', (err, row) => {
            if (err) reject(err);
            else resolve(row.count);
          });
        });

        console.log(`Found ${beforeCount} audiobooks to process`);

        // Mark all audiobooks as unavailable and delete chapters atomically
        await new Promise((resolve, reject) => {
          db.run('BEGIN TRANSACTION', (beginErr) => {
            if (beginErr) return reject(beginErr);

            db.run(
              'UPDATE audiobooks SET is_available = 0, original_path = file_path',
              (updateErr) => {
                if (updateErr) {
                  return db.run('ROLLBACK', () => reject(updateErr));
                }

                db.run('DELETE FROM audiobook_chapters', (deleteErr) => {
                  if (deleteErr) {
                    return db.run('ROLLBACK', () => reject(deleteErr));
                  }

                  db.run('COMMIT', (commitErr) => {
                    if (commitErr) {
                      return db.run('ROLLBACK', () => reject(commitErr));
                    }
                    resolve();
                  });
                });
              }
            );
          });
        });

        console.log('All audiobooks marked as unavailable, chapters cleared (transaction committed)');
        console.log('Chapters cleared, rescanning library...');

        const stats = await scanLibrary();

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

        // Refresh metadata for all restored books
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

            const metadata = await extractFileMetadata(audiobook.file_path);

            let finalCoverImage = metadata.cover_image;
            if (audiobook.cover_path && fs.existsSync(audiobook.cover_path)) {
              finalCoverImage = audiobook.cover_path;
            }

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
        console.log(`   - ${restoredCount} audiobooks restored/added (IDs preserved)`);
        console.log(`   - ${stillUnavailable} audiobooks still unavailable (files missing)`);
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
