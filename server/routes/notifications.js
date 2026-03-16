/**
 * Notification Routes
 *
 * API endpoints for user notifications (read/unread status)
 */

const express = require('express');
const rateLimit = require('express-rate-limit');
const { createDbHelpers } = require('../utils/db');

/**
 * Default dependencies - used when route is required directly
 */
const defaultDependencies = {
  auth: () => require('../auth'),
  db: () => require('../database'),
};

/**
 * Create notification routes with injectable dependencies
 * @param {Object} deps - Dependencies (for testing)
 * @param {Object} deps.auth - Authentication module (authenticateToken)
 * @param {Object} deps.db - Database module
 * @returns {express.Router}
 */
function createNotificationsRouter(deps = {}) {
  const router = express.Router();

  // Resolve dependencies (use provided or defaults)
  const auth = deps.auth || defaultDependencies.auth();
  const db = deps.db || defaultDependencies.db();
  const { authenticateToken } = auth;
  const { dbGet, dbAll, dbRun } = createDbHelpers(db);

  // SECURITY: Rate limiting for notification endpoints
  const notificationLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 60, // 60 requests per minute per IP
    message: { error: 'Too many requests. Please slow down.' },
    standardHeaders: true,
    legacyHeaders: false,
  });

  /**
   * GET /api/notifications
   * List notifications with read/unread status for current user
   * Query params: limit (default 50, max 100), offset (default 0)
   */
  router.get('/', notificationLimiter, authenticateToken, async (req, res) => {
    try {
      const limit = Math.min(Math.max(parseInt(req.query.limit) || 50, 1), 100);
      const offset = Math.max(parseInt(req.query.offset) || 0, 0);

      const notifications = await dbAll(
        `SELECT n.*,
                CASE WHEN unr.user_id IS NOT NULL THEN 1 ELSE 0 END AS is_read
         FROM notifications n
         LEFT JOIN user_notification_reads unr
           ON unr.notification_id = n.id AND unr.user_id = ?
         ORDER BY n.created_at DESC
         LIMIT ? OFFSET ?`,
        [req.user.id, limit, offset]
      );

      res.json(notifications);
    } catch (_err) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * GET /api/notifications/unread-count
   * Return count of unread notifications for current user
   * IMPORTANT: This route must be defined BEFORE /:id/read
   */
  router.get('/unread-count', notificationLimiter, authenticateToken, async (req, res) => {
    try {
      const result = await dbGet(
        `SELECT COUNT(*) AS count
         FROM notifications n
         WHERE NOT EXISTS (
           SELECT 1 FROM user_notification_reads unr
           WHERE unr.notification_id = n.id AND unr.user_id = ?
         )`,
        [req.user.id]
      );

      res.json({ count: result.count });
    } catch (_err) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * POST /api/notifications/:id/read
   * Mark a single notification as read for current user
   */
  router.post('/:id/read', notificationLimiter, authenticateToken, async (req, res) => {
    try {
      const notificationId = parseInt(req.params.id);
      if (isNaN(notificationId)) {
        return res.status(400).json({ error: 'Invalid notification ID' });
      }

      // Verify the notification exists
      const notification = await dbGet(
        'SELECT id FROM notifications WHERE id = ?',
        [notificationId]
      );
      if (!notification) {
        return res.status(404).json({ error: 'Notification not found' });
      }

      await dbRun(
        'INSERT OR IGNORE INTO user_notification_reads (user_id, notification_id) VALUES (?, ?)',
        [req.user.id, notificationId]
      );

      res.json({ success: true });
    } catch (_err) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * POST /api/notifications/read-all
   * Mark all notifications as read for current user
   */
  router.post('/read-all', notificationLimiter, authenticateToken, async (req, res) => {
    try {
      await dbRun(
        `INSERT OR IGNORE INTO user_notification_reads (user_id, notification_id)
         SELECT ?, n.id
         FROM notifications n
         WHERE NOT EXISTS (
           SELECT 1 FROM user_notification_reads unr
           WHERE unr.notification_id = n.id AND unr.user_id = ?
         )`,
        [req.user.id, req.user.id]
      );

      res.json({ success: true });
    } catch (_err) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  return router;
}

// Export default router for backwards compatibility with index.js
module.exports = createNotificationsRouter();
// Export factory function for testing
module.exports.createNotificationsRouter = createNotificationsRouter;
