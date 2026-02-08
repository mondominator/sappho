const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const db = require('../database');
const { extractFileMetadata } = require('./fileProcessor');
const websocketManager = require('./websocketManager');
const { generateBestHash } = require('../utils/contentHash');
const { organizeAudiobook } = require('./fileOrganizer');
const emailService = require('./emailService');
const { readExternalMetadata, mergeExternalMetadata } = require('../utils/externalMetadata');

// Lazy load to avoid circular dependency
let isDirectoryBeingConverted = null;
const getConversionChecker = () => {
  if (!isDirectoryBeingConverted) {
    isDirectoryBeingConverted = require('../routes/audiobooks').isDirectoryBeingConverted;
  }
  return isDirectoryBeingConverted;
};

const execFileAsync = promisify(execFile);
const audiobooksDir = process.env.AUDIOBOOKS_DIR || path.join(__dirname, '../../data/audiobooks');

// Audio file extensions we support
const audioExtensions = ['.mp3', '.m4a', '.m4b', '.mp4', '.ogg', '.flac', '.opus', '.aac', '.wav', '.wma'];

/**
 * Recursively scan a directory for audio files, grouped by directory
 * Returns an array of objects: { directory: string, files: string[] }
 */
function scanDirectory(dir, groupByDirectory = false) {
  const audioFiles = [];
  const groupedFiles = new Map(); // Map of directory -> files

  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        // Recursively scan subdirectories
        if (groupByDirectory) {
          const subResults = scanDirectory(fullPath, true);
          for (const [subDir, files] of subResults.entries()) {
            groupedFiles.set(subDir, files);
          }
        } else {
          audioFiles.push(...scanDirectory(fullPath, false));
        }
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (audioExtensions.includes(ext)) {
          if (groupByDirectory) {
            if (!groupedFiles.has(dir)) {
              groupedFiles.set(dir, []);
            }
            groupedFiles.get(dir).push(fullPath);
          } else {
            audioFiles.push(fullPath);
          }
        }
      }
    }
  } catch (error) {
    console.error(`Error scanning directory ${dir}:`, error.message);
  }

  return groupByDirectory ? groupedFiles : audioFiles;
}

/**
 * Extract chapters from an audio file using ffprobe.
 * Works on any format with embedded chapters (M4B, M4A, MP3, OGG, FLAC, etc.)
 */
async function extractM4BChapters(filePath) {
  try {
    const { stdout } = await execFileAsync('ffprobe', [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_chapters',
      filePath
    ]);

    const data = JSON.parse(stdout);
    if (!data.chapters || data.chapters.length === 0) {
      return null;
    }

    return data.chapters.map((chapter, index) => ({
      chapter_number: index + 1,
      title: chapter.tags?.title || `Chapter ${index + 1}`,
      start_time: parseFloat(chapter.start_time) || 0,
      end_time: parseFloat(chapter.end_time) || 0,
      duration: (parseFloat(chapter.end_time) || 0) - (parseFloat(chapter.start_time) || 0)
    }));
  } catch (_error) {
    console.log(`No chapters found in ${path.basename(filePath)} or ffprobe not available`);
    return null;
  }
}

// In-memory caches for scan-time lookups (populated at scan start, cleared after)
let knownFilePaths = null;  // Set of all file_path values in audiobooks table
let knownDirectories = null;  // Map of directory -> { id, file_path } for directory-level dedup

/**
 * Load all existing audiobook paths into memory for fast O(1) lookup during scan.
 * Call this once at the start of a scan instead of querying per-file.
 */
function loadPathCache() {
  return new Promise((resolve, reject) => {
    db.all('SELECT id, file_path FROM audiobooks', [], (err, rows) => {
      if (err) return reject(err);

      knownFilePaths = new Set();
      knownDirectories = new Map();

      for (const row of (rows || [])) {
        knownFilePaths.add(row.file_path);
        const dir = path.dirname(row.file_path);
        if (!knownDirectories.has(dir)) {
          knownDirectories.set(dir, { id: row.id, file_path: row.file_path });
        }
      }

      console.log(`Path cache loaded: ${knownFilePaths.size} files in ${knownDirectories.size} directories`);
      resolve();
    });
  });
}

