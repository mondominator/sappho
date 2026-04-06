/**
 * OIDC Authentication Routes
 *
 * Provides OpenID Connect SSO flow: config check, authorization redirect, and callback handling.
 */

const express = require('express');
const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { OidcService } = require('../services/oidcService');
const { decryptSecret } = require('../utils/oidcCrypto');

const BCRYPT_ROUNDS = 12;

/**
 * Default dependencies - used when route is required directly
 */
const defaultDependencies = {
  db: () => require('../database'),
  oidcService: () => new OidcService(),
};

/**
 * Create OIDC auth routes with injectable dependencies
 * @param {Object} deps - Dependencies (for testing)
 * @param {Object} deps.db - Database module
 * @param {Object} deps.oidcService - OidcService instance
 * @returns {express.Router}
 */
function createOidcAuthRouter(deps = {}) {
  const router = express.Router();

  const db = deps.db || defaultDependencies.db();
  const oidcService = deps.oidcService || defaultDependencies.oidcService();

  const { createDbHelpers } = require('../utils/db');
  const { dbGet, dbRun } = createDbHelpers(db);

  const JWT_SECRET = process.env.JWT_SECRET;

  // Rate limit for authorize and callback endpoints
  const oidcLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 20,
    message: { error: 'Too many OIDC requests. Please try again later.' },
    standardHeaders: true,
    legacyHeaders: false,
  });

  /**
   * GET /api/auth/oidc/config
   * Public endpoint - returns whether OIDC is enabled and the provider name
   */
  router.get('/config', async (req, res) => {
    try {
      const config = await dbGet(
        'SELECT enabled, provider_name FROM oidc_config WHERE id = 1',
        []
      );

      if (!config || !config.enabled) {
        return res.json({ enabled: false });
      }

      res.json({
        enabled: true,
        provider_name: config.provider_name,
      });
    } catch (error) {
      console.error('OIDC config check error:', error);
      res.json({ enabled: false });
    }
  });

  /**
   * GET /api/auth/oidc/authorize
   * Initiates the OIDC authorization flow by redirecting to the identity provider
   */
  router.get('/authorize', oidcLimiter, async (req, res) => {
    try {
      const config = await dbGet(
        'SELECT * FROM oidc_config WHERE id = 1 AND enabled = 1',
        []
      );

      if (!config) {
        return res.status(400).json({ error: 'OIDC is not configured or not enabled' });
      }

      // Decrypt client secret
      let clientSecret;
      try {
        clientSecret = decryptSecret(config.client_secret, JWT_SECRET);
      } catch (_err) {
        console.error('Failed to decrypt OIDC client secret');
        return res.status(500).json({ error: 'OIDC configuration error' });
      }

      // Discover OIDC endpoints
      let discovery;
      try {
        discovery = await oidcService.discover(config.issuer_url);
      } catch (err) {
        console.error('OIDC discovery failed:', err.message);
        return res.status(502).json({ error: 'Failed to contact identity provider' });
      }

      // Generate state and nonce for CSRF/replay protection
      const state = oidcService.generateState();
      const nonce = oidcService.generateNonce();

      // Build the redirect URI from the trusted BASE_URL env var — NEVER
      // from req.headers.host, which an attacker can spoof to get the IdP
      // to redirect back to a host they control with a real auth code.
      // Falls back to the request host only when BASE_URL is unset (local dev).
      const baseUrl = process.env.BASE_URL
        ? process.env.BASE_URL.replace(/\/$/, '')
        : `${req.protocol}://${req.get('host')}`;
      const redirectUri = `${baseUrl}/api/auth/oidc/callback`;

      // Store state for validation in callback
      oidcService.storeState(state, {
        nonce,
        redirectUri,
        clientId: config.client_id,
        clientSecret,
        issuerUrl: config.issuer_url,
        autoProvision: config.auto_provision,
        defaultAdmin: config.default_admin,
      });

      // Build authorization URL and redirect
      const authUrl = oidcService.buildAuthorizationUrl(
        discovery.authorization_endpoint,
        {
          clientId: config.client_id,
          redirectUri,
          state,
          nonce,
          scope: 'openid profile email',
        }
      );

      res.redirect(authUrl);
    } catch (error) {
      console.error('OIDC authorize error:', error);
      res.status(500).json({ error: 'Failed to initiate OIDC login' });
    }
  });

  /**
   * GET /api/auth/oidc/callback
   * Handles the callback from the identity provider after user authentication
   */
  router.get('/callback', oidcLimiter, async (req, res) => {
    const frontendRedirect = (params) => {
      const query = new URLSearchParams(params).toString();
      return res.redirect(`/?${query}`);
    };

    try {
      const { code, state, error: oidcError } = req.query;

      // Handle provider-side errors
      if (oidcError) {
        console.error('OIDC provider error:', oidcError, req.query.error_description);
        return frontendRedirect({ error: 'oidc_provider_error' });
      }

      if (!code || !state) {
        return frontendRedirect({ error: 'oidc_invalid_callback' });
      }

      // Validate state to prevent CSRF
      const stateData = oidcService.consumeState(state);
      if (!stateData) {
        return frontendRedirect({ error: 'oidc_invalid_state' });
      }

      const { nonce, redirectUri, clientId, clientSecret, issuerUrl, autoProvision, defaultAdmin } = stateData;

      // Discover endpoints (cached from authorize step)
      let discovery;
      try {
        discovery = await oidcService.discover(issuerUrl);
      } catch (err) {
        console.error('OIDC discovery failed in callback:', err.message);
        return frontendRedirect({ error: 'oidc_discovery_failed' });
      }

      // Exchange authorization code for tokens
      let tokenResponse;
      try {
        tokenResponse = await oidcService.exchangeCode(discovery.token_endpoint, {
          code,
          clientId,
          clientSecret,
          redirectUri,
        });
      } catch (err) {
        console.error('OIDC token exchange failed:', err.message);
        return frontendRedirect({ error: 'oidc_token_exchange_failed' });
      }

      if (!tokenResponse.id_token) {
        console.error('OIDC token response missing id_token');
        return frontendRedirect({ error: 'oidc_no_id_token' });
      }

      // Verify the ID token's signature against the provider's JWKS and
      // validate its claims (iss/aud/exp/nonce). decodeIdToken alone does
      // not check the signature and is vulnerable to forged tokens.
      let claims;
      try {
        claims = await oidcService.verifyIdToken(tokenResponse.id_token, {
          issuer: issuerUrl,
          clientId,
          nonce,
          discovery,
        });
      } catch (err) {
        console.error('OIDC ID token verification failed:', err.message);
        return frontendRedirect({ error: 'oidc_invalid_token' });
      }

      // Extract user info from claims
      const userInfo = oidcService.extractUserInfo(claims);

      if (!userInfo.username) {
        return frontendRedirect({ error: 'oidc_no_username' });
      }

      // Find existing user by username
      let user = await dbGet(
        'SELECT * FROM users WHERE username = ?',
        [userInfo.username]
      );

      if (user) {
        // Check if account is disabled
        if (user.account_disabled) {
          return frontendRedirect({ error: 'oidc_account_disabled' });
        }

        // Update user's email and display name from provider
        const updates = [];
        const params = [];

        if (userInfo.email && userInfo.email !== user.email) {
          updates.push('email = ?');
          params.push(userInfo.email);
        }
        if (userInfo.name && userInfo.name !== user.display_name) {
          updates.push('display_name = ?');
          params.push(userInfo.name);
        }

        if (updates.length > 0) {
          params.push(user.id);
          await dbRun(
            `UPDATE users SET ${updates.join(', ')} WHERE id = ?`,
            params
          );
        }
      } else if (autoProvision) {
        // Auto-provision new user from OIDC
        const randomPassword = crypto.randomBytes(32).toString('hex');
        const passwordHash = await bcrypt.hash(randomPassword, BCRYPT_ROUNDS);
        const isAdmin = defaultAdmin ? 1 : 0;

        const result = await dbRun(
          `INSERT INTO users (username, password_hash, email, display_name, is_admin, auth_method)
           VALUES (?, ?, ?, ?, ?, 'oidc')`,
          [userInfo.username, passwordHash, userInfo.email, userInfo.name, isAdmin]
        );

        user = await dbGet('SELECT * FROM users WHERE id = ?', [result.lastID]);
      } else {
        // No auto-provisioning and user doesn't exist
        return frontendRedirect({ error: 'oidc_user_not_found' });
      }

      // Issue Sappho JWT
      const token = jwt.sign(
        { id: user.id, username: user.username },
        JWT_SECRET,
        { expiresIn: '7d' }
      );

      frontendRedirect({ token });
    } catch (error) {
      console.error('OIDC callback error:', error);
      frontendRedirect({ error: 'oidc_internal_error' });
    }
  });

  return router;
}

// Export default router for backwards compatibility with index.js
module.exports = createOidcAuthRouter();
// Export factory function for testing
module.exports.createOidcAuthRouter = createOidcAuthRouter;
