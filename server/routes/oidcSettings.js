/**
 * OIDC Settings Routes
 *
 * Admin-only CRUD endpoints for OpenID Connect provider configuration.
 * Secrets are encrypted at rest using the server's JWT_SECRET.
 */

const express = require('express');
const rateLimit = require('express-rate-limit');
const { encryptSecret } = require('../utils/oidcCrypto');

function trimTrailingSlashes(str) {
  let end = str.length;
  while (end > 0 && str[end - 1] === '/') end--;
  return str.slice(0, end);
}
const { OidcService } = require('../services/oidcService');

/**
 * Default dependencies - used when route is required directly
 */
const defaultDependencies = {
  db: () => require('../database'),
  auth: () => require('../auth'),
};

/**
 * Rate limiter for OIDC settings endpoints
 */
const oidcSettingsLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: { error: 'Too many requests. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Required fields for creating/updating OIDC configuration
 */
const REQUIRED_FIELDS = ['provider_name', 'issuer_url', 'client_id', 'client_secret'];

/**
 * Create OIDC settings routes with injectable dependencies
 * @param {Object} deps - Dependencies (for testing)
 * @param {Object} deps.db - Database instance
 * @param {Function} deps.authenticateToken - Auth middleware
 * @param {Function} deps.requireAdmin - Admin middleware
 * @returns {express.Router}
 */
function createOidcSettingsRouter(deps = {}) {
  const router = express.Router();

  // Resolve dependencies
  const db = deps.db || defaultDependencies.db();
  const auth = deps.auth || (deps.authenticateToken && deps.requireAdmin
    ? { authenticateToken: deps.authenticateToken, requireAdmin: deps.requireAdmin }
    : defaultDependencies.auth());
  const { authenticateToken, requireAdmin } = auth;

  // Apply rate limiting and auth to all routes
  router.use(oidcSettingsLimiter);
  router.use(authenticateToken);
  router.use(requireAdmin);

  /**
   * GET / - Read current OIDC configuration
   * Returns config with client_secret masked (never exposes encrypted value)
   */
  router.get('/', (req, res) => {
    db.get('SELECT * FROM oidc_config LIMIT 1', [], (err, row) => {
      if (err) {
        req.log?.error({ err }, 'Failed to read OIDC config');
        return res.status(500).json({ error: 'Failed to read OIDC configuration' });
      }

      if (!row) {
        return res.json({ configured: false });
      }

      res.json({
        configured: true,
        config: {
          id: row.id,
          provider_name: row.provider_name,
          issuer_url: row.issuer_url,
          client_id: row.client_id,
          client_secret_set: true,
          auto_provision: Boolean(row.auto_provision),
          default_admin: Boolean(row.default_admin),
          enabled: Boolean(row.enabled),
          created_at: row.created_at,
        },
      });
    });
  });

  /**
   * POST / - Save or update OIDC configuration
   * Encrypts client_secret before storing. Upserts (replaces existing config).
   */
  router.post('/', (req, res) => {
    const { provider_name, issuer_url, client_id, client_secret, auto_provision, default_admin, enabled } = req.body;

    // Validate required fields
    const missing = REQUIRED_FIELDS.filter((field) => !req.body[field]);
    if (missing.length > 0) {
      return res.status(400).json({
        error: `Missing required fields: ${missing.join(', ')}`,
      });
    }

    // Validate issuer_url format
    try {
      new URL(issuer_url);
    } catch {
      return res.status(400).json({ error: 'Invalid issuer_url: must be a valid URL' });
    }

    // Encrypt the client secret
    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) {
      return res.status(500).json({ error: 'Server configuration error: JWT_SECRET not set' });
    }

    let encryptedSecret;
    try {
      encryptedSecret = encryptSecret(client_secret, jwtSecret);
    } catch (err) {
      req.log?.error({ err }, 'Failed to encrypt client secret');
      return res.status(500).json({ error: 'Failed to encrypt client secret' });
    }

    // Upsert: delete existing config then insert new one (single config row)
    db.run('DELETE FROM oidc_config', [], (deleteErr) => {
      if (deleteErr) {
        req.log?.error({ err: deleteErr }, 'Failed to clear existing OIDC config');
        return res.status(500).json({ error: 'Failed to save OIDC configuration' });
      }

      const sql = `
        INSERT INTO oidc_config (provider_name, issuer_url, client_id, client_secret, auto_provision, default_admin, enabled)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `;
      const params = [
        provider_name,
        trimTrailingSlashes(issuer_url),
        client_id,
        encryptedSecret,
        auto_provision !== undefined ? (auto_provision ? 1 : 0) : 1,
        default_admin !== undefined ? (default_admin ? 1 : 0) : 0,
        enabled !== undefined ? (enabled ? 1 : 0) : 1,
      ];

      db.run(sql, params, function (insertErr) {
        if (insertErr) {
          req.log?.error({ err: insertErr }, 'Failed to insert OIDC config');
          return res.status(500).json({ error: 'Failed to save OIDC configuration' });
        }

        res.json({
          message: 'OIDC configuration saved successfully',
          id: this.lastID,
        });
      });
    });
  });

  /**
   * POST /test - Test OIDC provider connection
   * Fetches the OpenID Connect discovery document to validate the issuer URL.
   */
  router.post('/test', async (req, res) => {
    const { issuer_url } = req.body;

    if (!issuer_url) {
      return res.status(400).json({ error: 'issuer_url is required' });
    }

    try {
      new URL(issuer_url);
    } catch {
      return res.status(400).json({ error: 'Invalid issuer_url: must be a valid URL' });
    }

    try {
      const oidcService = new OidcService();
      const discovery = await oidcService.discover(issuer_url);

      res.json({
        message: 'Connection successful',
        provider: {
          issuer: discovery.issuer,
          authorization_endpoint: discovery.authorization_endpoint,
          token_endpoint: discovery.token_endpoint,
          userinfo_endpoint: discovery.userinfo_endpoint,
        },
      });
    } catch (err) {
      req.log?.error({ err }, 'OIDC connection test failed');
      res.status(400).json({
        error: `Connection failed: ${err.message}`,
      });
    }
  });

  /**
   * DELETE / - Remove OIDC configuration
   */
  router.delete('/', (req, res) => {
    db.run('DELETE FROM oidc_config', [], function (err) {
      if (err) {
        req.log?.error({ err }, 'Failed to delete OIDC config');
        return res.status(500).json({ error: 'Failed to remove OIDC configuration' });
      }

      res.json({
        message: 'OIDC configuration removed',
        removed: this.changes > 0,
      });
    });
  });

  return router;
}

// Export default router for direct require() in index.js
module.exports = createOidcSettingsRouter();
// Export factory function for testing
module.exports.createOidcSettingsRouter = createOidcSettingsRouter;
