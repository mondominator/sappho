const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../auth');
const sessionManager = require('../services/sessionManager');

/**
 * Get all active sessions
 * Similar to Plex's /status/sessions endpoint
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

module.exports = router;
