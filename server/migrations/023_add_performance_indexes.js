/**
 * Migration: Add performance indexes for common query patterns
 *
 * Addresses missing indexes that cause full table scans on:
 * - Playback progress lookups (joined on every library request)
 * - Audiobook browsing by title, author, series
 * - File path lookups during library scanning
 * - Favorites and ratings joined on library requests
 */

function up(db) {
  const indexes = [
    // playback_progress: joined on nearly every audiobook query
    {
      sql: 'CREATE INDEX IF NOT EXISTS idx_progress_user_audiobook ON playback_progress(user_id, audiobook_id)',
      name: 'idx_progress_user_audiobook'
    },
    {
      sql: 'CREATE INDEX IF NOT EXISTS idx_progress_updated ON playback_progress(user_id, updated_at DESC)',
      name: 'idx_progress_updated'
    },

    // audiobooks: file_path lookups during library scanning
    {
      sql: 'CREATE INDEX IF NOT EXISTS idx_audiobooks_file_path ON audiobooks(file_path)',
      name: 'idx_audiobooks_file_path'
    },

    // audiobooks: default sort and search
    {
      sql: 'CREATE INDEX IF NOT EXISTS idx_audiobooks_title ON audiobooks(title)',
      name: 'idx_audiobooks_title'
    },

    // audiobooks: author browsing and filtering
    {
      sql: 'CREATE INDEX IF NOT EXISTS idx_audiobooks_author_title ON audiobooks(author, title)',
      name: 'idx_audiobooks_author_title'
    },

    // audiobooks: series browsing and ordering
    {
      sql: 'CREATE INDEX IF NOT EXISTS idx_audiobooks_series_position ON audiobooks(series, series_position)',
      name: 'idx_audiobooks_series_position'
    },

    // audiobooks: genre filtering
    {
      sql: 'CREATE INDEX IF NOT EXISTS idx_audiobooks_genre ON audiobooks(genre)',
      name: 'idx_audiobooks_genre'
    },

    // audiobooks: availability filtering (most queries filter on is_available = 1)
    // Note: idx_audiobooks_is_available may already exist from migration 016,
    // IF NOT EXISTS handles this safely
    {
      sql: 'CREATE INDEX IF NOT EXISTS idx_audiobooks_available_title ON audiobooks(is_available, title)',
      name: 'idx_audiobooks_available_title'
    },

    // user_favorites: joined on library requests
    {
      sql: 'CREATE INDEX IF NOT EXISTS idx_favorites_user_audiobook ON user_favorites(user_id, audiobook_id)',
      name: 'idx_favorites_user_audiobook'
    },
    {
      sql: 'CREATE INDEX IF NOT EXISTS idx_favorites_audiobook ON user_favorites(audiobook_id)',
      name: 'idx_favorites_audiobook'
    },

    // user_ratings: joined on library requests
    // Note: idx_ratings_audiobook may already exist from migration 012
    {
      sql: 'CREATE INDEX IF NOT EXISTS idx_ratings_user_audiobook ON user_ratings(user_id, audiobook_id)',
      name: 'idx_ratings_user_audiobook'
    },

    // users: username lookup on login
    {
      sql: 'CREATE INDEX IF NOT EXISTS idx_users_username ON users(username)',
      name: 'idx_users_username'
    },

    // audiobook_chapters: lookup by audiobook_id
    {
      sql: 'CREATE INDEX IF NOT EXISTS idx_chapters_audiobook ON audiobook_chapters(audiobook_id)',
      name: 'idx_chapters_audiobook'
    }
  ];

  for (const index of indexes) {
    db.run(index.sql, (err) => {
      if (err) {
        console.error(`Error creating ${index.name}:`, err.message);
      } else {
        console.log(`Created index: ${index.name}`);
      }
    });
  }
}

function down(db) {
  const indexNames = [
    'idx_progress_user_audiobook',
    'idx_progress_updated',
    'idx_audiobooks_file_path',
    'idx_audiobooks_title',
    'idx_audiobooks_author_title',
    'idx_audiobooks_series_position',
    'idx_audiobooks_genre',
    'idx_audiobooks_available_title',
    'idx_favorites_user_audiobook',
    'idx_favorites_audiobook',
    'idx_ratings_user_audiobook',
    'idx_users_username',
    'idx_chapters_audiobook'
  ];

  for (const name of indexNames) {
    db.run(`DROP INDEX IF EXISTS ${name}`, (err) => {
      if (err) console.error(`Error dropping ${name}:`, err.message);
    });
  }
}

module.exports = { up, down };
