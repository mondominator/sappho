/**
 * Migration: Add account status tracking
 *
 * Adds columns to users table for account disable/enable:
 * - account_disabled: Whether account is disabled by admin
 * - disabled_at: When account was disabled
 * - disabled_reason: Optional reason for disabling
 */

module.exports = {
  async up(db) {
    return new Promise((resolve) => {
      db.serialize(() => {
        // Add account_disabled column
        db.run('ALTER TABLE users ADD COLUMN account_disabled INTEGER DEFAULT 0', (err) => {
          if (err && !err.message.includes('duplicate column')) {
            console.error('Error adding account_disabled:', err.message);
          }
        });

        // Add disabled_at timestamp
        db.run('ALTER TABLE users ADD COLUMN disabled_at TIMESTAMP', (err) => {
          if (err && !err.message.includes('duplicate column')) {
            console.error('Error adding disabled_at:', err.message);
          }
        });

        // Add disabled_reason column
        db.run('ALTER TABLE users ADD COLUMN disabled_reason TEXT', (err) => {
          if (err && !err.message.includes('duplicate column')) {
            console.error('Error adding disabled_reason:', err.message);
          }
          resolve();
        });
      });
    });
  },

  async down(_db) {
    // SQLite doesn't support DROP COLUMN easily
    // Would need to recreate table without these columns
    console.log('Down migration for account status not implemented - columns will remain');
    return Promise.resolve();
  }
};
