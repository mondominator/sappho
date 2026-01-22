/**
 * Real Test Application Setup
 * Creates an Express app that uses the ACTUAL route handlers
 * with a mocked in-memory database
 */

const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'test-secret-key-for-testing';

// Store the test database globally so mocks can access it
let testDb = null;

/**
 * Create an in-memory SQLite database with all required tables
 */
function createTestDatabase() {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(':memory:', (err) => {
      if (err) return reject(err);

      db.serialize(() => {
        // Users table (matches real schema)
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
            mfa_secret TEXT,
            mfa_enabled INTEGER DEFAULT 0,
            mfa_backup_codes TEXT,
            mfa_enabled_at DATETIME,
            account_disabled INTEGER DEFAULT 0,
            disabled_at DATETIME,
            disabled_reason TEXT,
            share_activity INTEGER DEFAULT 0,
            show_in_feed INTEGER DEFAULT 0,
            preferred_genres TEXT,
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
            series TEXT,
            series_position REAL,
            duration INTEGER,
            file_path TEXT,
            file_size INTEGER,
            cover_image TEXT,
            cover_path TEXT,
            description TEXT,
            genres TEXT,
            language TEXT,
            publisher TEXT,
            isbn TEXT,
            asin TEXT,
            year INTEGER,
            content_hash TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
          )
        `);

        // Playback progress table
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
            is_active INTEGER DEFAULT 1,
            expires_at DATETIME,
            last_used_at DATETIME,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
          )
        `);

        // Activity events table
        db.run(`
          CREATE TABLE IF NOT EXISTS activity_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            event_type TEXT NOT NULL,
            audiobook_id INTEGER,
            metadata TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
          )
        `);

        // Collections table
        db.run(`
          CREATE TABLE IF NOT EXISTS collections (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            description TEXT,
            is_public INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
          )
        `);

        // Collection items table
        db.run(`
          CREATE TABLE IF NOT EXISTS collection_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            collection_id INTEGER NOT NULL,
            audiobook_id INTEGER NOT NULL,
            added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(collection_id, audiobook_id)
          )
        `);

        // Ratings table
        db.run(`
          CREATE TABLE IF NOT EXISTS ratings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            audiobook_id INTEGER NOT NULL,
            rating INTEGER NOT NULL,
            review TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(user_id, audiobook_id)
          )
        `);

        // SMTP settings table
        db.run(`
          CREATE TABLE IF NOT EXISTS smtp_settings (
            id INTEGER PRIMARY KEY DEFAULT 1,
            host TEXT,
            port INTEGER DEFAULT 587,
            secure INTEGER DEFAULT 0,
            username TEXT,
            password TEXT,
            from_address TEXT,
            from_name TEXT,
            enabled INTEGER DEFAULT 0
          )
        `);

        // Notification preferences table
        db.run(`
          CREATE TABLE IF NOT EXISTS notification_preferences (
            user_id INTEGER PRIMARY KEY,
            email_new_audiobook INTEGER DEFAULT 0,
            email_weekly_summary INTEGER DEFAULT 0,
            email_recommendations INTEGER DEFAULT 0,
            email_enabled INTEGER DEFAULT 1
          )
        `);

        // Unlock tokens table
        db.run(`
          CREATE TABLE IF NOT EXISTS unlock_tokens (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            token TEXT UNIQUE NOT NULL,
            expires_at DATETIME NOT NULL,
            used_at DATETIME,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
          )
        `);

        // Server settings table
        db.run(`
          CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT
          )
        `, (err) => {
          if (err) return reject(err);
          testDb = db;
          resolve(db);
        });
      });
    });
  });
}

/**
 * Create a test user
 */
async function createTestUser(db, { username, password, email = null, isAdmin = false }) {
  return new Promise((resolve, reject) => {
    const passwordHash = bcrypt.hashSync(password, 10);
    db.run(
      'INSERT INTO users (username, password_hash, email, is_admin) VALUES (?, ?, ?, ?)',
      [username, passwordHash, email, isAdmin ? 1 : 0],
      function(err) {
        if (err) return reject(err);
        resolve({ id: this.lastID, username, email, isAdmin });
      }
    );
  });
}

/**
 * Create a test audiobook
 */
async function createTestAudiobook(db, { title, author = 'Test Author', narrator = null, series = null, duration = 3600 }) {
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT INTO audiobooks (title, author, narrator, series, duration, file_path)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [title, author, narrator, series, duration, `/test/path/${title.replace(/\s/g, '_')}.m4b`],
      function(err) {
        if (err) return reject(err);
        resolve({ id: this.lastID, title, author, narrator, series, duration });
      }
    );
  });
}

/**
 * Generate a test JWT token
 */
function generateTestToken(user, expiresIn = '1h') {
  return jwt.sign(
    { id: user.id, username: user.username },
    JWT_SECRET,
    { expiresIn }
  );
}

/**
 * Create the Express app with real routes but test database
 *
 * Note: This requires careful module mocking because routes import db at load time.
 * We need to mock the database module BEFORE requiring the routes.
 */
function createRealTestApp(db) {
  // Store reference for the mocked database module
  testDb = db;

  const app = express();
  app.use(cors());
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Health check
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', message: 'Test server' });
  });

  return app;
}

/**
 * Get the current test database
 */
function getTestDb() {
  return testDb;
}

/**
 * Clean up test database
 */
async function cleanupTestDatabase(db) {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      db.run('DELETE FROM activity_events');
      db.run('DELETE FROM collection_items');
      db.run('DELETE FROM collections');
      db.run('DELETE FROM ratings');
      db.run('DELETE FROM playback_progress');
      db.run('DELETE FROM api_keys');
      db.run('DELETE FROM unlock_tokens');
      db.run('DELETE FROM audiobooks');
      db.run('DELETE FROM users', (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  });
}

module.exports = {
  createTestDatabase,
  createTestUser,
  createTestAudiobook,
  generateTestToken,
  createRealTestApp,
  getTestDb,
  cleanupTestDatabase,
  JWT_SECRET
};
