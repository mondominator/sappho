const express = require('express');
const router = express.Router();
const db = require('../database');
const path = require('path');
const fs = require('fs');
const { authenticateToken } = require('../auth');
const { extractFileMetadata } = require('../services/fileProcessor');

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

module.exports = router;
