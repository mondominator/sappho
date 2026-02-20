const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const db = require('./database');
const { createDbHelpers } = require('./utils/db');
const { dbGet, dbRun } = createDbHelpers(db);

// SECURITY: JWT_SECRET must be explicitly configured - no default fallback
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error('FATAL: JWT_SECRET environment variable is not set.');
  console.error('Please set a strong secret: export JWT_SECRET=$(openssl rand -base64 32)');
  process.exit(1);
}

if (JWT_SECRET.length < 32) {
  console.error('FATAL: JWT_SECRET must be at least 32 characters long.');
  process.exit(1);
}

// SECURITY: Token blacklist for logout/revocation (in-memory, clears on restart)
// For production, consider using Redis for persistence across restarts
const tokenBlacklist = new Map();

// Clean up expired tokens from blacklist every hour
// .unref() allows Node to exit even if this timer is still active (fixes Jest warning)
setInterval(() => {
  const now = Date.now();
  for (const [tokenHash, expiry] of tokenBlacklist.entries()) {
    if (expiry < now) {
      tokenBlacklist.delete(tokenHash);
    }
  }
}, 60 * 60 * 1000).unref();

// SECURITY: Account lockout tracking (in-memory)
const failedAttempts = new Map(); // username -> { count, lockedUntil }
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes

// SECURITY: Dummy hash for constant-time comparison (prevents timing attacks)
const DUMMY_HASH = bcrypt.hashSync('dummy-password-for-timing-safety', 10);

/**
 * Check if a token is blacklisted
 */
function isTokenBlacklisted(token) {
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  return tokenBlacklist.has(tokenHash);
}

/**
 * Add a token to the blacklist
 */
function blacklistToken(token, expiresAt) {
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  tokenBlacklist.set(tokenHash, expiresAt);
}

/**
 * Invalidate all tokens for a user by adding a marker
 * This is checked during token verification
 */
function invalidateUserTokens(userId) {
  // Store the invalidation timestamp
  const key = `user_invalidation_${userId}`;
  tokenBlacklist.set(key, Date.now());
}

/**
 * Check if account is locked
 */
function isAccountLocked(username) {
  const record = failedAttempts.get(username);
  if (!record) return false;
  if (record.lockedUntil && record.lockedUntil > Date.now()) {
    return true;
  }
  return false;
}

/**
 * Record a failed login attempt
 */
function recordFailedAttempt(username) {
  const record = failedAttempts.get(username) || { count: 0, lockedUntil: null };
  record.count++;
  if (record.count >= MAX_FAILED_ATTEMPTS) {
    record.lockedUntil = Date.now() + LOCKOUT_DURATION_MS;
    console.warn(`SECURITY: Account "${username}" locked for 15 minutes after ${MAX_FAILED_ATTEMPTS} failed attempts`);
  }
  failedAttempts.set(username, record);
}

/**
 * Clear failed attempts on successful login
 */
function clearFailedAttempts(username) {
  failedAttempts.delete(username);
}

/**
 * Get remaining lockout time in seconds
 */
function getLockoutRemaining(username) {
  const record = failedAttempts.get(username);
  if (!record || !record.lockedUntil) return 0;
  const remaining = Math.ceil((record.lockedUntil - Date.now()) / 1000);
  return remaining > 0 ? remaining : 0;
}

/**
 * Get all currently locked accounts
 * Returns array of { username, lockedUntil, remainingSeconds }
 */
function getLockedAccounts() {
  const locked = [];
  const now = Date.now();
  for (const [username, record] of failedAttempts.entries()) {
    if (record.lockedUntil && record.lockedUntil > now) {
      locked.push({
        username,
        lockedUntil: new Date(record.lockedUntil).toISOString(),
        remainingSeconds: Math.ceil((record.lockedUntil - now) / 1000)
      });
    }
  }
  return locked;
}

/**
 * Get failed attempts info for a username
 * Returns { count, lockedUntil, isLocked, remainingSeconds }
 */
function getFailedAttemptsInfo(username) {
  const record = failedAttempts.get(username);
  if (!record) {
    return { count: 0, lockedUntil: null, isLocked: false, remainingSeconds: 0 };
  }
  const now = Date.now();
  const isLocked = record.lockedUntil && record.lockedUntil > now;
  const remainingSeconds = isLocked ? Math.ceil((record.lockedUntil - now) / 1000) : 0;
  return {
    count: record.count || 0,
    lockedUntil: record.lockedUntil ? new Date(record.lockedUntil).toISOString() : null,
    isLocked,
    remainingSeconds
  };
}

