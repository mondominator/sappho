/**
 * Hardcover API Routes
 *
 * Provides endpoints for managing Hardcover.app integration:
 * - GET /api/hardcover/config - Get current configuration status
 * - POST /api/hardcover/api-key - Save user's personal API key
 * - DELETE /api/hardcover/api-key - Remove user's personal API key
 * - POST /api/hardcover/sync-enabled - Toggle sync enabled/disabled
 * - POST /api/hardcover/test-connection - Test API key connectivity
 *
 * Note: OAuth is not currently implemented. Per-user API keys are stored and
 * can be tested, but metadata search currently uses the server-wide
 * HARDCOVER_API_KEY environment variable exclusively.
 */

const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const logger = require('../utils/logger');
const { authenticateToken } = require('../auth');
const db = require('../database');

// Encryption key from environment (must be 32 bytes for AES-256)
// ENCRYPTION_KEY is now required via validateEnv - using a fixed salt for key derivation
const ENCRYPTION_KEY = crypto.scryptSync(process.env.ENCRYPTION_KEY, 'sappho-hardcover-key', 32);

/**
 * Encrypt an API key using AES-256-GCM
 * @param {string} plaintext - The API key to encrypt
 * @returns {object} Object with encrypted, salt, iv, and authTag
 */
function encryptHardcoverKey(plaintext) {
  // Generate a unique salt for this encryption operation
  const salt = crypto.randomBytes(32);

  // Derive a unique key from the master key + per-record salt
  const key = crypto.scryptSync(ENCRYPTION_KEY.toString('hex'), salt.toString('hex'), 32);

  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  const authTag = cipher.getAuthTag();

  return {
    encrypted,
    salt: salt.toString('hex'),
    iv: iv.toString('hex'),
    authTag: authTag.toString('hex')
  };
}

/**
 * Decrypt an encrypted API key
 * @param {string} encrypted - The encrypted data
 * @param {string} salt - The salt used for key derivation
 * @param {string} iv - The initialization vector
 * @param {string} authTag - The authentication tag
 * @returns {string} The decrypted API key
 */
