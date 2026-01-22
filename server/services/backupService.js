const fs = require('fs');
const path = require('path');
const archiver = require('archiver');
const unzipper = require('unzipper');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '../../data');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const DATABASE_PATH = process.env.DATABASE_PATH || path.join(DATA_DIR, 'sappho.db');
const COVERS_DIR = process.env.COVERS_DIR || path.join(DATA_DIR, 'covers');

// Default retention: keep last 7 backups
const DEFAULT_RETENTION = 7;

// Backup schedule interval (null = disabled)
let backupInterval = null;
let lastBackupTime = null;
let lastBackupResult = null;

/**
 * Ensure backup directory exists
 */
function ensureBackupDir() {
  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
  }
}

/**
 * Generate backup filename with timestamp
 */
function generateBackupFilename() {
  const now = new Date();
  const timestamp = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return `sappho-backup-${timestamp}.zip`;
}

/**
 * Create a backup of the database and covers
 */
async function createBackup(includeCovers = true) {
  ensureBackupDir();

  const filename = generateBackupFilename();
  const backupPath = path.join(BACKUP_DIR, filename);

  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(backupPath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    output.on('close', () => {
      const stats = fs.statSync(backupPath);
      lastBackupTime = new Date();
      lastBackupResult = {
        success: true,
        filename,
        size: stats.size,
        timestamp: lastBackupTime.toISOString(),
      };

      console.log(`✅ Backup created: ${filename} (${formatBytes(stats.size)})`);
      resolve(lastBackupResult);
    });

    archive.on('error', (err) => {
      lastBackupResult = { success: false, error: err.message };
      reject(err);
    });

    archive.pipe(output);

    // Add database file
    if (fs.existsSync(DATABASE_PATH)) {
      archive.file(DATABASE_PATH, { name: 'sappho.db' });
    }

    // Add manifest with version info
    const manifest = {
      version: '1.0',
      created: new Date().toISOString(),
      includes: ['database'],
    };

    // Add covers directory if requested and exists
    if (includeCovers && fs.existsSync(COVERS_DIR)) {
      const coverFiles = fs.readdirSync(COVERS_DIR);
      if (coverFiles.length > 0) {
        archive.directory(COVERS_DIR, 'covers');
        manifest.includes.push('covers');
        manifest.coverCount = coverFiles.length;
      }
    }

    archive.append(JSON.stringify(manifest, null, 2), { name: 'manifest.json' });

    archive.finalize();
  });
}

/**
 * List available backups
 */
function listBackups() {
  ensureBackupDir();

  const files = fs.readdirSync(BACKUP_DIR)
    .filter(f => f.endsWith('.zip') && f.startsWith('sappho-backup-'))
    .map(filename => {
      const filePath = path.join(BACKUP_DIR, filename);
      const stats = fs.statSync(filePath);

      // Extract date from filename
      const match = filename.match(/sappho-backup-(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2})/);
      const timestamp = match ? match[1].replace(/-/g, (m, i) => i > 9 ? ':' : '-') + 'Z' : stats.mtime.toISOString();

      return {
        filename,
        size: stats.size,
        sizeFormatted: formatBytes(stats.size),
        created: timestamp,
        createdFormatted: new Date(timestamp).toLocaleString(),
      };
    })
    .sort((a, b) => new Date(b.created) - new Date(a.created));

  return files;
}

/**
 * Get a specific backup file path
 */
function getBackupPath(filename) {
  // Sanitize filename to prevent directory traversal
  const sanitized = path.basename(filename);
  if (!sanitized.endsWith('.zip') || !sanitized.startsWith('sappho-backup-')) {
    throw new Error('Invalid backup filename');
  }

  const backupPath = path.join(BACKUP_DIR, sanitized);
  if (!fs.existsSync(backupPath)) {
    throw new Error('Backup not found');
  }

  return backupPath;
}

/**
 * Delete a backup
 */
function deleteBackup(filename) {
  const backupPath = getBackupPath(filename);
  fs.unlinkSync(backupPath);
  console.log(`🗑️ Backup deleted: ${filename}`);
  return { success: true, filename };
}

/**
 * Restore from a backup file
 */
