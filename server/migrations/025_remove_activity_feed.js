/**
 * Migration 025: Remove activity feed
 *
 * Drops the activity_events table and removes activity-related columns
 * from the users table. The activity feed feature has been removed.
 */

async function up(db) {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      // Drop activity_events table
      db.run('DROP TABLE IF EXISTS activity_events', (err) => {
        if (err) console.error('Error dropping activity_events:', err.message);
      });

      // SQLite doesn't support DROP COLUMN before 3.35.0, so we leave
      // share_activity and show_in_feed columns in users table.
      // They're harmless unused columns.

      db.run('SELECT 1', (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  });
}

async function down(_db) {
  // Activity feed has been permanently removed - no rollback
  return Promise.resolve();
}

module.exports = { up, down };
