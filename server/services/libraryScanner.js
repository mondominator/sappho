const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const db = require('../database');
const { extractFileMetadata } = require('./fileProcessor');

const execFileAsync = promisify(execFile);
const audiobooksDir = process.env.AUDIOBOOKS_DIR || path.join(__dirname, '../../data/audiobooks');

// Audio file extensions we support
const audioExtensions = ['.mp3', '.m4a', '.m4b', '.mp4', '.ogg', '.flac'];

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
 * Extract chapters from an m4b file using ffprobe
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
  } catch (error) {
    console.log(`No chapters found in ${path.basename(filePath)} or ffprobe not available`);
    return null;
  }
}

/**
 * Check if a file already exists in the database
 */
function fileExistsInDatabase(filePath) {
  return new Promise((resolve, reject) => {
    db.get('SELECT id FROM audiobooks WHERE file_path = ?', [filePath], (err, row) => {
      if (err) {
        reject(err);
      } else {
        resolve(!!row);
      }
    });
  });
}

/**
 * Import a single-file audiobook into the database without moving it
 */
async function importAudiobook(filePath, userId = 1) {
  try {
    // Check if already in database
    const exists = await fileExistsInDatabase(filePath);
    if (exists) {
      console.log(`Skipping ${filePath} - already in database`);
      return null;
    }

    // Extract metadata from the file
    const metadata = await extractFileMetadata(filePath);

    // Get file stats
    const stats = fs.statSync(filePath);

    // Check if this is an m4b file with chapters
    const ext = path.extname(filePath).toLowerCase();
    const isM4B = ext === '.m4b';
    let chapters = null;

    if (isM4B) {
      chapters = await extractM4BChapters(filePath);
    }

    // Determine if this should be marked as multi-file (has embedded chapters)
    const hasChapters = chapters && chapters.length > 1;

    // Save to database without moving the file
    return new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO audiobooks
         (title, author, narrator, description, duration, file_path, file_size,
          genre, published_year, isbn, series, series_position, cover_image, is_multi_file, added_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
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
        ],
        function (err) {
          if (err) {
            reject(err);
          } else {
            const audiobookId = this.lastID;

            // If we have chapters, insert them
            if (hasChapters) {
              let completedChapters = 0;
              let hasError = false;

              chapters.forEach((chapter) => {
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
                    if (err && !hasError) {
                      hasError = true;
                      reject(err);
                    } else {
                      completedChapters++;
                      if (completedChapters === chapters.length && !hasError) {
                        db.get('SELECT * FROM audiobooks WHERE id = ?', [audiobookId], (err, audiobook) => {
                          if (err) {
                            reject(err);
                          } else {
                            console.log(`Imported: ${metadata.title} by ${metadata.author} (${chapters.length} chapters)`);
                            resolve(audiobook);
                          }
                        });
                      }
                    }
                  }
                );
              });
            } else {
              db.get('SELECT * FROM audiobooks WHERE id = ?', [audiobookId], (err, audiobook) => {
                if (err) {
                  reject(err);
                } else {
                  console.log(`Imported: ${metadata.title} by ${metadata.author}`);
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

    // Store first file path as reference (will use chapters for playback)
    const firstFilePath = sortedFiles[0];

    // Check if already in database (check by first file path or by directory)
    const exists = await fileExistsInDatabase(firstFilePath);
    if (exists) {
      console.log(`Skipping multi-file audiobook ${metadata.title} - already in database`);
      return null;
    }

    // Save audiobook to database with is_multi_file flag
    return new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO audiobooks
         (title, author, narrator, description, duration, file_path, file_size,
          genre, published_year, isbn, series, series_position, cover_image, is_multi_file, added_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
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
        ],
        function (err) {
          if (err) {
            reject(err);
          } else {
            const audiobookId = this.lastID;

            // Insert chapters with cumulative start times
            let completedChapters = 0;
            let hasError = false;

            // Calculate cumulative start times for each chapter
            let cumulativeTime = 0;
            const chaptersWithStartTimes = chapterMetadata.map((chapter, index) => {
              const chapterWithStart = {
                ...chapter,
                start_time: cumulativeTime
              };
              cumulativeTime += chapter.duration || 0;
              return chapterWithStart;
            });

            chaptersWithStartTimes.forEach((chapter, index) => {
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
                  if (err && !hasError) {
                    hasError = true;
                    reject(err);
                  } else {
                    completedChapters++;
                    if (completedChapters === chaptersWithStartTimes.length && !hasError) {
                      db.get('SELECT * FROM audiobooks WHERE id = ?', [audiobookId], (err, audiobook) => {
                        if (err) {
                          reject(err);
                        } else {
                          console.log(`Imported multi-file audiobook: ${metadata.title} (${chaptersWithStartTimes.length} chapters)`);
                          resolve(audiobook);
                        }
                      });
                    }
                  }
                }
              );
            });
          }
        }
      );
    });
  } catch (error) {
    console.error(`Error importing multi-file audiobook:`, error.message);
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

  // Scan files grouped by directory
  const groupedFiles = scanDirectory(audiobooksDir, true);
  console.log(`Found audio files in ${groupedFiles.size} directories`);

  let imported = 0;
  let skipped = 0;
  let errors = 0;
  let totalFiles = 0;

  // Process each directory
  for (const [directory, files] of groupedFiles.entries()) {
    totalFiles += files.length;

    try {
      // Check if this looks like a multi-file audiobook (chapters) or separate books
      // M4B files typically have embedded chapters, so multiple M4Bs are likely separate books
      // MP3/M4A/FLAC files typically don't have chapters, so multiple files are likely chapters
      const hasM4BFiles = files.some(f => path.extname(f).toLowerCase() === '.m4b');
      const isMultiFileBook = files.length > 1 && !hasM4BFiles;

      if (isMultiFileBook) {
        // Multi-file audiobook - treat all files in directory as chapters
        console.log(`Processing multi-file audiobook in ${directory} (${files.length} files)`);
        const result = await importMultiFileAudiobook(files);
        if (result) {
          imported++;
        } else {
          skipped++;
        }
      } else {
        // Single file audiobook(s) - process each file separately
        for (const file of files) {
          const result = await importAudiobook(file);
          if (result) {
            imported++;
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

  const stats = { imported, skipped, errors, totalFiles, totalBooks: groupedFiles.size };
  console.log('Library scan complete:', stats);

  return stats;
}

/**
 * Start periodic library scanning
 */
let scanInterval = null;
let isScanning = false;

function startPeriodicScan(intervalMinutes = 5) {
  // Don't start if already running
  if (scanInterval) {
    console.log('Periodic library scan already running');
    return;
  }

  const intervalMs = intervalMinutes * 60 * 1000;
  console.log(`Starting periodic library scan every ${intervalMinutes} minutes`);

  // Run initial scan in background
  setImmediate(async () => {
    if (!isScanning) {
      isScanning = true;
      try {
        await scanLibrary();
      } catch (error) {
        console.error('Error in initial library scan:', error);
      } finally {
        isScanning = false;
      }
    }
  });

  // Set up periodic scanning
  scanInterval = setInterval(async () => {
    if (isScanning) {
      console.log('Library scan already in progress, skipping...');
      return;
    }

    isScanning = true;
    try {
      console.log('Starting periodic library scan...');
      await scanLibrary();
    } catch (error) {
      console.error('Error in periodic library scan:', error);
    } finally {
      isScanning = false;
    }
  }, intervalMs);
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
};
