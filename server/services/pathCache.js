/**
 * Path Cache Service
 *
 * In-memory caches for scan-time lookups. Populated at scan start,
 * cleared after scan completes. Provides O(1) lookup for file existence
 * and directory-level dedup instead of per-file database queries.
 */

const path = require('path');
const db = require('../database');

// In-memory caches for scan-time lookups (populated at scan start, cleared after)
let knownFilePaths = null;  // Set of all file_path values in audiobooks table
let knownDirectories = null;  // Map of directory -> { id, file_path } for directory-level dedup

/**
 * Load all existing audiobook paths into memory for fast O(1) lookup during scan.
 * Call this once at the start of a scan instead of querying per-file.
 */
function loadPathCache() {
  return new Promise((resolve, reject) => {
    db.all('SELECT id, file_path FROM audiobooks', [], (err, rows) => {
      if (err) return reject(err);

      knownFilePaths = new Set();
      knownDirectories = new Map();

      for (const row of (rows || [])) {
        knownFilePaths.add(row.file_path);
        const dir = path.dirname(row.file_path);
        if (!knownDirectories.has(dir)) {
          knownDirectories.set(dir, { id: row.id, file_path: row.file_path });
        }
      }

      console.log(`Path cache loaded: ${knownFilePaths.size} files in ${knownDirectories.size} directories`);
      resolve();
    });
  });
}

/**
 * Clear the in-memory path cache (call after scan completes)
 */
function clearPathCache() {
  knownFilePaths = null;
  knownDirectories = null;
}

/**
 * Check if a file already exists in the database (uses cache if available)
 */
function fileExistsInDatabase(filePath) {
  if (knownFilePaths) {
    return Promise.resolve(knownFilePaths.has(filePath));
  }
  return new Promise((resolve, reject) => {
    db.get('SELECT id FROM audiobooks WHERE file_path = ?', [filePath], (err, row) => {
      if (err) reject(err);
      else resolve(!!row);
    });
  });
}

/**
 * Check if another audiobook already exists in the same directory (uses cache if available)
 */
function audiobookExistsInDirectory(filePath) {
  const dir = path.dirname(filePath);
  if (knownDirectories) {
    return Promise.resolve(knownDirectories.get(dir) || null);
  }
  return new Promise((resolve, reject) => {
    db.get('SELECT id, file_path FROM audiobooks WHERE file_path LIKE ?', [`${dir}/%`], (err, row) => {
      if (err) reject(err);
      else resolve(row || null);
    });
  });
}

/**
 * Check if an audiobook with the given content hash already exists
 */
function audiobookExistsByHash(contentHash) {
  return new Promise((resolve, reject) => {
    db.get('SELECT id, file_path, title FROM audiobooks WHERE content_hash = ?', [contentHash], (err, row) => {
      if (err) {
        reject(err);
      } else {
        resolve(row || null);
      }
    });
  });
}

module.exports = {
  loadPathCache,
  clearPathCache,
  fileExistsInDatabase,
  audiobookExistsInDirectory,
  audiobookExistsByHash
};
