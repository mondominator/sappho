/**
 * Migration: Add must_change_password column to users table
 *
 * This column tracks whether a user must change their password on next login.
 * Used for:
 * - Default admin accounts created with generated passwords
 * - Password reset by administrators
 * - Security policy enforcement
 */

module.exports = {
  up: (db) => {
    return new Promise((resolve, reject) => {
      db.run(
        'ALTER TABLE users ADD COLUMN must_change_password INTEGER DEFAULT 0',
        (err) => {
          if (err) {
            // Column might already exist
            if (err.message.includes('duplicate column name')) {
              console.log('must_change_password column already exists');
              resolve();
            } else {
              reject(err);
            }
          } else {
            console.log('Added must_change_password column to users table');
            resolve();
          }
        }
      );
    });
  },

  down: (_db) => {
    return new Promise((resolve, _reject) => {
      // SQLite doesn't support DROP COLUMN directly
      // Would need to recreate table - skipping for simplicity
      console.log('Rollback not supported for this migration');
      resolve();
    });
  }
};
