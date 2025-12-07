// Migration: Add user_collections and collection_items tables

module.exports = {
  up: (db) => {
    return new Promise((resolve, reject) => {
      db.serialize(() => {
        // Create collections table
        db.run(`
          CREATE TABLE IF NOT EXISTS user_collections (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            description TEXT,
            cover_image TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
          )
        `, (err) => {
          if (err) {
            reject(err);
            return;
          }
          console.log('Created user_collections table');
        });

        // Create collection items table
        db.run(`
          CREATE TABLE IF NOT EXISTS collection_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            collection_id INTEGER NOT NULL,
            audiobook_id INTEGER NOT NULL,
            position INTEGER NOT NULL DEFAULT 0,
            added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (collection_id) REFERENCES user_collections(id) ON DELETE CASCADE,
            FOREIGN KEY (audiobook_id) REFERENCES audiobooks(id) ON DELETE CASCADE,
            UNIQUE(collection_id, audiobook_id)
          )
        `, (err) => {
          if (err) {
            reject(err);
            return;
          }
          console.log('Created collection_items table');
        });

        // Create indexes for performance
        db.run('CREATE INDEX IF NOT EXISTS idx_collections_user ON user_collections(user_id)', (err) => {
          if (err) console.warn('Index creation warning:', err.message);
        });

        db.run('CREATE INDEX IF NOT EXISTS idx_collection_items_collection ON collection_items(collection_id)', (err) => {
          if (err) console.warn('Index creation warning:', err.message);
          resolve();
        });
      });
    });
  },

  down: (db) => {
    return new Promise((resolve, reject) => {
      db.serialize(() => {
        db.run('DROP TABLE IF EXISTS collection_items', (err) => {
          if (err) console.warn('Drop warning:', err.message);
        });
        db.run('DROP TABLE IF EXISTS user_collections', (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    });
  }
};
