/**
 * Migration: Add activity feed tables
 *
 * Creates tables for tracking user activity and privacy settings
 */

function up(db) {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      // Activity events table - stores all user activities
      db.run(`
        CREATE TABLE IF NOT EXISTS activity_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL,
          event_type TEXT NOT NULL,
          audiobook_id INTEGER,
          metadata TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
          FOREIGN KEY (audiobook_id) REFERENCES audiobooks(id) ON DELETE SET NULL
        )
      `, (err) => {
        if (err) {
          console.error('Failed to create activity_events table:', err);
          return reject(err);
        }
      });

      // Index for efficient querying
      db.run('CREATE INDEX IF NOT EXISTS idx_activity_user_id ON activity_events(user_id)');
      db.run('CREATE INDEX IF NOT EXISTS idx_activity_created_at ON activity_events(created_at DESC)');
      db.run('CREATE INDEX IF NOT EXISTS idx_activity_event_type ON activity_events(event_type)');

      // Add privacy settings to users table
      db.run('ALTER TABLE users ADD COLUMN share_activity INTEGER DEFAULT 0', (err) => {
        // Ignore error if column already exists
        if (err && !err.message.includes('duplicate column')) {
          console.error('Failed to add share_activity column:', err);
        }
      });

      db.run('ALTER TABLE users ADD COLUMN show_in_feed INTEGER DEFAULT 1', (err) => {
        // Ignore error if column already exists
        if (err && !err.message.includes('duplicate column')) {
          console.error('Failed to add show_in_feed column:', err);
        }
        resolve();
      });
    });
  });
}

function down(db) {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      db.run('DROP TABLE IF EXISTS activity_events', (err) => {
        if (err) {
          console.error('Failed to drop activity_events table:', err);
          return reject(err);
        }
        resolve();
      });
    });
  });
}

module.exports = { up, down };
