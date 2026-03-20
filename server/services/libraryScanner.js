const fs = require('fs');
const logger = require('../utils/logger');
const path = require('path');
const db = require('../database');
const { extractFileMetadata } = require('./fileProcessor');
const websocketManager = require('./websocketManager');
const { generateBestHash } = require('../utils/contentHash');
const { organizeAudiobook } = require('./fileOrganizer');
const emailService = require('./emailService');
const notificationService = require('./notificationService');
const { readExternalMetadata, mergeExternalMetadata } = require('../utils/externalMetadata');
const { scanDirectory, extractM4BChapters, mergeSubdirectories, cleanupAllEmptyDirectories } = require('./fileSystemUtils');
const { loadPathCache, clearPathCache, fileExistsInDatabase, audiobookExistsInDirectory, audiobookExistsByHash, audiobookExistsByIsbn, audiobookExistsByAsin } = require('./pathCache');
const { findUnavailableByHash, markAvailable, markUnavailable, checkAvailability, restoreAudiobook } = require('./libraryQueries');
const { createDbHelpers } = require('../utils/db');

// Lazy load to avoid circular dependency
let isDirectoryBeingConverted = null;
const getConversionChecker = () => {
  if (!isDirectoryBeingConverted) {
    isDirectoryBeingConverted = require('../routes/audiobooks').isDirectoryBeingConverted;
  }
  return isDirectoryBeingConverted;
};

const audiobooksDir = process.env.AUDIOBOOKS_DIR || path.join(__dirname, '../../data/audiobooks');

/**
 * Check if a book with the same ISBN or ASIN already exists.
 * Returns the existing book info and match type if found, null otherwise.
 * Fails open: if the DB query errors, logs a warning and returns null
 * so the import proceeds (a duplicate is better than a lost book).
 */
async function findDuplicateByIdentifier(metadata) {
  if (metadata.isbn) {
    try {
      const existing = await audiobookExistsByIsbn(metadata.isbn);
      if (existing) {
        logger.info({ title: metadata.title, existingTitle: existing.title, isbn: metadata.isbn }, 'Potential duplicate by ISBN - flagging for review');
        return { existing, matchType: 'isbn' };
      }
    } catch (err) {
      logger.warn({ err, title: metadata.title, isbn: metadata.isbn }, 'ISBN dedup check failed, proceeding with import');
    }
  }
  if (metadata.asin) {
    try {
      const existing = await audiobookExistsByAsin(metadata.asin);
      if (existing) {
        logger.info({ title: metadata.title, existingTitle: existing.title, asin: metadata.asin }, 'Potential duplicate by ASIN - flagging for review');
        return { existing, matchType: 'asin' };
      }
    } catch (err) {
      logger.warn({ err, title: metadata.title, asin: metadata.asin }, 'ASIN dedup check failed, proceeding with import');
    }
  }
  return null;
}

/**
 * Record a duplicate flag for admin review instead of auto-skipping.
 */
async function flagDuplicate(newAudiobookId, existingAudiobookId, matchType) {
  const { createDbHelpers: createHelpers } = require('../utils/db');
  const { dbRun: flagRun } = createHelpers(db);
  try {
    await flagRun(
      `INSERT INTO duplicate_flags (audiobook_id, existing_audiobook_id, match_type, status)
       VALUES (?, ?, ?, 'pending')`,
      [newAudiobookId, existingAudiobookId, matchType]
    );
    logger.info({ newId: newAudiobookId, existingId: existingAudiobookId, matchType }, 'Flagged potential duplicate for review');
  } catch (err) {
    logger.warn({ err, newId: newAudiobookId, existingId: existingAudiobookId }, 'Failed to create duplicate flag');
  }
}

/**
 * Import a single-file audiobook into the database without moving it
 */