/**
 * Clear the in-memory path cache (call after scan completes)
 */
function clearPathCache() {
  knownFilePaths = null;
  knownDirectories = null;
}

/**
 * Check if a file already exists in the database (uses cache if available)
 */
function fileExistsInDatabase(filePath) {
  if (knownFilePaths) {
    return Promise.resolve(knownFilePaths.has(filePath));
  }
  return new Promise((resolve, reject) => {
    db.get('SELECT id FROM audiobooks WHERE file_path = ?', [filePath], (err, row) => {
      if (err) reject(err);
      else resolve(!!row);
    });
  });
}

/**
 * Check if another audiobook already exists in the same directory (uses cache if available)
 */
function audiobookExistsInDirectory(filePath) {
  const dir = path.dirname(filePath);
  if (knownDirectories) {
    return Promise.resolve(knownDirectories.get(dir) || null);
  }
  return new Promise((resolve, reject) => {
    db.get('SELECT id, file_path FROM audiobooks WHERE file_path LIKE ?', [`${dir}/%`], (err, row) => {
      if (err) reject(err);
      else resolve(row || null);
    });
  });
}

/**
 * Check if an audiobook with the given content hash already exists
 */
function audiobookExistsByHash(contentHash) {
  return new Promise((resolve, reject) => {
    db.get('SELECT id, file_path, title FROM audiobooks WHERE content_hash = ?', [contentHash], (err, row) => {
      if (err) {
        reject(err);
      } else {
        resolve(row || null);
      }
    });
  });
}

/**
 * Check if an unavailable audiobook with the given content hash exists
 * Used for restoring books that were previously removed
 */
function findUnavailableByHash(contentHash) {
  return new Promise((resolve, reject) => {
    db.get(
      'SELECT * FROM audiobooks WHERE content_hash = ? AND is_available = 0',
      [contentHash],
      (err, row) => {
        if (err) reject(err);
        else resolve(row || null);
      }
    );
  });
}

/**
 * Mark an audiobook as available (file exists)
 */
function markAvailable(audiobookId, filePath = null) {
  return new Promise((resolve, reject) => {
    const updates = filePath
      ? 'is_available = 1, last_seen_at = CURRENT_TIMESTAMP, file_path = ?'
      : 'is_available = 1, last_seen_at = CURRENT_TIMESTAMP';
    const params = filePath ? [filePath, audiobookId] : [audiobookId];

    db.run(
      `UPDATE audiobooks SET ${updates} WHERE id = ?`,
      params,
      (err) => {
        if (err) reject(err);
        else {
          console.log(`Marked audiobook ${audiobookId} as available`);
          resolve();
        }
      }
    );
  });
}

/**
 * Mark an audiobook as unavailable (file missing)
 * Preserves all user data (progress, ratings, collections)
 */
function markUnavailable(audiobookId) {
  return new Promise((resolve, reject) => {
    db.run(
      'UPDATE audiobooks SET is_available = 0, original_path = file_path WHERE id = ?',
      [audiobookId],
      (err) => {
        if (err) reject(err);
        else {
          console.log(`Marked audiobook ${audiobookId} as unavailable (file missing)`);
          // Broadcast to connected clients
          websocketManager.broadcastLibraryUpdate('library.unavailable', { id: audiobookId });
          resolve();
        }
      }
    );
  });
}

/**
 * Update last_seen_at timestamp for an audiobook
 */
function updateLastSeen(audiobookId) {
  return new Promise((resolve, reject) => {
    db.run(
      'UPDATE audiobooks SET last_seen_at = CURRENT_TIMESTAMP WHERE id = ?',
      [audiobookId],
      (err) => {
        if (err) reject(err);
        else resolve();
      }
    );
  });
}

/**
 * Get all audiobooks from the database
 */
