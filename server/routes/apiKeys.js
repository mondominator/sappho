const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const db = require('../database');
const { authenticateToken } = require('../auth');

// Generate a secure API key
function generateApiKey() {
  const key = crypto.randomBytes(32).toString('hex');
  const fullKey = `sapho_${key}`;
  const prefix = key.substring(0, 8);
  const hash = crypto.createHash('sha256').update(fullKey).digest('hex');

  return {
    key: fullKey,
    prefix: `sapho_${prefix}`,
    hash
  };
}

// Get all API keys for the current user
router.get('/', authenticateToken, (req, res) => {
  db.all(
    `SELECT id, name, key_prefix, permissions, last_used_at, expires_at, is_active, created_at
     FROM api_keys
     WHERE user_id = ?
     ORDER BY created_at DESC`,
    [req.user.id],
    (err, keys) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      res.json(keys);
    }
  );
});

// Create a new API key
router.post('/', authenticateToken, (req, res) => {
  const { name, permissions, expires_in_days } = req.body;

  if (!name || name.trim().length === 0) {
    return res.status(400).json({ error: 'Name is required' });
  }

  const { key, prefix, hash } = generateApiKey();
  const permissionsStr = permissions || 'read';

  let expiresAt = null;
  if (expires_in_days && expires_in_days > 0) {
    const expiry = new Date();
    expiry.setDate(expiry.getDate() + expires_in_days);
    expiresAt = expiry.toISOString();
  }

  db.run(
    `INSERT INTO api_keys (name, key_hash, key_prefix, user_id, permissions, expires_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [name, hash, prefix, req.user.id, permissionsStr, expiresAt],
    function (err) {
      if (err) {
        if (err.message.includes('UNIQUE')) {
          return res.status(409).json({ error: 'An API key with this hash already exists' });
        }
        return res.status(500).json({ error: err.message });
      }

      // Return the key ONLY this one time
      res.json({
        id: this.lastID,
        name,
        key,  // Full key - only shown once!
        key_prefix: prefix,
        permissions: permissionsStr,
        expires_at: expiresAt,
        created_at: new Date().toISOString(),
        message: 'Save this key securely - it will not be shown again!'
      });
    }
  );
});

// Update an API key (name, permissions, active status)
router.put('/:id', authenticateToken, (req, res) => {
  const { name, permissions, is_active } = req.body;

  const updates = [];
  const params = [];

  if (name !== undefined) {
    updates.push('name = ?');
    params.push(name);
  }

  if (permissions !== undefined) {
    updates.push('permissions = ?');
    params.push(permissions);
  }

  if (is_active !== undefined) {
    updates.push('is_active = ?');
    params.push(is_active ? 1 : 0);
  }

  if (updates.length === 0) {
    return res.status(400).json({ error: 'No fields to update' });
  }

  params.push(req.params.id);
  params.push(req.user.id);

  db.run(
    `UPDATE api_keys
     SET ${updates.join(', ')}
     WHERE id = ? AND user_id = ?`,
    params,
    function (err) {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      if (this.changes === 0) {
        return res.status(404).json({ error: 'API key not found' });
      }
      res.json({ message: 'API key updated successfully' });
    }
  );
});

// Delete an API key
router.delete('/:id', authenticateToken, (req, res) => {
  db.run(
    'DELETE FROM api_keys WHERE id = ? AND user_id = ?',
    [req.params.id, req.user.id],
    function (err) {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      if (this.changes === 0) {
        return res.status(404).json({ error: 'API key not found' });
      }
      res.json({ message: 'API key deleted successfully' });
    }
  );
});

module.exports = router;
