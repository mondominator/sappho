// Migration: Add user_favorites table for starred/favorited audiobooks

module.exports = {
  up: (db) => {
    return new Promise((resolve, reject) => {
      db.run(`
        CREATE TABLE IF NOT EXISTS user_favorites (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL,
          audiobook_id INTEGER NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
          FOREIGN KEY (audiobook_id) REFERENCES audiobooks(id) ON DELETE CASCADE,
          UNIQUE(user_id, audiobook_id)
        )
      `, (err) => {
        if (err) reject(err);
        else {
          console.log('Created user_favorites table');
          resolve();
        }
      });
    });
  },

  down: (db) => {
    return new Promise((resolve, reject) => {
      db.run('DROP TABLE IF EXISTS user_favorites', (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }
};