async function importAudiobook(filePath, userId) {
  try {
    // Check if directory has an active conversion in progress
    const dir = path.dirname(filePath);
    const checkConversion = getConversionChecker();
    if (checkConversion && checkConversion(dir)) {
      logger.debug({ filePath }, 'Skipping file - conversion in progress');
      return null;
    }

    // Check if already in database
    const exists = await fileExistsInDatabase(filePath);
    if (exists) {
      logger.debug({ filePath }, 'Skipping file - already in database');
      return null;
    }

    // Check if another audiobook exists in the same directory (e.g., converted file)
    const existingInDir = await audiobookExistsInDirectory(filePath);
    if (existingInDir) {
      logger.debug({ filePath, existingPath: existingInDir.file_path }, 'Skipping file - another audiobook in directory');
      return null;
    }

    // Extract metadata from the file
    const metadata = await extractFileMetadata(filePath);

    // Supplement with external metadata files (desc.txt, narrator.txt, *.opf)
    // External data fills gaps but never overwrites audio tag data
    const bookDir = path.dirname(filePath);
    const externalMeta = await readExternalMetadata(bookDir);
    mergeExternalMetadata(metadata, externalMeta);

    // Get file stats (needed for hash and database insert)
    const stats = fs.statSync(filePath);

    // Generate content hash for stable identification
    const contentHash = generateBestHash({ ...metadata, fileSize: stats.size }, filePath);

    // Check if an unavailable audiobook with this content hash exists (restore it)
    const unavailableBook = await findUnavailableByHash(contentHash);
    if (unavailableBook) {
      const restoredBook = await restoreAudiobook(unavailableBook, filePath, metadata);
      // Organize the restored book
      if (restoredBook) {
        await organizeAudiobook(restoredBook);
      }
      return restoredBook;
    }

    // Check for potential duplicates (will flag for review instead of skipping)
    const existingByHash = await audiobookExistsByHash(contentHash);
    const identifierMatch = await findDuplicateByIdentifier(metadata);

    // Try to extract embedded chapters using ffprobe (works on all formats, not just M4B/M4A)
    let chapters = null;
    chapters = await extractM4BChapters(filePath);

    // Single files with embedded chapters are NOT multi-file.
    // is_multi_file means separate physical files (handled by importMultiFileAudiobook).
    const hasChapters = chapters && chapters.length > 1;

    // Save to database in a transaction (audiobook + chapters atomically)
    const { dbTransaction } = createDbHelpers(db);
    const audiobook = await dbTransaction(async ({ dbRun, dbGet }) => {
      const { lastID: audiobookId } = await dbRun(
        `INSERT INTO audiobooks
         (title, author, narrator, description, duration, file_path, file_size,
          genre, published_year, isbn, series, series_position, cover_image, is_multi_file, added_by,
          tags, publisher, copyright_year, asin, language, rating, abridged, subtitle,
          content_hash, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        [
          metadata.title,
          metadata.author,
          metadata.narrator,
          metadata.description,
          metadata.duration,
          filePath,
          stats.size,
          metadata.genre,
          metadata.published_year,
          metadata.isbn,
          metadata.series,
          metadata.series_position,
          metadata.cover_image,
          0, // is_multi_file: always 0 for single files (even with embedded chapters)
          userId,
          metadata.tags,
          metadata.publisher,
          metadata.copyright_year,
          metadata.asin,
          metadata.language,
          metadata.rating,
          metadata.abridged ? 1 : 0,
          metadata.subtitle,
          contentHash,
        ]
      );

      // Insert chapters sequentially within the same transaction
      if (hasChapters) {
        for (const chapter of chapters) {
          await dbRun(
            `INSERT INTO audiobook_chapters
             (audiobook_id, chapter_number, file_path, duration, start_time, title)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [audiobookId, chapter.chapter_number, filePath, chapter.duration, chapter.start_time, chapter.title]
          );
        }
      }

      return await dbGet('SELECT * FROM audiobooks WHERE id = ?', [audiobookId]);
    });

    const chapterCount = hasChapters ? ` (${chapters.length} chapters)` : '';
    logger.info({ title: metadata.title, author: metadata.author, chapters: chapterCount || undefined }, 'Imported audiobook');

    // Flag as potential duplicate if hash or identifier matched an existing book
    if (existingByHash) {
      await flagDuplicate(audiobook.id, existingByHash.id, 'content_hash');
    }
    if (identifierMatch) {
      await flagDuplicate(audiobook.id, identifierMatch.existing.id, identifierMatch.matchType);
    }

    websocketManager.broadcastLibraryUpdate('library.add', audiobook);
    emailService.notifyNewAudiobook(audiobook).catch(e =>
      logger.error({ err: e }, 'Error sending new audiobook notification')
    );
    await notificationService.notifyNewAudiobook(audiobook);
    return audiobook;
  } catch (error) {
    logger.error({ err: error, filePath }, 'Error importing audiobook');
    return null;
  }
}