// Middleware to verify JWT token or API key
function authenticateToken(req, res, next) {
  // SECURITY: Only accept token from Authorization header, not query string
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  // Check if it's an API key (starts with 'sapho_')
  if (token && token.startsWith('sapho_')) {
    return authenticateApiKey(token, req, res, next);
  }

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  return verifyToken(token, req, res, next);
}

// Middleware for media endpoints (covers, streaming) that need query string tokens
// This is necessary because <img> and <audio> tags cannot send Authorization headers
function authenticateMediaToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  let token = authHeader && authHeader.split(' ')[1];

  // Fall back to query string token for media requests
  if (!token && req.query.token) {
    token = req.query.token;
  }

  // Check if it's an API key (starts with 'sapho_')
  if (token && token.startsWith('sapho_')) {
    return authenticateApiKey(token, req, res, next);
  }

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  return verifyToken(token, req, res, next);
}

// Shared token verification logic
async function verifyToken(token, req, res, next) {

  // SECURITY: Check if token is blacklisted (logged out)
  if (isTokenBlacklisted(token)) {
    return res.status(403).json({ error: 'Token has been revoked' });
  }

  let decoded;
  try {
    decoded = jwt.verify(token, JWT_SECRET);
  } catch (_err) {
    return res.status(403).json({ error: 'Invalid or expired token' });
  }

  // SECURITY: Check if user's tokens were invalidated after this token was issued
  const invalidationKey = `user_invalidation_${decoded.id}`;
  const invalidationTime = tokenBlacklist.get(invalidationKey);
  if (invalidationTime && decoded.iat * 1000 < invalidationTime) {
    return res.status(403).json({ error: 'Token has been invalidated. Please log in again.' });
  }

  try {
    // SECURITY: Fetch current user state from database instead of trusting JWT claims
    const user = await dbGet('SELECT id, username, is_admin FROM users WHERE id = ?', [decoded.id]);
    if (!user) {
      return res.status(403).json({ error: 'User not found' });
    }

    // Use fresh data from DB, not stale JWT claims
    req.user = {
      id: user.id,
      username: user.username,
      is_admin: user.is_admin
    };
    req.token = token;
    next();
  } catch (_err) {
    return res.status(500).json({ error: 'Database error' });
  }
}

// Helper function to authenticate API keys
async function authenticateApiKey(apiKey, req, res, next) {
  // Hash the provided API key
  const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex');

  try {
    // Look up the API key in the database
    const key = await dbGet(
      'SELECT * FROM api_keys WHERE key_hash = ? AND is_active = 1',
      [keyHash]
    );

    if (!key) {
      return res.status(403).json({ error: 'Invalid API key' });
    }

    // Check if key is expired
    if (key.expires_at && new Date(key.expires_at) < new Date()) {
      return res.status(403).json({ error: 'API key has expired' });
    }

    // Update last_used_at timestamp (fire-and-forget)
    dbRun(
      'UPDATE api_keys SET last_used_at = CURRENT_TIMESTAMP WHERE id = ?',
      [key.id]
    ).catch(updateErr => {
      console.error('Failed to update API key last_used_at:', updateErr);
    });

    // Get user information
    const user = await dbGet('SELECT id, username, is_admin FROM users WHERE id = ?', [key.user_id]);
    if (!user) {
      return res.status(403).json({ error: 'Invalid API key user' });
    }

    // Set user on request object
    req.user = { id: user.id, username: user.username, is_admin: user.is_admin };
    req.apiKey = key;
    next();
  } catch (_err) {
    return res.status(500).json({ error: 'Database error' });
  }
}

