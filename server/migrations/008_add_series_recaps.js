// Migration: Add series_recaps table for caching AI-generated series summaries

module.exports = {
  up: (db) => {
    return new Promise((resolve, reject) => {
      db.run(`
        CREATE TABLE IF NOT EXISTS series_recaps (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL,
          series_name TEXT NOT NULL,
          books_hash TEXT NOT NULL,
          recap_text TEXT NOT NULL,
          model_used TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users(id),
          UNIQUE(user_id, series_name, books_hash)
        )
      `, (err) => {
        if (err) reject(err);
        else {
          console.log('Created series_recaps table');
          resolve();
        }
      });
    });
  },

  down: (db) => {
    return new Promise((resolve, reject) => {
      db.run('DROP TABLE IF EXISTS series_recaps', (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }
};