/**
 * Import a multi-file audiobook (multiple chapters) into the database
 */
async function importMultiFileAudiobook(chapterFiles, userId) {
  try {
    // Sort chapter files by name using natural numeric sort
    // (so title2.mp3 comes before title10.mp3)
    const sortedFiles = chapterFiles.sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
    );

    // Check if directory has an active conversion in progress
    const directory = path.dirname(sortedFiles[0]);
    const checkConversion = getConversionChecker();
    if (checkConversion && checkConversion(directory)) {
      logger.debug({ directory }, 'Skipping multi-file import - conversion in progress');
      return null;
    }

    // Extract metadata from first file to represent the audiobook
    const metadata = await extractFileMetadata(sortedFiles[0]);

    // Calculate total duration and file size
    let totalDuration = 0;
    let totalSize = 0;
    const chapterMetadata = [];

    for (const filePath of sortedFiles) {
      const fileMetadata = await extractFileMetadata(filePath);
      const stats = fs.statSync(filePath);

      totalDuration += fileMetadata.duration || 0;
      totalSize += stats.size;

      chapterMetadata.push({
        file_path: filePath,
        duration: fileMetadata.duration,
        file_size: stats.size,
        title: fileMetadata.title,
      });
    }

    // Use directory name as a fallback for title if metadata title seems like a chapter
    const dirName = path.basename(directory);

    // If title looks like a chapter name (not a real book title), use directory name
    // Detect: "Chapter 3", "Part 1", "01 of 18", "Track 05", leading track numbers "01 - Title"
    const looksLikeChapter = /\bchapter\s+\d/i.test(metadata.title) ||
      /\bpart\s+\d/i.test(metadata.title) ||
      /\btrack\s+\d/i.test(metadata.title) ||
      /\d+\s*(of|\/)\s*\d+/.test(metadata.title) ||
      /^\d{1,3}\s*[-–.]/.test(metadata.title);
    if (metadata.title && looksLikeChapter) {
      // Clean directory name: replace dots/underscores with spaces, remove author prefix patterns
      let cleanDir = dirName
        .replace(/[._]+/g, ' ')          // dots/underscores → spaces
        .replace(/\s*\([^)]*$/, '')       // remove trailing unclosed parens e.g. "(NMR"
        .replace(/\s*\([^)]*\)\s*$/, '')  // remove trailing parens e.g. "(Unabridged)"
        .trim();

      // Try to extract series from directory patterns like "Author-Series.Bk.N-Title" or "Series - Book N - Title"
      // Pattern: "Author - Series Bk N - Title" or "Author.Series.Bk.2.Title"
      const bkMatch = cleanDir.match(/(?:^[^-]+-\s*)?(.+?)\s*(?:Bk|Book|Vol|Volume)\s*\.?\s*(\d+(?:\.\d+)?)\s*[-–]\s*(.+)/i);
      if (bkMatch) {
        const dirSeries = bkMatch[1].trim().replace(/\s+/g, ' ');
        const dirPosition = parseFloat(bkMatch[2]);
        const dirTitle = bkMatch[3].trim().replace(/\s+/g, ' ');
        if (dirTitle && dirSeries) {
          cleanDir = dirTitle;
          if (!metadata.series) {
            metadata.series = dirSeries;
            if (!metadata.series_position && !isNaN(dirPosition)) {
              metadata.series_position = dirPosition;
            }
          }
        }
      } else {
        // Remove leading "Author - " or "Author." prefix if it matches the extracted author
        if (metadata.author) {
          const authorPattern = metadata.author.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '[\\s._-]+');
          cleanDir = cleanDir.replace(new RegExp('^' + authorPattern + '\\s*[-–]\\s*', 'i'), '');
        }
      }

      metadata.title = cleanDir || dirName;
    }

    // Supplement with external metadata files (desc.txt, narrator.txt, *.opf)
    // External data fills gaps but never overwrites audio tag data
    const externalMeta = await readExternalMetadata(directory);
    mergeExternalMetadata(metadata, externalMeta);

    // Store first file path as reference (will use chapters for playback)
    const firstFilePath = sortedFiles[0];

    // Check if already in database (check by first file path or by directory)
    const exists = await fileExistsInDatabase(firstFilePath);
    if (exists) {
      logger.debug({ title: metadata.title }, 'Skipping multi-file audiobook - already in database');
      return null;
    }

    // Check if another audiobook already exists in the same directory (e.g., converted file)
    const existingInDir = await audiobookExistsInDirectory(firstFilePath);
    if (existingInDir) {
      logger.debug({ title: metadata.title, existingPath: existingInDir.file_path }, 'Skipping multi-file audiobook - another in directory');
      return null;
    }

    // Generate content hash for stable identification (use total duration and size for multi-file)
    const contentHash = generateBestHash({ ...metadata, duration: totalDuration, fileSize: totalSize }, firstFilePath);

    // Check if an unavailable audiobook with this content hash exists (restore it)
    const unavailableBook = await findUnavailableByHash(contentHash);
    if (unavailableBook) {
      const restoredBook = await restoreAudiobook(unavailableBook, firstFilePath, metadata);
      // Organize the restored book
      if (restoredBook) {
        await organizeAudiobook(restoredBook);
      }
      return restoredBook;
    }

    // Check for potential duplicates (will flag for review instead of skipping)
    const existingByHash = await audiobookExistsByHash(contentHash);
    const identifierMatch = await findDuplicateByIdentifier(metadata);

    // Save audiobook and chapters in a single transaction
    const { dbTransaction } = createDbHelpers(db);
    // Calculate cumulative start times for each chapter
    let cumulativeTime = 0;
    const chaptersWithStartTimes = chapterMetadata.map((chapter) => {
      const chapterWithStart = { ...chapter, start_time: cumulativeTime };
      cumulativeTime += chapter.duration || 0;
      return chapterWithStart;
    });

    const audiobook = await dbTransaction(async ({ dbRun, dbGet }) => {
      const { lastID: audiobookId } = await dbRun(
        `INSERT INTO audiobooks
         (title, author, narrator, description, duration, file_path, file_size,
          genre, published_year, isbn, series, series_position, cover_image, is_multi_file, added_by,
          tags, publisher, copyright_year, asin, language, rating, abridged, subtitle,
          content_hash, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        [
          metadata.title,
          metadata.author,
          metadata.narrator,
          metadata.description,
          totalDuration,
          firstFilePath,
          totalSize,
          metadata.genre,
          metadata.published_year,
          metadata.isbn,
          metadata.series,
          metadata.series_position,
          metadata.cover_image,
          userId,
          metadata.tags,
          metadata.publisher,
          metadata.copyright_year,
          metadata.asin,
          metadata.language,
          metadata.rating,
          metadata.abridged ? 1 : 0,
          metadata.subtitle,
          contentHash,
        ]
      );

      // Insert chapters sequentially within the same transaction
      for (let i = 0; i < chaptersWithStartTimes.length; i++) {
        const chapter = chaptersWithStartTimes[i];
        await dbRun(
          `INSERT INTO audiobook_chapters
           (audiobook_id, chapter_number, file_path, duration, file_size, title, start_time)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [audiobookId, i + 1, chapter.file_path, chapter.duration, chapter.file_size, chapter.title, chapter.start_time]
        );
      }

      return await dbGet('SELECT * FROM audiobooks WHERE id = ?', [audiobookId]);
    });

    logger.info({ title: metadata.title, chapters: chaptersWithStartTimes.length }, 'Imported multi-file audiobook');

    // Flag as potential duplicate if hash or identifier matched an existing book
    if (existingByHash) {
      await flagDuplicate(audiobook.id, existingByHash.id, 'content_hash');
    }
    if (identifierMatch) {
      await flagDuplicate(audiobook.id, identifierMatch.existing.id, identifierMatch.matchType);
    }

    websocketManager.broadcastLibraryUpdate('library.add', audiobook);
    emailService.notifyNewAudiobook(audiobook).catch(e =>
      logger.error({ err: e }, 'Error sending new audiobook notification')
    );
    await notificationService.notifyNewAudiobook(audiobook);
    return audiobook;
  } catch (error) {
    logger.error({ err: error }, 'Error importing multi-file audiobook');
    return null;
  }
}

