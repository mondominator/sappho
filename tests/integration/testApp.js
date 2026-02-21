/**
 * Test application setup for integration tests
 * Creates an isolated Express app with in-memory SQLite database
 * and mounts REAL route factories with test-compatible dependencies.
 */

const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');

const JWT_SECRET = process.env.JWT_SECRET || 'test-secret';

// Create temp directory for test uploads
const testUploadDir = path.join(os.tmpdir(), 'sappho-test-uploads');
if (!fs.existsSync(testUploadDir)) {
  fs.mkdirSync(testUploadDir, { recursive: true });
}

// Set UPLOAD_DIR env var for the real upload route's multer config
process.env.UPLOAD_DIR = testUploadDir;

// Create temp directory for audiobooks (used by multifile upload route)
const testAudiobooksDir = path.join(os.tmpdir(), 'sappho-test-audiobooks');
if (!fs.existsSync(testAudiobooksDir)) {
  fs.mkdirSync(testAudiobooksDir, { recursive: true });
}
process.env.AUDIOBOOKS_DIR = testAudiobooksDir;

// Route factory imports
// NOTE: express-rate-limit is mocked globally in tests/setup.js
const { createAudiobooksRouter } = require('../../server/routes/audiobooks');
const { createAuthRouter } = require('../../server/routes/auth');
const { createApiKeysRouter } = require('../../server/routes/apiKeys');
const { createBackupRouter } = require('../../server/routes/backup');
const { createCollectionsRouter } = require('../../server/routes/collections');
const { createEmailRouter } = require('../../server/routes/email');
const { createMfaRouter } = require('../../server/routes/mfa');
const { createProfileRouter } = require('../../server/routes/profile');
const { createRatingsRouter } = require('../../server/routes/ratings');
const { createSeriesRouter } = require('../../server/routes/series');
const { createSessionsRouter } = require('../../server/routes/sessions');
const { createSettingsRouter } = require('../../server/routes/settings');
const { createUploadRouter } = require('../../server/routes/upload');
const { createUsersRouter } = require('../../server/routes/users');
const { createMaintenanceRouter } = require('../../server/routes/maintenance');

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
            mfa_secret TEXT,
            mfa_enabled INTEGER DEFAULT 0,
            mfa_backup_codes TEXT,
            mfa_enabled_at DATETIME,
            account_disabled INTEGER DEFAULT 0,
            disabled_at DATETIME,
            disabled_reason TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
          )
        `);

        // Audiobooks table (full schema including migration columns)
        db.run(`
          CREATE TABLE IF NOT EXISTS audiobooks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            author TEXT,
            narrator TEXT,
            description TEXT,
            duration INTEGER,
            file_path TEXT,
            file_size INTEGER,
            cover_image TEXT,
            cover_path TEXT,
            isbn TEXT,
            asin TEXT,
            published_year INTEGER,
            genre TEXT,
            series TEXT,
            series_position REAL,
            series_index REAL,
            language TEXT DEFAULT 'en',
            is_available INTEGER DEFAULT 1,
            is_multi_file INTEGER DEFAULT 0,
            content_hash VARCHAR(16),
            last_seen_at DATETIME,
            original_path TEXT,
            tags TEXT,
            publisher TEXT,
            copyright_year INTEGER,
            rating REAL,
            abridged INTEGER DEFAULT 0,
            subtitle TEXT,
            added_by INTEGER,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
          )
        `);

        // Progress table (with queued_at for up-next feature)
        db.run(`
          CREATE TABLE IF NOT EXISTS playback_progress (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            audiobook_id INTEGER NOT NULL,
            position INTEGER DEFAULT 0,
            completed INTEGER DEFAULT 0,
            queued_at DATETIME,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(user_id, audiobook_id)
          )
        `);

        // User favorites table
        db.run(`
          CREATE TABLE IF NOT EXISTS user_favorites (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            audiobook_id INTEGER NOT NULL,
            priority INTEGER DEFAULT 0,
            list_order INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(user_id, audiobook_id)
          )
        `);

        // User ratings table
        db.run(`
          CREATE TABLE IF NOT EXISTS user_ratings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            audiobook_id INTEGER NOT NULL,
            rating INTEGER CHECK(rating >= 1 AND rating <= 5),
            review TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(user_id, audiobook_id)
          )
        `);

        // User collections table
        db.run(`
          CREATE TABLE IF NOT EXISTS user_collections (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            description TEXT,
            cover_image TEXT,
            is_public INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
          )
        `);

        // Collection items table
        db.run(`
          CREATE TABLE IF NOT EXISTS collection_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            collection_id INTEGER NOT NULL,
            audiobook_id INTEGER NOT NULL,
            position INTEGER NOT NULL DEFAULT 0,
            added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(collection_id, audiobook_id)
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
            last_used_at DATETIME,
            is_active INTEGER DEFAULT 1,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
          )
        `);

        // Series recaps cache table
        db.run(`
          CREATE TABLE IF NOT EXISTS series_recaps (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            series_name TEXT NOT NULL,
            books_hash TEXT,
            recap_text TEXT,
            model_used TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(user_id, series_name, books_hash)
          )
        `);

        // Audiobook chapters table
        db.run(`
          CREATE TABLE IF NOT EXISTS audiobook_chapters (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            audiobook_id INTEGER NOT NULL,
            chapter_number INTEGER NOT NULL,
            file_path TEXT,
            duration INTEGER,
            file_size INTEGER,
            title TEXT,
            start_time REAL DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (audiobook_id) REFERENCES audiobooks(id) ON DELETE CASCADE
          )
        `);

        // Book recaps cache table
        db.run(`
          CREATE TABLE IF NOT EXISTS book_recaps (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            audiobook_id INTEGER NOT NULL,
            books_hash TEXT,
            recap_text TEXT,
            model_used TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
            FOREIGN KEY (audiobook_id) REFERENCES audiobooks(id) ON DELETE CASCADE
          )
        `);

        // Email settings table (singleton)
        db.run(`
          CREATE TABLE IF NOT EXISTS email_settings (
            id INTEGER PRIMARY KEY CHECK(id = 1),
            host TEXT,
            port INTEGER DEFAULT 587,
            secure INTEGER DEFAULT 0,
            username TEXT,
            password TEXT,
            from_address TEXT,
            from_name TEXT DEFAULT 'Sappho',
            enabled INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
          )
        `);

        // User notification preferences
        db.run(`
          CREATE TABLE IF NOT EXISTS user_notification_prefs (
            user_id INTEGER PRIMARY KEY,
            email_new_audiobook INTEGER DEFAULT 1,
            email_weekly_summary INTEGER DEFAULT 0,
            email_recommendations INTEGER DEFAULT 0,
            email_enabled INTEGER DEFAULT 1,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
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
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
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

/**
 * Create test-compatible auth module that works with the test database.
 * Provides all functions that route factories expect from deps.auth.
 */
function createTestAuth(db) {
  function authenticateToken(req, res, next) {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.substring(7) : null;

    if (!token) {
      return res.status(401).json({ error: 'Access token required' });
    }

    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      db.get('SELECT id, username, is_admin, must_change_password FROM users WHERE id = ?', [decoded.id], (err, user) => {
        if (err || !user) {
          return res.status(401).json({ error: 'User not found' });
        }
        req.user = { id: user.id, username: user.username, is_admin: user.is_admin, must_change_password: user.must_change_password };
        req.token = token;
        next();
      });
    } catch (_err) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
  }

  function authenticateMediaToken(req, res, next) {
    // Accept token from query string (for <img>/<audio> tags)
    if (!req.headers.authorization && req.query.token) {
      req.headers.authorization = `Bearer ${req.query.token}`;
    }
    authenticateToken(req, res, next);
  }

  function requireAdmin(req, res, next) {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    if (!req.user.is_admin) return res.status(403).json({ error: 'Admin access required' });
    next();
  }

  function requirePasswordChanged(req, res, next) {
    // Skip for tests by default
    next();
  }

  function validatePassword(password) {
    const errors = [];
    if (password.length < 8) errors.push('Password must be at least 8 characters');
    if (!/[A-Z]/.test(password)) errors.push('Password must contain an uppercase letter');
    if (!/[a-z]/.test(password)) errors.push('Password must contain a lowercase letter');
    if (!/[0-9]/.test(password)) errors.push('Password must contain a number');
    if (!/[!@#$%^&*(),.?":{}|<>]/.test(password)) errors.push('Password must contain a special character');
    return errors;
  }

  async function register(username, password, email) {
    const passwordErrors = validatePassword(password);
    if (passwordErrors.length > 0) {
      throw new Error(passwordErrors.join('. '));
    }
    const passwordHash = bcrypt.hashSync(password, 10);
    return new Promise((resolve, reject) => {
      db.run(
        'INSERT INTO users (username, password_hash, email) VALUES (?, ?, ?)',
        [username, passwordHash, email || null],
        function(err) {
          if (err) reject(err);
          else resolve({ id: this.lastID, username, email: email || null });
        }
      );
    });
  }

  async function login(username, password) {
    return new Promise((resolve, reject) => {
      db.get('SELECT * FROM users WHERE username = ?', [username], (err, user) => {
        if (err) return reject(err);
        if (!user) return reject(new Error('Invalid username or password'));

        const isValid = bcrypt.compareSync(password, user.password_hash);
        if (!isValid) return reject(new Error('Invalid username or password'));

        // Check if MFA is enabled
        if (user.mfa_enabled && user.mfa_secret) {
          const mfaToken = jwt.sign(
            { id: user.id, username: user.username, mfa_pending: true },
            JWT_SECRET,
            { expiresIn: '5m' }
          );
          return resolve({
            mfa_required: true,
            mfa_token: mfaToken,
            message: 'MFA verification required'
          });
        }

        const token = jwt.sign(
          { id: user.id, username: user.username },
          JWT_SECRET,
          { expiresIn: '24h' }
        );
        resolve({
          token,
          user: { id: user.id, username: user.username, is_admin: user.is_admin },
          must_change_password: !!user.must_change_password
        });
      });
    });
  }

  function logout(_token) {
    // Noop for tests
  }

  return {
    authenticateToken,
    authenticateMediaToken,
    requireAdmin,
    requirePasswordChanged,
    register,
    login,
    logout,
    validatePassword,
    invalidateUserTokens: () => {},
    blacklistToken: () => {},
    isTokenBlacklisted: () => false,
    isUserTokenInvalidated: () => false,
    isAccountLocked: () => false,
    getLockoutRemaining: () => 0,
    clearFailedAttempts: () => {},
    getLockedAccounts: () => [],
    recordFailedAttempt: () => {},
    getFailedAttemptsInfo: () => ({ count: 0, isLocked: false, remainingSeconds: 0 }),
    createDefaultAdmin: async () => {},
  };
}

/**
 * Create mock session manager for tests.
 */
function createMockSessionManager() {
  const sessions = new Map();
  return {
    getAllSessions: () => Array.from(sessions.values()),
    getUserSessions: (userId) => Array.from(sessions.values()).filter(s => s.userId === userId),
    getSession: (sessionId) => sessions.get(sessionId) || null,
    stopSession: (sessionId) => sessions.delete(sessionId),
    createSession: (session) => { sessions.set(session.id, session); return session; },
    updateSession: () => {},
  };
}

/**
 * Create test Express app using REAL route factories with test dependencies.
 * This ensures integration tests exercise actual route code, not shadow copies.
 */
function createTestApp(db) {
  const app = express();
  app.use(cors());
  app.use(express.json());

  // Create test auth module
  const testAuth = createTestAuth(db);

  // Create mock session manager (exposed on app for test access)
  const mockSessionManager = createMockSessionManager();
  app.testSessionManager = mockSessionManager;

  // Shared dependencies for all route factories
  const baseDeps = {
    db,
    auth: testAuth,
  };

  // Mock services
  const { createDbHelpers } = require('../../server/utils/db');
  const { dbGet: _dbGet, dbRun: _dbRun } = createDbHelpers(db);

  const mockMfaService = {
    verifyToken: (token) => token === '123456',
    generateSecret: () => 'JBSWY3DPEHPK3PXP',
    generateQRCode: async () => 'data:image/png;base64,test',
    generateBackupCodes: () => {
      const plainCodes = ['AAAABBBB', 'CCCCDDDD', 'EEEEFFFF'];
      const hashedCodes = plainCodes.map(c => bcrypt.hashSync(c, 10));
      return { plainCodes, hashedCodes };
    },
    getMFAStatus: async (userId) => {
      return new Promise((resolve, reject) => {
        db.get('SELECT mfa_enabled, mfa_enabled_at, mfa_backup_codes FROM users WHERE id = ?', [userId], (err, user) => {
          if (err) return reject(err);
          if (!user) return resolve({ enabled: false });
          let remainingBackupCodes = 0;
          if (user.mfa_backup_codes) {
            try { remainingBackupCodes = JSON.parse(user.mfa_backup_codes).filter(c => c !== null).length; } catch (_e) {}
          }
          resolve({ enabled: !!user.mfa_enabled, enabledAt: user.mfa_enabled_at, remainingBackupCodes });
        });
      });
    },
    enableMFA: async (userId, secret, hashedCodes) => {
      return _dbRun(
        'UPDATE users SET mfa_secret = ?, mfa_enabled = 1, mfa_backup_codes = ?, mfa_enabled_at = CURRENT_TIMESTAMP WHERE id = ?',
        [secret, JSON.stringify(hashedCodes), userId]
      );
    },
    getUserMFASecret: async (userId) => {
      const user = await _dbGet('SELECT mfa_secret, mfa_enabled FROM users WHERE id = ?', [userId]);
      if (!user || !user.mfa_enabled) return null;
      return user.mfa_secret;
    },
    verifyBackupCode: async (userId, code) => {
      const user = await _dbGet('SELECT mfa_backup_codes FROM users WHERE id = ?', [userId]);
      if (!user || !user.mfa_backup_codes) return false;
      try {
        const hashedCodes = JSON.parse(user.mfa_backup_codes);
        const upperCode = code.toUpperCase().replace(/[^A-Z0-9]/g, '');
        for (let i = 0; i < hashedCodes.length; i++) {
          if (hashedCodes[i] && bcrypt.compareSync(upperCode, hashedCodes[i])) {
            hashedCodes[i] = null;
            await _dbRun('UPDATE users SET mfa_backup_codes = ? WHERE id = ?', [JSON.stringify(hashedCodes), userId]);
            return true;
          }
        }
      } catch (_e) {}
      return false;
    },
    disableMFA: async (userId) => {
      return _dbRun(
        'UPDATE users SET mfa_secret = NULL, mfa_enabled = 0, mfa_backup_codes = NULL, mfa_enabled_at = NULL WHERE id = ?',
        [userId]
      );
    },
    regenerateBackupCodes: async (userId) => {
      const { plainCodes, hashedCodes } = mockMfaService.generateBackupCodes();
      await _dbRun('UPDATE users SET mfa_backup_codes = ? WHERE id = ? AND mfa_enabled = 1', [JSON.stringify(hashedCodes), userId]);
      return plainCodes;
    },
  };

  const mockEmailService = {
    notifyAdminNewUser: async () => {},
    sendUnlockEmail: async () => {},
    isConfigured: () => false,
    getSMTPSettings: async () => {
      return new Promise((resolve, reject) => {
        db.get('SELECT * FROM email_settings WHERE id = 1', [], (err, row) => {
          if (err) return reject(err);
          resolve(row || null);
        });
      });
    },
    saveSMTPSettings: async (settings) => {
      return new Promise((resolve, reject) => {
        db.run(
          `INSERT OR REPLACE INTO email_settings (id, host, port, secure, username, password, from_address, from_name, enabled) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [settings.host, settings.port, settings.secure ? 1 : 0, settings.username, settings.password, settings.from_address, settings.from_name, settings.enabled ? 1 : 0],
          (err) => { if (err) reject(err); else resolve(); }
        );
      });
    },
    testConnection: async () => ({ success: true, message: 'Connection successful' }),
    sendTestEmail: async (to) => ({ success: true, message: `Test email sent to ${to}` }),
    getUserNotificationPrefs: async (userId) => {
      return new Promise((resolve, reject) => {
        db.get('SELECT * FROM user_notification_prefs WHERE user_id = ?', [userId], (err, row) => {
          if (err) return reject(err);
          resolve(row || { email_new_audiobook: 1, email_weekly_summary: 0, email_recommendations: 0, email_enabled: 1 });
        });
      });
    },
    saveUserNotificationPrefs: async (userId, prefs) => {
      return new Promise((resolve, reject) => {
        db.run(
          `INSERT OR REPLACE INTO user_notification_prefs (user_id, email_new_audiobook, email_weekly_summary, email_recommendations, email_enabled) VALUES (?, ?, ?, ?, ?)`,
          [userId, prefs.email_new_audiobook ? 1 : 0, prefs.email_weekly_summary ? 1 : 0, prefs.email_recommendations ? 1 : 0, prefs.email_enabled ? 1 : 0],
          (err) => { if (err) reject(err); else resolve(); }
        );
      });
    },
  };

  const mockUnlockService = {
    disableAccount: async () => {},
    enableAccount: async () => {},
    requestUnlock: async () => {},
  };

  const mockFileOrganizer = {
    organizeAudiobook: async () => {},
    needsOrganization: () => false,
    organizeLibrary: async () => ({ moved: 0, errors: [] }),
    getOrganizationPreview: async () => ({ changes: [] }),
  };

  const mockConversionService = {
    isDirectoryLocked: () => false,
    convertToM4b: async () => {},
    getConversionStatus: () => null,
  };

  const mockGenres = {
    normalizeGenres: (genre) => genre,
    GENRE_MAPPINGS: {},
    DEFAULT_GENRE_METADATA: {},
  };

  const mockFileProcessor = {
    processAudiobook: async (filePath, userId) => {
      // Extract title from multer-generated filename (strip timestamp prefix and extension)
      const basename = path.basename(filePath, path.extname(filePath));
      const parts = basename.split('-');
      // Multer prefixes: timestamp-random-originalname
      const title = parts.length > 2 ? parts.slice(2).join('-') : basename;
      const ext = path.extname(filePath);
      const fileSize = fs.existsSync(filePath) ? fs.statSync(filePath).size : 0;

      return new Promise((resolve, reject) => {
        db.run(
          `INSERT INTO audiobooks (title, file_path, file_size, duration, added_by) VALUES (?, ?, ?, ?, ?)`,
          [title, filePath, fileSize, 3600, userId],
          function(err) {
            if (err) return reject(err);
            resolve({ id: this.lastID, title, file_path: filePath, file_size: fileSize, duration: 3600, added_by: userId, format: ext.slice(1) });
          }
        );
      });
    },
    extractFileMetadata: async (filePath) => ({
      title: 'Test Audiobook',
      author: 'Test Author',
      duration: 600,
      cover_image: null,
    }),
  };

  const mockLibraryScanner = {
    scanLibrary: async () => {},
    lockScanning: () => {},
    unlockScanning: () => {},
    isScanningLocked: () => false,
    getJobStatus: () => null,
  };

  const mockWebsocketManager = {
    broadcastLibraryUpdate: () => {},
    broadcastSessionUpdate: () => {},
  };

  const mockContentHash = {
    generateBestHash: async () => 'testhash123',
  };

  const mockBackupService = {
    createBackup: async () => ({ success: true, filename: 'test-backup.zip', size: 1024, timestamp: new Date().toISOString() }),
    listBackups: () => [
      { filename: 'sappho-backup-2024-01-15T10-00-00.zip', size: 1024000, sizeFormatted: '1 MB', created: '2024-01-15T10:00:00Z' },
      { filename: 'sappho-backup-2024-01-14T10-00-00.zip', size: 512000, sizeFormatted: '500 KB', created: '2024-01-14T10:00:00Z' },
    ],
    getBackupPath: (filename) => {
      const sanitized = path.basename(filename);
      if (!sanitized.endsWith('.zip') || !sanitized.startsWith('sappho-backup-')) {
        throw new Error('Invalid backup filename');
      }
      // Only "known" test backups exist
      const known = ['sappho-backup-2024-01-15T10-00-00.zip', 'sappho-backup-2024-01-14T10-00-00.zip'];
      if (!known.includes(sanitized)) {
        throw new Error('Backup not found');
      }
      return path.join('/tmp', sanitized);
    },
    deleteBackup: (filename) => {
      // getBackupPath validates; if we get here, it's valid
      return { success: true, filename };
    },
    restoreBackup: async () => ({ database: true, covers: 0 }),
    applyRetention: (keepCount) => ({ deleted: Math.max(0, 2 - (keepCount || 7)) }),
    getStatus: () => ({ backupDir: '/tmp', scheduledBackups: false, lastBackup: null, lastResult: null, backupCount: 2 }),
  };

  const mockSettings = {
    getRecapPrompt: () => 'Default prompt...',
  };

  // Mount REAL routes with test dependencies
  app.use('/api/auth', createAuthRouter({
    ...baseDeps,
    mfaService: mockMfaService,
    emailService: mockEmailService,
    unlockService: mockUnlockService,
  }));

  app.use('/api/audiobooks', createAudiobooksRouter({
    ...baseDeps,
    fileOrganizer: mockFileOrganizer,
    conversionService: mockConversionService,
    genres: mockGenres,
  }));

  app.use('/api/upload', createUploadRouter({
    ...baseDeps,
    fileProcessor: mockFileProcessor,
    websocketManager: mockWebsocketManager,
    contentHash: mockContentHash,
  }));

  app.use('/api/api-keys', createApiKeysRouter(baseDeps));

  app.use('/api/sessions', createSessionsRouter({
    ...baseDeps,
    sessionManager: mockSessionManager,
  }));

  app.use('/api/users', createUsersRouter({
    ...baseDeps,
    unlockService: mockUnlockService,
  }));

  app.use('/api/profile', createProfileRouter({
    ...baseDeps,
    genres: mockGenres,
  }));

  app.use('/api/settings', createSettingsRouter(baseDeps));

  app.use('/api/maintenance', createMaintenanceRouter({
    ...baseDeps,
    fileProcessor: mockFileProcessor,
    libraryScanner: mockLibraryScanner,
    fileOrganizer: mockFileOrganizer,
  }));

  app.use('/api/series', createSeriesRouter({
    ...baseDeps,
    settings: mockSettings,
  }));

  app.use('/api/backup', createBackupRouter({
    ...baseDeps,
    backupService: mockBackupService,
  }));

  app.use('/api/collections', createCollectionsRouter(baseDeps));

  app.use('/api/ratings', createRatingsRouter(baseDeps));

  app.use('/api/mfa', createMfaRouter({
    ...baseDeps,
    mfaService: mockMfaService,
    bcrypt,
  }));

  app.use('/api/email', createEmailRouter({
    ...baseDeps,
    emailService: mockEmailService,
  }));

  // Health check (inline like production)
  app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
  });

  // Error-handling middleware for multer and other errors
  const multer = require('multer');
  app.use((err, _req, res, _next) => {
    if (err instanceof multer.MulterError) {
      return res.status(400).json({ error: err.message });
    }
    if (err.message && err.message.includes('Invalid file type')) {
      return res.status(400).json({ error: err.message });
    }
    console.error('Unhandled error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}

// Create test audiobook
async function createTestAudiobook(db, {
  title,
  author = 'Test Author',
  narrator = 'Test Narrator',
  description = 'Test description',
  duration = 3600,
  file_path = '/test/audiobook.m4b',
  file_size = 100000000,
  genre = null,
  series = null,
  series_position = null,
  published_year = null,
  is_available = 1
}) {
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT INTO audiobooks (title, author, narrator, description, duration, file_path, file_size, genre, series, series_position, published_year, is_available)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [title, author, narrator, description, duration, file_path, file_size, genre, series, series_position, published_year, is_available],
      function(err) {
        if (err) return reject(err);
        resolve({
          id: this.lastID,
          title,
          author,
          narrator,
          description,
          duration,
          file_path,
          file_size,
          genre,
          series,
          series_position,
          published_year,
          is_available
        });
      }
    );
  });
}

// Create test collection
async function createTestCollection(db, {
  user_id,
  name,
  description = null,
  is_public = 0
}) {
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT INTO user_collections (user_id, name, description, is_public)
       VALUES (?, ?, ?, ?)`,
      [user_id, name, description, is_public],
      function(err) {
        if (err) return reject(err);
        resolve({
          id: this.lastID,
          user_id,
          name,
          description,
          is_public
        });
      }
    );
  });
}

// Add audiobook to collection
async function addToCollection(db, collectionId, audiobookId, position = 0) {
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT INTO collection_items (collection_id, audiobook_id, position)
       VALUES (?, ?, ?)`,
      [collectionId, audiobookId, position],
      function(err) {
        if (err) return reject(err);
        resolve({ id: this.lastID, collection_id: collectionId, audiobook_id: audiobookId, position });
      }
    );
  });
}

module.exports = {
  createTestDatabase,
  createTestUser,
  generateTestToken,
  createTestApp,
  createTestAudiobook,
  createTestCollection,
  addToCollection,
  testUploadDir
};