function getAllAudiobooks() {
  return new Promise((resolve, reject) => {
    db.all('SELECT * FROM audiobooks', [], (err, rows) => {
      if (err) reject(err);
      else resolve(rows || []);
    });
  });
}

/**
 * Check file availability for all audiobooks and update status
 */
async function checkAvailability() {
  console.log('Checking file availability...');
  const audiobooks = await getAllAudiobooks();
  let restored = 0;
  let missing = 0;

  for (const book of audiobooks) {
    const fileExists = fs.existsSync(book.file_path);

    // For multi-file books, check if at least one chapter exists
    let hasChapters = false;
    if (book.is_multi_file && !fileExists) {
      const chapters = await new Promise((resolve, reject) => {
        db.all(
          'SELECT file_path FROM audiobook_chapters WHERE audiobook_id = ?',
          [book.id],
          (err, rows) => {
            if (err) reject(err);
            else resolve(rows || []);
          }
        );
      });
      hasChapters = chapters.some(ch => fs.existsSync(ch.file_path));
    }

    const isAvailable = fileExists || hasChapters;
    const wasAvailable = book.is_available !== 0;

    if (isAvailable && !wasAvailable) {
      // Book returned - restore availability
      await markAvailable(book.id);
      restored++;
    } else if (!isAvailable && wasAvailable) {
      // Book missing - mark unavailable (keep all user data)
      await markUnavailable(book.id);
      missing++;
    } else if (isAvailable) {
      // Update last_seen timestamp
      await updateLastSeen(book.id);
    }
  }

  if (restored > 0 || missing > 0) {
    console.log(`Availability check: ${restored} restored, ${missing} marked unavailable`);
  }

  return { restored, missing };
}

/**
 * Restore an unavailable audiobook with a new file path
 */
