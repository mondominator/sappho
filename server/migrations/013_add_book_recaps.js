// Migration: Add book_recaps table for caching AI-generated book summaries

module.exports = {
  up: (db) => {
    return new Promise((resolve, reject) => {
      db.run(`
        CREATE TABLE IF NOT EXISTS book_recaps (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL,
          audiobook_id INTEGER NOT NULL,
          books_hash TEXT NOT NULL,
          recap_text TEXT NOT NULL,
          model_used TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
          FOREIGN KEY (audiobook_id) REFERENCES audiobooks(id) ON DELETE CASCADE,
          UNIQUE(user_id, audiobook_id, books_hash)
        )
      `, (err) => {
        if (err) reject(err);
        else {
          console.log('Created book_recaps table');
          resolve();
        }
      });
    });
  },

  down: (db) => {
    return new Promise((resolve, reject) => {
      db.run('DROP TABLE IF EXISTS book_recaps', (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }
};
