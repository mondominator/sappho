const _sqlite3 = require('sqlite3').verbose();

/**
 * Migration to add start_time column to audiobook_chapters table for m4b chapter support
 */
function up(db) {
  return new Promise((resolve, reject) => {
    db.run(`
      ALTER TABLE audiobook_chapters ADD COLUMN start_time REAL DEFAULT 0
    `, (err) => {
      if (err && !err.message.includes('duplicate column')) {
        reject(err);
      } else {
        console.log('Added start_time column to audiobook_chapters');
        resolve();
      }
    });
  });
}

function down(_db) {
  return new Promise((resolve, _reject) => {
    // SQLite doesn't support dropping columns easily, so we'd need to recreate the table
    // For now, just resolve
    resolve();
  });
}

module.exports = { up, down };
