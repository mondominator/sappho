/**
 * Shared helpers for maintenance route modules
 */
const rateLimit = require('express-rate-limit');

// SECURITY: Rate limiting for maintenance endpoints
const maintenanceLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30, // 30 requests per minute per IP
  message: { error: 'Too many requests. Please slow down.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const maintenanceWriteLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10, // 10 maintenance operations per minute
  message: { error: 'Too many maintenance operations. Please slow down.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// In-memory log buffer for UI viewing
// Configure with LOG_BUFFER_SIZE env var (default 500, max 5000)
const LOG_BUFFER_SIZE = Math.min(parseInt(process.env.LOG_BUFFER_SIZE) || 500, 5000);
const logBuffer = [];
let logRotationCount = 0; // Track how many logs have been rotated out
const originalConsoleLog = console.log;
const originalConsoleError = console.error;

/**
 * Categorize log messages for better UI display
 */
function categorizeLogMessage(message) {
  const lowerMsg = message.toLowerCase();

  // Success indicators
  if (message.includes('✅') || message.includes('✓') ||
      lowerMsg.includes('complete') || lowerMsg.includes('success') ||
      lowerMsg.includes('imported:') || lowerMsg.includes('created')) {
    return 'success';
  }

  // Warning indicators
  if (message.includes('⚠') || lowerMsg.includes('warning') ||
      lowerMsg.includes('skipping') || lowerMsg.includes('skipped') ||
      lowerMsg.includes('already exists') || lowerMsg.includes('not found')) {
    return 'warning';
  }

  // Scan/Job related
  if (lowerMsg.includes('scan') || lowerMsg.includes('scanning') ||
      lowerMsg.includes('periodic') || lowerMsg.includes('starting') ||
      lowerMsg.includes('processing')) {
    return 'job';
  }

  // Import/Library related
  if (lowerMsg.includes('import') || lowerMsg.includes('library') ||
      lowerMsg.includes('audiobook') || lowerMsg.includes('metadata')) {
    return 'library';
  }

  // WebSocket/Session related
  if (lowerMsg.includes('websocket') || lowerMsg.includes('session') ||
      lowerMsg.includes('🔌') || lowerMsg.includes('📡') ||
      lowerMsg.includes('broadcast')) {
    return 'websocket';
  }

  // Auth related
  if (lowerMsg.includes('auth') || lowerMsg.includes('login') ||
      lowerMsg.includes('token') || lowerMsg.includes('user')) {
    return 'auth';
  }

  // Server/System
  if (lowerMsg.includes('server') || lowerMsg.includes('listening') ||
      lowerMsg.includes('initialized') || lowerMsg.includes('started')) {
    return 'system';
  }

  return 'info';
}

// Intercept console.log and console.error
console.log = (...args) => {
  const message = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
  const category = categorizeLogMessage(message);
  logBuffer.push({ timestamp: new Date().toISOString(), level: 'info', category, message });
  if (logBuffer.length > LOG_BUFFER_SIZE) {
    logBuffer.shift();
    logRotationCount++;
  }
  originalConsoleLog.apply(console, args);
};

// SECURITY: Redact sensitive patterns before buffering
function redactSensitive(msg) {
  return msg
    .replace(/password["\s:=]+[^\s,}"']*/gi, 'password=[REDACTED]')
    .replace(/secret["\s:=]+[^\s,}"']*/gi, 'secret=[REDACTED]')
    .replace(/token["\s:=]+[^\s,}"']*/gi, 'token=[REDACTED]');
}

console.error = (...args) => {
  const raw = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
  const message = redactSensitive(raw);
  logBuffer.push({ timestamp: new Date().toISOString(), level: 'error', category: 'error', message });
  if (logBuffer.length > LOG_BUFFER_SIZE) {
    logBuffer.shift();
    logRotationCount++;
  }
  // SECURITY: Log redacted message instead of raw args to prevent sensitive data leaks
  originalConsoleError.call(console, message);
};

/**
 * Get log buffer statistics
 */
function getLogStats() {
  const errorCount = logBuffer.filter(l => l.level === 'error').length;
  const warningCount = logBuffer.filter(l => l.category === 'warning').length;
  const oldestLog = logBuffer.length > 0 ? logBuffer[0].timestamp : null;

  return {
    bufferSize: LOG_BUFFER_SIZE,
    currentCount: logBuffer.length,
    rotatedCount: logRotationCount,
    errorCount,
    warningCount,
    oldestLog,
  };
}

/**
 * Clear the log buffer
 */
function clearLogBuffer() {
  const cleared = logBuffer.length;
  logBuffer.length = 0;
  logRotationCount = 0;
  console.log('Log buffer cleared');
  return cleared;
}

// Force rescan state - shared across routes
let forceRescanInProgress = false;

function getForceRescanInProgress() {
  return forceRescanInProgress;
}

function setForceRescanInProgress(value) {
  forceRescanInProgress = value;
}

module.exports = {
  maintenanceLimiter,
  maintenanceWriteLimiter,
  LOG_BUFFER_SIZE,
  logBuffer,
  getLogStats,
  clearLogBuffer,
  getForceRescanInProgress,
  setForceRescanInProgress,
};
