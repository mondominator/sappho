/**
 * File Organizer Service
 *
 * Handles automatic organization of audiobook files into a structured directory layout:
 * - With series: {AUDIOBOOKS_DIR}/{Author}/{Series}/{Position} - {Title}/
 * - Without series: {AUDIOBOOKS_DIR}/{Author}/{Title}/
 */
const logger = require('../utils/logger');

const fs = require('fs');
const path = require('path');
const db = require('../database');
const websocketManager = require('./websocketManager');
const { updatePathCacheEntry } = require('./pathCache');

const audiobooksDir = process.env.AUDIOBOOKS_DIR || path.join(__dirname, '../../data/audiobooks');

// Lazy-load conversion lock check to avoid circular dependency
let _isDirectoryBeingConverted = null;
function isDirectoryBeingConverted(dir) {
  if (!_isDirectoryBeingConverted) {
    try {
      _isDirectoryBeingConverted = require('../routes/audiobooks').isDirectoryBeingConverted;
    } catch (_e) {
      return false;
    }
  }
  return _isDirectoryBeingConverted ? _isDirectoryBeingConverted(dir) : false;
}

/**
 * Sanitize a string for use as a directory/file name
 * Replaces invalid characters with underscores
 */
function sanitizeName(name) {
  if (!name) return null;
  // Replace characters that are invalid in file paths: < > : " / \ | ? *
  // Also replace control characters and trim whitespace
  return name
    // eslint-disable-next-line no-control-regex
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Format series position for directory name
 * e.g., 1 -> "01", 1.5 -> "01.5", 10 -> "10"
 */
function formatSeriesPosition(position) {
  if (position === null || position === undefined) return null;
  const num = parseFloat(position);
  if (isNaN(num)) return null;

  // Pad with leading zero if single digit
  if (Number.isInteger(num)) {
    return num < 10 ? `0${num}` : `${num}`;
  } else {
    // Handle decimal positions like 1.5
    const intPart = Math.floor(num);
    const decPart = num - intPart;
    const paddedInt = intPart < 10 ? `0${intPart}` : `${intPart}`;
    return `${paddedInt}${decPart.toFixed(1).substring(1)}`;
  }
}

/**
 * Generate the target filename for an audiobook based on its title
 *
 * @param {Object} audiobook - Audiobook record from database
 * @param {string} originalPath - Original file path to get extension
 * @returns {string} Target filename with extension
 */
function getTargetFilename(audiobook, originalPath) {
  const title = sanitizeName(audiobook.title) || 'Unknown Title';
  const ext = path.extname(originalPath);
  return `${title}${ext}`;
}

/**
 * Calculate the target directory path for an audiobook based on its metadata
 *
 * @param {Object} audiobook - Audiobook record from database
 * @returns {string} Target directory path
 */
function getTargetDirectory(audiobook) {
  const author = sanitizeName(audiobook.author) || 'Unknown Author';
  const title = sanitizeName(audiobook.title) || 'Unknown Title';
  const series = sanitizeName(audiobook.series);
  const position = formatSeriesPosition(audiobook.series_position);

  let targetDir;

  if (series) {
    // With series: Author/Series/Position - Title/
    const bookFolder = position ? `${position} - ${title}` : title;
    targetDir = path.join(audiobooksDir, author, series, bookFolder);
  } else {
    // Without series: Author/Title/
    targetDir = path.join(audiobooksDir, author, title);
  }

  return targetDir;
}

/**
 * Check if a file needs to be organized (moved to correct location or renamed)
 *
 * @param {Object} audiobook - Audiobook record from database
 * @returns {boolean} True if file should be moved or renamed
 */
function needsOrganization(audiobook) {
  const currentDir = path.dirname(audiobook.file_path);
  const targetDir = getTargetDirectory(audiobook);

  // Normalize paths for comparison
  const normalizedCurrent = path.normalize(currentDir);
  const normalizedTarget = path.normalize(targetDir);

  // For multi-file books, only check directory (chapter filenames should not be renamed)
  if (audiobook.is_multi_file) {
    return normalizedCurrent !== normalizedTarget;
  }

  // For single-file books, check directory and filename
  const currentFilename = path.basename(audiobook.file_path);
  const targetFilename = getTargetFilename(audiobook, audiobook.file_path);
  return normalizedCurrent !== normalizedTarget || currentFilename !== targetFilename;
}

/**
 * Move a file safely with cross-filesystem support
 *
 * @param {string} source - Source file path
 * @param {string} destination - Destination file path
 * @returns {boolean} True if move succeeded
 */
function moveFile(source, destination) {
  try {
    // Try atomic rename first (fast, same filesystem)
    fs.renameSync(source, destination);
    logger.info(`Moved file (rename): ${path.basename(source)}`);
    return true;
  } catch (_renameErr) {
    // Rename failed (likely cross-filesystem), use copy+delete
    try {
      fs.copyFileSync(source, destination);

      // Verify copy succeeded by checking file size
      const sourceStats = fs.statSync(source);
      const destStats = fs.statSync(destination);

      if (sourceStats.size !== destStats.size) {
        fs.unlinkSync(destination);
        throw new Error('File size mismatch after copy');
      }

      try {
        fs.unlinkSync(source);
      } catch (deleteErr) {
        // Source couldn't be deleted - remove the copy to avoid duplicates
        logger.error(`Failed to delete source ${source}: ${deleteErr.message}, removing copy`);
        fs.unlinkSync(destination);
        return false;
      }
      logger.info(`Moved file (copy+delete): ${path.basename(source)}`);
      return true;
    } catch (copyErr) {
      logger.error(`Failed to move file ${source}:`, copyErr.message);
      // Clean up destination if it was created
      try { if (fs.existsSync(destination)) fs.unlinkSync(destination); } catch (_e) { /* ignore */ }
      return false;
    }
  }
}

/**
 * Clean up empty directories recursively up to audiobooksDir
 *
 * @param {string} dir - Directory to clean up
 */
function cleanupEmptyDirectories(dir) {
  // Don't delete the main audiobooks directory
  if (path.normalize(dir) === path.normalize(audiobooksDir)) {
    return;
  }

  try {
    const contents = fs.readdirSync(dir);
    if (contents.length === 0) {
      fs.rmdirSync(dir);
      logger.info(`Removed empty directory: ${dir}`);
      // Recursively check parent
      cleanupEmptyDirectories(path.dirname(dir));
    }
  } catch (_err) {
    // Directory doesn't exist or isn't empty, that's fine
  }
}

/**
 * Update chapter file paths in the database
 *
 * @param {number} audiobookId - Audiobook ID
 * @param {string} oldDir - Old directory path
 * @param {string} newDir - New directory path
 */
function updateChapterPaths(audiobookId, oldDir, newDir) {
  return new Promise((resolve, reject) => {
    // Update chapter paths by replacing the directory prefix (anchored to start of path)
    db.run(
      `UPDATE audiobook_chapters
       SET file_path = ? || SUBSTR(file_path, LENGTH(?) + 1)
       WHERE audiobook_id = ? AND file_path LIKE ? || '%'`,
      [newDir, oldDir, audiobookId, oldDir],
      (err) => {
        if (err) reject(err);
        else resolve();
      }
    );
  });
}

/**
 * Organize a single audiobook - move files to correct directory structure
 *
 * @param {Object} audiobook - Audiobook record from database
 * @returns {Promise<{moved: boolean, newPath?: string, error?: string}>}
 */
async function organizeAudiobook(audiobook) {
  try {
    // Check if organization is needed
    if (!needsOrganization(audiobook)) {
      return { moved: false };
    }

    // Skip if directory has an active conversion (don't move files ffmpeg is reading)
    const currentDir = path.dirname(audiobook.file_path);
    if (isDirectoryBeingConverted(currentDir)) {
      logger.info(`Skipping organization of "${audiobook.title}" - conversion in progress`);
      return { moved: false };
    }

    // Check if source file exists
    if (!fs.existsSync(audiobook.file_path)) {
      return { moved: false, error: 'Source file not found' };
    }

    const targetDir = getTargetDirectory(audiobook);
    const originalFilename = path.basename(audiobook.file_path);

    logger.info(`Organizing: "${audiobook.title}" by ${audiobook.author}`);
    logger.info(`  From: ${currentDir}`);
    logger.info(`  To: ${targetDir}`);

    // Create target directory
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    let newFilePath;

    if (audiobook.is_multi_file) {
      // Multi-file: move all audio files in the source directory, not just
      // those in the chapters table (which may have been overwritten by
      // Audnexus chapter fetch). This ensures all MP3s move together.
      const audioExtensions = ['.mp3', '.m4a', '.m4b', '.mp4', '.ogg', '.flac', '.opus', '.aac', '.wav', '.wma'];
      try {
        const dirFiles = fs.readdirSync(currentDir)
          .filter(f => audioExtensions.includes(path.extname(f).toLowerCase()));
        for (const fileName of dirFiles) {
          const srcPath = path.join(currentDir, fileName);
          const destPath = path.join(targetDir, fileName);
          moveFile(srcPath, destPath);
        }
      } catch (e) {
        logger.warn(`  Could not scan source directory for audio files: ${e.message}`);
      }

      // Also move the main file_path reference if it wasn't in the directory scan
      newFilePath = path.join(targetDir, originalFilename);
      if (fs.existsSync(audiobook.file_path)) {
        moveFile(audiobook.file_path, newFilePath);
      }

      // Update chapter paths in database (directory-level replace)
      await updateChapterPaths(audiobook.id, currentDir, targetDir);
    } else {
      // Single-file: rename to Title.ext
      const targetFilename = getTargetFilename(audiobook, audiobook.file_path);
      newFilePath = path.join(targetDir, targetFilename);

      // If target already exists and isn't the source file, skip the move
      if (fs.existsSync(newFilePath) && path.normalize(newFilePath) !== path.normalize(audiobook.file_path)) {
        logger.info(`  Skipping move: target already exists at ${newFilePath}`);
        return { moved: false };
      }

      if (!moveFile(audiobook.file_path, newFilePath)) {
        return { moved: false, error: 'Failed to move audio file' };
      }
    }

    // Move cover art if it exists in the same directory
    let newCoverPath = audiobook.cover_path || audiobook.cover_image;
    if (newCoverPath && fs.existsSync(newCoverPath)) {
      const coverDir = path.dirname(newCoverPath);
      if (path.normalize(coverDir) === path.normalize(currentDir)) {
        const coverFileName = path.basename(newCoverPath);
        const targetCoverPath = path.join(targetDir, coverFileName);
        if (moveFile(newCoverPath, targetCoverPath)) {
          newCoverPath = targetCoverPath;
        }
      }
    }

    // Update database with new paths
    await new Promise((resolve, reject) => {
      db.run(
        `UPDATE audiobooks
         SET file_path = ?, cover_path = ?, cover_image = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [newFilePath, newCoverPath, newCoverPath, audiobook.id],
        (err) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });

    // Update scanner's path cache so a concurrent scan doesn't re-import at the new location
    updatePathCacheEntry(audiobook.file_path, newFilePath, audiobook.id);

    // Clean up empty directories
    cleanupEmptyDirectories(currentDir);

    // Broadcast update to connected clients
    websocketManager.broadcastLibraryUpdate('library.update', { id: audiobook.id, file_path: newFilePath });

    logger.info(`  Successfully organized to: ${newFilePath}`);
    return { moved: true, newPath: newFilePath };

  } catch (error) {
    logger.error(`Error organizing audiobook ${audiobook.id}:`, error.message);
    return { moved: false, error: error.message };
  }
}

/**
 * Organize all audiobooks in the library
 *
 * @returns {Promise<{moved: number, skipped: number, errors: number}>}
 */
async function organizeLibrary() {
  logger.info('Starting library organization...');

  const stats = { moved: 0, skipped: 0, errors: 0 };

  // Get all available audiobooks
  const audiobooks = await new Promise((resolve, reject) => {
    db.all(
      'SELECT * FROM audiobooks WHERE is_available = 1 OR is_available IS NULL',
      [],
      (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      }
    );
  });

  logger.info(`Found ${audiobooks.length} audiobooks to check`);

  for (const audiobook of audiobooks) {
    const result = await organizeAudiobook(audiobook);

    if (result.moved) {
      stats.moved++;
    } else if (result.error) {
      stats.errors++;
    } else {
      stats.skipped++;
    }
  }

  logger.info('Library organization complete:', stats);
  return stats;
}

/**
 * Get a preview of what would be organized without actually moving files
 *
 * @returns {Promise<Array<{id: number, title: string, currentPath: string, targetPath: string}>>}
 */
async function getOrganizationPreview() {
  const audiobooks = await new Promise((resolve, reject) => {
    db.all(
      'SELECT * FROM audiobooks WHERE is_available = 1 OR is_available IS NULL',
      [],
      (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      }
    );
  });

  const needsMove = [];

  for (const audiobook of audiobooks) {
    if (needsOrganization(audiobook)) {
      // Multi-file books preserve their chapter filenames; single-file books get renamed
      const targetFilename = audiobook.is_multi_file
        ? path.basename(audiobook.file_path)
        : getTargetFilename(audiobook, audiobook.file_path);
      needsMove.push({
        id: audiobook.id,
        title: audiobook.title,
        author: audiobook.author,
        currentPath: audiobook.file_path,
        targetPath: path.join(getTargetDirectory(audiobook), targetFilename)
      });
    }
  }

  return needsMove;
}

module.exports = {
  getTargetDirectory,
  getTargetFilename,
  needsOrganization,
  organizeAudiobook,
  organizeLibrary,
  getOrganizationPreview,
  sanitizeName,
  cleanupEmptyDirectories,
};