function decryptHardcoverKey(encrypted, salt, iv, authTag) {
  try {
    // Derive the same unique key from the master key + stored salt
    const key = crypto.scryptSync(ENCRYPTION_KEY.toString('hex'), salt, 32);

    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      key,
      Buffer.from(iv, 'hex')
    );

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
 * Validate Hardcover API key format
 * Hardcover API keys are 40-character alphanumeric strings
 */
function isValidHardcoverApiKey(key) {
  return /^[a-zA-Z0-9]{40}$/.test(key);
}

/**
 * Make a GraphQL request to Hardcover API
 */
async function hardcoverGraphQLRequest(query, variables = {}, apiKey) {
  const response = await fetch('https://hardcover.app/api/graphql', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({ query, variables })
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const data = await response.json();

  if (data.errors) {
    throw new Error(data.errors[0].message);
  }

  return data.data;
}

/**
 * GET /api/hardcover/config
 *
 * Returns configuration status for the current user:
 * - serverHasKey: Whether a server-wide API key is configured
 * - userHasKey: Whether this user has a personal API key stored
 * - syncEnabled: Whether sync is enabled for this user
 * - hardcoverUserId: The user's Hardcover ID (if connected)
 *
 * Note: OAuth is not currently implemented. Per-user API keys are stored but not
 * currently used for metadata search (which uses the server-wide HARDCOVER_API_KEY).
 */
router.get('/config', authenticateToken, (req, res) => {
  db.get(
    `SELECT
      hardcover_api_key,
      hardcover_user_id,
      hardcover_sync_enabled
     FROM users WHERE id = ?`,
    [req.user.id],
    (err, row) => {
      if (err) {
        logger.error({ err, userId: req.user.id }, 'Failed to load Hardcover config');
        return res.status(500).json({ error: 'Failed to load configuration' });
      }

      if (!row) {
        return res.status(404).json({ error: 'User not found' });
      }

      // Determine available features
      const serverHasKey = !!process.env.HARDCOVER_API_KEY;
      const userHasKey = !!row.hardcover_api_key;

      const features = {
        metadataSearch: serverHasKey, // Currently uses server-wide key only
        progressSync: false, // Not yet implemented
        wantToReadImport: false, // Not yet implemented
        editionLinking: false // Not yet implemented
      };

      res.json({
        serverHasKey,
        userHasKey,
        syncEnabled: !!row.hardcover_sync_enabled,
        hardcoverUserId: row.hardcover_user_id,
        features
      });
    }
  );
});

/**
 * POST /api/hardcover/api-key
 *
 * Save or update the user's personal Hardcover API key.
 * The key is encrypted before storage.
 *
 * Body: { apiKey: string }
 */
router.post('/api-key', authenticateToken, (req, res) => {
  const { apiKey } = req.body;

  // Validate API key format
  if (!apiKey || !isValidHardcoverApiKey(apiKey)) {
    return res.status(400).json({
      error: 'Invalid API key format. Hardcover API keys are 40-character alphanumeric strings.'
    });
  }

  // Encrypt the API key
  const { encrypted, salt, iv, authTag } = encryptHardcoverKey(apiKey);

  // Store encrypted key as JSON string
  const encryptedData = JSON.stringify({ encrypted, salt, iv, authTag });

  db.run(
    'UPDATE users SET hardcover_api_key = ?, hardcover_user_id = NULL WHERE id = ?',
    [encryptedData, req.user.id],
    function(err) {
      if (err) {
        logger.error({ err, userId: req.user.id }, 'Failed to save API key');
        return res.status(500).json({ error: 'Failed to save API key' });
      }

      logger.info({ userId: req.user.id }, 'Hardcover API key saved');

      res.json({
        success: true,
        message: 'API key saved successfully'
      });
    }
  );
});

/**
 * DELETE /api/hardcover/api-key
 *
 * Remove the user's personal API key and disconnect their account.
 */
router.delete('/api-key', authenticateToken, (req, res) => {
  db.run(
    `UPDATE users SET
      hardcover_api_key = NULL,
      hardcover_user_id = NULL,
      hardcover_sync_enabled = 0
     WHERE id = ?`,
    [req.user.id],
    function(err) {
      if (err) {
        logger.error({ err, userId: req.user.id }, 'Failed to remove API key');
        return res.status(500).json({ error: 'Failed to remove API key' });
      }

      logger.info({ userId: req.user.id }, 'Hardcover API key removed');

      res.json({
        success: true,
        message: 'API key removed successfully'
      });
    }
  );
});

/**
 * POST /api/hardcover/sync-enabled
 *
 * Toggle Hardcover sync on/off for the current user.
 *
 * Body: { enabled: boolean }
 */
router.post('/sync-enabled', authenticateToken, (req, res) => {
  const { enabled } = req.body;

  if (typeof enabled !== 'boolean') {
    return res.status(400).json({ error: 'enabled must be a boolean' });
  }

  db.run(
    'UPDATE users SET hardcover_sync_enabled = ? WHERE id = ?',
    [enabled ? 1 : 0, req.user.id],
    function(err) {
      if (err) {
        logger.error({ err, userId: req.user.id }, 'Failed to update sync setting');
        return res.status(500).json({ error: 'Failed to update sync setting' });
      }

      logger.info({ userId: req.user.id, enabled }, 'Hardcover sync updated');

      res.json({
        success: true,
        syncEnabled: enabled
      });
    }
  );
});

/**
 * POST /api/hardcover/test-connection
 *
 * Test the user's Hardcover API key connectivity.
 * Attempts to fetch the user's profile from Hardcover.
 *
 * Note: This tests per-user API keys. Metadata search currently uses the
 * server-wide HARDCOVER_API_KEY environment variable instead.
 */
router.post('/test-connection', authenticateToken, async (req, res) => {
  // Get user's encrypted API key
  db.get(
    'SELECT hardcover_api_key FROM users WHERE id = ?',
    [req.user.id],
    async (err, row) => {
      if (err) {
        logger.error({ err, userId: req.user.id }, 'Failed to get API key for test');
        return res.status(500).json({ error: 'Failed to test connection' });
      }

      if (!row || !row.hardcover_api_key) {
        return res.status(400).json({
          error: 'No API key found. Please enter your Hardcover API key first.'
        });
      }

      let apiKey;

      // Decrypt API key
      try {
        const { encrypted, salt, iv, authTag } = JSON.parse(row.hardcover_api_key);
        apiKey = decryptHardcoverKey(encrypted, salt, iv, authTag);

        if (!apiKey) {
          return res.status(500).json({ error: 'Failed to decrypt API key' });
        }
      } catch (parseError) {
        logger.error({ err: parseError }, 'Failed to parse encrypted API key');
        return res.status(500).json({ error: 'Failed to decrypt API key' });
      }

      // Test connection by fetching user profile
      try {
        const query = `
          query {
            currentUser {
              id
              username
              displayName
            }
          }
        `;

        const data = await hardcoverGraphQLRequest(query, {}, apiKey);

        if (!data || !data.currentUser) {
          return res.status(400).json({
            error: 'Invalid response from Hardcover API'
          });
        }

        // Update hardcover_user_id with the ID from the API response
        db.run(
          'UPDATE users SET hardcover_user_id = ? WHERE id = ?',
          [data.currentUser.id, req.user.id],
          (updateErr) => {
            if (updateErr) {
              logger.error({ err: updateErr }, 'Failed to update Hardcover user ID');
            }
          }
        );

        logger.info({
          userId: req.user.id,
          hardcoverUserId: data.currentUser.id
        }, 'Hardcover connection test successful');

        res.json({
          connected: true,
          user: data.currentUser
        });

      } catch (apiError) {
        logger.error({ err: apiError.message, userId: req.user.id }, 'Hardcover API test failed');

        res.status(400).json({
          error: `Connection test failed: ${apiError.message}`
        });
      }
    }
  );
});

module.exports = router;
