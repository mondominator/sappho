const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const logger = require('./utils/logger');

const dbPath = process.env.DATABASE_PATH || path.join(__dirname, '../data/sappho.db');
const dbDir = path.dirname(dbPath);

// Ensure data directory exists
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

// Handle legacy database migration (sapho.db -> sappho.db)
// Early versions used misspelled "sapho.db" - migrate if found
if (!process.env.DATABASE_PATH) {
  const legacyDbPath = path.join(dbDir, 'sapho.db');

  if (!fs.existsSync(dbPath) && fs.existsSync(legacyDbPath)) {
    logger.info('Migrating legacy database: sapho.db -> sappho.db');
    try {
      fs.renameSync(legacyDbPath, dbPath);
      logger.info('Legacy database migration successful');
    } catch (err) {
      logger.error({ err }, 'Legacy database migration failed');
      logger.info('Falling back to legacy database path');
    }
  }
}

let dbReadyResolve;
const dbReady = new Promise((resolve) => {
  dbReadyResolve = resolve;
});

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    logger.fatal({ err }, 'Error opening database');
    process.exit(1);
  } else {
    logger.info({ path: dbPath }, 'Connected to SQLite database');
    // Enable foreign key constraint enforcement (off by default in SQLite)
    db.run('PRAGMA foreign_keys = ON', (fkErr) => {
      if (fkErr) {
        logger.error({ err: fkErr }, 'Error enabling foreign keys');
      } else {
        logger.debug('Foreign key constraints enabled');
      }
    });
    // Enable Write-Ahead Logging for better concurrent read performance
    db.run('PRAGMA journal_mode = WAL', (walErr) => {
      if (walErr) {
        logger.error({ err: walErr }, 'Error enabling WAL mode');
      } else {
        logger.debug('WAL journal mode enabled');
      }
    });
    initializeDatabase();
  }
});

/**
 * Initialize the database schema.
 *
 * This is the complete, current schema — all previous migrations have been
 * consolidated here. Every statement uses CREATE TABLE IF NOT EXISTS /
 * CREATE INDEX IF NOT EXISTS / CREATE TRIGGER IF NOT EXISTS so it's safe
 * to run on every startup against an existing database.
 *
 * For schema changes going forward:
 * - Small additive changes: add a CREATE TABLE / ALTER TABLE here
 * - Backfill/data migration: write a one-off script, run it manually,
 *   then fold the schema change into this file
 */
