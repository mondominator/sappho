/**
 * Unlock Service
 *
 * Handles account unlock operations:
 * - Generate secure unlock tokens
 * - Validate and consume unlock tokens
 * - Clear account lockouts
 * - Admin account enable/disable
 */

const crypto = require('crypto');
const db = require('../database');
const { clearFailedAttempts } = require('../auth');

const TOKEN_EXPIRY_HOURS = 1;

/**
 * Generate a secure unlock token for a user
 * Returns the token string (to be sent via email)
 */
async function generateUnlockToken(userId) {
  return new Promise((resolve, reject) => {
    // Generate a cryptographically secure token
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + TOKEN_EXPIRY_HOURS * 60 * 60 * 1000).toISOString();

    // Delete any existing unused tokens for this user
    db.run(
      'DELETE FROM unlock_tokens WHERE user_id = ? AND used_at IS NULL',
      [userId],
      (err) => {
        if (err) {
          return reject(err);
        }

        // Insert new token
        db.run(
          'INSERT INTO unlock_tokens (user_id, token, expires_at) VALUES (?, ?, ?)',
          [userId, token, expiresAt],
          function(err) {
            if (err) {
              return reject(err);
            }
            resolve(token);
          }
        );
      }
    );
  });
}

/**
 * Validate an unlock token
 * Returns user info if valid, null if invalid/expired
 */
async function validateUnlockToken(token) {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT ut.*, u.id as user_id, u.username, u.email
       FROM unlock_tokens ut
       JOIN users u ON ut.user_id = u.id
       WHERE ut.token = ? AND ut.used_at IS NULL AND ut.expires_at > datetime('now')`,
      [token],
      (err, row) => {
        if (err) {
          return reject(err);
        }
        resolve(row || null);
      }
    );
  });
}

/**
 * Consume an unlock token and unlock the account
 * Clears the in-memory lockout and marks token as used
 */
async function consumeUnlockToken(token) {
  // First validate the token
  const tokenData = await validateUnlockToken(token);
  if (!tokenData) {
    throw new Error('Invalid or expired unlock token');
  }

  // Mark token as used
  return new Promise((resolve, reject) => {
    db.run(
      'UPDATE unlock_tokens SET used_at = CURRENT_TIMESTAMP WHERE token = ?',
      [token],
      (err) => {
        if (err) {
          return reject(err);
        }

        // Clear the in-memory lockout
        clearFailedAttempts(tokenData.username);

        console.log(`Account unlocked via email token: ${tokenData.username}`);
        resolve({
          success: true,
          username: tokenData.username
        });
      }
    );
  });
}

/**
 * Get user by email for unlock request
 * Returns null if email not found (for security, don't reveal if email exists)
 */
async function getUserByEmail(email) {
  return new Promise((resolve, reject) => {
    db.get(
      'SELECT id, username, email FROM users WHERE email = ?',
      [email.toLowerCase().trim()],
      (err, row) => {
        if (err) {
          return reject(err);
        }
        resolve(row || null);
      }
    );
  });
}

/**
 * Disable a user account (admin action)
 */
async function disableAccount(userId, reason = null) {
  return new Promise((resolve, reject) => {
    db.run(
      'UPDATE users SET account_disabled = 1, disabled_at = CURRENT_TIMESTAMP, disabled_reason = ? WHERE id = ?',
      [reason, userId],
      function(err) {
        if (err) {
          return reject(err);
        }
        if (this.changes === 0) {
          return reject(new Error('User not found'));
        }
        resolve({ success: true });
      }
    );
  });
}

/**
 * Enable a user account (admin action)
 */
async function enableAccount(userId) {
  return new Promise((resolve, reject) => {
    db.run(
      'UPDATE users SET account_disabled = 0, disabled_at = NULL, disabled_reason = NULL WHERE id = ?',
      [userId],
      function(err) {
        if (err) {
          return reject(err);
        }
        if (this.changes === 0) {
          return reject(new Error('User not found'));
        }
        resolve({ success: true });
      }
    );
  });
}

/**
 * Get account status for a user
 */
async function getAccountStatus(userId) {
  return new Promise((resolve, reject) => {
    db.get(
      'SELECT id, username, account_disabled, disabled_at, disabled_reason FROM users WHERE id = ?',
      [userId],
      (err, row) => {
        if (err) {
          return reject(err);
        }
        if (!row) {
          return reject(new Error('User not found'));
        }
        resolve({
          id: row.id,
          username: row.username,
          disabled: !!row.account_disabled,
          disabledAt: row.disabled_at,
          disabledReason: row.disabled_reason
        });
      }
    );
  });
}

/**
 * Clean up expired unlock tokens (maintenance task)
 */
async function cleanupExpiredTokens() {
  return new Promise((resolve, reject) => {
    db.run(
      "DELETE FROM unlock_tokens WHERE expires_at < datetime('now')",
      [],
      function(err) {
        if (err) {
          return reject(err);
        }
        if (this.changes > 0) {
          console.log(`Cleaned up ${this.changes} expired unlock tokens`);
        }
        resolve(this.changes);
      }
    );
  });
}

// Run cleanup periodically (every hour)
setInterval(() => {
  cleanupExpiredTokens().catch(err => {
    console.error('Failed to cleanup expired unlock tokens:', err);
  });
}, 60 * 60 * 1000);

module.exports = {
  generateUnlockToken,
  validateUnlockToken,
  consumeUnlockToken,
  getUserByEmail,
  disableAccount,
  enableAccount,
  getAccountStatus,
  cleanupExpiredTokens
};
