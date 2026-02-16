/**
 * Library Query Utilities
 *
 * Database operations for audiobook availability tracking:
 * finding, marking, and restoring audiobooks.
 */

const fs = require('fs');
const db = require('../database');
const websocketManager = require('../services/websocketManager');

/**
 * Check if an unavailable audiobook with the given content hash exists
 * Used for restoring books that were previously removed
 */
function findUnavailableByHash(contentHash) {
  return new Promise((resolve, reject) => {
    db.get(
      'SELECT * FROM audiobooks WHERE content_hash = ? AND is_available = 0',
      [contentHash],
      (err, row) => {
        if (err) reject(err);
        else resolve(row || null);
      }
    );
  });
}

/**
 * Mark an audiobook as available (file exists)
 */
function markAvailable(audiobookId, filePath = null) {
  return new Promise((resolve, reject) => {
    const updates = filePath
      ? 'is_available = 1, last_seen_at = CURRENT_TIMESTAMP, file_path = ?'
      : 'is_available = 1, last_seen_at = CURRENT_TIMESTAMP';
    const params = filePath ? [filePath, audiobookId] : [audiobookId];

    db.run(
      `UPDATE audiobooks SET ${updates} WHERE id = ?`,
      params,
      (err) => {
        if (err) reject(err);
        else {
          console.log(`Marked audiobook ${audiobookId} as available`);
          resolve();
        }
      }
    );
  });
}

/**
 * Mark an audiobook as unavailable (file missing)
 * Preserves all user data (progress, ratings, collections)
 */
function markUnavailable(audiobookId) {
  return new Promise((resolve, reject) => {
    db.run(
      'UPDATE audiobooks SET is_available = 0, original_path = file_path WHERE id = ?',
      [audiobookId],
      (err) => {
        if (err) reject(err);
        else {
          console.log(`Marked audiobook ${audiobookId} as unavailable (file missing)`);
          // Broadcast to connected clients
          websocketManager.broadcastLibraryUpdate('library.unavailable', { id: audiobookId });
          resolve();
        }
      }
    );
  });
}

/**
 * Update last_seen_at timestamp for an audiobook
 */
function updateLastSeen(audiobookId) {
  return new Promise((resolve, reject) => {
    db.run(
      'UPDATE audiobooks SET last_seen_at = CURRENT_TIMESTAMP WHERE id = ?',
      [audiobookId],
      (err) => {
        if (err) reject(err);
        else resolve();
      }
    );
  });
}

/**
 * Get all audiobooks from the database
 */
function getAllAudiobooks() {
  return new Promise((resolve, reject) => {
    db.all('SELECT * FROM audiobooks', [], (err, rows) => {
      if (err) reject(err);
      else resolve(rows || []);
    });
  });
}

/**
 * Check file availability for all audiobooks and update status
 */
async function checkAvailability() {
  console.log('Checking file availability...');
  const audiobooks = await getAllAudiobooks();
  let restored = 0;
  let missing = 0;

  for (const book of audiobooks) {
    const fileExists = fs.existsSync(book.file_path);

    // For multi-file books, check if at least one chapter exists
    let hasChapters = false;
    if (book.is_multi_file && !fileExists) {
      const chapters = await new Promise((resolve, reject) => {
        db.all(
          'SELECT file_path FROM audiobook_chapters WHERE audiobook_id = ?',
          [book.id],
          (err, rows) => {
            if (err) reject(err);
            else resolve(rows || []);
          }
        );
      });
      hasChapters = chapters.some(ch => fs.existsSync(ch.file_path));
    }

    const isAvailable = fileExists || hasChapters;
    const wasAvailable = book.is_available !== 0;

    if (isAvailable && !wasAvailable) {
      // Book returned - restore availability
      await markAvailable(book.id);
      restored++;
    } else if (!isAvailable && wasAvailable) {
      // Book missing - mark unavailable (keep all user data)
      await markUnavailable(book.id);
      missing++;
    } else if (isAvailable) {
      // Update last_seen timestamp
      await updateLastSeen(book.id);
    }
  }

  if (restored > 0 || missing > 0) {
    console.log(`Availability check: ${restored} restored, ${missing} marked unavailable`);
  }

  return { restored, missing };
}

/**
 * Restore an unavailable audiobook with a new file path
 */
async function restoreAudiobook(existingBook, newFilePath, _metadata) {
  console.log(`Restoring previously unavailable book: ${existingBook.title}`);

  // Update the existing record with new file path and mark as available
  return new Promise((resolve, reject) => {
    db.run(
      `UPDATE audiobooks
       SET file_path = ?, is_available = 1, last_seen_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [newFilePath, existingBook.id],
      function(err) {
        if (err) {
          reject(err);
        } else {
          db.get('SELECT * FROM audiobooks WHERE id = ?', [existingBook.id], (err, audiobook) => {
            if (err) {
              reject(err);
            } else {
              console.log(`Restored: ${existingBook.title} - user data preserved`);
              websocketManager.broadcastLibraryUpdate('library.restored', audiobook);
              resolve(audiobook);
            }
          });
        }
      }
    );
  });
}

module.exports = {
  findUnavailableByHash,
  markAvailable,
  markUnavailable,
  updateLastSeen,
  getAllAudiobooks,
  checkAvailability,
  restoreAudiobook
};
