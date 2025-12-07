// Migration: Add user ratings and reviews table

module.exports = {
  up: (db) => {
    return new Promise((resolve, reject) => {
      db.run(`
        CREATE TABLE IF NOT EXISTS user_ratings (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL,
          audiobook_id INTEGER NOT NULL,
          rating INTEGER CHECK(rating >= 1 AND rating <= 5),
          review TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
          FOREIGN KEY (audiobook_id) REFERENCES audiobooks(id) ON DELETE CASCADE,
          UNIQUE(user_id, audiobook_id)
        )
      `, (err) => {
        if (err) {
          return reject(err);
        }

        // Create indexes for performance
        db.run('CREATE INDEX IF NOT EXISTS idx_ratings_user ON user_ratings(user_id)', (err) => {
          if (err) console.warn('Index creation warning:', err.message);
        });

        db.run('CREATE INDEX IF NOT EXISTS idx_ratings_audiobook ON user_ratings(audiobook_id)', (err) => {
          if (err) console.warn('Index creation warning:', err.message);
        });

        db.run('CREATE INDEX IF NOT EXISTS idx_ratings_rating ON user_ratings(rating)', (err) => {
          if (err) console.warn('Index creation warning:', err.message);
          resolve();
        });
      });
    });
  },

  down: (db) => {
    return new Promise((resolve, reject) => {
      db.run('DROP TABLE IF EXISTS user_ratings', (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }
};
