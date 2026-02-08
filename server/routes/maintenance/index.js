/**
 * Maintenance Routes
 *
 * API endpoints for library maintenance, scans, and system administration (admin only).
 * Routes are split into modules for maintainability.
 */

const express = require('express');

// Route modules
const logs = require('./logs');
const statistics = require('./statistics');
const library = require('./library');
const duplicates = require('./duplicates');
const cleanup = require('./cleanup');

/**
 * Default dependencies - used when route is required directly
 */
const defaultDependencies = {
  db: () => require('../../database'),
  auth: () => require('../../auth'),
  fileProcessor: () => require('../../services/fileProcessor'),
  libraryScanner: () => require('../../services/libraryScanner'),
  fileOrganizer: () => require('../../services/fileOrganizer'),
};

/**
 * Create maintenance routes with injectable dependencies
 * @param {Object} deps - Dependencies (for testing)
 * @param {Object} deps.db - Database module
 * @param {Object} deps.auth - Auth module
 * @param {Object} deps.fileProcessor - File processor service
 * @param {Object} deps.libraryScanner - Library scanner service
 * @param {Object} deps.fileOrganizer - File organizer service
 * @returns {express.Router}
 */
function createMaintenanceRouter(deps = {}) {
  const router = express.Router();

  // Resolve dependencies (use provided or defaults)
  const db = deps.db || defaultDependencies.db();
  const auth = deps.auth || defaultDependencies.auth();
  const fileProcessor = deps.fileProcessor || defaultDependencies.fileProcessor();
  const libraryScanner = deps.libraryScanner || defaultDependencies.libraryScanner();
  const fileOrganizer = deps.fileOrganizer || defaultDependencies.fileOrganizer();

  const { authenticateToken } = auth;
  const { extractFileMetadata } = fileProcessor;
  const { scanLibrary, lockScanning, unlockScanning, isScanningLocked, getJobStatus } = libraryScanner;
  const { organizeLibrary, getOrganizationPreview, organizeAudiobook } = fileOrganizer;

  // Shared deps object for module registration
  const sharedDeps = {
    db,
    authenticateToken,
    extractFileMetadata,
    scanLibrary,
    lockScanning,
    unlockScanning,
    isScanningLocked,
    getJobStatus,
    organizeLibrary,
    getOrganizationPreview,
    organizeAudiobook,
  };

  // Register route modules
  logs.register(router, sharedDeps);
  statistics.register(router, sharedDeps);
  library.register(router, sharedDeps);
  duplicates.register(router, sharedDeps);
  cleanup.register(router, sharedDeps);

  return router;
}

// Export default router for backwards compatibility with server/index.js
module.exports = createMaintenanceRouter();
// Export factory function for testing
module.exports.createMaintenanceRouter = createMaintenanceRouter;
