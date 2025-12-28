/**
 * Migration: Add unlock tokens table
 *
 * Creates table for account unlock tokens:
 * - Used for self-service email unlock
 * - Single-use tokens with 1-hour expiry
 */

module.exports = {
  async up(db) {
    return new Promise((resolve) => {
      db.run(`
        CREATE TABLE IF NOT EXISTS unlock_tokens (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL,
          token TEXT UNIQUE NOT NULL,
          expires_at TIMESTAMP NOT NULL,
          used_at TIMESTAMP,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
      `, (err) => {
        if (err) console.error('Error creating unlock_tokens:', err.message);

        // Create index for faster token lookups
        db.run('CREATE INDEX IF NOT EXISTS idx_unlock_tokens_token ON unlock_tokens(token)', (err) => {
          if (err) console.error('Error creating unlock_tokens index:', err.message);
          resolve();
        });
      });
    });
  },

  async down(db) {
    return new Promise((resolve) => {
      db.run('DROP TABLE IF EXISTS unlock_tokens', (err) => {
        if (err) console.error('Error dropping unlock_tokens:', err.message);
        resolve();
      });
    });
  }
};