/**
 * Scan the entire audiobooks library and import any new files
 */
async function scanLibrary() {
  logger.info('Starting library scan');
  logger.info({ directory: audiobooksDir }, 'Scanning directory');

  // Ensure audiobooks directory exists
  if (!fs.existsSync(audiobooksDir)) {
    logger.info({ directory: audiobooksDir }, 'Creating audiobooks directory');
    fs.mkdirSync(audiobooksDir, { recursive: true });
    return { imported: 0, skipped: 0, errors: 0 };
  }

  // Resolve a valid user ID for added_by — the original default admin (id=1) may have been deleted
  const scanUserId = await new Promise((resolve) => {
    db.get('SELECT id FROM users WHERE is_admin = 1 ORDER BY id LIMIT 1', (err, row) => {
      if (row) return resolve(row.id);
      db.get('SELECT id FROM users ORDER BY id LIMIT 1', (err2, row2) => {
        resolve(row2?.id || null);
      });
    });
  });
  if (!scanUserId) {
    logger.error('Library scan aborted: no users exist in the database');
    return { imported: 0, skipped: 0, errors: 0 };
  }

  // Load all existing paths into memory for fast lookups during scan
  await loadPathCache();

  // Scan files grouped by directory
  const groupedFiles = scanDirectory(audiobooksDir, true);
  logger.info({ directories: groupedFiles.size }, 'Found audio files');

  // Merge subdirectories that are part of the same audiobook (e.g., CD1, CD2, Part1, Part2)
  const mergedGroups = mergeSubdirectories(groupedFiles);
  logger.info({ groups: mergedGroups.size }, 'After merging subdirectories');

  let imported = 0;
  let skipped = 0;
  let errors = 0;
  let totalFiles = 0;

  // Process each directory
  for (const [directory, files] of mergedGroups.entries()) {
    totalFiles += files.length;

    try {
      // Check if this looks like a multi-file audiobook (chapters) or separate books
      // M4B files typically have embedded chapters, so multiple M4Bs are likely separate books
      // UNLESS they have chapter-like names (e.g., "Chapter 01.m4b", "Part 1.m4b")
      // MP3/M4A/FLAC files typically don't have chapters, so multiple files are likely chapters

      const hasM4BFiles = files.some(f => path.extname(f).toLowerCase() === '.m4b');

      // Check if M4B files have chapter-like names
      let isMultiFileBook = false;
      if (hasM4BFiles && files.length > 1) {
        const fileNames = files.map(f => path.basename(f, path.extname(f)).toLowerCase());
        const hasChapterNames = fileNames.some(name =>
          /chapter\s*\d+|part\s*\d+|section\s*\d+|\d+\s*-\s*chapter|^\d+$/i.test(name)
        );
        isMultiFileBook = hasChapterNames;
      } else if (!hasM4BFiles && files.length > 1) {
        // Non-M4B files with multiple files = multi-file book
        isMultiFileBook = true;
      }

      if (isMultiFileBook) {
        // Multi-file audiobook - treat all files in directory as chapters
        logger.debug({ directory, fileCount: files.length }, 'Processing multi-file audiobook');
        const result = await importMultiFileAudiobook(files, scanUserId);
        if (result) {
          imported++;
          // Organize the newly imported book
          await organizeAudiobook(result);
        } else {
          skipped++;
        }
      } else {
        // Single file audiobook(s) - process each file separately
        for (const file of files) {
          const result = await importAudiobook(file, scanUserId);
          if (result) {
            imported++;
            // Organize the newly imported book
            await organizeAudiobook(result);
          } else {
            skipped++;
          }
        }
      }
    } catch (error) {
      logger.error({ err: error, directory }, 'Failed to import from directory');
      errors++;
    }
  }

  // Clear the path cache now that import phase is done
  clearPathCache();

  // Check availability of all existing books (mark missing as unavailable)
  const availabilityStats = await checkAvailability();

  // Clean up empty directories left behind from moves, deletes, or external changes
  const emptyDirsRemoved = cleanupAllEmptyDirectories(audiobooksDir);
  if (emptyDirsRemoved > 0) {
    logger.info({ count: emptyDirsRemoved }, 'Removed empty directories');
  }


  const stats = {
    imported,
    skipped,
    errors,
    totalFiles,
    totalBooks: groupedFiles.size,
    restored: availabilityStats.restored,
    unavailable: availabilityStats.missing,
    emptyDirsRemoved
  };
  logger.info({ stats }, 'Library scan complete');

  return stats;
}

