const fs = require('fs');
const path = require('path');
const db = require('../database');
const { extractFileMetadata } = require('./fileProcessor');
const websocketManager = require('./websocketManager');
const { generateBestHash } = require('../utils/contentHash');
const { organizeAudiobook } = require('./fileOrganizer');
const emailService = require('./emailService');
const { readExternalMetadata, mergeExternalMetadata } = require('../utils/externalMetadata');
const { scanDirectory, extractM4BChapters, mergeSubdirectories, cleanupAllEmptyDirectories } = require('./fileSystemUtils');
const { loadPathCache, clearPathCache, fileExistsInDatabase, audiobookExistsInDirectory, audiobookExistsByHash } = require('./pathCache');
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
 * Import a single-file audiobook into the database without moving it
 */
async function importAudiobook(filePath, userId) {
  try {
    // Check if directory has an active conversion in progress
    const dir = path.dirname(filePath);
    const checkConversion = getConversionChecker();
    if (checkConversion && checkConversion(dir)) {
      console.log(`Skipping ${filePath} - conversion in progress in this directory`);
      return null;
    }

    // Check if already in database
    const exists = await fileExistsInDatabase(filePath);
    if (exists) {
      console.log(`Skipping ${filePath} - already in database`);
      return null;
    }

    // Check if another audiobook exists in the same directory (e.g., converted file)
    const existingInDir = await audiobookExistsInDirectory(filePath);
    if (existingInDir) {
      console.log(`Skipping ${filePath} - another audiobook already exists in this directory: ${existingInDir.file_path}`);
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

    // Check if an audiobook with this content hash already exists
    const existingByHash = await audiobookExistsByHash(contentHash);
    if (existingByHash) {
      console.log(`Skipping ${filePath} - audiobook with same content hash already exists: ${existingByHash.title}`);
      return null;
    }

    // Try to extract embedded chapters using ffprobe (works on all formats, not just M4B/M4A)
    let chapters = null;
    chapters = await extractM4BChapters(filePath);

    // Determine if this should be marked as multi-file (has embedded chapters)
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
          hasChapters ? 1 : 0,
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
    console.log(`Imported: ${metadata.title} by ${metadata.author}${chapterCount}`);
    websocketManager.broadcastLibraryUpdate('library.add', audiobook);
    emailService.notifyNewAudiobook(audiobook).catch(e =>
      console.error('Error sending new audiobook notification:', e.message)
    );
    return audiobook;
  } catch (error) {
    console.error(`Error importing ${filePath}:`, error.message);
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
      console.log(`Skipping multi-file import in ${directory} - conversion in progress`);
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

    // If title looks like a chapter (contains "chapter", "part", numbers), use directory name
    if (metadata.title && /chapter|part|\d+/i.test(metadata.title)) {
      metadata.title = dirName;
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
      console.log(`Skipping multi-file audiobook ${metadata.title} - already in database`);
      return null;
    }

    // Check if another audiobook already exists in the same directory (e.g., converted file)
    const existingInDir = await audiobookExistsInDirectory(firstFilePath);
    if (existingInDir) {
      console.log(`Skipping multi-file audiobook ${metadata.title} - another audiobook already exists in this directory: ${existingInDir.file_path}`);
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

    // Check if an audiobook with this content hash already exists
    const existingByHash = await audiobookExistsByHash(contentHash);
    if (existingByHash) {
      console.log(`Skipping multi-file audiobook ${metadata.title} - audiobook with same content hash already exists: ${existingByHash.title}`);
      return null;
    }

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

    console.log(`Imported multi-file audiobook: ${metadata.title} (${chaptersWithStartTimes.length} chapters)`);
    websocketManager.broadcastLibraryUpdate('library.add', audiobook);
    emailService.notifyNewAudiobook(audiobook).catch(e =>
      console.error('Error sending new audiobook notification:', e.message)
    );
    return audiobook;
  } catch (error) {
    console.error('Error importing multi-file audiobook:', error.message);
    return null;
  }
}

/**
 * Scan the entire audiobooks library and import any new files
 */
async function scanLibrary() {
  console.log('Starting library scan...');
  console.log('Scanning directory:', audiobooksDir);

  // Ensure audiobooks directory exists
  if (!fs.existsSync(audiobooksDir)) {
    console.log('Audiobooks directory does not exist, creating it...');
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
    console.error('Library scan aborted: no users exist in the database');
    return { imported: 0, skipped: 0, errors: 0 };
  }

  // Load all existing paths into memory for fast lookups during scan
  await loadPathCache();

  // Scan files grouped by directory
  const groupedFiles = scanDirectory(audiobooksDir, true);
  console.log(`Found audio files in ${groupedFiles.size} directories`);

  // Merge subdirectories that are part of the same audiobook (e.g., CD1, CD2, Part1, Part2)
  const mergedGroups = mergeSubdirectories(groupedFiles);
  console.log(`After merging subdirectories: ${mergedGroups.size} audiobook groups`);

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
        console.log(`Processing multi-file audiobook in ${directory} (${files.length} files)`);
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
      console.error(`Failed to import from ${directory}:`, error.message);
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
    console.log(`Removed ${emptyDirsRemoved} empty directories`);
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
  console.log('Library scan complete:', stats);

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
  const _now = new Date();
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
    console.log('Periodic library scan already running');
    return;
  }

  scanIntervalMinutes = intervalMinutes;
  const intervalMs = intervalMinutes * 60 * 1000;
  console.log(`Starting periodic library scan every ${intervalMinutes} minutes`);

  // Run initial scan in background
  setImmediate(async () => {
    if (!isScanning) {
      isScanning = true;
      try {
        const result = await scanLibrary();
        lastScanTime = new Date();
        lastScanResult = result;
      } catch (error) {
        console.error('Error in initial library scan:', error);
        lastScanResult = { error: error.message };
      } finally {
        isScanning = false;
      }
    }
  });

  // Set up periodic scanning
  scanInterval = setInterval(async () => {
    if (isScanning || scanningLocked) {
      console.log('Library scan already in progress or locked, skipping...');
      return;
    }

    isScanning = true;
    try {
      console.log('Starting periodic library scan...');
      const result = await scanLibrary();
      lastScanTime = new Date();
      lastScanResult = result;
    } catch (error) {
      console.error('Error in periodic library scan:', error);
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
    console.log('Periodic library scan stopped');
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
