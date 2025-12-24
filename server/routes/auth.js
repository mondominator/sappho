const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');
const db = require('../database');
const { register, login, logout, authenticateToken, validatePassword, invalidateUserTokens } = require('../auth');
const mfaService = require('../services/mfaService');

const JWT_SECRET = process.env.JWT_SECRET;

// SECURITY: Rate limiting for authentication endpoints to prevent brute-force attacks
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 attempts per window
  message: { error: 'Too many login attempts. Please try again in 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true, // Don't count successful logins
});

const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3, // 3 registrations per hour per IP
  message: { error: 'Too many registration attempts. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// SECURITY: Check if registration is allowed
function isRegistrationAllowed(callback) {
  // Check for REGISTRATION_DISABLED env var
  if (process.env.REGISTRATION_DISABLED === 'true') {
    return callback(false, 'Registration is disabled');
  }

  // Check for invite code requirement
  if (process.env.REQUIRE_INVITE_CODE === 'true') {
    return callback(true, null); // Will be validated with invite code
  }

  // Check if open registration is allowed (default: allow if no users exist yet)
  db.get('SELECT COUNT(*) as count FROM users', [], (err, row) => {
    if (err) {
      return callback(false, 'Database error');
    }

    // If no users, always allow (first user setup)
    if (row.count === 0) {
      return callback(true, null);
    }

    // Check ALLOW_OPEN_REGISTRATION setting (default: false for security)
    const allowOpen = process.env.ALLOW_OPEN_REGISTRATION === 'true';
    if (!allowOpen) {
      return callback(false, 'Registration is not open. Contact an administrator.');
    }

    callback(true, null);
  });
}

// Register endpoint
router.post('/register', registerLimiter, async (req, res) => {
  try {
    const { username, password, email, inviteCode } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    // SECURITY: Check password requirements before registration check
    const passwordErrors = validatePassword(password);
    if (passwordErrors.length > 0) {
      return res.status(400).json({ error: passwordErrors.join('. ') });
    }

    // SECURITY: Check if registration is allowed
    isRegistrationAllowed((allowed, reason) => {
      if (!allowed) {
        return res.status(403).json({ error: reason });
      }

      // If invite code is required, validate it
      if (process.env.REQUIRE_INVITE_CODE === 'true') {
        if (!inviteCode) {
          return res.status(400).json({ error: 'Invite code is required' });
        }
        // For now, just check against env var. In production, use a database table
        const validCodes = (process.env.INVITE_CODES || '').split(',').map(c => c.trim());
        if (!validCodes.includes(inviteCode)) {
          return res.status(403).json({ error: 'Invalid invite code' });
        }
      }

      // Proceed with registration
      register(username, password, email)
        .then(user => {
          res.status(201).json({ message: 'User registered successfully', user });
        })
        .catch(error => {
          res.status(400).json({ error: error.message });
        });
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Login endpoint
router.post('/login', loginLimiter, async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    const result = await login(username, password);
    res.json(result);
  } catch (error) {
    res.status(401).json({ error: error.message });
  }
});

// SECURITY: Logout endpoint to invalidate current token
router.post('/logout', authenticateToken, (req, res) => {
  try {
    if (req.token) {
      logout(req.token);
    }
    res.json({ message: 'Logged out successfully' });
  } catch (_error) {
    res.status(500).json({ error: 'Failed to logout' });
  }
});

// SECURITY: Logout from all devices by invalidating all tokens
router.post('/logout-all', authenticateToken, (req, res) => {
  try {
    invalidateUserTokens(req.user.id);
    res.json({ message: 'Logged out from all devices successfully' });
  } catch (_error) {
    res.status(500).json({ error: 'Failed to logout from all devices' });
  }
});

// MFA verification endpoint
router.post('/verify-mfa', loginLimiter, async (req, res) => {
  try {
    const { mfa_token, token: mfaCode } = req.body;

    if (!mfa_token || !mfaCode) {
      return res.status(400).json({ error: 'MFA token and verification code are required' });
    }

    // Verify the MFA token
    let decoded;
    try {
      decoded = jwt.verify(mfa_token, JWT_SECRET);
    } catch (_err) {
      return res.status(403).json({ error: 'MFA session expired. Please login again.' });
    }

    // Check that this is an MFA pending token
    if (!decoded.mfa_pending) {
      return res.status(400).json({ error: 'Invalid MFA token' });
    }

    // Get user's MFA secret
    const secret = await mfaService.getUserMFASecret(decoded.id);
    if (!secret) {
      return res.status(400).json({ error: 'MFA is not enabled for this account' });
    }

    // Verify the TOTP code
    let isValid = mfaService.verifyToken(mfaCode, secret);

    // If TOTP verification fails, try as backup code
    if (!isValid) {
      isValid = await mfaService.verifyBackupCode(decoded.id, mfaCode);
    }

    if (!isValid) {
      return res.status(400).json({ error: 'Invalid verification code' });
    }

    // Get user info for response
    const user = await new Promise((resolve, reject) => {
      db.get(
        'SELECT id, username, is_admin, must_change_password FROM users WHERE id = ?',
        [decoded.id],
        (err, row) => {
          if (err) reject(err);
          else resolve(row);
        }
      );
    });

    if (!user) {
      return res.status(400).json({ error: 'User not found' });
    }

    // Issue full session token
    const token = jwt.sign(
      { id: user.id, username: user.username },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        is_admin: user.is_admin
      },
      must_change_password: !!user.must_change_password
    });
  } catch (error) {
    console.error('MFA verification error:', error);
    res.status(500).json({ error: 'MFA verification failed' });
  }
});

module.exports = router;
