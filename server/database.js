const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const dbPath = process.env.DATABASE_PATH || path.join(__dirname, '../data/sapho.db');
const dbDir = path.dirname(dbPath);

// Ensure data directory exists
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

let dbReadyResolve;
const dbReady = new Promise((resolve) => {
  dbReadyResolve = resolve;
});

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Error opening database:', err);
  } else {
    console.log('Connected to SQLite database at:', dbPath);
    initializeDatabase();
  }
});

function initializeDatabase() {
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
        description TEXT,
        duration INTEGER,
        file_path TEXT NOT NULL,
        file_size INTEGER,
        cover_image TEXT,
        isbn TEXT,
        published_year INTEGER,
        genre TEXT,
        series TEXT,
        series_position REAL,
        language TEXT DEFAULT 'en',
        added_by INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (added_by) REFERENCES users(id)
      )
    `);

    // Playback progress table
    db.run(`
      CREATE TABLE IF NOT EXISTS playback_progress (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        audiobook_id INTEGER NOT NULL,
        position INTEGER NOT NULL DEFAULT 0,
        completed INTEGER DEFAULT 0,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id),
        FOREIGN KEY (audiobook_id) REFERENCES audiobooks(id),
        UNIQUE(user_id, audiobook_id)
      )
    `);

    // Tags table for flexible categorization
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
        FOREIGN KEY (audiobook_id) REFERENCES audiobooks(id) ON DELETE CASCADE,
        FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE,
        PRIMARY KEY (audiobook_id, tag_id)
      )
    `);

    // API Keys table for external integrations
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

    // Migrations: Add new columns if they don't exist
    db.all("PRAGMA table_info(users)", (err, columns) => {
      if (!err) {
        const columnNames = columns.map(col => col.name);
        if (!columnNames.includes('display_name')) {
          db.run("ALTER TABLE users ADD COLUMN display_name TEXT");
          console.log('Added display_name column to users table');
        }
        if (!columnNames.includes('avatar')) {
          db.run("ALTER TABLE users ADD COLUMN avatar TEXT");
          console.log('Added avatar column to users table');
        }
      }
    });

    // Add series_index column as an alias for series_position
    db.all("PRAGMA table_info(audiobooks)", (err, columns) => {
      if (!err) {
        const columnNames = columns.map(col => col.name);
        if (!columnNames.includes('series_index')) {
          db.run("ALTER TABLE audiobooks ADD COLUMN series_index REAL", (err) => {
            if (err) {
              console.error('Error adding series_index column:', err);
            } else {
              console.log('Added series_index column to audiobooks table');
              // Copy series_position values to series_index
              db.run("UPDATE audiobooks SET series_index = series_position WHERE series_position IS NOT NULL", (err) => {
                if (err) {
                  console.error('Error migrating series_position to series_index:', err);
                } else {
                  console.log('Migrated series_position to series_index');
                }
              });
            }
          });
        }
      }
    });

    // Run migrations after core tables are created
    runMigrations();

    console.log('Database initialized');

    // Signal that database is ready
    if (dbReadyResolve) {
      dbReadyResolve();
    }
  });
}

function runMigrations() {
  const migrationsDir = path.join(__dirname, 'migrations');

  // Check if migrations directory exists
  if (!fs.existsSync(migrationsDir)) {
    console.log('No migrations directory found');
    return;
  }

  // Get all migration files
  const migrationFiles = fs.readdirSync(migrationsDir)
    .filter(file => file.endsWith('.js'))
    .sort();

  console.log(`Found ${migrationFiles.length} migration(s)`);

  // Run each migration
  for (const file of migrationFiles) {
    const migrationPath = path.join(migrationsDir, file);
    try {
      const migration = require(migrationPath);
      console.log(`Running migration: ${file}`);
      migration.up(db);
    } catch (error) {
      console.error(`Error running migration ${file}:`, error);
    }
  }
}

// Export both the db instance and the ready promise
db.ready = dbReady;
module.exports = db;
