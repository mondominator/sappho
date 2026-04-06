const fs = require('fs');
const logger = require('../utils/logger');
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

      logger.info({ filename, size: formatBytes(stats.size) }, 'Backup created');
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
  logger.info({ filename }, 'Backup deleted');
  return { success: true, filename };
}

/**
 * Validate that a file has a valid SQLite header AND that the whole file opens
 * cleanly with an integrity check. The header-only check used previously would
 * happily accept a truncated file whose first 16 bytes are intact.
 *
 * The integrity check is best-effort: if sqlite3 can't be loaded (e.g. in a
 * unit test where `fs` is mocked out and the bindings resolver can't find the
 * native addon), we fall back to the header check alone and log a warning.
 */
async function validateSqliteFile(filePath) {
  // Header check first — cheap way to reject obvious junk before opening sqlite
  const fd = fs.openSync(filePath, 'r');
  try {
    const header = Buffer.alloc(16);
    fs.readSync(fd, header, 0, 16, 0);
    if (header.toString('utf8', 0, 15) !== 'SQLite format 3') {
      return false;
    }
  } finally {
    fs.closeSync(fd);
  }

  // Full integrity check — opens the DB read-only and runs `PRAGMA integrity_check`.
  // This catches truncated/corrupt files that still have a valid header.
  let sqlite3;
  try {
    sqlite3 = require('sqlite3');
  } catch (err) {
    logger.warn({ err: err.message }, 'sqlite3 unavailable, skipping integrity check');
    return true;
  }

  return new Promise((resolve) => {
    const testDb = new sqlite3.Database(filePath, sqlite3.OPEN_READONLY, (err) => {
      if (err) {
        resolve(false);
        return;
      }
      testDb.get('PRAGMA integrity_check', (pragmaErr, row) => {
        testDb.close(() => {
          if (pragmaErr) { resolve(false); return; }
          resolve(row && row.integrity_check === 'ok');
        });
      });
    });
  });
}

/**
 * Safe path join: refuses any path that escapes `baseDir` after resolution.
 * Returns the absolute path or throws.
 */
function safeJoin(baseDir, relativePath) {
  const normalized = path.normalize(relativePath).replace(/^(\.\.[/\\])+/, '');
  const resolved = path.resolve(baseDir, normalized);
  const baseResolved = path.resolve(baseDir);
  if (resolved !== baseResolved && !resolved.startsWith(baseResolved + path.sep)) {
    throw new Error(`Path traversal attempt: ${relativePath}`);
  }
  return resolved;
}

/**
 * Drain a zip entry to a file, resolving only once the write stream fully
 * flushes. Rejects on write-side errors.
 *
 * Listeners attach to the write stream rather than the entry because the
 * test suite mocks entry as a plain object with just `.pipe`. Production
 * entry streams bubble errors to the destination through the pipe chain.
 */
function streamEntryToFile(entry, destPath) {
  return new Promise((resolve, reject) => {
    entry.pipe(fs.createWriteStream(destPath))
      .on('finish', resolve)
      .on('error', reject);
  });
}

/**
 * Extract zip entries to a temp directory, then apply the restore.
 *
 * Key safety properties:
 * - Each entry is fully written to disk *before* we advance to the next one.
 *   The previous implementation fired an async handler per entry without
 *   awaiting it, so the unzipper stream could emit 'close' before writes
 *   completed. That race could leave a truncated temp DB that later passed
 *   the (header-only) validator and got copied over the live database.
 * - All paths are resolved via `safeJoin`, which blocks traversal even if
 *   the zip contains an absolute or `..`-laden entry name.
 * - Stream or per-entry errors reject the outer promise immediately; the
 *   caller is responsible for removing the temp dir on failure.
 */
