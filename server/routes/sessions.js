/**
 * Sessions Routes
 *
 * API endpoints for managing playback sessions
 * Similar to Plex's /status/sessions endpoint
 */

const express = require('express');

/**
 * Default dependencies - used when route is required directly
 */
const defaultDependencies = {
  auth: () => require('../auth'),
  sessionManager: () => require('../services/sessionManager'),
};

/**
 * Create sessions routes with injectable dependencies
 * @param {Object} deps - Dependencies (for testing)
 * @param {Object} deps.auth - Authentication module (authenticateToken)
 * @param {Object} deps.sessionManager - Session manager service
 * @returns {express.Router}
 */
function createSessionsRouter(deps = {}) {
  const router = express.Router();

  // Resolve dependencies (use provided or defaults)
  const auth = deps.auth || defaultDependencies.auth();
  const sessionManager = deps.sessionManager || defaultDependencies.sessionManager();
  const { authenticateToken } = auth;

  /**
   * GET /api/sessions
   * Get all active sessions
   */
  router.get('/', authenticateToken, (req, res) => {
    try {
      const sessions = sessionManager.getAllSessions();
      res.json({ sessions });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * GET /api/sessions/user/:userId
   * Get sessions for a specific user
   */
  router.get('/user/:userId', authenticateToken, (req, res) => {
    try {
      const { userId } = req.params;
      const sessions = sessionManager.getUserSessions(parseInt(userId));
      res.json({ sessions });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * GET /api/sessions/:sessionId
   * Get a specific session by ID
   */
  router.get('/:sessionId', authenticateToken, (req, res) => {
    try {
      const { sessionId } = req.params;
      const session = sessionManager.getSession(sessionId);

      if (!session) {
        return res.status(404).json({ error: 'Session not found' });
      }

      res.json({ session });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * DELETE /api/sessions/:sessionId
   * Stop a session
   */
  router.delete('/:sessionId', authenticateToken, (req, res) => {
    try {
      const { sessionId } = req.params;
      sessionManager.stopSession(sessionId);
      res.json({ success: true, message: 'Session stopped' });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  return router;
}

// Export default router for backwards compatibility with index.js
module.exports = createSessionsRouter();
// Export factory function for testing
module.exports.createSessionsRouter = createSessionsRouter;
