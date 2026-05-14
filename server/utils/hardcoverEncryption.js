/**
 * Hardcover API key encryption + resolution.
 *
 * Stored shape: a JSON-stringified `{ encrypted, salt, iv, authTag }` object
 * in the `users.hardcover_api_key` column. Each save generates a fresh random
 * salt and IV; the master key is derived from `process.env.ENCRYPTION_KEY`
 * (required at boot via validateEnv).
 *
 * Single source of truth so both the routes layer (POST /api/hardcover/*) and
 * the metadata search layer use the exact same crypto + canonical Hardcover
 * GraphQL endpoint.
 */

const crypto = require('crypto');
const logger = require('./logger');

// Canonical Hardcover GraphQL endpoint. The previous code had two different
// URLs in routes/hardcover.js vs services/metadataSearch.js — exporting from
// one place makes that drift impossible.
const HARDCOVER_GRAPHQL_URL = 'https://hardcover.app/api/graphql';

// Master key derived from the required ENCRYPTION_KEY env var. The outer salt
// is a fixed string so the master key is deterministic across restarts —
// intentional (per-record salts below provide the unique-key property); the
// deterministic master is what makes previously-stored keys decryptable after
// a process restart.
//
// Lazy-init so importing this module doesn't crash test setups that don't
// configure ENCRYPTION_KEY. validateEnv guarantees it's present at boot in
// production paths before any encrypt/decrypt call runs.
let _masterKey = null;
function getMasterKey() {
  if (_masterKey === null) {
    if (!process.env.ENCRYPTION_KEY) {
      throw new Error('ENCRYPTION_KEY is required for Hardcover key encryption');
    }
    _masterKey = crypto.scryptSync(
      process.env.ENCRYPTION_KEY,
      'sappho-hardcover-key',
      32
    );
  }
  return _masterKey;
}

/**
 * Encrypt a plaintext API key.
 *
 * @param {string} plaintext
 * @returns {{encrypted: string, salt: string, iv: string, authTag: string}}
 */
function encryptHardcoverKey(plaintext) {
  const salt = crypto.randomBytes(32);
  const key = crypto.scryptSync(getMasterKey().toString('hex'), salt.toString('hex'), 32);

  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  return {
    encrypted,
    salt: salt.toString('hex'),
    iv: iv.toString('hex'),
    authTag: cipher.getAuthTag().toString('hex')
  };
}

/**
 * Decrypt a stored Hardcover key blob.
 *
 * @param {string} encrypted
 * @param {string} salt
 * @param {string} iv
 * @param {string} authTag
 * @returns {string|null} The decrypted key, or null on any failure
 */
function decryptHardcoverKey(encrypted, salt, iv, authTag) {
  try {
    const key = crypto.scryptSync(getMasterKey().toString('hex'), salt, 32);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'hex'));
    decipher.setAuthTag(Buffer.from(authTag, 'hex'));

    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (error) {
    logger.error({ error: error.message }, 'Failed to decrypt Hardcover key');
    return null;
  }
}

/**
 * Resolve which Hardcover API key to use for a request. Per-user encrypted
 * key takes precedence; falls back to the server-wide env var if the user
 * has not connected their own account.
 *
 * @param {number} userId - The authenticated user's id
 * @param {object} db - sqlite3 database handle
 * @returns {Promise<string|null>} The API key to use, or null if nothing is configured
 */
function resolveUserHardcoverKey(userId, db) {
  return new Promise((resolve) => {
    if (!userId) {
      resolve(process.env.HARDCOVER_API_KEY || null);
      return;
    }
    db.get(
      'SELECT hardcover_api_key FROM users WHERE id = ?',
      [userId],
      (err, row) => {
        if (err) {
          // Don't fail the whole search if the per-user lookup errors —
          // log it and fall back to the server-wide key.
          logger.error({ err, userId }, 'Failed to look up per-user Hardcover key');
          resolve(process.env.HARDCOVER_API_KEY || null);
          return;
        }

        if (!row || !row.hardcover_api_key) {
          resolve(process.env.HARDCOVER_API_KEY || null);
          return;
        }

        try {
          const { encrypted, salt, iv, authTag } = JSON.parse(row.hardcover_api_key);
          const apiKey = decryptHardcoverKey(encrypted, salt, iv, authTag);
          // Decrypt failure shouldn't take down search either — fall back.
          resolve(apiKey || process.env.HARDCOVER_API_KEY || null);
        } catch (parseError) {
          logger.error({ err: parseError, userId }, 'Failed to parse per-user Hardcover key blob');
          resolve(process.env.HARDCOVER_API_KEY || null);
        }
      }
    );
  });
}

module.exports = {
  HARDCOVER_GRAPHQL_URL,
  encryptHardcoverKey,
  decryptHardcoverKey,
  resolveUserHardcoverKey
};
