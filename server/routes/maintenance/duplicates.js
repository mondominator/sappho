/**
 * Duplicate Detection & Merge Routes
 * Find duplicate audiobooks and merge them.
 */
const fs = require('fs');
const path = require('path');
const { maintenanceLimiter, maintenanceWriteLimiter } = require('./helpers');
const { createDbHelpers } = require('../../utils/db');
const { createQueryHelpers } = require('../../utils/queryHelpers');
const { levenshteinSimilarity, normalizeTitle } = require('../../utils/stringSimilarity');

function register(router, { db, authenticateToken, requireAdmin }) {
  const { dbGet, dbAll, dbRun } = createDbHelpers(db);
  const { getAudiobookById } = createQueryHelpers(db);

  // Detect duplicate audiobooks
  router.get('/duplicates', maintenanceLimiter, authenticateToken, requireAdmin, async (req, res) => {
    try {
      console.log('Scanning for duplicate audiobooks...');

      // Build progress map
      const progressData = await dbAll(
        `SELECT audiobook_id, COUNT(*) as user_count, MAX(position) as max_position
         FROM playback_progress
         GROUP BY audiobook_id`
      );

      const progressMap = new Map();
      for (const p of progressData) {
        progressMap.set(p.audiobook_id, { userCount: p.user_count, maxPosition: p.max_position });
      }

      // Track which book IDs are already assigned to a duplicate group
      const matched = new Set();
      // Map from group key to array of book rows
      const groupMap = new Map();

      // --- 1. Find duplicates by ISBN ---
      const isbnDups = await dbAll(
        `SELECT id, title, author, narrator, duration, file_size, file_path,
                isbn, asin, series, series_position, cover_image, cover_path,
                created_at
         FROM audiobooks
         WHERE isbn IS NOT NULL AND TRIM(isbn) != ''
           AND isbn IN (
             SELECT isbn FROM audiobooks
             WHERE isbn IS NOT NULL AND TRIM(isbn) != ''
             GROUP BY isbn
             HAVING COUNT(*) > 1
           )
         ORDER BY isbn, title, author`
      );

      // Group ISBN duplicates
      const isbnGroups = new Map();
      for (const book of isbnDups) {
        const key = book.isbn;
        if (!isbnGroups.has(key)) isbnGroups.set(key, []);
        isbnGroups.get(key).push(book);
      }
      for (const [key, books] of isbnGroups) {
        if (books.length > 1) {
          const groupKey = `isbn:${key}`;
          groupMap.set(groupKey, { reason: 'Same ISBN', score: 90, books });
          for (const b of books) matched.add(b.id);
        }
      }

      // --- 2. Find duplicates by ASIN ---
      const asinDups = await dbAll(
        `SELECT id, title, author, narrator, duration, file_size, file_path,
                isbn, asin, series, series_position, cover_image, cover_path,
                created_at
         FROM audiobooks
         WHERE asin IS NOT NULL AND TRIM(asin) != ''
           AND id NOT IN (${matched.size > 0 ? [...matched].map(() => '?').join(',') : '0'})
           AND asin IN (
             SELECT asin FROM audiobooks
             WHERE asin IS NOT NULL AND TRIM(asin) != ''
               AND id NOT IN (${matched.size > 0 ? [...matched].map(() => '?').join(',') : '0'})
             GROUP BY asin
             HAVING COUNT(*) > 1
           )
         ORDER BY asin, title, author`,
        [...matched, ...matched]
      );

      const asinGroups = new Map();
      for (const book of asinDups) {
        const key = book.asin;
        if (!asinGroups.has(key)) asinGroups.set(key, []);
        asinGroups.get(key).push(book);
      }
      for (const [key, books] of asinGroups) {
        if (books.length > 1) {
          const groupKey = `asin:${key}`;
          groupMap.set(groupKey, { reason: 'Same ASIN', score: 90, books });
          for (const b of books) matched.add(b.id);
        }
      }

      // --- 3. Find duplicates by title + author ---
      const titleAuthorDups = await dbAll(
        `SELECT id, title, author, narrator, duration, file_size, file_path,
                isbn, asin, series, series_position, cover_image, cover_path,
                created_at
         FROM audiobooks
         WHERE title IS NOT NULL AND TRIM(title) != ''
           AND author IS NOT NULL AND TRIM(author) != ''
           AND id NOT IN (${matched.size > 0 ? [...matched].map(() => '?').join(',') : '0'})
           AND (LOWER(TRIM(title)) || '|||' || LOWER(TRIM(author))) IN (
             SELECT LOWER(TRIM(title)) || '|||' || LOWER(TRIM(author))
             FROM audiobooks
             WHERE title IS NOT NULL AND TRIM(title) != ''
               AND author IS NOT NULL AND TRIM(author) != ''
               AND id NOT IN (${matched.size > 0 ? [...matched].map(() => '?').join(',') : '0'})
             GROUP BY LOWER(TRIM(title)), LOWER(TRIM(author))
             HAVING COUNT(*) > 1
           )
         ORDER BY LOWER(TRIM(title)), LOWER(TRIM(author))`,
        [...matched, ...matched]
      );

      const titleAuthorGroups = new Map();
      for (const book of titleAuthorDups) {
        const key = `${book.title.toLowerCase().trim()}|||${book.author.toLowerCase().trim()}`;
        if (!titleAuthorGroups.has(key)) titleAuthorGroups.set(key, []);
        titleAuthorGroups.get(key).push(book);
      }
      for (const [key, books] of titleAuthorGroups) {
        if (books.length > 1) {
          const groupKey = `titleauthor:${key}`;
          groupMap.set(groupKey, { reason: 'Same title and author', score: 80, books });
          for (const b of books) matched.add(b.id);
        }
      }

      // --- 4. Fuzzy title similarity + duration/size match on remaining unmatched books ---
      const remainingBooks = await dbAll(
        `SELECT id, title, author, narrator, duration, file_size, file_path,
                isbn, asin, series, series_position, cover_image, cover_path,
                created_at
         FROM audiobooks
         WHERE duration IS NOT NULL AND duration > 0
           AND file_size IS NOT NULL AND file_size > 0
           AND title IS NOT NULL AND TRIM(title) != ''
           AND id NOT IN (${matched.size > 0 ? [...matched].map(() => '?').join(',') : '0'})
         ORDER BY title, author`,
        [...matched]
      );

      // Group by normalized title for O(n) bucketing, then pairwise Levenshtein between buckets
      const normalizedGroups = new Map();
      for (const book of remainingBooks) {
        const norm = normalizeTitle(book.title);
        if (!norm) continue;
        if (!normalizedGroups.has(norm)) normalizedGroups.set(norm, []);
        normalizedGroups.get(norm).push(book);
      }

      // Collect all normalized keys and do pairwise Levenshtein between keys
      const normKeys = [...normalizedGroups.keys()];
      const titleBuckets = new Map();

      for (const key of normKeys) {
        let assigned = false;
        for (const [bucketKey, bucketBooks] of titleBuckets) {
          if (levenshteinSimilarity(key, bucketKey) >= 0.85) {
            bucketBooks.push(...normalizedGroups.get(key));
            assigned = true;
            break;
          }
        }
        if (!assigned) {
          titleBuckets.set(key, [...normalizedGroups.get(key)]);
        }
      }

      // Within each bucket, do pairwise duration/size comparison
      for (const [, bucketBooks] of titleBuckets) {
        if (bucketBooks.length < 2) continue;

        const fuzzyProcessed = new Set();
        for (let i = 0; i < bucketBooks.length; i++) {
          if (fuzzyProcessed.has(bucketBooks[i].id)) continue;
          const book = bucketBooks[i];
          const fuzzyMatches = [book];

          for (let j = i + 1; j < bucketBooks.length; j++) {
            if (fuzzyProcessed.has(bucketBooks[j].id)) continue;
            const candidate = bucketBooks[j];

            const durationDiff = Math.abs(book.duration - candidate.duration) / Math.max(book.duration, candidate.duration);
            const sizeDiff = Math.abs(book.file_size - candidate.file_size) / Math.max(book.file_size, candidate.file_size);

            if (durationDiff < 0.02 && sizeDiff < 0.15) {
              fuzzyMatches.push(candidate);
              fuzzyProcessed.add(candidate.id);
            }
          }

          if (fuzzyMatches.length > 1) {
            const titleSim = levenshteinSimilarity(
              normalizeTitle(fuzzyMatches[0].title),
              normalizeTitle(fuzzyMatches[1].title)
            );
            const score = Math.max(50, Math.min(70, Math.round(50 + (titleSim - 0.85) * 133)));

            const groupKey = `fuzzy:${book.id}`;
            groupMap.set(groupKey, { reason: 'Similar title, duration and file size', score, books: fuzzyMatches });
            for (const b of fuzzyMatches) matched.add(b.id);
            fuzzyProcessed.add(book.id);
          }
        }
      }

      // --- Build response ---
      const duplicateGroups = [];
      let groupIndex = 1;

      for (const [, group] of groupMap) {
        const matchesWithProgress = group.books.map(m => ({
          ...m,
          progress: progressMap.get(m.id) || { userCount: 0, maxPosition: 0 },
          hasCover: !!(m.cover_image || m.cover_path),
          hasUserCover: !!m.cover_path,
        }));

        matchesWithProgress.sort((a, b) => {
          if (a.hasUserCover !== b.hasUserCover) return b.hasUserCover - a.hasUserCover;
          if (a.progress.userCount !== b.progress.userCount) return b.progress.userCount - a.progress.userCount;
          if (a.file_size !== b.file_size) return (b.file_size || 0) - (a.file_size || 0);
          return new Date(a.created_at) - new Date(b.created_at);
        });

        duplicateGroups.push({
          id: `group-${groupIndex++}`,
          matchReason: group.reason,
          score: group.score,
          books: matchesWithProgress,
          suggestedKeep: matchesWithProgress[0].id,
        });
      }

      console.log(`Found ${duplicateGroups.length} duplicate groups`);

      res.json({
        duplicateGroups,
        totalDuplicates: duplicateGroups.reduce((sum, g) => sum + g.books.length - 1, 0),
      });
    } catch (error) {
      console.error('Error detecting duplicates:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Merge duplicate audiobooks
  router.post('/duplicates/merge', maintenanceWriteLimiter, authenticateToken, requireAdmin, async (req, res) => {
    const { keepId, deleteIds, deleteFiles } = req.body;

    if (!keepId || !Array.isArray(deleteIds) || deleteIds.length === 0) {
      return res.status(400).json({ error: 'Must specify keepId and deleteIds array' });
    }

    if (deleteIds.includes(keepId)) {
      return res.status(400).json({ error: 'Cannot delete the audiobook being kept' });
    }

    try {
      console.log(`Merging duplicates: keeping ${keepId}, deleting ${deleteIds.join(', ')}`);

      const keepBook = await getAudiobookById(keepId);
      if (!keepBook) {
        return res.status(404).json({ error: 'Audiobook to keep not found' });
      }

      const deleteBooks = await dbAll(
        `SELECT * FROM audiobooks WHERE id IN (${deleteIds.map(() => '?').join(',')})`,
        deleteIds
      );

      if (deleteBooks.length === 0) {
        return res.status(404).json({ error: 'No audiobooks to delete found' });
      }

      // Transfer playback progress from deleted books to kept book
      let progressTransferred = 0;
      for (const deleteBook of deleteBooks) {
        const progressRecords = await dbAll(
          'SELECT * FROM playback_progress WHERE audiobook_id = ?',
          [deleteBook.id]
        );

        for (const progress of progressRecords) {
          const existingProgress = await dbGet(
            'SELECT * FROM playback_progress WHERE user_id = ? AND audiobook_id = ?',
            [progress.user_id, keepId]
          );

          if (existingProgress) {
            if (progress.position > existingProgress.position) {
              await dbRun(
                'UPDATE playback_progress SET position = ?, completed = ?, updated_at = ? WHERE user_id = ? AND audiobook_id = ?',
                [progress.position, progress.completed, progress.updated_at, progress.user_id, keepId]
              );
              progressTransferred++;
            }
          } else {
            await dbRun(
              'INSERT INTO playback_progress (user_id, audiobook_id, position, completed, updated_at) VALUES (?, ?, ?, ?, ?)',
              [progress.user_id, keepId, progress.position, progress.completed, progress.updated_at]
            );
            progressTransferred++;
          }
        }
      }

      // Delete progress, chapters, and audiobook records for deleted books
      const placeholders = deleteIds.map(() => '?').join(',');
      await dbRun(`DELETE FROM playback_progress WHERE audiobook_id IN (${placeholders})`, deleteIds);
      await dbRun(`DELETE FROM audiobook_chapters WHERE audiobook_id IN (${placeholders})`, deleteIds);
      await dbRun(`DELETE FROM collection_items WHERE audiobook_id IN (${placeholders})`, deleteIds);
      await dbRun(`DELETE FROM audiobooks WHERE id IN (${placeholders})`, deleteIds);

      // Optionally delete the actual files
      let filesDeleted = 0;
      if (deleteFiles) {
        for (const deleteBook of deleteBooks) {
          try {
            if (deleteBook.file_path && fs.existsSync(deleteBook.file_path)) {
              const dir = path.dirname(deleteBook.file_path);
              const files = fs.readdirSync(dir);
              const audioFiles = files.filter(f => /\.(m4b|m4a|mp3|flac|ogg)$/i.test(f));

              if (audioFiles.length === 1) {
                fs.rmSync(dir, { recursive: true, force: true });
                console.log(`Deleted directory: ${dir}`);
              } else {
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

      console.log(`Merge complete: ${deleteBooks.length} duplicates removed, ${progressTransferred} progress records transferred`);

      res.json({
        success: true,
        kept: keepId,
        deleted: deleteIds,
        progressTransferred,
        filesDeleted,
      });
    } catch (error) {
      console.error('Error merging duplicates:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });
}

module.exports = { register };
