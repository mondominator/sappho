/**
 * Migration: Add email notification support
 *
 * Creates tables for:
 * - email_settings: SMTP server configuration (admin)
 * - user_notification_prefs: Per-user notification preferences
 */

module.exports = {
  async up(db) {
    return new Promise((resolve) => {
      db.serialize(() => {
        // Create email settings table (singleton - only 1 row)
        db.run(`
          CREATE TABLE IF NOT EXISTS email_settings (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            host TEXT,
            port INTEGER DEFAULT 587,
            secure INTEGER DEFAULT 0,
            username TEXT,
            password TEXT,
            from_address TEXT,
            from_name TEXT,
            enabled INTEGER DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          )
        `, (err) => {
          if (err) console.error('Error creating email_settings:', err.message);
        });

        // Create user notification preferences table
        db.run(`
          CREATE TABLE IF NOT EXISTS user_notification_prefs (
            user_id INTEGER PRIMARY KEY,
            email_new_audiobook INTEGER DEFAULT 0,
            email_weekly_summary INTEGER DEFAULT 0,
            email_recommendations INTEGER DEFAULT 0,
            email_enabled INTEGER DEFAULT 1,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
          )
        `, (err) => {
          if (err) console.error('Error creating user_notification_prefs:', err.message);
          resolve();
        });
      });
    });
  },

  async down(db) {
    return new Promise((resolve) => {
      db.serialize(() => {
        db.run('DROP TABLE IF EXISTS user_notification_prefs', (err) => {
          if (err) console.error('Error dropping user_notification_prefs:', err.message);
        });
        db.run('DROP TABLE IF EXISTS email_settings', (err) => {
          if (err) console.error('Error dropping email_settings:', err.message);
          resolve();
        });
      });
    });
  }
};
