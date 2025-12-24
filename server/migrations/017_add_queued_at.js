/**
 * Migration: Add queued_at column to playback_progress table
 *
 * Adds:
 * - queued_at: Timestamp when a book was queued as "up next" (e.g., after finishing previous book in series)
 *
 * This allows distinguishing between books that were accidentally opened (position=0)
 * and books that were intentionally queued as the next in a series.
 */

function up(db) {
  db.run(`
    ALTER TABLE playback_progress ADD COLUMN queued_at DATETIME
  `, (err) => {
    if (err && !err.message.includes('duplicate column')) {
      console.error('Error adding queued_at column:', err.message);
    } else if (!err) {
      console.log('Added queued_at column to playback_progress table');
    }
  });

  // Create index for faster filtering of queued books
  db.run(`
    CREATE INDEX IF NOT EXISTS idx_playback_progress_queued_at ON playback_progress(queued_at)
  `, (err) => {
    if (err) {
      console.error('Error creating queued_at index:', err.message);
    } else {
      console.log('Created index on queued_at column');
    }
  });
}

function down(_db) {
  console.log('Rollback not supported for this migration');
}

module.exports = { up, down };