function initializeDatabase() {
  db.serialize(() => {
    // -------------------------------------------------------------------
    // Users
    // -------------------------------------------------------------------
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
        share_activity INTEGER DEFAULT 0,
        show_in_feed INTEGER DEFAULT 1,
        mfa_secret TEXT,
        mfa_enabled INTEGER DEFAULT 0,
        mfa_backup_codes TEXT,
        mfa_enabled_at TIMESTAMP,
        account_disabled INTEGER DEFAULT 0,
        disabled_at TIMESTAMP,
        disabled_reason TEXT,
        auth_method TEXT DEFAULT 'local',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Add any new user columns here with try/catch for existing DBs
    addColumnIfMissing('users', 'display_name', 'TEXT');
    addColumnIfMissing('users', 'avatar', 'TEXT');
    addColumnIfMissing('users', 'share_activity', 'INTEGER DEFAULT 0');
    addColumnIfMissing('users', 'show_in_feed', 'INTEGER DEFAULT 1');
    addColumnIfMissing('users', 'mfa_secret', 'TEXT');
    addColumnIfMissing('users', 'mfa_enabled', 'INTEGER DEFAULT 0');
    addColumnIfMissing('users', 'mfa_backup_codes', 'TEXT');
    addColumnIfMissing('users', 'mfa_enabled_at', 'TIMESTAMP');
    addColumnIfMissing('users', 'account_disabled', 'INTEGER DEFAULT 0');
    addColumnIfMissing('users', 'disabled_at', 'TIMESTAMP');
    addColumnIfMissing('users', 'disabled_reason', 'TEXT');
    addColumnIfMissing('users', 'auth_method', "TEXT DEFAULT 'local'");

    // -------------------------------------------------------------------
    // Audiobooks
    // -------------------------------------------------------------------
    db.run(`
      CREATE TABLE IF NOT EXISTS audiobooks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        subtitle TEXT,
        author TEXT,
        narrator TEXT,
        description TEXT,
        duration INTEGER,
        file_path TEXT NOT NULL,
        file_size INTEGER,
        cover_image TEXT,
        cover_path TEXT,
        isbn TEXT,
        asin TEXT,
        publisher TEXT,
        published_year INTEGER,
        copyright_year INTEGER,
        genre TEXT,
        tags TEXT,
        rating TEXT,
        abridged INTEGER DEFAULT 0,
        series TEXT,
        series_position REAL,
        series_index REAL,
        language TEXT DEFAULT 'en',
        is_multi_file INTEGER DEFAULT 0,
        content_hash VARCHAR(16),
        is_available INTEGER DEFAULT 1,
        last_seen_at DATETIME,
        original_path TEXT,
        added_by INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (added_by) REFERENCES users(id)
      )
    `);

    // Additive columns for existing databases
    addColumnIfMissing('audiobooks', 'subtitle', 'TEXT');
    addColumnIfMissing('audiobooks', 'asin', 'TEXT');
    addColumnIfMissing('audiobooks', 'publisher', 'TEXT');
    addColumnIfMissing('audiobooks', 'cover_path', 'TEXT');
    addColumnIfMissing('audiobooks', 'series_index', 'REAL');
    addColumnIfMissing('audiobooks', 'is_multi_file', 'INTEGER DEFAULT 0');
    addColumnIfMissing('audiobooks', 'copyright_year', 'INTEGER');
    addColumnIfMissing('audiobooks', 'rating', 'TEXT');
    addColumnIfMissing('audiobooks', 'abridged', 'INTEGER DEFAULT 0');
    addColumnIfMissing('audiobooks', 'tags', 'TEXT');
    addColumnIfMissing('audiobooks', 'content_hash', 'VARCHAR(16)');
    addColumnIfMissing('audiobooks', 'is_available', 'INTEGER DEFAULT 1');
    addColumnIfMissing('audiobooks', 'last_seen_at', 'DATETIME');
    addColumnIfMissing('audiobooks', 'original_path', 'TEXT');

    // -------------------------------------------------------------------
    // Playback progress
    // -------------------------------------------------------------------
    db.run(`
      CREATE TABLE IF NOT EXISTS playback_progress (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        audiobook_id INTEGER NOT NULL,
        position INTEGER NOT NULL DEFAULT 0,
        completed INTEGER DEFAULT 0,
        queued_at DATETIME,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id),
        FOREIGN KEY (audiobook_id) REFERENCES audiobooks(id),
        UNIQUE(user_id, audiobook_id)
      )
    `);
    addColumnIfMissing('playback_progress', 'queued_at', 'DATETIME');

    // -------------------------------------------------------------------
    // Tags
    // -------------------------------------------------------------------
    db.run(`
      CREATE TABLE IF NOT EXISTS tags (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE NOT NULL
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS audiobook_tags (
        audiobook_id INTEGER,
        tag_id INTEGER,
        PRIMARY KEY (audiobook_id, tag_id),
        FOREIGN KEY (audiobook_id) REFERENCES audiobooks(id) ON DELETE CASCADE,
        FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
      )
    `);

    // -------------------------------------------------------------------
    // API keys
    // -------------------------------------------------------------------
    db.run(`
      CREATE TABLE IF NOT EXISTS api_keys (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        key_hash TEXT UNIQUE NOT NULL,
        key_prefix TEXT NOT NULL,
        user_id INTEGER NOT NULL,
        permissions TEXT DEFAULT 'read',
        last_used_at DATETIME,
        expires_at DATETIME,
        is_active INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    // -------------------------------------------------------------------
    // Chapters (for multi-file audiobooks)
    // -------------------------------------------------------------------
    db.run(`
      CREATE TABLE IF NOT EXISTS audiobook_chapters (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        audiobook_id INTEGER NOT NULL,
        chapter_number INTEGER NOT NULL,
        file_path TEXT NOT NULL,
        duration INTEGER,
        file_size INTEGER,
        title TEXT,
        start_time REAL DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(audiobook_id, chapter_number),
        FOREIGN KEY (audiobook_id) REFERENCES audiobooks(id) ON DELETE CASCADE
      )
    `);
    addColumnIfMissing('audiobook_chapters', 'start_time', 'REAL DEFAULT 0');

    // -------------------------------------------------------------------
    // Favorites / Reading List
    // -------------------------------------------------------------------
    db.run(`
      CREATE TABLE IF NOT EXISTS user_favorites (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        audiobook_id INTEGER NOT NULL,
        priority INTEGER DEFAULT 0,
        list_order INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, audiobook_id),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (audiobook_id) REFERENCES audiobooks(id) ON DELETE CASCADE
      )
    `);
    addColumnIfMissing('user_favorites', 'priority', 'INTEGER DEFAULT 0');
    addColumnIfMissing('user_favorites', 'list_order', 'INTEGER DEFAULT 0');

    // -------------------------------------------------------------------
    // Collections
    // -------------------------------------------------------------------
    db.run(`
      CREATE TABLE IF NOT EXISTS user_collections (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        cover_image TEXT,
        is_public INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);
    addColumnIfMissing('user_collections', 'is_public', 'INTEGER DEFAULT 0');

    db.run(`
      CREATE TABLE IF NOT EXISTS collection_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        collection_id INTEGER NOT NULL,
        audiobook_id INTEGER NOT NULL,
        position INTEGER NOT NULL DEFAULT 0,
        added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(collection_id, audiobook_id),
        FOREIGN KEY (collection_id) REFERENCES user_collections(id) ON DELETE CASCADE,
        FOREIGN KEY (audiobook_id) REFERENCES audiobooks(id) ON DELETE CASCADE
      )
    `);

    // -------------------------------------------------------------------
    // Ratings
    // -------------------------------------------------------------------
    db.run(`
      CREATE TABLE IF NOT EXISTS user_ratings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        audiobook_id INTEGER NOT NULL,
        rating INTEGER CHECK(rating >= 1 AND rating <= 5),
        review TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, audiobook_id),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (audiobook_id) REFERENCES audiobooks(id) ON DELETE CASCADE
      )
    `);

    // -------------------------------------------------------------------
    // Recaps (AI-generated series/book summaries)
    // -------------------------------------------------------------------
    db.run(`
      CREATE TABLE IF NOT EXISTS series_recaps (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        series_name TEXT NOT NULL,
        books_hash TEXT NOT NULL,
        recap_text TEXT NOT NULL,
        model_used TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, series_name, books_hash),
        FOREIGN KEY (user_id) REFERENCES users(id)
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS book_recaps (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        audiobook_id INTEGER NOT NULL,
        books_hash TEXT NOT NULL,
        recap_text TEXT NOT NULL,
        model_used TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, audiobook_id, books_hash),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (audiobook_id) REFERENCES audiobooks(id) ON DELETE CASCADE
      )
    `);

    // -------------------------------------------------------------------
    // Email settings and notifications
    // -------------------------------------------------------------------
    db.run(`
      CREATE TABLE IF NOT EXISTS email_settings (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        host TEXT,
        port INTEGER DEFAULT 587,
        secure INTEGER DEFAULT 0,
        username TEXT,
        password TEXT,
        from_address TEXT,
        from_name TEXT,
        enabled INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS user_notification_prefs (
        user_id INTEGER PRIMARY KEY,
        email_new_audiobook INTEGER DEFAULT 0,
        email_weekly_summary INTEGER DEFAULT 0,
        email_recommendations INTEGER DEFAULT 0,
        email_enabled INTEGER DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS notifications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL,
        title TEXT NOT NULL,
        message TEXT NOT NULL,
        metadata TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS user_notification_reads (
        user_id INTEGER NOT NULL,
        notification_id INTEGER NOT NULL,
        read_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (user_id, notification_id),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (notification_id) REFERENCES notifications(id) ON DELETE CASCADE
      )
    `);

    // -------------------------------------------------------------------
    // Authentication tokens
    // -------------------------------------------------------------------
    db.run(`
      CREATE TABLE IF NOT EXISTS unlock_tokens (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        token TEXT UNIQUE NOT NULL,
        expires_at TIMESTAMP NOT NULL,
        used_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS revoked_tokens (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        token_hash TEXT NOT NULL UNIQUE,
        user_id INTEGER,
        expires_at INTEGER NOT NULL,
        revoked_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS user_token_invalidations (
        user_id INTEGER PRIMARY KEY,
        invalidated_at INTEGER NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    // -------------------------------------------------------------------
    // OIDC (external auth provider)
    // -------------------------------------------------------------------
    db.run(`
      CREATE TABLE IF NOT EXISTS oidc_config (
        id INTEGER PRIMARY KEY,
        provider_name TEXT NOT NULL,
        issuer_url TEXT NOT NULL,
        client_id TEXT NOT NULL,
        client_secret TEXT NOT NULL,
        auto_provision INTEGER DEFAULT 1,
        default_admin INTEGER DEFAULT 0,
        enabled INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // -------------------------------------------------------------------
    // Listening sessions (OpsDec integration)
    // -------------------------------------------------------------------
    db.run(`
      CREATE TABLE IF NOT EXISTS listening_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        audiobook_id INTEGER NOT NULL,
        started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        stopped_at DATETIME,
        start_position INTEGER NOT NULL DEFAULT 0,
        end_position INTEGER,
        device_name TEXT,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (audiobook_id) REFERENCES audiobooks(id) ON DELETE CASCADE
      )
    `);

    // -------------------------------------------------------------------
    // Duplicate detection
    // -------------------------------------------------------------------
    db.run(`
      CREATE TABLE IF NOT EXISTS duplicate_flags (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        audiobook_id INTEGER NOT NULL,
        existing_audiobook_id INTEGER NOT NULL,
        match_type TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        resolved_at TEXT,
        FOREIGN KEY (audiobook_id) REFERENCES audiobooks(id) ON DELETE CASCADE,
        FOREIGN KEY (existing_audiobook_id) REFERENCES audiobooks(id) ON DELETE CASCADE
      )
    `);

    // -------------------------------------------------------------------
    // Indexes
    // -------------------------------------------------------------------
    db.run('CREATE INDEX IF NOT EXISTS idx_users_username ON users(username)');
    db.run('CREATE INDEX IF NOT EXISTS idx_audiobooks_file_path ON audiobooks(file_path)');
    db.run('CREATE INDEX IF NOT EXISTS idx_audiobooks_title ON audiobooks(title)');
    db.run('CREATE INDEX IF NOT EXISTS idx_audiobooks_author_title ON audiobooks(author, title)');
    db.run('CREATE INDEX IF NOT EXISTS idx_audiobooks_series_position ON audiobooks(series, series_position)');
    db.run('CREATE INDEX IF NOT EXISTS idx_audiobooks_genre ON audiobooks(genre)');
    db.run('CREATE INDEX IF NOT EXISTS idx_audiobooks_is_available ON audiobooks(is_available)');
    db.run('CREATE INDEX IF NOT EXISTS idx_audiobooks_available_title ON audiobooks(is_available, title)');
    db.run('CREATE INDEX IF NOT EXISTS idx_audiobooks_content_hash ON audiobooks(content_hash)');
    db.run('CREATE INDEX IF NOT EXISTS idx_progress_user_audiobook ON playback_progress(user_id, audiobook_id)');
    db.run('CREATE INDEX IF NOT EXISTS idx_progress_updated ON playback_progress(user_id, updated_at DESC)');
    db.run('CREATE INDEX IF NOT EXISTS idx_playback_progress_queued_at ON playback_progress(queued_at)');
    db.run('CREATE INDEX IF NOT EXISTS idx_chapters_audiobook ON audiobook_chapters(audiobook_id)');
    db.run('CREATE INDEX IF NOT EXISTS idx_favorites_user_audiobook ON user_favorites(user_id, audiobook_id)');
    db.run('CREATE INDEX IF NOT EXISTS idx_favorites_audiobook ON user_favorites(audiobook_id)');
    db.run('CREATE INDEX IF NOT EXISTS idx_collections_user ON user_collections(user_id)');
    db.run('CREATE INDEX IF NOT EXISTS idx_collections_public ON user_collections(is_public)');
    db.run('CREATE INDEX IF NOT EXISTS idx_collection_items_collection ON collection_items(collection_id)');
    db.run('CREATE INDEX IF NOT EXISTS idx_ratings_user_audiobook ON user_ratings(user_id, audiobook_id)');
    db.run('CREATE INDEX IF NOT EXISTS idx_ratings_user ON user_ratings(user_id)');
    db.run('CREATE INDEX IF NOT EXISTS idx_ratings_audiobook ON user_ratings(audiobook_id)');
    db.run('CREATE INDEX IF NOT EXISTS idx_ratings_rating ON user_ratings(rating)');
    db.run('CREATE INDEX IF NOT EXISTS idx_unlock_tokens_token ON unlock_tokens(token)');
    db.run('CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications(created_at DESC)');
    db.run('CREATE INDEX IF NOT EXISTS idx_notifications_type ON notifications(type)');
    db.run('CREATE INDEX IF NOT EXISTS idx_revoked_tokens_hash ON revoked_tokens(token_hash)');
    db.run('CREATE INDEX IF NOT EXISTS idx_revoked_tokens_expires ON revoked_tokens(expires_at)');
    db.run('CREATE INDEX IF NOT EXISTS idx_listening_sessions_user_book ON listening_sessions(user_id, audiobook_id)');
    db.run('CREATE INDEX IF NOT EXISTS idx_listening_sessions_started ON listening_sessions(started_at)');
    db.run('CREATE INDEX IF NOT EXISTS idx_duplicate_flags_status ON duplicate_flags(status)');
    db.run('CREATE INDEX IF NOT EXISTS idx_duplicate_flags_audiobook ON duplicate_flags(audiobook_id)');

    // -------------------------------------------------------------------
    // Full-text search (FTS5 virtual table + triggers)
    // -------------------------------------------------------------------
    db.run(`
      CREATE VIRTUAL TABLE IF NOT EXISTS audiobooks_fts USING fts5(
        title, author, series, narrator, description,
        content=audiobooks, content_rowid=id
      )
    `);

    db.run(`
      CREATE TRIGGER IF NOT EXISTS audiobooks_fts_insert
      AFTER INSERT ON audiobooks
      BEGIN
        INSERT INTO audiobooks_fts(rowid, title, author, narrator, series, description)
        VALUES (NEW.id, COALESCE(NEW.title, ''), COALESCE(NEW.author, ''), COALESCE(NEW.narrator, ''), COALESCE(NEW.series, ''), COALESCE(NEW.description, ''));
      END
    `);

    db.run(`
      CREATE TRIGGER IF NOT EXISTS audiobooks_fts_delete
      AFTER DELETE ON audiobooks
      BEGIN
        INSERT INTO audiobooks_fts(audiobooks_fts, rowid, title, author, narrator, series, description)
        VALUES ('delete', OLD.id, COALESCE(OLD.title, ''), COALESCE(OLD.author, ''), COALESCE(OLD.narrator, ''), COALESCE(OLD.series, ''), COALESCE(OLD.description, ''));
      END
    `);

    db.run(`
      CREATE TRIGGER IF NOT EXISTS audiobooks_fts_update
      AFTER UPDATE ON audiobooks
      BEGIN
        INSERT INTO audiobooks_fts(audiobooks_fts, rowid, title, author, narrator, series, description)
        VALUES ('delete', OLD.id, COALESCE(OLD.title, ''), COALESCE(OLD.author, ''), COALESCE(OLD.narrator, ''), COALESCE(OLD.series, ''), COALESCE(OLD.description, ''));
        INSERT INTO audiobooks_fts(rowid, title, author, narrator, series, description)
        VALUES (NEW.id, COALESCE(NEW.title, ''), COALESCE(NEW.author, ''), COALESCE(NEW.narrator, ''), COALESCE(NEW.series, ''), COALESCE(NEW.description, ''));
      END
    `);

    // Backfill series_index from series_position for existing rows where it's null
    db.run(
      'UPDATE audiobooks SET series_index = series_position WHERE series_index IS NULL AND series_position IS NOT NULL',
      (err) => {
        if (err) logger.debug({ err: err.message }, 'series_index backfill skipped');
      }
    );

    // Signal that database is ready AFTER all queued SQL has executed.
    db.get('SELECT 1', [], () => {
      logger.info('Database initialized');
      if (dbReadyResolve) {
        dbReadyResolve();
      }
    });
  });
}

/**
 * Add a column to a table if it doesn't already exist.
 * Safe to call against both fresh and existing databases.
 */
function addColumnIfMissing(table, column, definition) {
  db.all(`PRAGMA table_info(${table})`, (err, columns) => {
    if (err) return;
    const exists = columns.some((col) => col.name === column);
    if (!exists) {
      db.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`, (alterErr) => {
        if (alterErr && !alterErr.message.includes('duplicate column')) {
          logger.error({ err: alterErr, table, column }, 'Error adding column');
        } else if (!alterErr) {
          logger.info({ table, column }, 'Added missing column');
        }
      });
    }
  });
}

/**
 * Checkpoint WAL to flush pending writes into the main database file.
 * Should be called before any operation that needs a consistent DB file on disk.
 */
function checkpoint() {
  return new Promise((resolve, reject) => {
    db.run('PRAGMA wal_checkpoint(TRUNCATE)', (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

/**
 * Close the database connection.
 * Used before backup restore to release file locks.
 */
function closeDatabase() {
  return new Promise((resolve, reject) => {
    db.close((err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

// Export both the db instance and the ready promise
db.ready = dbReady;
db.checkpoint = checkpoint;
db.closeDatabase = closeDatabase;
db.dbPath = dbPath;
module.exports = db;
