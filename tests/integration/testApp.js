/**
 * Test application setup for integration tests
 * Creates an isolated Express app with in-memory SQLite database
 */

const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const os = require('os');

const JWT_SECRET = process.env.JWT_SECRET || 'test-secret';

// Create temp directory for test uploads
const testUploadDir = path.join(os.tmpdir(), 'sappho-test-uploads');
if (!fs.existsSync(testUploadDir)) {
  fs.mkdirSync(testUploadDir, { recursive: true });
}

// Multer configuration for test uploads
const testStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, testUploadDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + '-' + file.originalname);
  }
});

const testFileFilter = (req, file, cb) => {
  const allowedTypes = [
    'audio/mpeg',
    'audio/mp3',
    'audio/m4a',
    'audio/m4b',
    'audio/x-m4a',
    'audio/x-m4b',
    'audio/mp4',
    'audio/ogg',
    'audio/flac',
  ];

  const allowedExtensions = ['.mp3', '.m4a', '.m4b', '.mp4', '.ogg', '.flac'];
  const ext = path.extname(file.originalname).toLowerCase();

  if (allowedTypes.includes(file.mimetype) || allowedExtensions.includes(ext)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Only audio files are allowed.'), false);
  }
};

const testUpload = multer({
  storage: testStorage,
  fileFilter: testFileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024 * 1024, // 5GB limit
  },
});

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
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
          )
        `);

        // Audiobooks table (full schema)
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
            series_name TEXT NOT NULL UNIQUE,
            recap TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
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

  // Profile endpoint (removed - using comprehensive version in PROFILE ROUTES section)

  // Admin-only middleware helper
  const requireAdmin = (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    if (!req.user.is_admin) return res.status(403).json({ error: 'Admin access required' });
    next();
  };

  // Password validation helper
  const validatePassword = (password) => {
    const errors = [];
    if (password.length < 8) errors.push('Password must be at least 8 characters');
    if (!/[A-Z]/.test(password)) errors.push('Password must contain an uppercase letter');
    if (!/[a-z]/.test(password)) errors.push('Password must contain a lowercase letter');
    if (!/[0-9]/.test(password)) errors.push('Password must contain a number');
    if (!/[!@#$%^&*(),.?":{}|<>]/.test(password)) errors.push('Password must contain a special character');
    return errors;
  };

  // Audiobooks list endpoint with filtering and pagination
  app.get('/api/audiobooks', (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

    const { genre, author, series, search, favorites, includeUnavailable, limit = 50, offset = 0 } = req.query;
    const userId = req.user.id;

    let query = `SELECT a.*, p.position as progress_position, p.completed as progress_completed,
                        p.updated_at as progress_updated_at,
                        CASE WHEN f.id IS NOT NULL THEN 1 ELSE 0 END as is_favorite,
                        ur.rating as user_rating
                 FROM audiobooks a
                 LEFT JOIN playback_progress p ON a.id = p.audiobook_id AND p.user_id = ?
                 LEFT JOIN user_favorites f ON a.id = f.audiobook_id AND f.user_id = ?
                 LEFT JOIN user_ratings ur ON a.id = ur.audiobook_id AND ur.user_id = ?
                 WHERE 1=1`;
    const params = [userId, userId, userId];

    // Filter out unavailable books by default
    if (includeUnavailable !== 'true') {
      query += ' AND (a.is_available = 1 OR a.is_available IS NULL)';
    }

    if (genre) {
      query += ' AND a.genre LIKE ?';
      params.push(`%${genre}%`);
    }

    if (author) {
      query += ' AND a.author LIKE ?';
      params.push(`%${author}%`);
    }

    if (series) {
      query += ' AND a.series LIKE ?';
      params.push(`%${series}%`);
    }

    if (search) {
      query += ' AND (a.title LIKE ? OR a.author LIKE ? OR a.narrator LIKE ? OR a.series LIKE ?)';
      params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
    }

    if (favorites === 'true') {
      query += ' AND f.id IS NOT NULL';
    }

    query += ' ORDER BY a.title ASC LIMIT ? OFFSET ?';
    params.push(parseInt(limit), parseInt(offset));

    db.all(query, params, (err, audiobooks) => {
      if (err) return res.status(500).json({ error: 'Database error' });

      // Transform to match real API response shape
      const transformedAudiobooks = audiobooks.map(book => {
        const { progress_position, progress_completed, progress_updated_at, is_favorite, user_rating, ...rest } = book;
        return {
          ...rest,
          is_favorite: !!is_favorite,
          user_rating: user_rating || null,
          progress: progress_position !== null ? {
            position: progress_position,
            completed: progress_completed,
            updated_at: progress_updated_at
          } : null
        };
      });

      // Get total count for pagination
      let countQuery = favorites === 'true'
        ? `SELECT COUNT(*) as total FROM audiobooks a
           INNER JOIN user_favorites f ON a.id = f.audiobook_id AND f.user_id = ?
           WHERE 1=1`
        : 'SELECT COUNT(*) as total FROM audiobooks a WHERE 1=1';
      const countParams = favorites === 'true' ? [userId] : [];

      if (includeUnavailable !== 'true') {
        countQuery += ' AND (a.is_available = 1 OR a.is_available IS NULL)';
      }

      db.get(countQuery, countParams, (err, countResult) => {
        if (err) return res.status(500).json({ error: 'Database error' });
        res.json({
          audiobooks: transformedAudiobooks,
          total: countResult?.total || 0,
          limit: parseInt(limit),
          offset: parseInt(offset)
        });
      });
    });
  });

  // Get favorites list (must be before :id route)
  app.get('/api/audiobooks/favorites', (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

    db.all(
      `SELECT a.* FROM audiobooks a
       INNER JOIN user_favorites f ON a.id = f.audiobook_id
       WHERE f.user_id = ?
       ORDER BY f.created_at DESC`,
      [req.user.id],
      (err, audiobooks) => {
        if (err) return res.status(500).json({ error: 'Database error' });
        res.json(audiobooks);
      }
    );
  });

  // Get single audiobook
  app.get('/api/audiobooks/:id', (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

    const audiobookId = parseInt(req.params.id);
    const userId = req.user.id;

    db.get(
      `SELECT a.*, p.position as progress_position, p.completed as progress_completed,
              CASE WHEN f.id IS NOT NULL THEN 1 ELSE 0 END as is_favorite,
              ur.rating as user_rating
       FROM audiobooks a
       LEFT JOIN playback_progress p ON a.id = p.audiobook_id AND p.user_id = ?
       LEFT JOIN user_favorites f ON a.id = f.audiobook_id AND f.user_id = ?
       LEFT JOIN user_ratings ur ON a.id = ur.audiobook_id AND ur.user_id = ?
       WHERE a.id = ?`,
      [userId, userId, userId, audiobookId],
      (err, audiobook) => {
        if (err) return res.status(500).json({ error: 'Database error' });
        if (!audiobook) return res.status(404).json({ error: 'Audiobook not found' });

        const { progress_position, progress_completed, is_favorite, user_rating, ...rest } = audiobook;
        res.json({
          ...rest,
          is_favorite: !!is_favorite,
          user_rating: user_rating || null,
          progress: progress_position !== null ? {
            position: progress_position,
            completed: progress_completed
          } : null
        });
      }
    );
  });

  // Update audiobook
  app.put('/api/audiobooks/:id', (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

    const audiobookId = parseInt(req.params.id);
    const { title, author, narrator, description, genre, series, series_position } = req.body;

    const updates = [];
    const params = [];

    if (title !== undefined) { updates.push('title = ?'); params.push(title); }
    if (author !== undefined) { updates.push('author = ?'); params.push(author); }
    if (narrator !== undefined) { updates.push('narrator = ?'); params.push(narrator); }
    if (description !== undefined) { updates.push('description = ?'); params.push(description); }
    if (genre !== undefined) { updates.push('genre = ?'); params.push(genre); }
    if (series !== undefined) { updates.push('series = ?'); params.push(series); }
    if (series_position !== undefined) { updates.push('series_position = ?'); params.push(series_position); }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    updates.push('updated_at = CURRENT_TIMESTAMP');
    params.push(audiobookId);

    db.run(
      `UPDATE audiobooks SET ${updates.join(', ')} WHERE id = ?`,
      params,
      function(err) {
        if (err) return res.status(500).json({ error: 'Database error' });
        if (this.changes === 0) return res.status(404).json({ error: 'Audiobook not found' });
        res.json({ message: 'Audiobook updated successfully' });
      }
    );
  });

  // Get audiobook progress
  app.get('/api/audiobooks/:id/progress', (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

    const audiobookId = parseInt(req.params.id);
    db.get(
      'SELECT position, completed, updated_at FROM playback_progress WHERE user_id = ? AND audiobook_id = ?',
      [req.user.id, audiobookId],
      (err, progress) => {
        if (err) return res.status(500).json({ error: 'Database error' });
        res.json(progress || { position: 0, completed: 0 });
      }
    );
  });

  // Save audiobook progress
  app.post('/api/audiobooks/:id/progress', (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

    const audiobookId = parseInt(req.params.id);
    const { position, completed } = req.body;

    if (position === undefined) {
      return res.status(400).json({ error: 'Position is required' });
    }

    // Check audiobook exists
    db.get('SELECT id, duration FROM audiobooks WHERE id = ?', [audiobookId], (err, audiobook) => {
      if (err) return res.status(500).json({ error: 'Database error' });
      if (!audiobook) return res.status(404).json({ error: 'Audiobook not found' });

      // Determine if completed (position >= 95% of duration)
      const isCompleted = completed !== undefined ? completed :
        (audiobook.duration && position >= audiobook.duration * 0.95 ? 1 : 0);

      db.run(
        `INSERT INTO playback_progress (user_id, audiobook_id, position, completed, updated_at)
         VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(user_id, audiobook_id) DO UPDATE SET
           position = ?, completed = ?, updated_at = CURRENT_TIMESTAMP`,
        [req.user.id, audiobookId, position, isCompleted, position, isCompleted],
        function(err) {
          if (err) return res.status(500).json({ error: 'Database error' });
          res.json({
            success: true,
            position,
            completed: isCompleted,
            progressPercent: audiobook.duration ? Math.round((position / audiobook.duration) * 100) : 0
          });
        }
      );
    });
  });

  // Delete audiobook progress
  app.delete('/api/audiobooks/:id/progress', (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

    const audiobookId = parseInt(req.params.id);
    db.run(
      'DELETE FROM playback_progress WHERE user_id = ? AND audiobook_id = ?',
      [req.user.id, audiobookId],
      function(err) {
        if (err) return res.status(500).json({ error: 'Database error' });
        res.json({ success: true, deleted: this.changes > 0 });
      }
    );
  });

  // Check if audiobook is favorite
  app.get('/api/audiobooks/:id/favorite', (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

    const audiobookId = parseInt(req.params.id);
    db.get(
      'SELECT id FROM user_favorites WHERE user_id = ? AND audiobook_id = ?',
      [req.user.id, audiobookId],
      (err, row) => {
        if (err) return res.status(500).json({ error: 'Database error' });
        res.json({ is_favorite: !!row });
      }
    );
  });

  // Add audiobook to favorites
  app.post('/api/audiobooks/:id/favorite', (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

    const audiobookId = parseInt(req.params.id);

    // Check audiobook exists
    db.get('SELECT id FROM audiobooks WHERE id = ?', [audiobookId], (err, audiobook) => {
      if (err) return res.status(500).json({ error: 'Database error' });
      if (!audiobook) return res.status(404).json({ error: 'Audiobook not found' });

      db.run(
        'INSERT OR IGNORE INTO user_favorites (user_id, audiobook_id) VALUES (?, ?)',
        [req.user.id, audiobookId],
        function(err) {
          if (err) return res.status(500).json({ error: 'Database error' });
          res.json({ success: true, is_favorite: true });
        }
      );
    });
  });

  // Remove audiobook from favorites
  app.delete('/api/audiobooks/:id/favorite', (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

    const audiobookId = parseInt(req.params.id);
    db.run(
      'DELETE FROM user_favorites WHERE user_id = ? AND audiobook_id = ?',
      [req.user.id, audiobookId],
      function(err) {
        if (err) return res.status(500).json({ error: 'Database error' });
        res.json({ success: true, is_favorite: false });
      }
    );
  });

  // Toggle favorite status
  app.post('/api/audiobooks/:id/favorite/toggle', (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

    const audiobookId = parseInt(req.params.id);

    db.get(
      'SELECT id FROM user_favorites WHERE user_id = ? AND audiobook_id = ?',
      [req.user.id, audiobookId],
      (err, row) => {
        if (err) return res.status(500).json({ error: 'Database error' });

        if (row) {
          // Remove from favorites
          db.run(
            'DELETE FROM user_favorites WHERE user_id = ? AND audiobook_id = ?',
            [req.user.id, audiobookId],
            function(err) {
              if (err) return res.status(500).json({ error: 'Database error' });
              res.json({ success: true, is_favorite: false });
            }
          );
        } else {
          // Check audiobook exists then add
          db.get('SELECT id FROM audiobooks WHERE id = ?', [audiobookId], (err, audiobook) => {
            if (err) return res.status(500).json({ error: 'Database error' });
            if (!audiobook) return res.status(404).json({ error: 'Audiobook not found' });

            db.run(
              'INSERT INTO user_favorites (user_id, audiobook_id) VALUES (?, ?)',
              [req.user.id, audiobookId],
              function(err) {
                if (err) return res.status(500).json({ error: 'Database error' });
                res.json({ success: true, is_favorite: true });
              }
            );
          });
        }
      }
    );
  });

  // Meta: Get all series
  app.get('/api/audiobooks/meta/series', (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

    db.all(
      `SELECT series, COUNT(*) as book_count, MIN(series_position) as first_position
       FROM audiobooks
       WHERE series IS NOT NULL AND series != ''
       AND (is_available = 1 OR is_available IS NULL)
       GROUP BY series
       ORDER BY series ASC`,
      [],
      (err, series) => {
        if (err) return res.status(500).json({ error: 'Database error' });
        res.json(series);
      }
    );
  });

  // Meta: Get all authors
  app.get('/api/audiobooks/meta/authors', (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

    db.all(
      `SELECT author, COUNT(*) as book_count
       FROM audiobooks
       WHERE author IS NOT NULL AND author != ''
       AND (is_available = 1 OR is_available IS NULL)
       GROUP BY author
       ORDER BY author ASC`,
      [],
      (err, authors) => {
        if (err) return res.status(500).json({ error: 'Database error' });
        res.json(authors);
      }
    );
  });

  // Meta: Get all genres
  app.get('/api/audiobooks/meta/genres', (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

    db.all(
      `SELECT genre, COUNT(*) as book_count
       FROM audiobooks
       WHERE genre IS NOT NULL AND genre != ''
       AND (is_available = 1 OR is_available IS NULL)
       GROUP BY genre
       ORDER BY book_count DESC`,
      [],
      (err, genres) => {
        if (err) return res.status(500).json({ error: 'Database error' });
        res.json(genres);
      }
    );
  });

  // Meta: Get recent audiobooks
  app.get('/api/audiobooks/meta/recent', (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

    const limit = parseInt(req.query.limit) || 10;
    db.all(
      `SELECT * FROM audiobooks
       WHERE (is_available = 1 OR is_available IS NULL)
       ORDER BY created_at DESC
       LIMIT ?`,
      [limit],
      (err, audiobooks) => {
        if (err) return res.status(500).json({ error: 'Database error' });
        res.json(audiobooks);
      }
    );
  });

  // Meta: Get in-progress audiobooks for current user
  app.get('/api/audiobooks/meta/in-progress', (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

    db.all(
      `SELECT a.*, p.position, p.completed, p.updated_at as progress_updated_at
       FROM audiobooks a
       INNER JOIN playback_progress p ON a.id = p.audiobook_id
       WHERE p.user_id = ? AND p.position > 0 AND p.completed = 0
       AND (a.is_available = 1 OR a.is_available IS NULL)
       ORDER BY p.updated_at DESC`,
      [req.user.id],
      (err, audiobooks) => {
        if (err) return res.status(500).json({ error: 'Database error' });
        res.json(audiobooks);
      }
    );
  });

  // Meta: Get finished audiobooks for current user
  app.get('/api/audiobooks/meta/finished', (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

    db.all(
      `SELECT a.*, p.position, p.completed, p.updated_at as progress_updated_at
       FROM audiobooks a
       INNER JOIN playback_progress p ON a.id = p.audiobook_id
       WHERE p.user_id = ? AND p.completed = 1
       AND (a.is_available = 1 OR a.is_available IS NULL)
       ORDER BY p.updated_at DESC`,
      [req.user.id],
      (err, audiobooks) => {
        if (err) return res.status(500).json({ error: 'Database error' });
        res.json(audiobooks);
      }
    );
  });

  // Meta: Get up-next audiobooks (queued)
  app.get('/api/audiobooks/meta/up-next', (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

    db.all(
      `SELECT a.*, p.position, p.completed, p.queued_at
       FROM audiobooks a
       INNER JOIN playback_progress p ON a.id = p.audiobook_id
       WHERE p.user_id = ? AND p.queued_at IS NOT NULL AND p.completed = 0
       AND (a.is_available = 1 OR a.is_available IS NULL)
       ORDER BY p.queued_at DESC`,
      [req.user.id],
      (err, audiobooks) => {
        if (err) return res.status(500).json({ error: 'Database error' });
        res.json(audiobooks);
      }
    );
  });

  // Batch: Mark multiple audiobooks as finished
  app.post('/api/audiobooks/batch/mark-finished', (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

    const { audiobook_ids } = req.body;
    if (!audiobook_ids || !Array.isArray(audiobook_ids) || audiobook_ids.length === 0) {
      return res.status(400).json({ error: 'audiobook_ids array is required' });
    }

    const placeholders = audiobook_ids.map(() => '(?, ?, 0, 1, CURRENT_TIMESTAMP)').join(', ');
    const params = audiobook_ids.flatMap(id => [req.user.id, id]);

    db.run(
      `INSERT INTO playback_progress (user_id, audiobook_id, position, completed, updated_at)
       VALUES ${placeholders}
       ON CONFLICT(user_id, audiobook_id) DO UPDATE SET
         completed = 1, updated_at = CURRENT_TIMESTAMP`,
      params,
      function(err) {
        if (err) return res.status(500).json({ error: 'Database error' });
        res.json({ success: true, updated: audiobook_ids.length });
      }
    );
  });

  // Batch: Clear progress for multiple audiobooks
  app.post('/api/audiobooks/batch/clear-progress', (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

    const { audiobook_ids } = req.body;
    if (!audiobook_ids || !Array.isArray(audiobook_ids) || audiobook_ids.length === 0) {
      return res.status(400).json({ error: 'audiobook_ids array is required' });
    }

    const placeholders = audiobook_ids.map(() => '?').join(', ');
    db.run(
      `DELETE FROM playback_progress WHERE user_id = ? AND audiobook_id IN (${placeholders})`,
      [req.user.id, ...audiobook_ids],
      function(err) {
        if (err) return res.status(500).json({ error: 'Database error' });
        res.json({ success: true, deleted: this.changes });
      }
    );
  });

  // Batch: Delete audiobooks (admin only)
  app.post('/api/audiobooks/batch/delete', requireAdmin, (req, res) => {
    const { audiobook_ids, delete_files } = req.body;
    if (!audiobook_ids || !Array.isArray(audiobook_ids) || audiobook_ids.length === 0) {
      return res.status(400).json({ error: 'audiobook_ids array is required' });
    }

    const placeholders = audiobook_ids.map(() => '?').join(', ');

    // Delete related data first
    db.serialize(() => {
      db.run(`DELETE FROM playback_progress WHERE audiobook_id IN (${placeholders})`, audiobook_ids);
      db.run(`DELETE FROM user_favorites WHERE audiobook_id IN (${placeholders})`, audiobook_ids);
      db.run(`DELETE FROM user_ratings WHERE audiobook_id IN (${placeholders})`, audiobook_ids);
      db.run(`DELETE FROM collection_items WHERE audiobook_id IN (${placeholders})`, audiobook_ids);
      db.run(`DELETE FROM audiobooks WHERE id IN (${placeholders})`, audiobook_ids, function(err) {
        if (err) return res.status(500).json({ error: 'Database error' });
        res.json({ success: true, deleted: this.changes, files_deleted: !!delete_files });
      });
    });
  });

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

  // MFA endpoints
  const { authenticator } = require('otplib');
  const QRCode = require('qrcode');
  const crypto = require('crypto');

  // MFA Status endpoint
  app.get('/api/mfa/status', (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

    db.get(
      'SELECT mfa_enabled, mfa_enabled_at, mfa_backup_codes FROM users WHERE id = ?',
      [req.user.id],
      (err, user) => {
        if (err) return res.status(500).json({ error: 'Database error' });
        if (!user) return res.json({ enabled: false });

        let remainingBackupCodes = 0;
        if (user.mfa_backup_codes) {
          try {
            const codes = JSON.parse(user.mfa_backup_codes);
            remainingBackupCodes = codes.filter(c => c !== null).length;
          } catch (_e) {
            // Ignore parse errors
          }
        }

        res.json({
          enabled: !!user.mfa_enabled,
          enabledAt: user.mfa_enabled_at,
          remainingBackupCodes
        });
      }
    );
  });

  // MFA Setup endpoint
  app.post('/api/mfa/setup', async (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

    try {
      // Check if MFA is already enabled
      const user = await new Promise((resolve, reject) => {
        db.get('SELECT mfa_enabled FROM users WHERE id = ?', [req.user.id], (err, row) => {
          if (err) reject(err);
          else resolve(row);
        });
      });

      if (user && user.mfa_enabled) {
        return res.status(400).json({ error: 'MFA is already enabled' });
      }

      // Generate new secret
      const secret = authenticator.generateSecret();

      // Generate QR code
      const otpauth = authenticator.keyuri(req.user.username, 'Sappho', secret);
      const qrCode = await QRCode.toDataURL(otpauth);

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

  // MFA Verify Setup endpoint
  app.post('/api/mfa/verify-setup', async (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

    const { secret, token } = req.body;

    if (!secret || !token) {
      return res.status(400).json({ error: 'Secret and token are required' });
    }

    // Verify the token matches the secret
    const isValid = authenticator.verify({ token, secret });
    if (!isValid) {
      return res.status(400).json({ error: 'Invalid verification code' });
    }

    // Generate backup codes
    const plainCodes = [];
    const hashedCodes = [];
    for (let i = 0; i < 10; i++) {
      const code = crypto.randomBytes(4).toString('hex').toUpperCase();
      plainCodes.push(code);
      hashedCodes.push(bcrypt.hashSync(code, 10));
    }

    // Enable MFA
    await new Promise((resolve, reject) => {
      db.run(
        `UPDATE users SET mfa_secret = ?, mfa_enabled = 1, mfa_backup_codes = ?, mfa_enabled_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [secret, JSON.stringify(hashedCodes), req.user.id],
        (err) => err ? reject(err) : resolve()
      );
    });

    res.json({
      success: true,
      message: 'MFA enabled successfully',
      backupCodes: plainCodes,
      warning: 'Save these backup codes securely. They will not be shown again!'
    });
  });

  // MFA Disable endpoint
  app.post('/api/mfa/disable', async (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

    const { token, password } = req.body;

    // Check if MFA is enabled
    const user = await new Promise((resolve, reject) => {
      db.get('SELECT mfa_enabled, mfa_secret, mfa_backup_codes, password_hash FROM users WHERE id = ?', [req.user.id], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });

    if (!user || !user.mfa_enabled) {
      return res.status(400).json({ error: 'MFA is not enabled' });
    }

    // Verify with MFA token
    if (token) {
      const isValid = authenticator.verify({ token, secret: user.mfa_secret });
      if (!isValid) {
        // Try as backup code
        let isBackupValid = false;
        if (user.mfa_backup_codes) {
          try {
            const codes = JSON.parse(user.mfa_backup_codes);
            const upperToken = token.toUpperCase().replace(/[^A-Z0-9]/g, '');
            for (let i = 0; i < codes.length; i++) {
              if (codes[i] && bcrypt.compareSync(upperToken, codes[i])) {
                isBackupValid = true;
                break;
              }
            }
          } catch (_e) {
            // Ignore
          }
        }
        if (!isBackupValid) {
          return res.status(400).json({ error: 'Invalid verification code' });
        }
      }
    } else if (password) {
      if (!bcrypt.compareSync(password, user.password_hash)) {
        return res.status(400).json({ error: 'Invalid password' });
      }
    } else {
      return res.status(400).json({ error: 'Token or password required to disable MFA' });
    }

    // Disable MFA
    await new Promise((resolve, reject) => {
      db.run(
        'UPDATE users SET mfa_secret = NULL, mfa_enabled = 0, mfa_backup_codes = NULL, mfa_enabled_at = NULL WHERE id = ?',
        [req.user.id],
        (err) => err ? reject(err) : resolve()
      );
    });

    res.json({ success: true, message: 'MFA disabled successfully' });
  });

  // MFA Regenerate Codes endpoint
  app.post('/api/mfa/regenerate-codes', async (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

    const { token } = req.body;

    if (!token) {
      return res.status(400).json({ error: 'MFA token required' });
    }

    // Verify MFA token
    const user = await new Promise((resolve, reject) => {
      db.get('SELECT mfa_secret, mfa_enabled FROM users WHERE id = ?', [req.user.id], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });

    if (!user || !user.mfa_enabled || !user.mfa_secret) {
      return res.status(400).json({ error: 'MFA is not enabled' });
    }

    const isValid = authenticator.verify({ token, secret: user.mfa_secret });
    if (!isValid) {
      return res.status(400).json({ error: 'Invalid verification code' });
    }

    // Generate new codes
    const plainCodes = [];
    const hashedCodes = [];
    for (let i = 0; i < 10; i++) {
      const code = crypto.randomBytes(4).toString('hex').toUpperCase();
      plainCodes.push(code);
      hashedCodes.push(bcrypt.hashSync(code, 10));
    }

    await new Promise((resolve, reject) => {
      db.run(
        'UPDATE users SET mfa_backup_codes = ? WHERE id = ?',
        [JSON.stringify(hashedCodes), req.user.id],
        (err) => err ? reject(err) : resolve()
      );
    });

    res.json({
      success: true,
      backupCodes: plainCodes,
      warning: 'Save these backup codes securely. Old codes are now invalid!'
    });
  });

  // Delete audiobook endpoint (admin only)
  app.delete('/api/audiobooks/:id', requireAdmin, (req, res) => {
    db.get('SELECT * FROM audiobooks WHERE id = ?', [req.params.id], (err, audiobook) => {
      if (err) return res.status(500).json({ error: 'Database error' });
      if (!audiobook) return res.status(404).json({ error: 'Audiobook not found' });

      db.run('DELETE FROM audiobooks WHERE id = ?', [req.params.id], (err) => {
        if (err) return res.status(500).json({ error: 'Database error' });
        res.json({ message: 'Audiobook deleted successfully' });
      });
    });
  });

  // Delete audiobook files endpoint (admin only)
  app.delete('/api/audiobooks/:id/files', requireAdmin, (req, res) => {
    const { file_path } = req.body;
    if (!file_path) return res.status(400).json({ error: 'file_path is required' });

    db.get('SELECT * FROM audiobooks WHERE id = ?', [req.params.id], (err, audiobook) => {
      if (err) return res.status(500).json({ error: 'Database error' });
      if (!audiobook) return res.status(404).json({ error: 'Audiobook not found' });

      res.json({ message: 'File deleted successfully' });
    });
  });

  // ============================================
  // UPLOAD ENDPOINTS
  // ============================================

  // Multer error handler middleware
  const handleMulterError = (err, req, res, next) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: 'File too large. Maximum size is 5GB.' });
      }
      return res.status(400).json({ error: err.message });
    } else if (err) {
      return res.status(400).json({ error: err.message });
    }
    next();
  };

  // Single file upload
  app.post('/api/upload', (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    next();
  }, testUpload.single('audiobook'), handleMulterError, (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const userId = req.user.id;

    // Simulate audiobook creation from uploaded file
    db.run(
      `INSERT INTO audiobooks (title, author, narrator, duration, file_path, file_size, added_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        path.basename(req.file.originalname, path.extname(req.file.originalname)),
        'Unknown Author',
        null,
        3600,
        req.file.path,
        req.file.size,
        userId
      ],
      function(err) {
        // Clean up test file
        if (fs.existsSync(req.file.path)) {
          fs.unlinkSync(req.file.path);
        }

        if (err) {
          return res.status(500).json({ error: 'Database error' });
        }

        db.get('SELECT * FROM audiobooks WHERE id = ?', [this.lastID], (err, audiobook) => {
          if (err) return res.status(500).json({ error: 'Database error' });
          res.json({
            message: 'Audiobook uploaded successfully',
            audiobook: audiobook
          });
        });
      }
    );
  });

  // Batch upload (multiple files as separate audiobooks)
  app.post('/api/upload/batch', (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    next();
  }, testUpload.array('audiobooks', 10), handleMulterError, async (req, res) => {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No files uploaded' });
    }

    const userId = req.user.id;
    const results = [];

    for (const file of req.files) {
      try {
        const audiobookId = await new Promise((resolve, reject) => {
          db.run(
            `INSERT INTO audiobooks (title, author, narrator, duration, file_path, file_size, added_by)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
              path.basename(file.originalname, path.extname(file.originalname)),
              'Unknown Author',
              null,
              3600,
              file.path,
              file.size,
              userId
            ],
            function(err) {
              if (err) reject(err);
              else resolve(this.lastID);
            }
          );
        });

        const audiobook = await new Promise((resolve, reject) => {
          db.get('SELECT * FROM audiobooks WHERE id = ?', [audiobookId], (err, row) => {
            if (err) reject(err);
            else resolve(row);
          });
        });

        results.push({ success: true, filename: file.originalname, audiobook });
      } catch (error) {
        results.push({ success: false, filename: file.originalname, error: error.message });
      } finally {
        // Clean up test file
        if (fs.existsSync(file.path)) {
          fs.unlinkSync(file.path);
        }
      }
    }

    res.json({
      message: 'Batch upload completed',
      results: results
    });
  });

  // Multi-file upload (multiple files as single audiobook with chapters)
  app.post('/api/upload/multifile', (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    next();
  }, testUpload.array('audiobooks', 100), handleMulterError, async (req, res) => {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No files uploaded' });
    }

    const userId = req.user.id;
    const bookName = req.body.bookName || 'Multi-File Audiobook';

    // Sort files by name
    const sortedFiles = req.files.sort((a, b) =>
      a.originalname.localeCompare(b.originalname, undefined, { numeric: true, sensitivity: 'base' })
    );

    try {
      // Calculate total size
      const totalSize = sortedFiles.reduce((sum, f) => sum + f.size, 0);
      const totalDuration = sortedFiles.length * 600; // Estimate 10 min per file

      // Create audiobook record
      const audiobookId = await new Promise((resolve, reject) => {
        db.run(
          `INSERT INTO audiobooks (title, author, narrator, duration, file_path, file_size, added_by)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            bookName,
            'Unknown Author',
            null,
            totalDuration,
            sortedFiles[0].path,
            totalSize,
            userId
          ],
          function(err) {
            if (err) reject(err);
            else resolve(this.lastID);
          }
        );
      });

      const audiobook = await new Promise((resolve, reject) => {
        db.get('SELECT * FROM audiobooks WHERE id = ?', [audiobookId], (err, row) => {
          if (err) reject(err);
          else resolve(row);
        });
      });

      // Clean up test files
      for (const file of sortedFiles) {
        if (fs.existsSync(file.path)) {
          fs.unlinkSync(file.path);
        }
      }

      res.json({
        message: 'Multi-file audiobook uploaded successfully',
        audiobook: audiobook
      });
    } catch (error) {
      // Clean up on error
      for (const file of sortedFiles) {
        if (fs.existsSync(file.path)) {
          fs.unlinkSync(file.path);
        }
      }
      res.status(500).json({ error: error.message });
    }
  });

  // ==================== PROFILE ROUTES ====================

  // GET /api/profile - Get current user profile
  app.get('/api/profile', (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

    db.get(
      'SELECT id, username, email, display_name, avatar, is_admin, must_change_password, created_at FROM users WHERE id = ?',
      [req.user.id],
      (err, user) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!user) return res.status(404).json({ error: 'User not found' });
        res.json({
          ...user,
          must_change_password: !!user.must_change_password
        });
      }
    );
  });

  // GET /api/profile/stats - Get user listening stats
  app.get('/api/profile/stats', (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

    const userId = req.user.id;

    // Simplified stats for testing
    db.get(
      `SELECT COALESCE(SUM(a.duration), 0) as totalListenTime
       FROM playback_progress p
       JOIN audiobooks a ON p.audiobook_id = a.id
       WHERE p.user_id = ? AND p.completed = 1`,
      [userId],
      (err, row) => {
        if (err) return res.status(500).json({ error: err.message });

        db.get(
          `SELECT COUNT(DISTINCT audiobook_id) as booksStarted
           FROM playback_progress WHERE user_id = ? AND position > 0`,
          [userId],
          (err, row2) => {
            if (err) return res.status(500).json({ error: err.message });

            db.get(
              `SELECT COUNT(*) as booksCompleted
               FROM playback_progress WHERE user_id = ? AND completed = 1`,
              [userId],
              (err, row3) => {
                if (err) return res.status(500).json({ error: err.message });

                res.json({
                  totalListenTime: row.totalListenTime,
                  booksStarted: row2.booksStarted,
                  booksCompleted: row3.booksCompleted,
                  currentlyListening: 0,
                  topAuthors: [],
                  topGenres: [],
                  recentActivity: [],
                  activeDaysLast30: 0,
                  currentStreak: 0,
                  avgSessionLength: 0
                });
              }
            );
          }
        );
      }
    );
  });

  // PUT /api/profile - Update profile
  app.put('/api/profile', (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

    const { displayName, email } = req.body;
    const updates = [];
    const params = [];

    if (displayName !== undefined) {
      const trimmedDisplayName = displayName ? displayName.trim() : '';
      if (trimmedDisplayName.length === 0) {
        return res.status(400).json({ error: 'Display name cannot be empty or whitespace-only' });
      }
      if (trimmedDisplayName.length > 100) {
        return res.status(400).json({ error: 'Display name must be 100 characters or less' });
      }
      updates.push('display_name = ?');
      params.push(trimmedDisplayName);
    }

    if (email !== undefined) {
      updates.push('email = ?');
      params.push(email || null);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    params.push(req.user.id);

    db.run(
      `UPDATE users SET ${updates.join(', ')} WHERE id = ?`,
      params,
      function(err) {
        if (err) return res.status(500).json({ error: err.message });
        if (this.changes === 0) return res.status(404).json({ error: 'User not found' });

        db.get(
          'SELECT id, username, email, display_name, avatar, is_admin, must_change_password, created_at FROM users WHERE id = ?',
          [req.user.id],
          (err, user) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({
              ...user,
              must_change_password: !!user.must_change_password
            });
          }
        );
      }
    );
  });

  // DELETE /api/profile/avatar - Delete avatar
  app.delete('/api/profile/avatar', (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

    db.run(
      'UPDATE users SET avatar = NULL WHERE id = ?',
      [req.user.id],
      function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: 'Avatar removed successfully' });
      }
    );
  });

  // PUT /api/profile/password - Change password
  app.put('/api/profile/password', (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Current password and new password are required' });
    }

    // Basic password validation
    if (newPassword.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    db.get(
      'SELECT password_hash FROM users WHERE id = ?',
      [req.user.id],
      (err, user) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!user) return res.status(404).json({ error: 'User not found' });

        const bcrypt = require('bcryptjs');
        const isValid = bcrypt.compareSync(currentPassword, user.password_hash);
        if (!isValid) {
          return res.status(401).json({ error: 'Current password is incorrect' });
        }

        const newPasswordHash = bcrypt.hashSync(newPassword, 10);
        db.run(
          'UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?',
          [newPasswordHash, req.user.id],
          function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({
              message: 'Password updated successfully. Please log in again on all devices.'
            });
          }
        );
      }
    );
  });

  // ==================== SETTINGS ROUTES (Admin only) ====================

  // GET /api/settings/all - Get all settings
  app.get('/api/settings/all', requireAdmin, (req, res) => {
    const settings = {
      port: process.env.PORT || '3001',
      nodeEnv: process.env.NODE_ENV || 'development',
      databasePath: process.env.DATABASE_PATH || '/app/data/sappho.db',
      dataDir: process.env.DATA_DIR || '/app/data',
      audiobooksDir: process.env.AUDIOBOOKS_DIR || '/app/data/audiobooks',
      uploadDir: process.env.UPLOAD_DIR || '/app/data/uploads',
      libraryScanInterval: parseInt(process.env.LIBRARY_SCAN_INTERVAL) || 5,
      autoBackupInterval: parseInt(process.env.AUTO_BACKUP_INTERVAL) || 24,
      backupRetention: parseInt(process.env.BACKUP_RETENTION) || 7,
      logBufferSize: Math.min(parseInt(process.env.LOG_BUFFER_SIZE) || 500, 5000),
    };
    res.json({ settings, lockedFields: [] });
  });

  // PUT /api/settings/all - Update all settings
  app.put('/api/settings/all', requireAdmin, (req, res) => {
    const { port, nodeEnv, libraryScanInterval } = req.body;
    const errors = [];
    const updates = [];

    if (port !== undefined) {
      const portNum = parseInt(port);
      if (isNaN(portNum) || portNum < 1 || portNum > 65535) {
        errors.push('Port must be between 1 and 65535');
      } else {
        updates.push('PORT');
      }
    }

    if (nodeEnv !== undefined) {
      if (!['development', 'production'].includes(nodeEnv)) {
        errors.push('Environment must be "development" or "production"');
      } else {
        updates.push('NODE_ENV');
      }
    }

    if (libraryScanInterval !== undefined) {
      const interval = parseInt(libraryScanInterval);
      if (isNaN(interval) || interval < 1 || interval > 1440) {
        errors.push('Scan interval must be between 1 and 1440 minutes');
      } else {
        updates.push('LIBRARY_SCAN_INTERVAL');
      }
    }

    if (errors.length > 0) {
      return res.status(400).json({ errors });
    }

    res.json({
      message: 'Settings updated successfully.',
      updated: updates,
      requiresRestart: updates.filter(u => ['PORT', 'NODE_ENV'].includes(u))
    });
  });

  // GET /api/settings/library - Get library settings
  app.get('/api/settings/library', requireAdmin, (req, res) => {
    res.json({
      libraryPath: process.env.AUDIOBOOKS_DIR || '/app/data/audiobooks',
      uploadPath: process.env.UPLOAD_DIR || '/app/data/uploads'
    });
  });

  // PUT /api/settings/library - Update library settings
  app.put('/api/settings/library', requireAdmin, (req, res) => {
    const { libraryPath, uploadPath } = req.body;

    if (!libraryPath || !uploadPath) {
      return res.status(400).json({ error: 'All paths are required' });
    }

    res.json({ message: 'Library settings updated successfully.' });
  });

  // GET /api/settings/server - Get server settings
  app.get('/api/settings/server', requireAdmin, (req, res) => {
    const settings = {
      port: process.env.PORT || '3001',
      nodeEnv: process.env.NODE_ENV || 'development',
      databasePath: process.env.DATABASE_PATH || '/app/data/sappho.db',
      dataDir: process.env.DATA_DIR || '/app/data',
      audiobooksDir: process.env.AUDIOBOOKS_DIR || '/app/data/audiobooks',
      uploadDir: process.env.UPLOAD_DIR || '/app/data/uploads',
      libraryScanInterval: parseInt(process.env.LIBRARY_SCAN_INTERVAL) || 5,
      autoBackupInterval: parseInt(process.env.AUTO_BACKUP_INTERVAL) || 24,
      backupRetention: parseInt(process.env.BACKUP_RETENTION) || 7,
      logBufferSize: Math.min(parseInt(process.env.LOG_BUFFER_SIZE) || 500, 5000),
    };
    res.json({ settings, lockedFields: [] });
  });

  // PUT /api/settings/server - Update server settings (same as /all)
  app.put('/api/settings/server', requireAdmin, (req, res) => {
    const { port, nodeEnv, libraryScanInterval } = req.body;
    const errors = [];
    const updates = [];

    if (port !== undefined) {
      const portNum = parseInt(port);
      if (isNaN(portNum) || portNum < 1 || portNum > 65535) {
        errors.push('Port must be between 1 and 65535');
      } else {
        updates.push('PORT');
      }
    }

    if (nodeEnv !== undefined) {
      if (!['development', 'production'].includes(nodeEnv)) {
        errors.push('Environment must be "development" or "production"');
      } else {
        updates.push('NODE_ENV');
      }
    }

    if (libraryScanInterval !== undefined) {
      const interval = parseInt(libraryScanInterval);
      if (isNaN(interval) || interval < 1 || interval > 1440) {
        errors.push('Scan interval must be between 1 and 1440 minutes');
      } else {
        updates.push('LIBRARY_SCAN_INTERVAL');
      }
    }

    if (errors.length > 0) {
      return res.status(400).json({ errors });
    }

    res.json({
      message: 'Settings updated successfully.',
      updated: updates,
      requiresRestart: updates.filter(u => ['PORT', 'NODE_ENV'].includes(u))
    });
  });

  // GET /api/settings/ai - Get AI settings
  app.get('/api/settings/ai', requireAdmin, (req, res) => {
    res.json({
      settings: {
        aiProvider: process.env.AI_PROVIDER || 'openai',
        openaiApiKey: process.env.OPENAI_API_KEY ? '••••••••' : '',
        openaiModel: process.env.OPENAI_MODEL || 'gpt-4o-mini',
        geminiApiKey: process.env.GEMINI_API_KEY ? '••••••••' : '',
        geminiModel: process.env.GEMINI_MODEL || 'gemini-1.5-flash',
        recapCustomPrompt: process.env.RECAP_CUSTOM_PROMPT || '',
        recapOffensiveMode: process.env.RECAP_OFFENSIVE_MODE === 'true',
        recapDefaultPrompt: 'Default prompt...'
      }
    });
  });

  // GET /api/settings/ai/status - Check if AI is configured
  app.get('/api/settings/ai/status', (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

    const provider = process.env.AI_PROVIDER || 'openai';
    const hasApiKey = provider === 'gemini'
      ? !!process.env.GEMINI_API_KEY
      : !!process.env.OPENAI_API_KEY;

    res.json({ configured: hasApiKey, provider });
  });

  // PUT /api/settings/ai - Update AI settings
  app.put('/api/settings/ai', requireAdmin, (req, res) => {
    const { aiProvider, openaiModel, geminiModel } = req.body;

    if (aiProvider && !['openai', 'gemini'].includes(aiProvider)) {
      return res.status(400).json({ error: 'Invalid AI provider' });
    }

    if (openaiModel) {
      const validModels = ['gpt-4o-mini', 'gpt-4o', 'gpt-4-turbo', 'gpt-3.5-turbo'];
      if (!validModels.includes(openaiModel)) {
        return res.status(400).json({ error: 'Invalid OpenAI model selected' });
      }
    }

    if (geminiModel) {
      const validGeminiModels = ['gemini-1.5-flash', 'gemini-1.5-pro', 'gemini-1.0-pro'];
      if (!validGeminiModels.includes(geminiModel)) {
        return res.status(400).json({ error: 'Invalid Gemini model selected' });
      }
    }

    res.json({ message: 'AI settings updated successfully' });
  });

  // ==================== COLLECTIONS ROUTES ====================

  // Helper to check if user can edit collection (owner OR public collection)
  const canEditCollection = (collectionId, userId, callback) => {
    db.get(
      'SELECT id, user_id, is_public FROM user_collections WHERE id = ?',
      [collectionId],
      (err, collection) => {
        if (err) {
          callback(err, null);
          return;
        }
        if (!collection) {
          callback(null, { allowed: false, reason: 'Collection not found' });
          return;
        }
        // Can edit if owner OR if collection is public
        const allowed = collection.user_id === userId || collection.is_public === 1;
        callback(null, { allowed, collection });
      }
    );
  };

  // GET /api/collections - List all collections (user's private + all public)
  app.get('/api/collections', (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

    db.all(
      `SELECT c.*,
              u.username as creator_username,
              COUNT(ci.id) as book_count,
              COALESCE(SUM(a.duration), 0) as total_duration,
              (SELECT GROUP_CONCAT(ci2.audiobook_id) FROM collection_items ci2
               WHERE ci2.collection_id = c.id
               ORDER BY ci2.position ASC LIMIT 10) as book_ids,
              CASE WHEN c.user_id = ? THEN 1 ELSE 0 END as is_owner
       FROM user_collections c
       LEFT JOIN collection_items ci ON c.id = ci.collection_id
       LEFT JOIN audiobooks a ON ci.audiobook_id = a.id
       LEFT JOIN users u ON c.user_id = u.id
       WHERE c.user_id = ? OR c.is_public = 1
       GROUP BY c.id
       ORDER BY c.updated_at DESC`,
      [req.user.id, req.user.id],
      (err, collections) => {
        if (err) {
          return res.status(500).json({ error: err.message });
        }
        // Parse book_ids string into array
        const result = (collections || []).map(c => ({
          ...c,
          book_ids: c.book_ids ? c.book_ids.split(',').map(id => parseInt(id, 10)) : []
        }));
        res.json(result);
      }
    );
  });

  // POST /api/collections - Create a new collection
  app.post('/api/collections', (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

    const { name, description, is_public } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Collection name is required' });
    }

    db.run(
      'INSERT INTO user_collections (user_id, name, description, is_public) VALUES (?, ?, ?, ?)',
      [req.user.id, name.trim(), description || null, is_public ? 1 : 0],
      function(err) {
        if (err) {
          return res.status(500).json({ error: err.message });
        }

        db.get(
          `SELECT c.*, u.username as creator_username,
                  CASE WHEN c.user_id = ? THEN 1 ELSE 0 END as is_owner
           FROM user_collections c
           LEFT JOIN users u ON c.user_id = u.id
           WHERE c.id = ?`,
          [req.user.id, this.lastID],
          (err, collection) => {
            if (err) {
              return res.status(500).json({ error: err.message });
            }
            res.status(201).json(collection);
          }
        );
      }
    );
  });

  // GET /api/collections/for-book/:bookId - Get collections containing a specific book
  // NOTE: This route MUST be before /:id to avoid "for-book" being matched as an ID
  app.get('/api/collections/for-book/:bookId', (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

    const bookId = req.params.bookId;

    db.all(
      `SELECT c.id, c.name, c.is_public, c.user_id, u.username as creator_username,
              CASE WHEN ci.audiobook_id IS NOT NULL THEN 1 ELSE 0 END as contains_book,
              CASE WHEN c.user_id = ? THEN 1 ELSE 0 END as is_owner
       FROM user_collections c
       LEFT JOIN collection_items ci ON c.id = ci.collection_id AND ci.audiobook_id = ?
       LEFT JOIN users u ON c.user_id = u.id
       WHERE c.user_id = ? OR c.is_public = 1
       ORDER BY c.name ASC`,
      [req.user.id, bookId, req.user.id],
      (err, collections) => {
        if (err) {
          return res.status(500).json({ error: err.message });
        }
        res.json(collections || []);
      }
    );
  });

  // GET /api/collections/:id - Get single collection with books
  app.get('/api/collections/:id', (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

    const collectionId = req.params.id;

    // Get collection if user owns it OR it's public
    db.get(
      `SELECT c.*, u.username as creator_username,
              CASE WHEN c.user_id = ? THEN 1 ELSE 0 END as is_owner
       FROM user_collections c
       LEFT JOIN users u ON c.user_id = u.id
       WHERE c.id = ? AND (c.user_id = ? OR c.is_public = 1)`,
      [req.user.id, collectionId, req.user.id],
      (err, collection) => {
        if (err) {
          return res.status(500).json({ error: err.message });
        }
        if (!collection) {
          return res.status(404).json({ error: 'Collection not found' });
        }

        // Then get the books in this collection
        db.all(
          `SELECT a.*, ci.position, ci.added_at,
                  pp.position as progress_position, pp.completed as progress_completed
           FROM collection_items ci
           JOIN audiobooks a ON ci.audiobook_id = a.id
           LEFT JOIN playback_progress pp ON a.id = pp.audiobook_id AND pp.user_id = ?
           WHERE ci.collection_id = ?
           ORDER BY ci.position ASC`,
          [req.user.id, collectionId],
          (err, books) => {
            if (err) {
              return res.status(500).json({ error: err.message });
            }
            res.json({
              ...collection,
              books: books || []
            });
          }
        );
      }
    );
  });

  // PUT /api/collections/:id - Update a collection (owner only)
  app.put('/api/collections/:id', (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

    const collectionId = req.params.id;
    const { name, description, is_public } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Collection name is required' });
    }

    // Only the owner can update a collection
    db.run(
      `UPDATE user_collections
       SET name = ?, description = ?, is_public = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND user_id = ?`,
      [name.trim(), description || null, is_public ? 1 : 0, collectionId, req.user.id],
      function(err) {
        if (err) {
          return res.status(500).json({ error: err.message });
        }
        if (this.changes === 0) {
          return res.status(404).json({ error: 'Collection not found or not owned by you' });
        }

        db.get(
          `SELECT c.*, u.username as creator_username,
                  CASE WHEN c.user_id = ? THEN 1 ELSE 0 END as is_owner
           FROM user_collections c
           LEFT JOIN users u ON c.user_id = u.id
           WHERE c.id = ?`,
          [req.user.id, collectionId],
          (err, collection) => {
            if (err) {
              return res.status(500).json({ error: err.message });
            }
            res.json(collection);
          }
        );
      }
    );
  });

  // DELETE /api/collections/:id - Delete a collection (owner only)
  app.delete('/api/collections/:id', (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

    const collectionId = req.params.id;

    // Only the owner can delete a collection
    db.run(
      'DELETE FROM user_collections WHERE id = ? AND user_id = ?',
      [collectionId, req.user.id],
      function(err) {
        if (err) {
          return res.status(500).json({ error: err.message });
        }
        if (this.changes === 0) {
          return res.status(404).json({ error: 'Collection not found or not owned by you' });
        }
        res.json({ success: true });
      }
    );
  });

  // POST /api/collections/:id/items - Add a book to a collection
  app.post('/api/collections/:id/items', (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

    const collectionId = req.params.id;
    const { audiobook_id } = req.body;

    if (!audiobook_id) {
      return res.status(400).json({ error: 'audiobook_id is required' });
    }

    canEditCollection(collectionId, req.user.id, (err, result) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      if (!result.allowed) {
        return res.status(404).json({ error: result.reason || 'Collection not found' });
      }

      // Get the next position
      db.get(
        'SELECT COALESCE(MAX(position), -1) + 1 as next_position FROM collection_items WHERE collection_id = ?',
        [collectionId],
        (err, posResult) => {
          if (err) {
            return res.status(500).json({ error: err.message });
          }

          db.run(
            'INSERT INTO collection_items (collection_id, audiobook_id, position) VALUES (?, ?, ?)',
            [collectionId, audiobook_id, posResult.next_position],
            function(err) {
              if (err) {
                if (err.message.includes('UNIQUE constraint')) {
                  return res.status(409).json({ error: 'Book already in collection' });
                }
                return res.status(500).json({ error: err.message });
              }

              // Update collection's updated_at
              db.run(
                'UPDATE user_collections SET updated_at = CURRENT_TIMESTAMP WHERE id = ?',
                [collectionId]
              );

              res.status(201).json({ success: true, id: this.lastID });
            }
          );
        }
      );
    });
  });

  // DELETE /api/collections/:id/items/:bookId - Remove a book from a collection
  app.delete('/api/collections/:id/items/:bookId', (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

    const { id: collectionId, bookId } = req.params;

    canEditCollection(collectionId, req.user.id, (err, result) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      if (!result.allowed) {
        return res.status(404).json({ error: result.reason || 'Collection not found' });
      }

      db.run(
        'DELETE FROM collection_items WHERE collection_id = ? AND audiobook_id = ?',
        [collectionId, bookId],
        function(err) {
          if (err) {
            return res.status(500).json({ error: err.message });
          }
          if (this.changes === 0) {
            return res.status(404).json({ error: 'Book not in collection' });
          }

          // Update collection's updated_at
          db.run(
            'UPDATE user_collections SET updated_at = CURRENT_TIMESTAMP WHERE id = ?',
            [collectionId]
          );

          res.json({ success: true });
        }
      );
    });
  });

  // PUT /api/collections/:id/items/reorder - Reorder books in a collection
  app.put('/api/collections/:id/items/reorder', (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

    const collectionId = req.params.id;
    const { order } = req.body; // Array of audiobook_ids in new order

    if (!Array.isArray(order)) {
      return res.status(400).json({ error: 'order must be an array of audiobook IDs' });
    }

    canEditCollection(collectionId, req.user.id, (err, result) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      if (!result.allowed) {
        return res.status(404).json({ error: result.reason || 'Collection not found' });
      }

      // Update positions
      const updates = order.map((audiobookId, index) => {
        return new Promise((resolve, reject) => {
          db.run(
            'UPDATE collection_items SET position = ? WHERE collection_id = ? AND audiobook_id = ?',
            [index, collectionId, audiobookId],
            (err) => {
              if (err) reject(err);
              else resolve();
            }
          );
        });
      });

      Promise.all(updates)
        .then(() => {
          // Update collection's updated_at
          db.run(
            'UPDATE user_collections SET updated_at = CURRENT_TIMESTAMP WHERE id = ?',
            [collectionId]
          );
          res.json({ success: true });
        })
        .catch(err => {
          res.status(500).json({ error: err.message });
        });
    });
  });



  // ==================== API KEYS ROUTES ====================

  // Helper to generate API key
  const generateApiKey = () => {
    const key = crypto.randomBytes(32).toString('hex');
    const fullKey = `sapho_${key}`;
    const prefix = key.substring(0, 8);
    const hash = crypto.createHash('sha256').update(fullKey).digest('hex');
    return { key: fullKey, prefix: `sapho_${prefix}`, hash };
  };

  // GET /api/api-keys - List all API keys for current user
  app.get('/api/api-keys', (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

    db.all(
      `SELECT id, name, key_prefix, permissions, last_used_at, expires_at, is_active, created_at
       FROM api_keys
       WHERE user_id = ?
       ORDER BY created_at DESC`,
      [req.user.id],
      (err, keys) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(keys || []);
      }
    );
  });

  // POST /api/api-keys - Create a new API key
  app.post('/api/api-keys', (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

    const { name, permissions, expires_in_days } = req.body;

    if (!name || name.trim().length === 0) {
      return res.status(400).json({ error: 'Name is required' });
    }

    const { key, prefix, hash } = generateApiKey();
    const permissionsStr = permissions || 'read';

    // Default and maximum expiration for API keys
    const DEFAULT_EXPIRY_DAYS = 90;
    const MAX_EXPIRY_DAYS = 365;

    let expiryDays = expires_in_days || DEFAULT_EXPIRY_DAYS;
    expiryDays = Math.min(Math.max(1, expiryDays), MAX_EXPIRY_DAYS);

    const expiry = new Date();
    expiry.setDate(expiry.getDate() + expiryDays);
    const expiresAt = expiry.toISOString();

    db.run(
      `INSERT INTO api_keys (name, key_hash, key_prefix, user_id, permissions, expires_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [name, hash, prefix, req.user.id, permissionsStr, expiresAt],
      function(err) {
        if (err) {
          if (err.message.includes('UNIQUE')) {
            return res.status(409).json({ error: 'An API key with this hash already exists' });
          }
          return res.status(500).json({ error: err.message });
        }

        res.json({
          id: this.lastID,
          name,
          key,
          key_prefix: prefix,
          permissions: permissionsStr,
          expires_at: expiresAt,
          created_at: new Date().toISOString(),
          message: 'Save this key securely - it will not be shown again!'
        });
      }
    );
  });

  // PUT /api/api-keys/:id - Update an API key
  app.put('/api/api-keys/:id', (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

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
      `UPDATE api_keys SET ${updates.join(', ')} WHERE id = ? AND user_id = ?`,
      params,
      function(err) {
        if (err) return res.status(500).json({ error: err.message });
        if (this.changes === 0) return res.status(404).json({ error: 'API key not found' });
        res.json({ message: 'API key updated successfully' });
      }
    );
  });

  // DELETE /api/api-keys/:id - Delete an API key
  app.delete('/api/api-keys/:id', (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

    db.run(
      'DELETE FROM api_keys WHERE id = ? AND user_id = ?',
      [req.params.id, req.user.id],
      function(err) {
        if (err) return res.status(500).json({ error: err.message });
        if (this.changes === 0) return res.status(404).json({ error: 'API key not found' });
        res.json({ message: 'API key deleted successfully' });
      }
    );
  });

  // ==================== RATINGS ROUTES ====================

  // GET /api/ratings/my-ratings - Get all ratings by current user (MUST be before :audiobookId routes)
  app.get('/api/ratings/my-ratings', (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

    db.all(
      `SELECT ur.*, a.title, a.author, a.cover_image
       FROM user_ratings ur
       JOIN audiobooks a ON ur.audiobook_id = a.id
       WHERE ur.user_id = ?
       ORDER BY ur.updated_at DESC`,
      [req.user.id],
      (err, ratings) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(ratings || []);
      }
    );
  });

  // GET /api/ratings/audiobook/:audiobookId - Get current user's rating for an audiobook
  app.get('/api/ratings/audiobook/:audiobookId', (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

    db.get(
      'SELECT * FROM user_ratings WHERE user_id = ? AND audiobook_id = ?',
      [req.user.id, req.params.audiobookId],
      (err, rating) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rating || null);
      }
    );
  });

  // GET /api/ratings/audiobook/:audiobookId/all - Get all ratings for an audiobook
  app.get('/api/ratings/audiobook/:audiobookId/all', (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

    db.all(
      `SELECT ur.*, u.username, u.display_name
       FROM user_ratings ur
       JOIN users u ON ur.user_id = u.id
       WHERE ur.audiobook_id = ?
       ORDER BY ur.updated_at DESC`,
      [req.params.audiobookId],
      (err, ratings) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(ratings || []);
      }
    );
  });

  // GET /api/ratings/audiobook/:audiobookId/average - Get average rating for an audiobook
  app.get('/api/ratings/audiobook/:audiobookId/average', (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

    db.get(
      `SELECT
         AVG(rating) as average_rating,
         COUNT(*) as rating_count
       FROM user_ratings
       WHERE audiobook_id = ? AND rating IS NOT NULL`,
      [req.params.audiobookId],
      (err, result) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({
          average: result.average_rating ? Math.round(result.average_rating * 10) / 10 : null,
          count: result.rating_count || 0
        });
      }
    );
  });

  // POST /api/ratings/audiobook/:audiobookId - Set or update rating/review for an audiobook
  app.post('/api/ratings/audiobook/:audiobookId', (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

    const { audiobookId } = req.params;
    const { rating, review } = req.body;

    // Validate rating if provided
    if (rating !== undefined && rating !== null) {
      const ratingNum = parseInt(rating);
      if (isNaN(ratingNum) || ratingNum < 1 || ratingNum > 5) {
        return res.status(400).json({ error: 'Rating must be between 1 and 5' });
      }
    }

    // Check if rating already exists
    db.get(
      'SELECT id FROM user_ratings WHERE user_id = ? AND audiobook_id = ?',
      [req.user.id, audiobookId],
      (err, existing) => {
        if (err) return res.status(500).json({ error: err.message });

        if (existing) {
          // Update existing rating
          db.run(
            `UPDATE user_ratings
             SET rating = ?, review = ?, updated_at = CURRENT_TIMESTAMP
             WHERE user_id = ? AND audiobook_id = ?`,
            [rating || null, review || null, req.user.id, audiobookId],
            function(err) {
              if (err) return res.status(500).json({ error: err.message });

              db.get('SELECT * FROM user_ratings WHERE id = ?', [existing.id], (err, updated) => {
                if (err) return res.status(500).json({ error: err.message });
                res.json(updated);
              });
            }
          );
        } else {
          // Create new rating
          db.run(
            'INSERT INTO user_ratings (user_id, audiobook_id, rating, review) VALUES (?, ?, ?, ?)',
            [req.user.id, audiobookId, rating || null, review || null],
            function(err) {
              if (err) return res.status(500).json({ error: err.message });

              db.get('SELECT * FROM user_ratings WHERE id = ?', [this.lastID], (err, created) => {
                if (err) return res.status(500).json({ error: err.message });
                res.status(201).json(created);
              });
            }
          );
        }
      }
    );
  });

  // DELETE /api/ratings/audiobook/:audiobookId - Delete rating/review for an audiobook
  app.delete('/api/ratings/audiobook/:audiobookId', (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

    db.run(
      'DELETE FROM user_ratings WHERE user_id = ? AND audiobook_id = ?',
      [req.user.id, req.params.audiobookId],
      function(err) {
        if (err) return res.status(500).json({ error: err.message });
        if (this.changes === 0) return res.status(404).json({ error: 'Rating not found' });
        res.json({ success: true });
      }
    );
  });

  // ==================== SESSIONS ROUTES ====================

  // Mock session manager for tests
  const mockSessions = new Map();

  const getTestSessionManager = () => ({
    getAllSessions: () => Array.from(mockSessions.values()),
    getUserSessions: (userId) => Array.from(mockSessions.values()).filter(s => s.userId === userId),
    getSession: (sessionId) => mockSessions.get(sessionId) || null,
    stopSession: (sessionId) => mockSessions.delete(sessionId),
    createSession: (session) => { mockSessions.set(session.id, session); return session; }
  });

  // Expose session manager for tests
  app.testSessionManager = getTestSessionManager();

  // GET /api/sessions - Get all active sessions
  app.get('/api/sessions', (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

    try {
      const sessions = app.testSessionManager.getAllSessions();
      res.json({ sessions });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // GET /api/sessions/user/:userId - Get sessions for a specific user
  app.get('/api/sessions/user/:userId', (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

    try {
      const sessions = app.testSessionManager.getUserSessions(parseInt(req.params.userId));
      res.json({ sessions });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // GET /api/sessions/:sessionId - Get a specific session by ID
  app.get('/api/sessions/:sessionId', (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

    try {
      const session = app.testSessionManager.getSession(req.params.sessionId);
      if (!session) {
        return res.status(404).json({ error: 'Session not found' });
      }
      res.json({ session });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // DELETE /api/sessions/:sessionId - Stop a session
  app.delete('/api/sessions/:sessionId', (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

    try {
      app.testSessionManager.stopSession(req.params.sessionId);
      res.json({ success: true, message: 'Session stopped' });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // ==================== SERIES ROUTES ====================

  // GET /api/series/:seriesName/recap - Get series recap (limited test - returns mock data)
  app.get('/api/series/:seriesName/recap', (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

    const { seriesName } = req.params;
    const decodedSeriesName = decodeURIComponent(seriesName);

    // Check cache first
    db.get(
      'SELECT * FROM series_recaps WHERE series_name = ?',
      [decodedSeriesName],
      (err, cached) => {
        if (err) return res.status(500).json({ error: err.message });

        if (cached) {
          return res.json({
            seriesName: decodedSeriesName,
            recap: cached.recap,
            cached: true,
            generatedAt: cached.created_at
          });
        }

        // In real app, would call AI here. For tests, return mock
        res.json({
          seriesName: decodedSeriesName,
          recap: 'Mock series recap for testing purposes.',
          cached: false,
          generatedAt: new Date().toISOString()
        });
      }
    );
  });

  // DELETE /api/series/:seriesName/recap - Clear cached recap (admin only)
  app.delete('/api/series/:seriesName/recap', requireAdmin, (req, res) => {
    const { seriesName } = req.params;
    const decodedSeriesName = decodeURIComponent(seriesName);

    db.run(
      'DELETE FROM series_recaps WHERE series_name = ?',
      [decodedSeriesName],
      function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true, deleted: this.changes > 0 });
      }
    );
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