async function restoreBackup(backupPath, options = {}) {
  const { restoreDatabase = true, restoreCovers = true } = options;

  if (!fs.existsSync(backupPath)) {
    throw new Error('Backup file not found');
  }

  const results = {
    database: false,
    covers: 0,
    manifest: null,
  };

  return new Promise((resolve, reject) => {
    fs.createReadStream(backupPath)
      .pipe(unzipper.Parse())
      .on('entry', async (entry) => {
        const fileName = entry.path;

        if (fileName === 'manifest.json') {
          const content = await entry.buffer();
          results.manifest = JSON.parse(content.toString());
        } else if ((fileName === 'sappho.db' || fileName === 'sapho.db') && restoreDatabase) {
          // Backup current database first
          if (fs.existsSync(DATABASE_PATH)) {
            const backupName = DATABASE_PATH + '.pre-restore';
            fs.copyFileSync(DATABASE_PATH, backupName);
            console.log(`📦 Backed up current database to ${backupName}`);
          }

          // Write new database
          entry.pipe(fs.createWriteStream(DATABASE_PATH))
            .on('finish', () => {
              results.database = true;
              console.log('✅ Database restored');
            });
        } else if (fileName.startsWith('covers/') && restoreCovers) {
          const coverName = fileName.replace('covers/', '');
          if (coverName) {
            const coverPath = path.join(COVERS_DIR, coverName);

            // Ensure covers directory exists
            if (!fs.existsSync(COVERS_DIR)) {
              fs.mkdirSync(COVERS_DIR, { recursive: true });
            }

            entry.pipe(fs.createWriteStream(coverPath))
              .on('finish', () => {
                results.covers++;
              });
          } else {
            entry.autodrain();
          }
        } else {
          entry.autodrain();
        }
      })
      .on('close', () => {
        console.log(`✅ Restore complete: database=${results.database}, covers=${results.covers}`);
        resolve(results);
      })
      .on('error', reject);
  });
}

/**
 * Apply retention policy - delete old backups
 */
function applyRetention(keepCount = DEFAULT_RETENTION) {
  const backups = listBackups();

  if (backups.length <= keepCount) {
    return { deleted: 0 };
  }

  const toDelete = backups.slice(keepCount);
  let deleted = 0;

  for (const backup of toDelete) {
    try {
      deleteBackup(backup.filename);
      deleted++;
    } catch (err) {
      console.error(`Failed to delete old backup ${backup.filename}:`, err.message);
    }
  }

  console.log(`🧹 Retention applied: deleted ${deleted} old backup(s)`);
  return { deleted };
}

/**
 * Start scheduled backups
 */
function startScheduledBackups(intervalHours = 24, retention = DEFAULT_RETENTION) {
  if (backupInterval) {
    console.log('Scheduled backups already running');
    return;
  }

  const intervalMs = intervalHours * 60 * 60 * 1000;
  console.log(`📅 Starting scheduled backups every ${intervalHours} hours`);

  // Run first backup after a short delay
  setTimeout(async () => {
    try {
      await createBackup(true);
      applyRetention(retention);
    } catch (err) {
      console.error('Scheduled backup failed:', err.message);
    }
  }, 60000).unref(); // 1 minute after startup

  // Schedule recurring backups
  backupInterval = setInterval(async () => {
    try {
      await createBackup(true);
      applyRetention(retention);
    } catch (err) {
      console.error('Scheduled backup failed:', err.message);
    }
  }, intervalMs).unref();
}

/**
 * Stop scheduled backups
 */
function stopScheduledBackups() {
  if (backupInterval) {
    clearInterval(backupInterval);
    backupInterval = null;
    console.log('📅 Scheduled backups stopped');
  }
}

/**
 * Get backup service status
 */
function getStatus() {
  return {
    backupDir: BACKUP_DIR,
    scheduledBackups: backupInterval !== null,
    lastBackup: lastBackupTime ? lastBackupTime.toISOString() : null,
    lastResult: lastBackupResult,
    backupCount: listBackups().length,
  };
}

/**
 * Format bytes to human readable
 */
function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

module.exports = {
  createBackup,
  listBackups,
  getBackupPath,
  deleteBackup,
  restoreBackup,
  applyRetention,
  startScheduledBackups,
  stopScheduledBackups,
  getStatus,
  BACKUP_DIR,
};