async function restoreAudiobook(existingBook, newFilePath, _metadata) {
  console.log(`Restoring previously unavailable book: ${existingBook.title}`);

  // Update the existing record with new file path and mark as available
  return new Promise((resolve, reject) => {
    db.run(
      `UPDATE audiobooks
       SET file_path = ?, is_available = 1, last_seen_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [newFilePath, existingBook.id],
      function(err) {
        if (err) {
          reject(err);
        } else {
          db.get('SELECT * FROM audiobooks WHERE id = ?', [existingBook.id], (err, audiobook) => {
            if (err) {
              reject(err);
            } else {
              console.log(`Restored: ${existingBook.title} - user data preserved`);
              websocketManager.broadcastLibraryUpdate('library.restored', audiobook);
              resolve(audiobook);
            }
          });
        }
      }
    );
  });
}

/**
 * Import a single-file audiobook into the database without moving it
 */
async function importAudiobook(filePath, userId = 1) {
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

    // Generate content hash for stable identification
    const contentHash = generateBestHash(metadata, filePath);

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

    // Get file stats
    const stats = fs.statSync(filePath);

    // Try to extract embedded chapters using ffprobe (works on all formats, not just M4B/M4A)
    let chapters = null;
    chapters = await extractM4BChapters(filePath);

    // Determine if this should be marked as multi-file (has embedded chapters)
    const hasChapters = chapters && chapters.length > 1;

    // Save to database without moving the file
    return new Promise((resolve, reject) => {
      db.run(
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
        ],
        function (err) {
          if (err) {
            reject(err);
          } else {
            const audiobookId = this.lastID;

            // If we have chapters, insert them
            if (hasChapters) {
              // Use Promise.all to insert all chapters and wait for all to complete
              const chapterInsertPromises = chapters.map((chapter) => {
                return new Promise((resolveChapter, rejectChapter) => {
                  db.run(
                    `INSERT INTO audiobook_chapters
                     (audiobook_id, chapter_number, file_path, duration, start_time, title)
                     VALUES (?, ?, ?, ?, ?, ?)`,
                    [
                      audiobookId,
                      chapter.chapter_number,
                      filePath, // Same file for all chapters in m4b
                      chapter.duration,
                      chapter.start_time,
                      chapter.title,
                    ],
                    (err) => {
                      if (err) rejectChapter(err);
                      else resolveChapter();
                    }
                  );
                });
              });

              Promise.all(chapterInsertPromises)
                .then(() => {
                  db.get('SELECT * FROM audiobooks WHERE id = ?', [audiobookId], (err, audiobook) => {
                    if (err) {
                      reject(err);
                    } else {
                      console.log(`Imported: ${metadata.title} by ${metadata.author} (${chapters.length} chapters)`);
                      // Broadcast to connected clients
                      websocketManager.broadcastLibraryUpdate('library.add', audiobook);
                      // Send email notification to subscribed users
                      emailService.notifyNewAudiobook(audiobook).catch(e =>
                        console.error('Error sending new audiobook notification:', e.message)
                      );
                      resolve(audiobook);
                    }
                  });
                })
                .catch((err) => {
                  console.error(`Error inserting chapters for ${metadata.title}:`, err.message);
                  reject(err);
                });
            } else {
              db.get('SELECT * FROM audiobooks WHERE id = ?', [audiobookId], (err, audiobook) => {
                if (err) {
                  reject(err);
                } else {
                  console.log(`Imported: ${metadata.title} by ${metadata.author}`);
                  // Broadcast to connected clients
                  websocketManager.broadcastLibraryUpdate('library.add', audiobook);
                  // Send email notification to subscribed users
                  emailService.notifyNewAudiobook(audiobook).catch(e =>
                    console.error('Error sending new audiobook notification:', e.message)
                  );
                  resolve(audiobook);
                }
              });
            }
          }
        }
      );
    });
  } catch (error) {
    console.error(`Error importing ${filePath}:`, error.message);
    return null;
  }
}

/**
 * Import a multi-file audiobook (multiple chapters) into the database
 */
async function importMultiFileAudiobook(chapterFiles, userId = 1) {
  try {
    // Sort chapter files by name to ensure correct order
    const sortedFiles = chapterFiles.sort();

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
    const directory = path.dirname(sortedFiles[0]);
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

    // Generate content hash for stable identification (use total duration for multi-file)
    const contentHash = generateBestHash({ ...metadata, duration: totalDuration }, firstFilePath);

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

    // Save audiobook to database with is_multi_file flag
    return new Promise((resolve, reject) => {
      db.run(
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
        ],
        function (err) {
          if (err) {
            reject(err);
          } else {
            const audiobookId = this.lastID;

            // Calculate cumulative start times for each chapter
            let cumulativeTime = 0;
            const chaptersWithStartTimes = chapterMetadata.map((chapter, _index) => {
              const chapterWithStart = {
                ...chapter,
                start_time: cumulativeTime
              };
              cumulativeTime += chapter.duration || 0;
              return chapterWithStart;
            });

            // Use Promise.all to insert all chapters and wait for all to complete
            const chapterInsertPromises = chaptersWithStartTimes.map((chapter, index) => {
              return new Promise((resolveChapter, rejectChapter) => {
                db.run(
                  `INSERT INTO audiobook_chapters
                   (audiobook_id, chapter_number, file_path, duration, file_size, title, start_time)
                   VALUES (?, ?, ?, ?, ?, ?, ?)`,
                  [
                    audiobookId,
                    index + 1,
                    chapter.file_path,
                    chapter.duration,
                    chapter.file_size,
                    chapter.title,
                    chapter.start_time,
                  ],
                  (err) => {
                    if (err) rejectChapter(err);
                    else resolveChapter();
                  }
                );
              });
            });

            Promise.all(chapterInsertPromises)
              .then(() => {
                db.get('SELECT * FROM audiobooks WHERE id = ?', [audiobookId], (err, audiobook) => {
                  if (err) {
                    reject(err);
                  } else {
                    console.log(`Imported multi-file audiobook: ${metadata.title} (${chaptersWithStartTimes.length} chapters)`);
                    // Broadcast to connected clients
                    websocketManager.broadcastLibraryUpdate('library.add', audiobook);
                    // Send email notification to subscribed users
                    emailService.notifyNewAudiobook(audiobook).catch(e =>
                      console.error('Error sending new audiobook notification:', e.message)
                    );
                    resolve(audiobook);
                  }
                });
              })
              .catch((err) => {
                console.error(`Error inserting chapters for multi-file audiobook ${metadata.title}:`, err.message);
                reject(err);
              });
          }
        }
      );
    });
  } catch (error) {
    console.error('Error importing multi-file audiobook:', error.message);
    return null;
  }
}

/**
 * Merge subdirectories that belong to the same audiobook
 * For example: /Book/CD1/file.mp3 and /Book/CD2/file.mp3 should be merged
 */
function mergeSubdirectories(groupedFiles) {
  const mergedGroups = new Map();
  const processedDirs = new Set();

  // Group directories by their parent
  const parentGroups = new Map();
  for (const [dir, files] of groupedFiles.entries()) {
    const parent = path.dirname(dir);
    if (!parentGroups.has(parent)) {
      parentGroups.set(parent, []);
    }
    parentGroups.set(parent, [...parentGroups.get(parent), { dir, files }]);
  }

  // For each parent directory
  for (const [parent, children] of parentGroups.entries()) {
    // If there's only one child directory, no merging needed
    if (children.length === 1) {
      const { dir, files } = children[0];
      mergedGroups.set(dir, files);
      processedDirs.add(dir);
      continue;
    }

    // Check if children look like multi-part audiobook (CD1, CD2, Part 1, Part 2, etc.)
    // Common patterns: CD, Disc, Disk, Part, Vol, Volume, Chapter, numbered directories
    const dirNames = children.map(c => path.basename(c.dir).toLowerCase());
    const looksLikeMultiPart = dirNames.some(name =>
      /^(cd|disc|disk|part|vol|volume|chapter|ch)[\s_-]*\d+$/i.test(name) ||
      /^\d+$/.test(name) // Just a number
    );

    const allFiles = children.flatMap(c => c.files);

    if (looksLikeMultiPart) {
      // Merge all files from subdirectories into parent
      console.log(`Merging ${children.length} subdirectories under ${parent}`);
      mergedGroups.set(parent, allFiles);
      children.forEach(c => processedDirs.add(c.dir));
    } else {
      // Don't merge, keep as separate directories
      children.forEach(({ dir, files }) => {
        mergedGroups.set(dir, files);
        processedDirs.add(dir);
      });
    }
  }

  return mergedGroups;
}

/**
 * Recursively find and remove all empty directories in the library
 * Works bottom-up to handle nested empty directories
 */
function cleanupAllEmptyDirectories() {
  let removed = 0;

  function scanAndClean(dir) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (_err) {
      return;
    }

    // First, recurse into subdirectories
    for (const entry of entries) {
      if (entry.isDirectory() && !entry.name.startsWith('.')) {
        scanAndClean(path.join(dir, entry.name));
      }
    }

    // After processing children, check if this directory is now empty
    // Re-read to get updated contents after child cleanup
    if (dir !== audiobooksDir) {
      try {
        const currentEntries = fs.readdirSync(dir);
        // Filter out hidden files for the empty check
        const visibleEntries = currentEntries.filter(e => !e.startsWith('.'));
        if (visibleEntries.length === 0) {
          fs.rmdirSync(dir);
          console.log(`Removed empty directory: ${dir}`);
          removed++;
        }
      } catch (_err) {
        // Directory might have been removed or inaccessible
      }
    }
  }

  scanAndClean(audiobooksDir);
  return removed;
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
        const result = await importMultiFileAudiobook(files);
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
          const result = await importAudiobook(file);
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
  const emptyDirsRemoved = cleanupAllEmptyDirectories();
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
  importAudiobook,
  startPeriodicScan,
  stopPeriodicScan,
  lockScanning,
  unlockScanning,
  isScanningLocked,
  getJobStatus,
  checkAvailability,
  markAvailable,
  markUnavailable,
};
