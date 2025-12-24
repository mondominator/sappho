/**
 * Migration: Add MFA (Multi-Factor Authentication) support
 *
 * Adds columns to users table for TOTP-based 2FA:
 * - mfa_secret: Encrypted TOTP secret key
 * - mfa_enabled: Whether MFA is active for user
 * - mfa_backup_codes: JSON array of hashed backup codes
 * - mfa_enabled_at: When MFA was enabled
 */

module.exports = {
  async up(db) {
    return new Promise((resolve) => {
      db.serialize(() => {
        // Add MFA columns to users table
        db.run('ALTER TABLE users ADD COLUMN mfa_secret TEXT', (err) => {
          if (err && !err.message.includes('duplicate column')) {
            console.error('Error adding mfa_secret:', err.message);
          }
        });

        db.run('ALTER TABLE users ADD COLUMN mfa_enabled INTEGER DEFAULT 0', (err) => {
          if (err && !err.message.includes('duplicate column')) {
            console.error('Error adding mfa_enabled:', err.message);
          }
        });

        db.run('ALTER TABLE users ADD COLUMN mfa_backup_codes TEXT', (err) => {
          if (err && !err.message.includes('duplicate column')) {
            console.error('Error adding mfa_backup_codes:', err.message);
          }
        });

        db.run('ALTER TABLE users ADD COLUMN mfa_enabled_at TIMESTAMP', (err) => {
          if (err && !err.message.includes('duplicate column')) {
            console.error('Error adding mfa_enabled_at:', err.message);
          }
          resolve();
        });
      });
    });
  },

  async down(_db) {
    // SQLite doesn't support DROP COLUMN easily
    // Would need to recreate table without these columns
    console.log('Down migration for MFA not implemented - columns will remain');
    return Promise.resolve();
  }
};