/**
 * Start periodic library scanning
 */
let scanInterval = null;
let isScanning = false;
let scanningLocked = false;  // External lock for force rescan
let lastScanTime = null;
let lastScanResult = null;
let scanIntervalMinutes = 5;

function lockScanning() {
  scanningLocked = true;
}

function unlockScanning() {
  scanningLocked = false;
}

function isScanningLocked() {
  return scanningLocked || isScanning;
}

/**
 * Get job status for UI display
 */
function getJobStatus() {
  let nextScanTime = null;

  if (scanInterval && lastScanTime && !scanningLocked) {
    nextScanTime = new Date(lastScanTime.getTime() + scanIntervalMinutes * 60 * 1000);
  }

  // Get backup service status
  const backupService = require('./backupService');
  const backupStatus = backupService.getStatus();
  const backupIntervalHours = parseInt(process.env.AUTO_BACKUP_INTERVAL) || 24;

  return {
    libraryScanner: {
      name: 'Library Scanner',
      description: 'Periodically scans for new audiobooks',
      interval: `${scanIntervalMinutes} minutes`,
      status: isScanning ? 'running' : (scanningLocked ? 'locked' : 'idle'),
      lastRun: lastScanTime ? lastScanTime.toISOString() : null,
      nextRun: nextScanTime ? nextScanTime.toISOString() : null,
      lastResult: lastScanResult,
      canTrigger: true,
    },
    autoBackup: {
      name: 'Auto Backup',
      description: 'Automatically backs up database and covers',
      interval: backupIntervalHours > 0 ? `${backupIntervalHours} hours` : 'disabled',
      status: backupStatus.scheduledBackups ? 'running' : 'disabled',
      lastRun: backupStatus.lastBackup,
      nextRun: backupStatus.lastBackup && backupIntervalHours > 0
        ? new Date(new Date(backupStatus.lastBackup).getTime() + backupIntervalHours * 60 * 60 * 1000).toISOString()
        : null,
      lastResult: backupStatus.lastResult,
      canTrigger: true,
    },
    sessionCleanup: {
      name: 'Session Cleanup',
      description: 'Removes stale playback sessions',
      interval: '15 seconds',
      status: 'running',
      lastRun: null, // SessionManager handles this internally
      nextRun: null,
      canTrigger: false,
    },
    logRotator: {
      name: 'Log Rotator',
      description: 'In-memory log buffer with automatic rotation',
      interval: 'continuous',
      status: 'running',
      bufferSize: parseInt(process.env.LOG_BUFFER_SIZE) || 500,
      canTrigger: false,
    }
  };
}

