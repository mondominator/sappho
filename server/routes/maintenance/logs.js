/**
 * Log & Jobs Routes
 * View server logs, clear log buffer, check background job status.
 */
const { maintenanceLimiter, maintenanceWriteLimiter, logBuffer, LOG_BUFFER_SIZE, getLogStats, clearLogBuffer, getForceRescanInProgress } = require('./helpers');

function register(router, { authenticateToken, isScanningLocked, getJobStatus }) {
  // Get server logs
  router.get('/logs', maintenanceLimiter, authenticateToken, (req, res) => {
    if (!req.user.is_admin) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const limit = Math.min(parseInt(req.query.limit) || 100, LOG_BUFFER_SIZE);
    const logs = logBuffer.slice(-limit);

    res.json({
      logs,
      total: logBuffer.length,
      stats: getLogStats(),
      forceRescanInProgress: getForceRescanInProgress(),
      scanningLocked: isScanningLocked()
    });
  });

  // Clear server logs
  router.delete('/logs', maintenanceWriteLimiter, authenticateToken, (req, res) => {
    if (!req.user.is_admin) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const cleared = clearLogBuffer();
    res.json({
      success: true,
      message: `Cleared ${cleared} log entries`,
      cleared
    });
  });

  // Get background jobs status
  router.get('/jobs', maintenanceLimiter, authenticateToken, (req, res) => {
    if (!req.user.is_admin) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const jobs = getJobStatus();

    res.json({
      jobs,
      forceRefreshInProgress: getForceRescanInProgress(),
    });
  });
}

module.exports = { register };
