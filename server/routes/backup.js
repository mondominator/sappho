/**
 * Backup Routes
 *
 * API endpoints for backup management (admin only)
 */

const express = require('express');
const rateLimit = require('express-rate-limit');
const fs = require('fs');
const multer = require('multer');

/**
 * Default dependencies - used when route is required directly
 */
const defaultDependencies = {
  auth: () => require('../auth'),
  backupService: () => require('../services/backupService'),
};

// SECURITY: Rate limiting for backup endpoints
const backupLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30, // 30 requests per minute per IP
  message: { error: 'Too many requests. Please slow down.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const backupWriteLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 5, // 5 backup operations per minute
  message: { error: 'Too many backup operations. Please slow down.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Configure multer for backup file uploads
const upload = multer({
  dest: '/tmp/sappho-uploads/',
  limits: { fileSize: 500 * 1024 * 1024 }, // 500MB max
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === 'application/zip' || file.originalname.endsWith('.zip')) {
      cb(null, true);
    } else {
      cb(new Error('Only .zip files are allowed'));
    }
  },
});

/**
 * Create backup routes with injectable dependencies
 * @param {Object} deps - Dependencies (for testing)
 * @param {Object} deps.auth - Auth module
 * @param {Object} deps.backupService - Backup service module
 * @returns {express.Router}
 */
function createBackupRouter(deps = {}) {
  const router = express.Router();

  // Resolve dependencies (use provided or defaults)
  const auth = deps.auth || defaultDependencies.auth();
  const backupService = deps.backupService || defaultDependencies.backupService();
  const { authenticateToken, requireAdmin } = auth;

  /**
   * GET /api/backup - List all backups
   */
  router.get('/', backupLimiter, authenticateToken, requireAdmin, (req, res) => {
  try {
    const backups = backupService.listBackups();
    const status = backupService.getStatus();

    res.json({
      backups,
      status,
    });
  } catch (error) {
    console.error('Error listing backups:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/backup - Create a new backup
 */
router.post('/', backupWriteLimiter, authenticateToken, requireAdmin, async (req, res) => {
  const { includeCovers = true } = req.body;

  try {
    console.log('Creating manual backup...');
    const result = await backupService.createBackup(includeCovers);
    res.json(result);
  } catch (error) {
    console.error('Error creating backup:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/backup/:filename - Download a backup
 */
router.get('/:filename', backupLimiter, authenticateToken, requireAdmin, (req, res) => {
  try {
    const backupPath = backupService.getBackupPath(req.params.filename);
    res.download(backupPath, req.params.filename);
  } catch (error) {
    console.error('Error downloading backup:', error);
    res.status(404).json({ error: 'Internal server error' });
  }
});

/**
 * DELETE /api/backup/:filename - Delete a backup
 */
router.delete('/:filename', backupWriteLimiter, authenticateToken, requireAdmin, (req, res) => {
  try {
    const result = backupService.deleteBackup(req.params.filename);
    res.json(result);
  } catch (error) {
    console.error('Error deleting backup:', error);
    res.status(404).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/backup/restore/:filename - Restore from an existing backup
 */
router.post('/restore/:filename', backupWriteLimiter, authenticateToken, requireAdmin, async (req, res) => {
  const { restoreDatabase = true, restoreCovers = true } = req.body;

  try {
    const backupPath = backupService.getBackupPath(req.params.filename);
    console.log(`Restoring from backup: ${req.params.filename}`);

    const result = await backupService.restoreBackup(backupPath, {
      restoreDatabase,
      restoreCovers,
    });

    res.json({
      success: true,
      message: 'Restore complete. Server restart may be required.',
      ...result,
    });
  } catch (error) {
    console.error('Error restoring backup:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/backup/upload - Upload and restore from a backup file
 */
router.post('/upload', backupWriteLimiter, authenticateToken, requireAdmin, upload.single('backup'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No backup file uploaded' });
  }

  const { restoreDatabase = true, restoreCovers = true } = req.body;

  try {
    console.log(`Restoring from uploaded backup: ${req.file.originalname}`);

    const result = await backupService.restoreBackup(req.file.path, {
      restoreDatabase: restoreDatabase === 'true' || restoreDatabase === true,
      restoreCovers: restoreCovers === 'true' || restoreCovers === true,
    });

    // Clean up uploaded file
    fs.unlinkSync(req.file.path);

    res.json({
      success: true,
      message: 'Restore complete. Server restart may be required.',
      ...result,
    });
  } catch (error) {
    // Clean up uploaded file on error
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }

    console.error('Error restoring backup:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/backup/retention - Apply retention policy
 */
router.post('/retention', backupWriteLimiter, authenticateToken, requireAdmin, (req, res) => {
  const { keepCount = 7 } = req.body;

  try {
    const result = backupService.applyRetention(keepCount);
    res.json(result);
  } catch (error) {
    console.error('Error applying retention:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

  return router;
}

// Export default router for backwards compatibility with index.js
module.exports = createBackupRouter();
// Export factory function for testing
module.exports.createBackupRouter = createBackupRouter;
