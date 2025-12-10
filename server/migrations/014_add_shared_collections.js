// Migration: Add is_public field and creator info to collections

module.exports = {
  up: (db) => {
    return new Promise((resolve) => {
      db.serialize(() => {
        // Add is_public column (default false for private)
        db.run(`
          ALTER TABLE user_collections ADD COLUMN is_public INTEGER DEFAULT 0
        `, (err) => {
          if (err && !err.message.includes('duplicate column')) {
            console.error('Error adding is_public column:', err.message);
          } else {
            console.log('Added is_public column to user_collections');
          }
        });

        // Create index for efficient filtering of public collections
        db.run(`
          CREATE INDEX IF NOT EXISTS idx_collections_public ON user_collections(is_public)
        `, (err) => {
          if (err) console.warn('Index creation warning:', err.message);
          else console.log('Created index on is_public');
          resolve();
        });
      });
    });
  },

  down: (db) => {
    return new Promise((resolve) => {
      // SQLite doesn't support DROP COLUMN easily, so we'll just leave the column
      // In production, you'd recreate the table without the column
      db.run('DROP INDEX IF EXISTS idx_collections_public', (err) => {
        if (err) console.warn('Drop index warning:', err.message);
        resolve();
      });
    });
  }
};