function startPeriodicScan(intervalMinutes = 5) {
  // Don't start if already running
  if (scanInterval) {
    logger.debug('Periodic library scan already running');
    return;
  }

  scanIntervalMinutes = intervalMinutes;
  const intervalMs = intervalMinutes * 60 * 1000;
  logger.info({ intervalMinutes }, 'Starting periodic library scan');

  // Run initial scan in background
  setImmediate(async () => {
    if (!isScanning) {
      isScanning = true;
      try {
        const result = await scanLibrary();
        lastScanTime = new Date();
        lastScanResult = result;
      } catch (error) {
        logger.error({ err: error }, 'Error in initial library scan');
        lastScanResult = { error: error.message };
      } finally {
        isScanning = false;
      }
    }
  });

  // Set up periodic scanning
  scanInterval = setInterval(async () => {
    if (isScanning || scanningLocked) {
      logger.debug('Library scan already in progress or locked, skipping');
      return;
    }

    isScanning = true;
    try {
      logger.info('Starting periodic library scan');
      const result = await scanLibrary();
      lastScanTime = new Date();
      lastScanResult = result;
    } catch (error) {
      logger.error({ err: error }, 'Error in periodic library scan');
      lastScanResult = { error: error.message };
    } finally {
      isScanning = false;
    }
  }, intervalMs).unref();
}

/**
 * Stop periodic library scanning
 */
function stopPeriodicScan() {
  if (scanInterval) {
    clearInterval(scanInterval);
    scanInterval = null;
    logger.info('Periodic library scan stopped');
  }
}

module.exports = {
  scanLibrary,
  startPeriodicScan,
  stopPeriodicScan,
  lockScanning,
  unlockScanning,
  isScanningLocked,
  getJobStatus,
  // Re-export from libraryQueries for backward compatibility
  checkAvailability,
  markAvailable,
  markUnavailable,
};
