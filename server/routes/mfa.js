/**
 * MFA Routes
 *
 * API endpoints for multi-factor authentication management
 */

const express = require('express');
const rateLimit = require('express-rate-limit');
const { createDbHelpers } = require('../utils/db');

/**
 * Default dependencies - used when route is required directly
 */
const defaultDependencies = {
  auth: () => require('../auth'),
  db: () => require('../database'),
  mfaService: () => require('../services/mfaService'),
  bcrypt: () => require('bcryptjs'),
};

/**
 * Create MFA routes with injectable dependencies
 * @param {Object} deps - Dependencies (for testing)
 * @param {Object} deps.auth - Authentication module (authenticateToken)
 * @param {Object} deps.db - Database module
 * @param {Object} deps.mfaService - MFA service module
 * @param {Object} deps.bcrypt - bcrypt module for password verification
 * @returns {express.Router}
 */
function createMfaRouter(deps = {}) {
  const router = express.Router();

  // Resolve dependencies (use provided or defaults)
  const auth = deps.auth || defaultDependencies.auth();
  const db = deps.db || defaultDependencies.db();
  const mfaService = deps.mfaService || defaultDependencies.mfaService();
  const bcrypt = deps.bcrypt || defaultDependencies.bcrypt();
  const { authenticateToken } = auth;
  const { dbGet } = createDbHelpers(db);

  // SECURITY: Strict rate limiting for MFA endpoints
  const mfaLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 10, // 10 attempts per 15 minutes
    message: { error: 'Too many MFA attempts. Please try again later.' },
    standardHeaders: true,
    legacyHeaders: false,
  });

  const mfaSetupLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 5, // 5 setup attempts per hour
    message: { error: 'Too many MFA setup attempts. Please try again later.' },
    standardHeaders: true,
    legacyHeaders: false,
  });

  /**
   * GET /api/mfa/status
   * Get current user's MFA status
   */
  router.get('/status', mfaLimiter, authenticateToken, async (req, res) => {
    try {
      const status = await mfaService.getMFAStatus(req.user.id);
      res.json(status);
    } catch (error) {
      console.error('Error getting MFA status:', error);
      res.status(500).json({ error: 'Failed to get MFA status' });
    }
  });

  /**
   * POST /api/mfa/setup
   * Begin MFA setup - generates secret and QR code
   */
  router.post('/setup', mfaSetupLimiter, authenticateToken, async (req, res) => {
    try {
      // Check if MFA is already enabled
      const status = await mfaService.getMFAStatus(req.user.id);
      if (status.enabled) {
        return res.status(400).json({ error: 'MFA is already enabled' });
      }

      // Generate new secret
      const secret = mfaService.generateSecret();

      // Generate QR code
      const qrCode = await mfaService.generateQRCode(req.user.username, secret);

      // Return secret and QR code (don't save yet - user must verify first)
      res.json({
        secret,
        qrCode,
        message: 'Scan the QR code with your authenticator app, then verify with a code'
      });
    } catch (error) {
      console.error('Error setting up MFA:', error);
      res.status(500).json({ error: 'Failed to setup MFA' });
    }
  });

  /**
   * POST /api/mfa/verify-setup
   * Verify setup and enable MFA
   */
  router.post('/verify-setup', mfaSetupLimiter, authenticateToken, async (req, res) => {
    try {
      const { secret, token } = req.body;

      if (!secret || !token) {
        return res.status(400).json({ error: 'Secret and token are required' });
      }

      // Verify the token matches the secret
      const isValid = mfaService.verifyToken(token, secret);
      if (!isValid) {
        return res.status(400).json({ error: 'Invalid verification code' });
      }

      // Generate backup codes
      const { plainCodes, hashedCodes } = mfaService.generateBackupCodes();

      // Enable MFA
      await mfaService.enableMFA(req.user.id, secret, hashedCodes);

      res.json({
        success: true,
        message: 'MFA enabled successfully',
        backupCodes: plainCodes,
        warning: 'Save these backup codes securely. They will not be shown again!'
      });
    } catch (error) {
      console.error('Error verifying MFA setup:', error);
      res.status(500).json({ error: 'Failed to enable MFA' });
    }
  });

  /**
   * POST /api/mfa/disable
   * Disable MFA (requires current password or MFA code)
   */
  router.post('/disable', mfaLimiter, authenticateToken, async (req, res) => {
    try {
      const { token, password } = req.body;

      // Check if MFA is enabled
      const status = await mfaService.getMFAStatus(req.user.id);
      if (!status.enabled) {
        return res.status(400).json({ error: 'MFA is not enabled' });
      }

      // Verify with MFA token
      if (token) {
        const secret = await mfaService.getUserMFASecret(req.user.id);
        const isValid = mfaService.verifyToken(token, secret);
        if (!isValid) {
          // Try as backup code
          const isBackupValid = await mfaService.verifyBackupCode(req.user.id, token);
          if (!isBackupValid) {
            return res.status(400).json({ error: 'Invalid verification code' });
          }
        }
      } else if (password) {
        // Verify with password (for account recovery)
        const user = await dbGet('SELECT password_hash FROM users WHERE id = ?', [req.user.id]);

        if (!user || !bcrypt.compareSync(password, user.password_hash)) {
          return res.status(400).json({ error: 'Invalid password' });
        }
      } else {
        return res.status(400).json({ error: 'Token or password required to disable MFA' });
      }

      // Disable MFA
      await mfaService.disableMFA(req.user.id);

      res.json({
        success: true,
        message: 'MFA disabled successfully'
      });
    } catch (error) {
      console.error('Error disabling MFA:', error);
      res.status(500).json({ error: 'Failed to disable MFA' });
    }
  });

  /**
   * POST /api/mfa/regenerate-codes
   * Generate new backup codes (invalidates old ones)
   */
  router.post('/regenerate-codes', mfaLimiter, authenticateToken, async (req, res) => {
    try {
      const { token } = req.body;

      if (!token) {
        return res.status(400).json({ error: 'MFA token required' });
      }

      // Verify MFA token
      const secret = await mfaService.getUserMFASecret(req.user.id);
      if (!secret) {
        return res.status(400).json({ error: 'MFA is not enabled' });
      }

      const isValid = mfaService.verifyToken(token, secret);
      if (!isValid) {
        return res.status(400).json({ error: 'Invalid verification code' });
      }

      // Generate new codes
      const plainCodes = await mfaService.regenerateBackupCodes(req.user.id);

      res.json({
        success: true,
        backupCodes: plainCodes,
        warning: 'Save these backup codes securely. Old codes are now invalid!'
      });
    } catch (error) {
      console.error('Error regenerating backup codes:', error);
      res.status(500).json({ error: 'Failed to regenerate backup codes' });
    }
  });

  return router;
}

// Export default router for backwards compatibility with index.js
module.exports = createMfaRouter();
// Export factory function for testing
module.exports.createMfaRouter = createMfaRouter;
