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

  return app;
}

module.exports = {
  createTestDatabase,
  createTestUser,
  generateTestToken,
  createTestApp
};