// Middleware to check admin privileges
function requireAdmin(req, res, next) {
  if (!req.user || !req.user.is_admin) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

// SECURITY: Password complexity validation
function validatePassword(password) {
  const errors = [];
  if (password.length < 8) {
    errors.push('Password must be at least 8 characters long');
  }
  if (!/[A-Z]/.test(password)) {
    errors.push('Password must contain at least one uppercase letter');
  }
  if (!/[a-z]/.test(password)) {
    errors.push('Password must contain at least one lowercase letter');
  }
  if (!/[0-9]/.test(password)) {
    errors.push('Password must contain at least one number');
  }
  if (!/[^A-Za-z0-9]/.test(password)) {
    errors.push('Password must contain at least one special character');
  }
  return errors;
}

// Register new user
async function register(username, password, email = null) {
  // SECURITY: Validate password complexity
  const passwordErrors = validatePassword(password);
  if (passwordErrors.length > 0) {
    throw new Error(passwordErrors.join('. '));
  }

  // Hash password
  const passwordHash = bcrypt.hashSync(password, 10);

  try {
    const { lastID } = await dbRun(
      'INSERT INTO users (username, password_hash, email) VALUES (?, ?, ?)',
      [username, passwordHash, email]
    );
    return { id: lastID, username, email };
  } catch (err) {
    if (err.message.includes('UNIQUE')) {
      throw new Error('Username already exists');
    }
    throw err;
  }
}

// Login user
async function login(username, password) {
  // SECURITY: Check for account lockout
  if (isAccountLocked(username)) {
    const remaining = getLockoutRemaining(username);
    throw new Error(`Account is locked. Try again in ${remaining} seconds.`);
  }

  const user = await dbGet(
    'SELECT id, username, password_hash, is_admin, must_change_password, mfa_enabled, account_disabled FROM users WHERE username = ?',
    [username]
  );

  // SECURITY: Always perform bcrypt comparison to prevent timing attacks
  const hashToCompare = user ? user.password_hash : DUMMY_HASH;
  const isValid = bcrypt.compareSync(password, hashToCompare);

  if (!user || !isValid) {
    // Record failed attempt
    recordFailedAttempt(username);
    throw new Error('Invalid username or password');
  }

  // SECURITY: Check if account is disabled by admin
  if (user.account_disabled) {
    throw new Error('Your account has been disabled. Please contact an administrator.');
  }

  // Clear failed attempts on successful login
  clearFailedAttempts(username);

  // SECURITY: Check if MFA is enabled
  if (user.mfa_enabled) {
    // Return a temporary token that requires MFA verification
    const mfaToken = jwt.sign(
      { id: user.id, username: user.username, mfa_pending: true },
      JWT_SECRET,
      { expiresIn: '5m' } // Short expiry for MFA challenge
    );

    return {
      mfa_required: true,
      mfa_token: mfaToken,
      message: 'MFA verification required'
    };
  }

  // SECURITY: Don't include is_admin in JWT - fetch from DB on each request
  const token = jwt.sign(
    { id: user.id, username: user.username },
    JWT_SECRET,
    { expiresIn: '7d' }
  );

  // SECURITY: Include must_change_password flag in response
  return {
    token,
    user: {
      id: user.id,
      username: user.username,
      is_admin: user.is_admin
    },
    must_change_password: !!user.must_change_password
  };
}

// Logout - invalidate the current token
function logout(token) {
  try {
    const decoded = jwt.decode(token);
    if (decoded && decoded.exp) {
      // Add to blacklist until expiry
      blacklistToken(token, decoded.exp * 1000);
      return true;
    }
  } catch (_e) {
    // Token decode failed, ignore
  }
  return false;
}

// Generate a secure random password
function _generateSecurePassword(length = 16) {
  const charset = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*';
  const randomBytes = crypto.randomBytes(length);
  let password = '';
  for (let i = 0; i < length; i++) {
    password += charset[randomBytes[i] % charset.length];
  }
  return password;
}

// Create default admin user if no users exist
async function createDefaultAdmin() {
  const row = await dbGet('SELECT COUNT(*) as count FROM users', []);
  if (row.count === 0) {
    // Default admin credentials - user must change password on first login
    const defaultPassword = 'admin';
    const passwordHash = bcrypt.hashSync(defaultPassword, 10);
    // SECURITY: Set must_change_password=1 to force password change on first login
    await dbRun(
      'INSERT INTO users (username, password_hash, is_admin, must_change_password) VALUES (?, ?, 1, 1)',
      ['admin', passwordHash]
    );
    console.log('');
    console.log('╔════════════════════════════════════════════════════════════╗');
    console.log('║           DEFAULT ADMIN ACCOUNT CREATED                    ║');
    console.log('╠════════════════════════════════════════════════════════════╣');
    console.log('║  Username: admin                                           ║');
    console.log('║  Password: admin                                           ║');
    console.log('╠════════════════════════════════════════════════════════════╣');
    console.log('║  ⚠️  You will be required to change this on first login!  ║');
    console.log('╚════════════════════════════════════════════════════════════╝');
    console.log('');
  }
}

/**
 * Check if a user's tokens have been invalidated after a given token issuance time
 */
function isUserTokenInvalidated(userId, tokenIat) {
  const key = `user_invalidation_${userId}`;
  const invalidationTime = tokenBlacklist.get(key);
  if (invalidationTime && tokenIat * 1000 < invalidationTime) {
    return true;
  }
  return false;
}

module.exports = {
  authenticateToken,
  authenticateMediaToken,
  requireAdmin,
  register,
  login,
  logout,
  createDefaultAdmin,
  validatePassword,
  blacklistToken,
  invalidateUserTokens,
  isTokenBlacklisted,
  isUserTokenInvalidated,
  isAccountLocked,
  getLockoutRemaining,
  clearFailedAttempts,
  getLockedAccounts,
  recordFailedAttempt,
  getFailedAttemptsInfo,
};
