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
 * Validate that a file has a valid SQLite header.
 */
function validateSqliteFile(filePath) {
  const fd = fs.openSync(filePath, 'r');
  try {
    const header = Buffer.alloc(16);
    fs.readSync(fd, header, 0, 16, 0);
    return header.toString('utf8', 0, 15) === 'SQLite format 3';
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Extract zip entries to a temp directory, then apply the restore.
 * This separates extraction from file replacement to avoid race conditions.
 */
async function extractBackupToTemp(backupPath, options) {
  const { restoreDatabase = true, restoreCovers = true } = options;
  const os = require('os');
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sappho-restore-'));

  const results = {
    database: false,
    covers: 0,
    manifest: null,
    tempDir,
    tempDbPath: null,
    coverFiles: [],
  };

  await new Promise((resolve, reject) => {
    fs.createReadStream(backupPath)
      .pipe(unzipper.Parse())
      .on('entry', async (entry) => {
        try {
          const fileName = entry.path;

          if (fileName === 'manifest.json') {
            const content = await entry.buffer();
            results.manifest = JSON.parse(content.toString());
          } else if ((fileName === 'sappho.db' || fileName === 'sapho.db') && restoreDatabase) {
            const tempDbPath = path.join(tempDir, 'sappho.db');
            await new Promise((res, rej) => {
              entry.pipe(fs.createWriteStream(tempDbPath))
                .on('finish', res)
                .on('error', rej);
            });
            results.tempDbPath = tempDbPath;
          } else if (fileName.startsWith('covers/') && restoreCovers) {
            const coverName = fileName.replace('covers/', '');
            if (coverName && !coverName.includes('..') && !coverName.startsWith('/') && !path.isAbsolute(coverName)) {
              const tempCoverPath = path.join(tempDir, 'covers', coverName);
              const tempCoverDir = path.dirname(tempCoverPath);
              if (!fs.existsSync(tempCoverDir)) {
                fs.mkdirSync(tempCoverDir, { recursive: true });
              }
              await new Promise((res, rej) => {
                entry.pipe(fs.createWriteStream(tempCoverPath))
                  .on('finish', res)
                  .on('error', rej);
              });
              results.coverFiles.push(coverName);
            } else {
              if (coverName) {
                console.warn(`⚠️ Skipping invalid cover path: ${fileName}`);
              }
              entry.autodrain();
            }
          } else {
            entry.autodrain();
          }
        } catch (err) {
          entry.autodrain();
          reject(err);
        }
      })
      .on('close', resolve)
      .on('error', reject);
  });

  return results;
}

/**
 * Restore from a backup file.
 *
 * Safety measures:
 * 1. Extracts zip to temp directory first (no partial writes to live files)
 * 2. Validates extracted database has valid SQLite header
 * 3. Checkpoints WAL to flush pending writes before overwriting
 * 4. Closes active database connection before file replacement
 * 5. Removes stale WAL/SHM journal files
 * 6. Uses fs.copyFileSync for atomic-ish file replacement
 * 7. Backs up current database before overwriting
 */
async function restoreBackup(backupPath, options = {}) {
  if (!fs.existsSync(backupPath)) {
    throw new Error('Backup file not found');
  }

  // Phase 1: Extract zip to temp directory
  const extracted = await extractBackupToTemp(backupPath, options);

  const results = {
    database: false,
    covers: 0,
    manifest: extracted.manifest,
  };

  try {
    // Phase 2: Restore database
    if (extracted.tempDbPath) {
      // Validate the extracted database file
      if (!validateSqliteFile(extracted.tempDbPath)) {
        throw new Error('Invalid backup: extracted file is not a valid SQLite database');
      }

      // Backup current database
      if (fs.existsSync(DATABASE_PATH)) {
        const preRestorePath = DATABASE_PATH + '.pre-restore';
        fs.copyFileSync(DATABASE_PATH, preRestorePath);
        console.log(`📦 Backed up current database to ${preRestorePath}`);
      }

      // Checkpoint and close the active database connection
      const db = require('../database');
      try {
        await db.checkpoint();
        console.log('📦 WAL checkpoint complete');
      } catch (err) {
        console.warn('⚠️ WAL checkpoint failed (may not be in WAL mode):', err.message);
      }

      try {
        await db.closeDatabase();
        console.log('📦 Database connection closed');
      } catch (err) {
        console.warn('⚠️ Failed to close database connection:', err.message);
      }

      // Remove stale WAL and SHM journal files
      const walPath = DATABASE_PATH + '-wal';
      const shmPath = DATABASE_PATH + '-shm';
      for (const journalFile of [walPath, shmPath]) {
        try {
          if (fs.existsSync(journalFile)) {
            fs.unlinkSync(journalFile);
          }
        } catch (_e) { /* may not exist */ }
      }

      // Copy the validated backup database over the live database
      fs.copyFileSync(extracted.tempDbPath, DATABASE_PATH);
      results.database = true;
      console.log('✅ Database restored');
    }

    // Phase 3: Restore covers
    if (extracted.coverFiles.length > 0) {
      if (!fs.existsSync(COVERS_DIR)) {
        fs.mkdirSync(COVERS_DIR, { recursive: true });
      }

      for (const coverName of extracted.coverFiles) {
        const srcPath = path.join(extracted.tempDir, 'covers', coverName);
        const destPath = path.join(COVERS_DIR, coverName);

        // SECURITY: Validate resolved path is within COVERS_DIR
        const resolvedDest = path.resolve(destPath);
        if (!resolvedDest.startsWith(path.resolve(COVERS_DIR) + path.sep)) {
          console.warn(`⚠️ Skipping suspicious cover path: ${coverName}`);
          continue;
        }

        fs.copyFileSync(srcPath, destPath);
        results.covers++;
      }
    }

    console.log(`✅ Restore complete: database=${results.database}, covers=${results.covers}`);
    return results;
  } finally {
    // Clean up temp directory
    try {
      fs.rmSync(extracted.tempDir, { recursive: true, force: true });
    } catch (_e) { /* best effort cleanup */ }
  }
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
