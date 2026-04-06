/**
 * MFA Service
 *
 * Handles TOTP-based multi-factor authentication:
 * - Secret generation and QR code creation
 * - Token verification
 * - Backup code generation and validation
 */

const { authenticator } = require('otplib');
const QRCode = require('qrcode');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const db = require('../database');

// Configure TOTP settings
authenticator.options = {
  digits: 6,
  step: 30, // 30 second window
  window: 1  // Allow 1 step before/after for clock drift
};

const APP_NAME = 'Sappho';

/**
 * Generate a new TOTP secret for a user
 */
function generateSecret() {
  return authenticator.generateSecret();
}

/**
 * Generate QR code data URL for authenticator app setup
 */
async function generateQRCode(username, secret) {
  const otpauth = authenticator.keyuri(username, APP_NAME, secret);
  return QRCode.toDataURL(otpauth);
}

/**
 * Verify a TOTP token against a secret
 */
function verifyToken(token, secret) {
  try {
    return authenticator.verify({ token, secret });
  } catch (error) {
    console.error('TOTP verification error:', error);
    return false;
  }
}

/**
 * Generate backup codes for account recovery.
 * Returns both plain codes (to show user) and hashed codes (to store).
 *
 * Hashing runs concurrently via bcrypt.hash() rather than bcrypt.hashSync —
 * the sync version blocks the event loop for ~300ms per code × 10 codes =
 * ~3 seconds of blocking, during which the whole server is frozen.
 */
async function generateBackupCodes(count = 10) {
  const plainCodes = [];
  for (let i = 0; i < count; i++) {
    plainCodes.push(crypto.randomBytes(4).toString('hex').toUpperCase());
  }
  // Parallel hashing: ~300ms total instead of 3s.
  const hashedCodes = await Promise.all(plainCodes.map(code => bcrypt.hash(code, 12)));
  return { plainCodes, hashedCodes };
}

/**
 * Verify a backup code and mark it as used if valid.
 *
 * Uses bcrypt.compare (async) and awaits every comparison — the previous
 * version used compareSync in a for-loop, blocking the event loop for
 * ~300ms × 10 codes on every backup-code login attempt. That's a trivial
 * DoS vector even without bad intent.
 */
async function verifyBackupCode(userId, code) {
  const user = await new Promise((resolve, reject) => {
    db.get(
      'SELECT mfa_backup_codes FROM users WHERE id = ?',
      [userId],
      (err, row) => (err ? reject(err) : resolve(row))
    );
  });

  if (!user || !user.mfa_backup_codes) return false;

  let hashedCodes;
  try {
    hashedCodes = JSON.parse(user.mfa_backup_codes);
  } catch (parseError) {
    console.error('Error parsing backup codes:', parseError);
    return false;
  }

  const upperCode = code.toUpperCase().replace(/[^A-Z0-9]/g, '');

  // Compare against every non-null stored hash in parallel, then find a
  // match. Parallel execution means we don't scale with the number of
  // unused codes, and awaiting means we don't freeze the event loop.
  const activeHashes = hashedCodes
    .map((hash, idx) => ({ hash, idx }))
    .filter(entry => entry.hash);
  const comparisons = await Promise.all(
    activeHashes.map(entry => bcrypt.compare(upperCode, entry.hash))
  );
  const matchIndex = comparisons.findIndex(matched => matched);
  if (matchIndex === -1) return false;

  // Mark the matched code as used (set to null) and persist.
  hashedCodes[activeHashes[matchIndex].idx] = null;
  await new Promise((resolve) => {
    db.run(
      'UPDATE users SET mfa_backup_codes = ? WHERE id = ?',
      [JSON.stringify(hashedCodes), userId],
      (updateErr) => {
        if (updateErr) console.error('Error updating backup codes:', updateErr);
        resolve();
      }
    );
  });
  return true;
}

/**
 * Enable MFA for a user (store secret and backup codes)
 */
async function enableMFA(userId, secret, hashedBackupCodes) {
  return new Promise((resolve, reject) => {
    db.run(
      `UPDATE users SET
        mfa_secret = ?,
        mfa_enabled = 1,
        mfa_backup_codes = ?,
        mfa_enabled_at = CURRENT_TIMESTAMP
      WHERE id = ?`,
      [secret, JSON.stringify(hashedBackupCodes), userId],
      function(err) {
        if (err) reject(err);
        else resolve(this.changes > 0);
      }
    );
  });
}

/**
 * Disable MFA for a user
 */
async function disableMFA(userId) {
  return new Promise((resolve, reject) => {
    db.run(
      `UPDATE users SET
        mfa_secret = NULL,
        mfa_enabled = 0,
        mfa_backup_codes = NULL,
        mfa_enabled_at = NULL
      WHERE id = ?`,
      [userId],
      function(err) {
        if (err) reject(err);
        else resolve(this.changes > 0);
      }
    );
  });
}

/**
 * Get MFA status for a user
 */
async function getMFAStatus(userId) {
  return new Promise((resolve, reject) => {
    db.get(
      'SELECT mfa_enabled, mfa_enabled_at, mfa_backup_codes FROM users WHERE id = ?',
      [userId],
      (err, user) => {
        if (err) return reject(err);
        if (!user) return resolve({ enabled: false });

        let remainingBackupCodes = 0;
        if (user.mfa_backup_codes) {
          try {
            const codes = JSON.parse(user.mfa_backup_codes);
            remainingBackupCodes = codes.filter(c => c !== null).length;
          } catch (_e) {
            // Ignore parse errors
          }
        }

        resolve({
          enabled: !!user.mfa_enabled,
          enabledAt: user.mfa_enabled_at,
          remainingBackupCodes
        });
      }
    );
  });
}

/**
 * Get user's MFA secret (for verification during login)
 */
async function getUserMFASecret(userId) {
  return new Promise((resolve, reject) => {
    db.get(
      'SELECT mfa_secret, mfa_enabled FROM users WHERE id = ?',
      [userId],
      (err, user) => {
        if (err) return reject(err);
        if (!user || !user.mfa_enabled) return resolve(null);
        resolve(user.mfa_secret);
      }
    );
  });
}

/**
 * Check if user has MFA enabled (for login flow)
 */
async function userHasMFA(userId) {
  return new Promise((resolve, reject) => {
    db.get(
      'SELECT mfa_enabled FROM users WHERE id = ?',
      [userId],
      (err, user) => {
        if (err) return reject(err);
        resolve(user && !!user.mfa_enabled);
      }
    );
  });
}

/**
 * Regenerate backup codes for a user
 */
async function regenerateBackupCodes(userId) {
  const { plainCodes, hashedCodes } = await generateBackupCodes();

  return new Promise((resolve, reject) => {
    db.run(
      'UPDATE users SET mfa_backup_codes = ? WHERE id = ? AND mfa_enabled = 1',
      [JSON.stringify(hashedCodes), userId],
      function(err) {
        if (err) return reject(err);
        if (this.changes === 0) {
          return reject(new Error('MFA not enabled for this user'));
        }
        resolve(plainCodes);
      }
    );
  });
}

module.exports = {
  generateSecret,
  generateQRCode,
  verifyToken,
  generateBackupCodes,
  verifyBackupCode,
  enableMFA,
  disableMFA,
  getMFAStatus,
  getUserMFASecret,
  userHasMFA,
  regenerateBackupCodes
};
