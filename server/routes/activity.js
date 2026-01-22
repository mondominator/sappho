/**
 * Activity Feed Routes
 *
 * API endpoints for the social activity feed
 */

const express = require('express');
const rateLimit = require('express-rate-limit');

/**
 * Default dependencies - used when route is required directly
 */
const defaultDependencies = {
  auth: () => require('../auth'),
  activityService: () => require('../services/activityService'),
};

/**
 * Create activity routes with injectable dependencies
 * @param {Object} deps - Dependencies (for testing)
 * @param {Object} deps.auth - Authentication module (authenticateToken)
 * @param {Object} deps.activityService - Activity service module
 * @returns {express.Router}
 */
function createActivityRouter(deps = {}) {
  const router = express.Router();

  // Resolve dependencies (use provided or defaults)
  const auth = deps.auth || defaultDependencies.auth();
  const activityService = deps.activityService || defaultDependencies.activityService();
  const { authenticateToken } = auth;

  // SECURITY: Rate limiting for activity feed endpoints
  const activityLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 60, // 60 requests per minute per IP
    message: { error: 'Too many requests. Please slow down.' },
    standardHeaders: true,
    legacyHeaders: false,
  });

  const privacyUpdateLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 10, // 10 privacy updates per minute
    message: { error: 'Too many privacy updates. Please try again later.' },
    standardHeaders: true,
    legacyHeaders: false,
  });

  /**
   * GET /api/activity/feed
   * Get the combined activity feed (own + shared)
   */
  router.get('/feed', activityLimiter, authenticateToken, async (req, res) => {
    try {
      const { limit = 50, offset = 0, type, includeOwn = 'true' } = req.query;

      const activities = await activityService.getActivityFeed(req.user.id, {
        limit: parseInt(limit),
        offset: parseInt(offset),
        type: type || null,
        includeOwn: includeOwn === 'true'
      });

      res.json({ data: activities });
    } catch (error) {
      console.error('Error fetching activity feed:', error);
      res.status(500).json({ error: 'Failed to fetch activity feed' });
    }
  });

  /**
   * GET /api/activity/personal
   * Get only the current user's activity
   */
  router.get('/personal', activityLimiter, authenticateToken, async (req, res) => {
    try {
      const { limit = 50, offset = 0, type } = req.query;

      const activities = await activityService.getPersonalActivity(req.user.id, {
        limit: parseInt(limit),
        offset: parseInt(offset),
        type: type || null
      });

      res.json({ data: activities });
    } catch (error) {
      console.error('Error fetching personal activity:', error);
      res.status(500).json({ error: 'Failed to fetch personal activity' });
    }
  });

  /**
   * GET /api/activity/server
   * Get server-wide shared activity
   */
  router.get('/server', activityLimiter, authenticateToken, async (req, res) => {
    try {
      const { limit = 50, offset = 0, type } = req.query;

      const activities = await activityService.getServerActivity({
        limit: parseInt(limit),
        offset: parseInt(offset),
        type: type || null
      });

      res.json({ data: activities });
    } catch (error) {
      console.error('Error fetching server activity:', error);
      res.status(500).json({ error: 'Failed to fetch server activity' });
    }
  });

  /**
   * GET /api/activity/privacy
   * Get current user's privacy settings
   */
  router.get('/privacy', activityLimiter, authenticateToken, async (req, res) => {
    try {
      const settings = await activityService.getPrivacySettings(req.user.id);
      res.json(settings);
    } catch (error) {
      console.error('Error fetching privacy settings:', error);
      res.status(500).json({ error: 'Failed to fetch privacy settings' });
    }
  });

  /**
   * PUT /api/activity/privacy
   * Update current user's privacy settings
   */
  router.put('/privacy', privacyUpdateLimiter, authenticateToken, async (req, res) => {
    try {
      const { shareActivity, showInFeed } = req.body;

      await activityService.updatePrivacySettings(req.user.id, {
        shareActivity: !!shareActivity,
        showInFeed: showInFeed !== false // default to true
      });

      res.json({
        message: 'Privacy settings updated',
        shareActivity: !!shareActivity,
        showInFeed: showInFeed !== false
      });
    } catch (error) {
      console.error('Error updating privacy settings:', error);
      res.status(500).json({ error: 'Failed to update privacy settings' });
    }
  });

  /**
   * GET /api/activity/types
   * Get available activity event types
   */
  router.get('/types', activityLimiter, authenticateToken, (_req, res) => {
    res.json({
      types: Object.entries(activityService.EVENT_TYPES).map(([key, value]) => ({
        key,
        value,
        label: key.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, l => l.toUpperCase())
      }))
    });
  });

  return router;
}

// Export default router for backwards compatibility with index.js
module.exports = createActivityRouter();
// Export factory function for testing
module.exports.createActivityRouter = createActivityRouter;
