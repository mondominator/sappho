/**
 * Log & Jobs Routes
 * View server logs, clear log buffer, check background job status.
 */
const { maintenanceLimiter, maintenanceWriteLimiter, logBuffer, LOG_BUFFER_SIZE, getLogStats, clearLogBuffer, getForceRescanInProgress } = require('./helpers');

function register(router, { authenticateToken, requireAdmin, isScanningLocked, getJobStatus }) {
  // Get server logs
  router.get('/logs', maintenanceLimiter, authenticateToken, requireAdmin, (req, res) => {
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
  router.delete('/logs', maintenanceWriteLimiter, authenticateToken, requireAdmin, (req, res) => {
    const cleared = clearLogBuffer();
    res.json({
      success: true,
      message: `Cleared ${cleared} log entries`,
      cleared
    });
  });

  // Get background jobs status
  router.get('/jobs', maintenanceLimiter, authenticateToken, requireAdmin, (req, res) => {
    const jobs = getJobStatus();

    res.json({
      jobs,
      forceRefreshInProgress: getForceRescanInProgress(),
    });
  });
}

module.exports = { register };
