/**
 * Listening sessions route handlers
 * Tracks discrete listening sessions with start/stop times and positions
 */
const { createDbHelpers } = require('../../utils/db');

function register(router, { db, authenticateToken }) {
  const { dbRun, dbAll } = createDbHelpers(db);

  // Get listening sessions for an audiobook
  router.get('/:id/sessions', authenticateToken, async (req, res) => {
    try {
      const limit = parseInt(req.query.limit) || 50;
      const offset = parseInt(req.query.offset) || 0;

      const sessions = await dbAll(
        `SELECT id, started_at, stopped_at, start_position, end_position, device_name
         FROM listening_sessions
         WHERE user_id = ? AND audiobook_id = ?
         ORDER BY started_at DESC
         LIMIT ? OFFSET ?`,
        [req.user.id, req.params.id, limit, offset]
      );

      res.json({ sessions });
    } catch (_err) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Start or stop a listening session
  router.post('/:id/sessions', authenticateToken, async (req, res) => {
    const { action, position, deviceName } = req.body;
    const audiobookId = req.params.id;
    const userId = req.user.id;

    if (action !== 'start' && action !== 'stop') {
      return res.status(400).json({ error: 'action must be "start" or "stop"' });
    }
    if (typeof position !== 'number') {
      return res.status(400).json({ error: 'position must be a number' });
    }

    try {
      if (action === 'start') {
        // Close any open session first
        await dbRun(
          `UPDATE listening_sessions
           SET stopped_at = CURRENT_TIMESTAMP, end_position = ?
           WHERE user_id = ? AND audiobook_id = ? AND stopped_at IS NULL`,
          [position, userId, audiobookId]
        );

        // Insert new session
        const result = await dbRun(
          `INSERT INTO listening_sessions (user_id, audiobook_id, started_at, start_position, device_name)
           VALUES (?, ?, CURRENT_TIMESTAMP, ?, ?)`,
          [userId, audiobookId, position, deviceName || null]
        );

        res.json({ id: result.lastID, message: 'Session started' });
      } else {
        // Stop the most recent open session
        const result = await dbRun(
          `UPDATE listening_sessions
           SET stopped_at = CURRENT_TIMESTAMP, end_position = ?
           WHERE user_id = ? AND audiobook_id = ? AND stopped_at IS NULL`,
          [position, userId, audiobookId]
        );

        res.json({ message: 'Session stopped', updated: result.changes > 0 });
      }
    } catch (_err) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });
}

module.exports = { register };
