/**
 * Test application setup for integration tests
 * Creates an isolated Express app with in-memory SQLite database
 */

const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'test-secret';

// Create in-memory database
function createTestDatabase() {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(':memory:', (err) => {
      if (err) return reject(err);

      db.serialize(() => {
        // Users table
        db.run(`
          CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            email TEXT,
            display_name TEXT,
            avatar TEXT,
            is_admin INTEGER DEFAULT 0,
            must_change_password INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
          )
        `);

        // Audiobooks table
        db.run(`
          CREATE TABLE IF NOT EXISTS audiobooks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            author TEXT,
            narrator TEXT,
            duration INTEGER,
            file_path TEXT,
            cover_image TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
          )
        `);

        // Progress table
        db.run(`
          CREATE TABLE IF NOT EXISTS playback_progress (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            audiobook_id INTEGER NOT NULL,
            position INTEGER DEFAULT 0,
            completed INTEGER DEFAULT 0,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(user_id, audiobook_id)
          )
        `);

        // API keys table
        db.run(`
          CREATE TABLE IF NOT EXISTS api_keys (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            key_hash TEXT UNIQUE NOT NULL,
            key_prefix TEXT NOT NULL,
            user_id INTEGER NOT NULL,
            permissions TEXT,
            expires_at DATETIME,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
          )
        `, (err) => {
          if (err) return reject(err);
          resolve(db);
        });
      });
    });
  });
}

// Create test user
async function createTestUser(db, { username, password, isAdmin = false }) {
  return new Promise((resolve, reject) => {
    const passwordHash = bcrypt.hashSync(password, 10);
    db.run(
      'INSERT INTO users (username, password_hash, is_admin) VALUES (?, ?, ?)',
      [username, passwordHash, isAdmin ? 1 : 0],
      function(err) {
        if (err) return reject(err);
        resolve({ id: this.lastID, username, isAdmin });
      }
    );
  });
}

// Generate test token
function generateTestToken(user) {
  return jwt.sign(
    { id: user.id, username: user.username },
    JWT_SECRET,
    { expiresIn: '1h' }
  );
}

// Create test Express app
function createTestApp(db) {
  const app = express();
  app.use(cors());
  app.use(express.json());

  // Inject test database into request
  app.use((req, res, next) => {
    req.testDb = db;
    next();
  });

  // Simple auth middleware for tests
  app.use((req, res, next) => {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      try {
        const decoded = jwt.verify(token, JWT_SECRET);
        db.get('SELECT id, username, is_admin FROM users WHERE id = ?', [decoded.id], (err, user) => {
          if (!err && user) {
            req.user = { id: user.id, username: user.username, is_admin: user.is_admin };
          }
          next();
        });
      } catch (err) {
        next();
      }
    } else {
      next();
    }
  });

  // Health check endpoint
  app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
  });

  // Login endpoint
  app.post('/api/auth/login', (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }

    db.get('SELECT * FROM users WHERE username = ?', [username], (err, user) => {
      if (err) return res.status(500).json({ error: 'Database error' });
      if (!user) return res.status(401).json({ error: 'Invalid username or password' });

      const isValid = bcrypt.compareSync(password, user.password_hash);
      if (!isValid) return res.status(401).json({ error: 'Invalid username or password' });

      const token = generateTestToken(user);
      res.json({
        token,
        user: { id: user.id, username: user.username },
        must_change_password: !!user.must_change_password
      });
    });
  });

  // Profile endpoint
  app.get('/api/profile', (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

    db.get('SELECT id, username, email, display_name, is_admin FROM users WHERE id = ?',
      [req.user.id], (err, user) => {
        if (err) return res.status(500).json({ error: 'Database error' });
        if (!user) return res.status(404).json({ error: 'User not found' });
        res.json(user);
      });
  });

  // Audiobooks list endpoint
  app.get('/api/audiobooks', (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

    db.all('SELECT * FROM audiobooks ORDER BY created_at DESC', [], (err, audiobooks) => {
      if (err) return res.status(500).json({ error: 'Database error' });
      res.json(audiobooks);
    });
  });

  // Admin-only middleware helper
  const requireAdmin = (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    if (!req.user.is_admin) return res.status(403).json({ error: 'Admin access required' });
    next();
  };

  // Password validation helper
  const validatePassword = (password) => {
    const errors = [];
    if (password.length < 6) errors.push('Password must be at least 6 characters');
    if (!/[A-Z]/.test(password)) errors.push('Password must contain an uppercase letter');
    if (!/[a-z]/.test(password)) errors.push('Password must contain a lowercase letter');
    if (!/[0-9]/.test(password)) errors.push('Password must contain a number');
    if (!/[!@#$%^&*(),.?":{}|<>]/.test(password)) errors.push('Password must contain a special character');
    return errors;
  };

  // GET /api/users - List all users (admin only)
  app.get('/api/users', requireAdmin, (req, res) => {
    db.all(
      'SELECT id, username, email, is_admin, created_at FROM users ORDER BY created_at DESC',
      [],
      (err, users) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(users);
      }
    );
  });

  // GET /api/users/:id - Get single user (admin only)
  app.get('/api/users/:id', requireAdmin, (req, res) => {
    db.get(
      'SELECT id, username, email, is_admin, created_at FROM users WHERE id = ?',
      [req.params.id],
      (err, user) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!user) return res.status(404).json({ error: 'User not found' });
        res.json(user);
      }
    );
  });

  // POST /api/users - Create new user (admin only)
  app.post('/api/users', requireAdmin, (req, res) => {
    const { username, password, email, is_admin = 0 } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    const passwordErrors = validatePassword(password);
    if (passwordErrors.length > 0) {
      return res.status(400).json({ error: passwordErrors.join('. ') });
    }

    const passwordHash = bcrypt.hashSync(password, 10);

    db.run(
      'INSERT INTO users (username, password_hash, email, is_admin) VALUES (?, ?, ?, ?)',
      [username, passwordHash, email || null, is_admin ? 1 : 0],
      function(err) {
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

  // PUT /api/users/:id - Update user (admin only)
  app.put('/api/users/:id', requireAdmin, (req, res) => {
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
      function(err) {
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

  // DELETE /api/users/:id - Delete user (admin only)
  app.delete('/api/users/:id', requireAdmin, (req, res) => {
    const userId = parseInt(req.params.id);

    // Prevent deleting yourself
    if (userId === req.user.id) {
      return res.status(400).json({ error: 'Cannot delete your own account' });
    }

    // Check if this is the last admin user
    db.get('SELECT COUNT(*) as admin_count FROM users WHERE is_admin = 1', [], (err, result) => {
      if (err) return res.status(500).json({ error: err.message });

      db.get('SELECT is_admin FROM users WHERE id = ?', [userId], (err, user) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!user) return res.status(404).json({ error: 'User not found' });

        if (user.is_admin && result.admin_count <= 1) {
          return res.status(400).json({ error: 'Cannot delete the last admin user' });
        }

        db.serialize(() => {
          db.run('DELETE FROM playback_progress WHERE user_id = ?', [userId]);
          db.run('DELETE FROM api_keys WHERE user_id = ?', [userId]);
          db.run('DELETE FROM users WHERE id = ?', [userId], function(err) {
            if (err) return res.status(500).json({ error: err.message });
            if (this.changes === 0) return res.status(404).json({ error: 'User not found' });
            res.json({ message: 'User deleted successfully' });
          });
        });
      });
    });
  });

  return app;
}

module.exports = {
  createTestDatabase,
  createTestUser,
  generateTestToken,
  createTestApp
};
