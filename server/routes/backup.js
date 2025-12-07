const express = require('express');
const router = express.Router();
const fs = require('fs');
const multer = require('multer');
const { authenticateToken } = require('../auth');
const backupService = require('../services/backupService');

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
 * GET /api/backup - List all backups
 */
router.get('/', authenticateToken, (req, res) => {
  if (!req.user.is_admin) {
    return res.status(403).json({ error: 'Admin access required' });
  }

  try {
    const backups = backupService.listBackups();
    const status = backupService.getStatus();

    res.json({
      backups,
      status,
    });
  } catch (error) {
    console.error('Error listing backups:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/backup - Create a new backup
 */
router.post('/', authenticateToken, async (req, res) => {
  if (!req.user.is_admin) {
    return res.status(403).json({ error: 'Admin access required' });
  }

  const { includeCovers = true } = req.body;

  try {
    console.log('Creating manual backup...');
    const result = await backupService.createBackup(includeCovers);
    res.json(result);
  } catch (error) {
    console.error('Error creating backup:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/backup/:filename - Download a backup
 */
router.get('/:filename', authenticateToken, (req, res) => {
  if (!req.user.is_admin) {
    return res.status(403).json({ error: 'Admin access required' });
  }

  try {
    const backupPath = backupService.getBackupPath(req.params.filename);
    res.download(backupPath, req.params.filename);
  } catch (error) {
    console.error('Error downloading backup:', error);
    res.status(404).json({ error: error.message });
  }
});

/**
 * DELETE /api/backup/:filename - Delete a backup
 */
router.delete('/:filename', authenticateToken, (req, res) => {
  if (!req.user.is_admin) {
    return res.status(403).json({ error: 'Admin access required' });
  }

  try {
    const result = backupService.deleteBackup(req.params.filename);
    res.json(result);
  } catch (error) {
    console.error('Error deleting backup:', error);
    res.status(404).json({ error: error.message });
  }
});

/**
 * POST /api/backup/restore/:filename - Restore from an existing backup
 */
router.post('/restore/:filename', authenticateToken, async (req, res) => {
  if (!req.user.is_admin) {
    return res.status(403).json({ error: 'Admin access required' });
  }

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
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/backup/upload - Upload and restore from a backup file
 */
router.post('/upload', authenticateToken, upload.single('backup'), async (req, res) => {
  if (!req.user.is_admin) {
    return res.status(403).json({ error: 'Admin access required' });
  }

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
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/backup/retention - Apply retention policy
 */
router.post('/retention', authenticateToken, (req, res) => {
  if (!req.user.is_admin) {
    return res.status(403).json({ error: 'Admin access required' });
  }

  const { keepCount = 7 } = req.body;

  try {
    const result = backupService.applyRetention(keepCount);
    res.json(result);
  } catch (error) {
    console.error('Error applying retention:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
