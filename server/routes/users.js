/**
 * Users Routes
 *
 * API endpoints for user management (admin only)
 */

const express = require('express');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');

/**
 * Default dependencies - used when route is required directly
 */
const defaultDependencies = {
  db: () => require('../database'),
  auth: () => require('../auth'),
  unlockService: () => require('../services/unlockService'),
};

/**
 * Create users routes with injectable dependencies
 * @param {Object} deps - Dependencies (for testing)
 * @param {Object} deps.db - Database module
 * @param {Object} deps.auth - Auth module
 * @param {Object} deps.unlockService - Unlock service module
 * @returns {express.Router}
 */
function createUsersRouter(deps = {}) {
  const router = express.Router();

  // Resolve dependencies (use provided or defaults)
  const db = deps.db || defaultDependencies.db();
  const auth = deps.auth || defaultDependencies.auth();
  const unlockService = deps.unlockService || defaultDependencies.unlockService();

  const {
    authenticateToken,
    requireAdmin,
    clearFailedAttempts,
    getLockedAccounts,
    isAccountLocked,
    getLockoutRemaining,
    validatePassword,
    getFailedAttemptsInfo
  } = auth;

  const { disableAccount, enableAccount } = unlockService;

  // SECURITY: Rate limiting for user management endpoints
  const userLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 30, // 30 requests per minute per IP
    message: { error: 'Too many requests. Please slow down.' },
    standardHeaders: true,
    legacyHeaders: false,
  });

  const userWriteLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 10, // 10 user modifications per minute
    message: { error: 'Too many user management operations. Please slow down.' },
    standardHeaders: true,
    legacyHeaders: false,
  });

  /**
   * GET /api/users
   * Get all users (admin only)
   */
  router.get('/', userLimiter, authenticateToken, requireAdmin, (req, res) => {
    db.all(
      'SELECT id, username, email, is_admin, account_disabled, disabled_at, disabled_reason, created_at FROM users ORDER BY created_at DESC',
      [],
      (err, users) => {
        if (err) {
          return res.status(500).json({ error: 'Internal server error' });
        }
        // Add lockout status for each user
        const usersWithLockout = users.map(user => ({
          ...user,
          account_disabled: !!user.account_disabled,
          is_locked: isAccountLocked(user.username),
          lockout_remaining: getLockoutRemaining(user.username)
        }));
        res.json(usersWithLockout);
      }
    );
  });

  /**
   * GET /api/users/:id
   * Get single user (admin only)
   */
  router.get('/:id', userLimiter, authenticateToken, requireAdmin, (req, res) => {
    db.get(
      'SELECT id, username, email, is_admin, created_at FROM users WHERE id = ?',
      [req.params.id],
      (err, user) => {
        if (err) {
          return res.status(500).json({ error: 'Internal server error' });
        }
        if (!user) {
          return res.status(404).json({ error: 'User not found' });
        }
        res.json(user);
      }
    );
  });

  /**
   * GET /api/users/:id/details
   * Get detailed user info for troubleshooting (admin only)
   * Includes: account status, lockout info, listening stats, activity
   */
  router.get('/:id/details', userLimiter, authenticateToken, requireAdmin, async (req, res) => {
    const userId = parseInt(req.params.id);

    try {
      // Get basic user info
      const user = await new Promise((resolve, reject) => {
        db.get(
          `SELECT id, username, email, is_admin, account_disabled, disabled_at,
                  disabled_reason, created_at FROM users WHERE id = ?`,
          [userId],
          (err, row) => {
            if (err) reject(err);
            else resolve(row);
          }
        );
      });

      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      // Get lockout/failed attempts info
      const loginAttempts = getFailedAttemptsInfo(user.username);

      // Get listening statistics
      const listeningStats = await new Promise((resolve, reject) => {
        db.get(
          `SELECT
            COUNT(DISTINCT audiobook_id) as booksStarted,
            SUM(CASE WHEN completed = 1 THEN 1 ELSE 0 END) as booksCompleted,
            COALESCE(SUM(position), 0) as totalListenTime,
            MAX(updated_at) as lastActivity
          FROM playback_progress WHERE user_id = ?`,
          [userId],
          (err, row) => {
            if (err) reject(err);
            else resolve(row || { booksStarted: 0, booksCompleted: 0, totalListenTime: 0, lastActivity: null });
          }
        );
      });

      // Get recent activity (last 10 books listened to)
      const recentActivity = await new Promise((resolve, reject) => {
        db.all(
          `SELECT
            pp.audiobook_id,
            a.title,
            a.author,
            pp.position,
            pp.completed,
            pp.updated_at as lastPlayed
          FROM playback_progress pp
          JOIN audiobooks a ON pp.audiobook_id = a.id
          WHERE pp.user_id = ?
          ORDER BY pp.updated_at DESC
          LIMIT 10`,
          [userId],
          (err, rows) => {
            if (err) reject(err);
            else resolve(rows || []);
          }
        );
      });

      // Get API keys count
      const apiKeysCount = await new Promise((resolve, reject) => {
        db.get(
          'SELECT COUNT(*) as count FROM api_keys WHERE user_id = ?',
          [userId],
          (err, row) => {
            if (err) reject(err);
            else resolve(row?.count || 0);
          }
        );
      });

      res.json({
        user: {
          ...user,
          account_disabled: !!user.account_disabled
        },
        loginAttempts,
        listeningStats: {
          booksStarted: listeningStats.booksStarted || 0,
          booksCompleted: listeningStats.booksCompleted || 0,
          totalListenTimeSeconds: listeningStats.totalListenTime || 0,
          lastActivity: listeningStats.lastActivity
        },
        recentActivity,
        apiKeysCount
      });
    } catch (error) {
      console.error('Error fetching user details:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * POST /api/users
   * Create new user (admin only)
   */
  router.post('/', userWriteLimiter, authenticateToken, requireAdmin, (req, res) => {
    const { username, password, email, is_admin = 0 } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    // SECURITY: Validate password complexity
    const passwordErrors = validatePassword(password);
    if (passwordErrors.length > 0) {
      return res.status(400).json({ error: passwordErrors.join('. ') });
    }

    const passwordHash = bcrypt.hashSync(password, 10);

    db.run(
      'INSERT INTO users (username, password_hash, email, is_admin) VALUES (?, ?, ?, ?)',
      [username, passwordHash, email || null, is_admin ? 1 : 0],
      function (err) {
        if (err) {
          if (err.message.includes('UNIQUE')) {
            return res.status(400).json({ error: 'Username already exists' });
          }
          return res.status(500).json({ error: 'Internal server error' });
        }
        res.status(201).json({
          message: 'User created successfully',
          user: { id: this.lastID, username, email, is_admin: is_admin ? 1 : 0 }
        });
      }
    );
  });

  /**
   * PUT /api/users/:id
   * Update user (admin only)
   */
  router.put('/:id', userWriteLimiter, authenticateToken, requireAdmin, (req, res) => {
    const { username, password, email, is_admin } = req.body;
    const updates = [];
    const params = [];

    if (username !== undefined) {
      updates.push('username = ?');
      params.push(username);
    }

    if (password !== undefined && password !== '') {
      updates.push('password_hash = ?');
      params.push(bcrypt.hashSync(password, 10));
    }

    if (email !== undefined) {
      updates.push('email = ?');
      params.push(email || null);
    }

    if (is_admin !== undefined) {
      updates.push('is_admin = ?');
      params.push(is_admin ? 1 : 0);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    params.push(req.params.id);

    db.run(
      `UPDATE users SET ${updates.join(', ')} WHERE id = ?`,
      params,
      function (err) {
        if (err) {
          if (err.message.includes('UNIQUE')) {
            return res.status(400).json({ error: 'Username already exists' });
          }
          return res.status(500).json({ error: 'Internal server error' });
        }
        if (this.changes === 0) {
          return res.status(404).json({ error: 'User not found' });
        }
        res.json({ message: 'User updated successfully' });
      }
    );
  });

  /**
   * DELETE /api/users/:id
   * Delete user (admin only)
   */
  router.delete('/:id', userWriteLimiter, authenticateToken, requireAdmin, (req, res) => {
    const userId = parseInt(req.params.id);

    // Prevent deleting yourself
    if (userId === req.user.id) {
      return res.status(400).json({ error: 'Cannot delete your own account' });
    }

    // Check if this is the last admin user
    db.get(
      'SELECT COUNT(*) as admin_count FROM users WHERE is_admin = 1',
      [],
      (err, result) => {
        if (err) {
          return res.status(500).json({ error: 'Internal server error' });
        }

        db.get('SELECT is_admin FROM users WHERE id = ?', [userId], (err, user) => {
          if (err) {
            return res.status(500).json({ error: 'Internal server error' });
          }

          if (!user) {
            return res.status(404).json({ error: 'User not found' });
          }

          if (user.is_admin && result.admin_count <= 1) {
            return res.status(400).json({ error: 'Cannot delete the last admin user' });
          }

          // Delete user's progress, API keys, etc.
          db.serialize(() => {
            db.run('DELETE FROM playback_progress WHERE user_id = ?', [userId]);
            db.run('DELETE FROM api_keys WHERE user_id = ?', [userId]);
            db.run('DELETE FROM users WHERE id = ?', [userId], function (err) {
              if (err) {
                return res.status(500).json({ error: 'Internal server error' });
              }
              if (this.changes === 0) {
                return res.status(404).json({ error: 'User not found' });
              }
              res.json({ message: 'User deleted successfully' });
            });
          });
        });
      }
    );
  });

  /**
   * GET /api/users/locked/list
   * Get all currently locked accounts (admin only)
   */
  router.get('/locked/list', userLimiter, authenticateToken, requireAdmin, (req, res) => {
    const lockedAccounts = getLockedAccounts();
    res.json(lockedAccounts);
  });

  /**
   * POST /api/users/:id/unlock
   * Unlock a user account - clear in-memory lockout (admin only)
   */
  router.post('/:id/unlock', userWriteLimiter, authenticateToken, requireAdmin, (req, res) => {
    const userId = parseInt(req.params.id);

    db.get('SELECT username FROM users WHERE id = ?', [userId], (err, user) => {
      if (err) {
        return res.status(500).json({ error: 'Internal server error' });
      }
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      // Clear the in-memory lockout
      clearFailedAttempts(user.username);
      console.log(`Admin ${req.user.username} unlocked account: ${user.username}`);

      res.json({ message: `Account ${user.username} unlocked successfully` });
    });
  });

  /**
   * POST /api/users/:id/disable
   * Disable a user account (admin only)
   */
  router.post('/:id/disable', userWriteLimiter, authenticateToken, requireAdmin, async (req, res) => {
    const userId = parseInt(req.params.id);
    const { reason } = req.body;

    // Prevent disabling yourself
    if (userId === req.user.id) {
      return res.status(400).json({ error: 'Cannot disable your own account' });
    }

    try {
      await disableAccount(userId, reason || null);

      // Get username for logging
      db.get('SELECT username FROM users WHERE id = ?', [userId], (err, user) => {
        if (!err && user) {
          console.log(`Admin ${req.user.username} disabled account: ${user.username}${reason ? ` (reason: ${reason})` : ''}`);
        }
      });

      res.json({ message: 'Account disabled successfully' });
    } catch (_error) {
      res.status(400).json({ error: 'Internal server error' });
    }
  });

  /**
   * POST /api/users/:id/enable
   * Enable a user account (admin only)
   */
  router.post('/:id/enable', userWriteLimiter, authenticateToken, requireAdmin, async (req, res) => {
    const userId = parseInt(req.params.id);

    try {
      await enableAccount(userId);

      // Get username for logging
      db.get('SELECT username FROM users WHERE id = ?', [userId], (err, user) => {
        if (!err && user) {
          console.log(`Admin ${req.user.username} enabled account: ${user.username}`);
        }
      });

      res.json({ message: 'Account enabled successfully' });
    } catch (_error) {
      res.status(400).json({ error: 'Internal server error' });
    }
  });

  return router;
}

// Export default router for backwards compatibility with index.js
module.exports = createUsersRouter();
// Export factory function for testing
module.exports.createUsersRouter = createUsersRouter;
