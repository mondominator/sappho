/**
 * Audiobooks Routes
 *
 * API endpoints for audiobook management, streaming, and playback progress.
 * Routes are split into modules for maintainability.
 */

const express = require('express');

// Route modules
const crud = require('./crud');
const stream = require('./stream');
const conversion = require('./conversion');
const progress = require('./progress');
const aggregates = require('./aggregates');
const batch = require('./batch');
const metadata = require('./metadata');

/**
 * Default dependencies - used when route is required directly
 */
const defaultDependencies = {
  db: () => require('../../database'),
  auth: () => require('../../auth'),
  fileOrganizer: () => require('../../services/fileOrganizer'),
  activityService: () => require('../../services/activityService'),
  conversionService: () => require('../../services/conversionService'),
  genres: () => require('../../utils/genres'),
};

// Export for use by library scanner - uses conversion service to check active conversions
const isDirectoryBeingConverted = (dir) => defaultDependencies.conversionService().isDirectoryLocked(dir);

/**
 * Create audiobooks routes with injectable dependencies
 * @param {Object} deps - Dependencies (for testing)
 * @param {Object} deps.db - Database module
 * @param {Object} deps.auth - Auth module
 * @param {Object} deps.fileOrganizer - File organizer service
 * @param {Object} deps.activityService - Activity service
 * @param {Object} deps.conversionService - Conversion service
 * @param {Object} deps.genres - Genres utility module
 * @returns {express.Router}
 */
function createAudiobooksRouter(deps = {}) {
  const router = express.Router();

  // Resolve dependencies (use provided or defaults)
  const db = deps.db || defaultDependencies.db();
  const auth = deps.auth || defaultDependencies.auth();
  const fileOrganizer = deps.fileOrganizer || defaultDependencies.fileOrganizer();
  const activityService = deps.activityService || defaultDependencies.activityService();
  const conversionService = deps.conversionService || defaultDependencies.conversionService();
  const genres = deps.genres || defaultDependencies.genres();

  const { authenticateToken, authenticateMediaToken, requireAdmin } = auth;
  const { organizeAudiobook, needsOrganization } = fileOrganizer;
  const { GENRE_MAPPINGS, DEFAULT_GENRE_METADATA, normalizeGenres } = genres;

  // Shared deps object for module registration
  const sharedDeps = {
    db,
    authenticateToken,
    authenticateMediaToken,
    requireAdmin,
    activityService,
    conversionService,
    normalizeGenres,
    organizeAudiobook,
    needsOrganization,
    GENRE_MAPPINGS,
    DEFAULT_GENRE_METADATA,
  };

  // Register route modules
  crud.register(router, sharedDeps);
  stream.register(router, sharedDeps);
  conversion.register(router, sharedDeps);
  progress.register(router, sharedDeps);
  aggregates.register(router, sharedDeps);
  metadata.register(router, sharedDeps);
  batch.register(router, sharedDeps);

  return router;
}

// Export default router for backwards compatibility with server/index.js
module.exports = createAudiobooksRouter();
// Export factory function for testing
module.exports.createAudiobooksRouter = createAudiobooksRouter;
// Export for use by library scanner
module.exports.isDirectoryBeingConverted = isDirectoryBeingConverted;
