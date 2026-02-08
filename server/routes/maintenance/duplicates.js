/**
 * Duplicate Detection & Merge Routes
 * Find duplicate audiobooks and merge them.
 */
const fs = require('fs');
const path = require('path');
const { maintenanceLimiter, maintenanceWriteLimiter } = require('./helpers');

function register(router, { db, authenticateToken }) {
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
}

module.exports = { register };
