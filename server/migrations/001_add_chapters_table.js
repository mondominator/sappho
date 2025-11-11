const sqlite3 = require('sqlite3').verbose();
const path = require('path');

/**
 * Migration to add chapters table for multi-file audiobooks
 */
function up(db) {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      // Create chapters table
      db.run(`
        CREATE TABLE IF NOT EXISTS audiobook_chapters (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          audiobook_id INTEGER NOT NULL,
          chapter_number INTEGER NOT NULL,
          file_path TEXT NOT NULL,
          duration INTEGER,
          file_size INTEGER,
          title TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (audiobook_id) REFERENCES audiobooks(id) ON DELETE CASCADE,
          UNIQUE(audiobook_id, chapter_number)
        )
      `, (err) => {
        if (err) {
          reject(err);
        } else {
          console.log('Created audiobook_chapters table');

          // Add is_multi_file flag to audiobooks table
          db.run(`
            ALTER TABLE audiobooks ADD COLUMN is_multi_file INTEGER DEFAULT 0
          `, (err) => {
            if (err && !err.message.includes('duplicate column')) {
              reject(err);
            } else {
              console.log('Added is_multi_file column to audiobooks');
              resolve();
            }
          });
        }
      });
    });
  });
}

function down(db) {
  return new Promise((resolve, reject) => {
    db.run('DROP TABLE IF EXISTS audiobook_chapters', (err) => {
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    });
  });
}

module.exports = { up, down };
