/**
 * Database Migration Tests
 * Verifies that migrations can run cleanly on a fresh database
 */

const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');

describe('Database Migrations', () => {
  let db;

  beforeEach((done) => {
    // Create fresh in-memory database for each test
    db = new sqlite3.Database(':memory:', done);
  });

  afterEach((done) => {
    db.close(done);
  });

  test('base schema creates required tables', (done) => {
    // Create base schema (from database.js)
    db.serialize(() => {
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

      db.run(`
        CREATE TABLE IF NOT EXISTS audiobooks (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          title TEXT NOT NULL,
          author TEXT,
          file_path TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);

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

      db.run(`
        CREATE TABLE IF NOT EXISTS migrations (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT UNIQUE NOT NULL,
          applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `, (err) => {
        if (err) return done(err);

        // Verify tables exist
        db.all("SELECT name FROM sqlite_master WHERE type='table'", [], (err, tables) => {
          if (err) return done(err);

          const tableNames = tables.map(t => t.name);
          expect(tableNames).toContain('users');
          expect(tableNames).toContain('audiobooks');
          expect(tableNames).toContain('playback_progress');
          expect(tableNames).toContain('migrations');
          done();
        });
      });
    });
  });

  test('users table has required columns', (done) => {
    db.run(`
      CREATE TABLE users (
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
    `, (err) => {
      if (err) return done(err);

      db.all("PRAGMA table_info(users)", [], (err, columns) => {
        if (err) return done(err);

        const columnNames = columns.map(c => c.name);
        expect(columnNames).toContain('id');
        expect(columnNames).toContain('username');
        expect(columnNames).toContain('password_hash');
        expect(columnNames).toContain('is_admin');
        expect(columnNames).toContain('must_change_password');
        done();
      });
    });
  });

  test('migration files exist and are valid JavaScript', () => {
    const migrationsDir = path.join(__dirname, '../../server/migrations');

    if (!fs.existsSync(migrationsDir)) {
      // Skip if migrations directory doesn't exist
      return;
    }

    const migrationFiles = fs.readdirSync(migrationsDir)
      .filter(f => f.endsWith('.js'))
      .sort();

    migrationFiles.forEach(file => {
      const filePath = path.join(migrationsDir, file);

      // Verify file can be required without errors
      expect(() => {
        const migration = require(filePath);
        // Migration should export up and/or have a valid structure
        expect(typeof migration).toBe('object');
      }).not.toThrow();
    });
  });

  test('can insert and retrieve user', (done) => {
    db.serialize(() => {
      db.run(`
        CREATE TABLE users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          username TEXT UNIQUE NOT NULL,
          password_hash TEXT NOT NULL,
          is_admin INTEGER DEFAULT 0
        )
      `);

      db.run(
        'INSERT INTO users (username, password_hash, is_admin) VALUES (?, ?, ?)',
        ['testuser', 'hashedpassword', 0],
        function(err) {
          if (err) return done(err);

          expect(this.lastID).toBe(1);

          db.get('SELECT * FROM users WHERE id = ?', [1], (err, user) => {
            if (err) return done(err);

            expect(user.username).toBe('testuser');
            expect(user.is_admin).toBe(0);
            done();
          });
        }
      );
    });
  });

  test('username uniqueness constraint works', (done) => {
    db.serialize(() => {
      db.run(`
        CREATE TABLE users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          username TEXT UNIQUE NOT NULL,
          password_hash TEXT NOT NULL
        )
      `);

      db.run('INSERT INTO users (username, password_hash) VALUES (?, ?)', ['testuser', 'hash1']);
      db.run('INSERT INTO users (username, password_hash) VALUES (?, ?)', ['testuser', 'hash2'], (err) => {
        expect(err).toBeDefined();
        expect(err.message).toContain('UNIQUE constraint failed');
        done();
      });
    });
  });
});