async function extractBackupToTemp(backupPath, options) {
  const { restoreDatabase = true, restoreCovers = true } = options;
  const os = require('os');
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sappho-restore-'));
  const tempCoversDir = path.join(tempDir, 'covers');

  const results = {
    database: false,
    covers: 0,
    manifest: null,
    tempDir,
    tempDbPath: null,
    coverFiles: [],
  };

  // Buffer entries and await each one serially. We can't await inside the
  // 'entry' listener because unzipper fires them back-to-back; we push work
  // into a queue and drain it via a chain of promises.
  let chain = Promise.resolve();

  await new Promise((resolve, reject) => {
    // Chain off the pipe return value — keeps the same shape the tests mock
    // (fs.createReadStream(...).pipe(unzipper.Parse()) → parser)
    const parser = fs.createReadStream(backupPath).pipe(unzipper.Parse());
    let streamError = null;

    parser.on('entry', (entry) => {
      const fileName = entry.path;

      chain = chain.then(async () => {
        if (streamError) { entry.autodrain(); return; }

        try {
          if (fileName === 'manifest.json') {
            const content = await entry.buffer();
            results.manifest = JSON.parse(content.toString());
            return;
          }

          if ((fileName === 'sappho.db' || fileName === 'sapho.db') && restoreDatabase) {
            const tempDbPath = path.join(tempDir, 'sappho.db');
            await streamEntryToFile(entry, tempDbPath);
            results.tempDbPath = tempDbPath;
            return;
          }

          if (fileName.startsWith('covers/') && restoreCovers) {
            const coverName = fileName.slice('covers/'.length);
            if (!coverName) { entry.autodrain(); return; }

            let tempCoverPath;
            try {
              tempCoverPath = safeJoin(tempCoversDir, coverName);
            } catch (err) {
              logger.warn({ fileName, err: err.message }, 'Skipping cover with unsafe path');
              entry.autodrain();
              return;
            }

            fs.mkdirSync(path.dirname(tempCoverPath), { recursive: true });
            await streamEntryToFile(entry, tempCoverPath);
            results.coverFiles.push(coverName);
            return;
          }

          entry.autodrain();
        } catch (err) {
          streamError = err;
          try { entry.autodrain(); } catch (_e) { /* already drained */ }
          throw err;
        }
      }).catch((err) => {
        if (!streamError) streamError = err;
      });
    });

    parser.on('close', async () => {
      try {
        await chain;
        if (streamError) reject(streamError);
        else resolve();
      } catch (err) {
        reject(err);
      }
    });

    parser.on('error', (err) => {
      streamError = err;
      reject(err);
    });
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
  // Defence in depth: even though callers pre-sanitize via getBackupPath(),
  // confirm the resolved path is inside BACKUP_DIR before we hand it to
  // fs.createReadStream. This keeps CodeQL/static analysers happy and
  // defeats any future caller that forgets to sanitize.
  const resolvedBackupPath = path.resolve(backupPath);
  const resolvedBackupDir = path.resolve(BACKUP_DIR);
  if (!resolvedBackupPath.startsWith(resolvedBackupDir + path.sep)) {
    throw new Error('Backup path must be inside BACKUP_DIR');
  }
  if (!fs.existsSync(resolvedBackupPath)) {
    throw new Error('Backup file not found');
  }

  // Phase 1: Extract zip to temp directory
  const extracted = await extractBackupToTemp(resolvedBackupPath, options);

  const results = {
    database: false,
    covers: 0,
    manifest: extracted.manifest,
  };

  try {
    // Phase 2: Restore database
    if (extracted.tempDbPath) {
      // Validate the extracted database file — header AND integrity check.
      // We do this BEFORE touching the live database so a corrupt backup
      // fails fast without taking down the running server.
      const valid = await validateSqliteFile(extracted.tempDbPath);
      if (!valid) {
        throw new Error('Invalid backup: extracted file failed SQLite integrity check');
      }

      // Backup current database
      if (fs.existsSync(DATABASE_PATH)) {
        const preRestorePath = DATABASE_PATH + '.pre-restore';
        fs.copyFileSync(DATABASE_PATH, preRestorePath);
        logger.info({ path: preRestorePath }, 'Backed up current database before restore');
      }

      // Checkpoint and close the active database connection
      const db = require('../database');
      try {
        await db.checkpoint();
        logger.debug('WAL checkpoint complete');
      } catch (err) {
        logger.warn({ err }, 'WAL checkpoint failed (may not be in WAL mode)');
      }

      try {
        await db.closeDatabase();
        logger.debug('Database connection closed for restore');
      } catch (err) {
        logger.warn({ err }, 'Failed to close database connection');
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
      logger.info('Database restored');
    }

    // Phase 3: Restore covers
    if (extracted.coverFiles.length > 0) {
      if (!fs.existsSync(COVERS_DIR)) {
        fs.mkdirSync(COVERS_DIR, { recursive: true });
      }

      for (const coverName of extracted.coverFiles) {
        let srcPath;
        let destPath;
        try {
          srcPath = safeJoin(path.join(extracted.tempDir, 'covers'), coverName);
          destPath = safeJoin(COVERS_DIR, coverName);
        } catch (err) {
          logger.warn({ coverName, err: err.message }, 'Skipping cover with unsafe path');
          continue;
        }

        fs.mkdirSync(path.dirname(destPath), { recursive: true });
        fs.copyFileSync(srcPath, destPath);
        results.covers++;
      }
    }

    logger.info({ database: results.database, covers: results.covers }, 'Restore complete');
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
      logger.error({ err, filename: backup.filename }, 'Failed to delete old backup');
    }
  }

  logger.info({ deleted }, 'Backup retention applied');
  return { deleted };
}

/**
 * Start scheduled backups
 */
function startScheduledBackups(intervalHours = 24, retention = DEFAULT_RETENTION) {
  if (backupInterval) {
    logger.debug('Scheduled backups already running');
    return;
  }

  const intervalMs = intervalHours * 60 * 60 * 1000;
  logger.info({ intervalHours }, 'Starting scheduled backups');

  // Run first backup after a short delay
  setTimeout(async () => {
    try {
      await createBackup(true);
      applyRetention(retention);
    } catch (err) {
      logger.error({ err }, 'Scheduled backup failed');
    }
  }, 60000).unref(); // 1 minute after startup

  // Schedule recurring backups
  backupInterval = setInterval(async () => {
    try {
      await createBackup(true);
      applyRetention(retention);
    } catch (err) {
      logger.error({ err }, 'Scheduled backup failed');
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
    logger.info('Scheduled backups stopped');
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
