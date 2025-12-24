/**
 * Activity Service
 *
 * Tracks and retrieves user activity events for the social feed
 */

const db = require('../database');

// Event types
const EVENT_TYPES = {
  STARTED_LISTENING: 'started_listening',
  FINISHED_BOOK: 'finished_book',
  RATED_BOOK: 'rated_book',
  ADDED_TO_COLLECTION: 'added_to_collection',
  PROGRESS_MILESTONE: 'progress_milestone',
  BOOK_ADDED: 'book_added'
};

/**
 * Record a new activity event
 */
function recordActivity(userId, eventType, audiobookId = null, metadata = null) {
  return new Promise((resolve, reject) => {
    const metadataJson = metadata ? JSON.stringify(metadata) : null;

    db.run(
      `INSERT INTO activity_events (user_id, event_type, audiobook_id, metadata)
       VALUES (?, ?, ?, ?)`,
      [userId, eventType, audiobookId, metadataJson],
      function(err) {
        if (err) {
          console.error('Failed to record activity:', err);
          return reject(err);
        }
        resolve({ id: this.lastID });
      }
    );
  });
}

/**
 * Get activity feed for a user (their own activity + shared activity from others)
 */
function getActivityFeed(userId, options = {}) {
  return new Promise((resolve, reject) => {
    const { limit = 50, offset = 0, includeOwn = true, type = null } = options;

    let query = `
      SELECT
        ae.id,
        ae.event_type,
        ae.created_at,
        ae.metadata,
        u.id as user_id,
        u.username,
        a.id as audiobook_id,
        a.title as book_title,
        a.author as book_author,
        a.series,
        a.series_position,
        a.cover_path
      FROM activity_events ae
      INNER JOIN users u ON ae.user_id = u.id
      LEFT JOIN audiobooks a ON ae.audiobook_id = a.id
      WHERE (
        ae.user_id = ?
        OR (u.share_activity = 1 AND u.show_in_feed = 1)
      )
    `;

    const params = [userId];

    if (type) {
      query += ' AND ae.event_type = ?';
      params.push(type);
    }

    if (!includeOwn) {
      query += ' AND ae.user_id != ?';
      params.push(userId);
    }

    query += `
      ORDER BY ae.created_at DESC
      LIMIT ? OFFSET ?
    `;
    params.push(limit, offset);

    db.all(query, params, (err, rows) => {
      if (err) {
        console.error('Failed to get activity feed:', err);
        return reject(err);
      }

      // Parse metadata JSON
      const activities = rows.map(row => ({
        ...row,
        metadata: row.metadata ? JSON.parse(row.metadata) : null
      }));

      resolve(activities);
    });
  });
}

/**
 * Get personal activity (only user's own activity)
 */
function getPersonalActivity(userId, options = {}) {
  return new Promise((resolve, reject) => {
    const { limit = 50, offset = 0, type = null } = options;

    let query = `
      SELECT
        ae.id,
        ae.event_type,
        ae.created_at,
        ae.metadata,
        a.id as audiobook_id,
        a.title as book_title,
        a.author as book_author,
        a.series,
        a.series_position,
        a.cover_path
      FROM activity_events ae
      LEFT JOIN audiobooks a ON ae.audiobook_id = a.id
      WHERE ae.user_id = ?
    `;

    const params = [userId];

    if (type) {
      query += ' AND ae.event_type = ?';
      params.push(type);
    }

    query += `
      ORDER BY ae.created_at DESC
      LIMIT ? OFFSET ?
    `;
    params.push(limit, offset);

    db.all(query, params, (err, rows) => {
      if (err) {
        console.error('Failed to get personal activity:', err);
        return reject(err);
      }

      const activities = rows.map(row => ({
        ...row,
        metadata: row.metadata ? JSON.parse(row.metadata) : null
      }));

      resolve(activities);
    });
  });
}

/**
 * Get server-wide activity (all shared activity)
 */
function getServerActivity(options = {}) {
  return new Promise((resolve, reject) => {
    const { limit = 50, offset = 0, type = null } = options;

    let query = `
      SELECT
        ae.id,
        ae.event_type,
        ae.created_at,
        ae.metadata,
        u.id as user_id,
        u.username,
        a.id as audiobook_id,
        a.title as book_title,
        a.author as book_author,
        a.series,
        a.series_position,
        a.cover_path
      FROM activity_events ae
      INNER JOIN users u ON ae.user_id = u.id
      LEFT JOIN audiobooks a ON ae.audiobook_id = a.id
      WHERE u.share_activity = 1 AND u.show_in_feed = 1
    `;

    const params = [];

    if (type) {
      query += ' AND ae.event_type = ?';
      params.push(type);
    }

    query += `
      ORDER BY ae.created_at DESC
      LIMIT ? OFFSET ?
    `;
    params.push(limit, offset);

    db.all(query, params, (err, rows) => {
      if (err) {
        console.error('Failed to get server activity:', err);
        return reject(err);
      }

      const activities = rows.map(row => ({
        ...row,
        metadata: row.metadata ? JSON.parse(row.metadata) : null
      }));

      resolve(activities);
    });
  });
}

/**
 * Update user privacy settings
 */
function updatePrivacySettings(userId, settings) {
  return new Promise((resolve, reject) => {
    const { shareActivity, showInFeed } = settings;

    db.run(
      'UPDATE users SET share_activity = ?, show_in_feed = ? WHERE id = ?',
      [shareActivity ? 1 : 0, showInFeed ? 1 : 0, userId],
      function(err) {
        if (err) {
          console.error('Failed to update privacy settings:', err);
          return reject(err);
        }
        resolve({ changes: this.changes });
      }
    );
  });
}

/**
 * Get user privacy settings
 */
function getPrivacySettings(userId) {
  return new Promise((resolve, reject) => {
    db.get(
      'SELECT share_activity, show_in_feed FROM users WHERE id = ?',
      [userId],
      (err, row) => {
        if (err) {
          console.error('Failed to get privacy settings:', err);
          return reject(err);
        }
        resolve({
          shareActivity: row?.share_activity === 1,
          showInFeed: row?.show_in_feed === 1
        });
      }
    );
  });
}

/**
 * Delete old activity events (cleanup)
 */
function cleanupOldActivity(daysToKeep = 90) {
  return new Promise((resolve, reject) => {
    db.run(
      `DELETE FROM activity_events
       WHERE created_at < datetime('now', '-' || ? || ' days')`,
      [daysToKeep],
      function(err) {
        if (err) {
          console.error('Failed to cleanup old activity:', err);
          return reject(err);
        }
        console.log(`Cleaned up ${this.changes} old activity events`);
        resolve({ deleted: this.changes });
      }
    );
  });
}

module.exports = {
  EVENT_TYPES,
  recordActivity,
  getActivityFeed,
  getPersonalActivity,
  getServerActivity,
  updatePrivacySettings,
  getPrivacySettings,
  cleanupOldActivity
};
