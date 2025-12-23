/**
 * Migration: Add availability tracking columns to audiobooks table
 *
 * Adds:
 * - is_available: Whether the file exists on disk (1 = available, 0 = missing)
 * - last_seen_at: Last time the file was confirmed to exist
 * - original_path: Stores the original path for matching when book is re-added
 */

function up(db) {
  // Add is_available column (default 1 = available)
  db.run(`
    ALTER TABLE audiobooks ADD COLUMN is_available INTEGER DEFAULT 1
  `, (err) => {
    if (err && !err.message.includes('duplicate column')) {
      console.error('Error adding is_available column:', err.message);
    } else if (!err) {
      console.log('Added is_available column to audiobooks table');
    }
  });

  // Add last_seen_at column
  db.run(`
    ALTER TABLE audiobooks ADD COLUMN last_seen_at DATETIME
  `, (err) => {
    if (err && !err.message.includes('duplicate column')) {
      console.error('Error adding last_seen_at column:', err.message);
    } else if (!err) {
      console.log('Added last_seen_at column to audiobooks table');
      // Initialize last_seen_at for existing books
      db.run('UPDATE audiobooks SET last_seen_at = updated_at WHERE last_seen_at IS NULL');
    }
  });

  // Add original_path column (for matching re-added books)
  db.run(`
    ALTER TABLE audiobooks ADD COLUMN original_path TEXT
  `, (err) => {
    if (err && !err.message.includes('duplicate column')) {
      console.error('Error adding original_path column:', err.message);
    } else if (!err) {
      console.log('Added original_path column to audiobooks table');
    }
  });

  // Create index on is_available for faster filtering
  db.run(`
    CREATE INDEX IF NOT EXISTS idx_audiobooks_is_available ON audiobooks(is_available)
  `, (err) => {
    if (err) {
      console.error('Error creating is_available index:', err.message);
    } else {
      console.log('Created index on is_available column');
    }
  });

  // Create index on content_hash for faster book matching
  db.run(`
    CREATE INDEX IF NOT EXISTS idx_audiobooks_content_hash ON audiobooks(content_hash)
  `, (err) => {
    if (err) {
      console.error('Error creating content_hash index:', err.message);
    } else {
      console.log('Created index on content_hash column');
    }
  });
}

function down(_db) {
  // SQLite doesn't support DROP COLUMN easily, so we'd need to recreate the table
  // For now, just log that rollback isn't supported
  console.log('Rollback not supported for this migration');
}

module.exports = { up, down };
