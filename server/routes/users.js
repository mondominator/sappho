const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const db = require('../database');
const bcrypt = require('bcryptjs');
const { authenticateToken, requireAdmin } = require('../auth');

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

// Get all users (admin only)
router.get('/', userLimiter, authenticateToken, requireAdmin, (req, res) => {
  db.all(
    'SELECT id, username, email, is_admin, created_at FROM users ORDER BY created_at DESC',
    [],
    (err, users) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      res.json(users);
    }
  );
});

// Get single user (admin only)
router.get('/:id', userLimiter, authenticateToken, requireAdmin, (req, res) => {
  db.get(
    'SELECT id, username, email, is_admin, created_at FROM users WHERE id = ?',
    [req.params.id],
    (err, user) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }
      res.json(user);
    }
  );
});

// Create new user (admin only)
router.post('/', userWriteLimiter, authenticateToken, requireAdmin, (req, res) => {
  const { username, password, email, is_admin = 0 } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
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
        return res.status(500).json({ error: err.message });
      }
      res.status(201).json({
        message: 'User created successfully',
        user: { id: this.lastID, username, email, is_admin: is_admin ? 1 : 0 }
      });
    }
  );
});

// Update user (admin only)
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
        return res.status(500).json({ error: err.message });
      }
      if (this.changes === 0) {
        return res.status(404).json({ error: 'User not found' });
      }
      res.json({ message: 'User updated successfully' });
    }
  );
});

// Delete user (admin only)
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
        return res.status(500).json({ error: err.message });
      }

      db.get('SELECT is_admin FROM users WHERE id = ?', [userId], (err, user) => {
        if (err) {
          return res.status(500).json({ error: err.message });
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
              return res.status(500).json({ error: err.message });
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

module.exports = router;
