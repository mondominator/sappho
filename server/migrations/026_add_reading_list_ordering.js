// Migration: Add priority and list_order columns to user_favorites for reading list ordering

module.exports = {
  up: (db) => {
    return new Promise((resolve, reject) => {
      db.serialize(() => {
        // Add priority column: 0=None, 1=High, 2=Medium, 3=Low
        db.run(
          'ALTER TABLE user_favorites ADD COLUMN priority INTEGER DEFAULT 0',
          (err) => {
            if (err && !err.message.includes('duplicate column')) {
              return reject(err);
            }
          }
        );

        // Add list_order column for manual drag-and-drop reordering
        db.run(
          'ALTER TABLE user_favorites ADD COLUMN list_order INTEGER DEFAULT 0',
          (err) => {
            if (err && !err.message.includes('duplicate column')) {
              return reject(err);
            }
          }
        );

        // Backfill list_order from existing created_at order so current users keep their implicit ordering
        db.run(
          `UPDATE user_favorites SET list_order = (
            SELECT COUNT(*) FROM user_favorites f2
            WHERE f2.user_id = user_favorites.user_id AND f2.created_at <= user_favorites.created_at
          ) - 1`,
          (err) => {
            if (err) return reject(err);
            console.log('Added priority and list_order columns to user_favorites');
            resolve();
          }
        );
      });
    });
  },

  down: (db) => {
    return new Promise((resolve, reject) => {
      // SQLite doesn't support DROP COLUMN before 3.35.0, so recreate the table
      db.serialize(() => {
        db.run(`CREATE TABLE user_favorites_backup AS
          SELECT id, user_id, audiobook_id, created_at FROM user_favorites`);
        db.run('DROP TABLE user_favorites');
        db.run(`CREATE TABLE user_favorites (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL,
          audiobook_id INTEGER NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
          FOREIGN KEY (audiobook_id) REFERENCES audiobooks(id) ON DELETE CASCADE,
          UNIQUE(user_id, audiobook_id)
        )`);
        db.run(
          'INSERT INTO user_favorites (id, user_id, audiobook_id, created_at) SELECT id, user_id, audiobook_id, created_at FROM user_favorites_backup',
          (err) => {
            if (err) return reject(err);
          }
        );
        db.run('DROP TABLE user_favorites_backup', (err) => {
          if (err) return reject(err);
          resolve();
        });
      });
    });
  }
};
