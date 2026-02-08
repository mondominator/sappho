/**
 * File Organizer Service
 *
 * Handles automatic organization of audiobook files into a structured directory layout:
 * - With series: {AUDIOBOOKS_DIR}/{Author}/{Series}/{Position} - {Title}/
 * - Without series: {AUDIOBOOKS_DIR}/{Author}/{Title}/
 */

const fs = require('fs');
const path = require('path');
const db = require('../database');
const websocketManager = require('./websocketManager');

const audiobooksDir = process.env.AUDIOBOOKS_DIR || path.join(__dirname, '../../data/audiobooks');

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
  const currentFilename = path.basename(audiobook.file_path);
  const targetDir = getTargetDirectory(audiobook);
  const targetFilename = getTargetFilename(audiobook, audiobook.file_path);

  // Normalize paths for comparison
  const normalizedCurrent = path.normalize(currentDir);
  const normalizedTarget = path.normalize(targetDir);

  // Check if directory OR filename needs to change
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
    console.log(`Moved file (rename): ${path.basename(source)}`);
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
        console.error(`Failed to delete source ${source}: ${deleteErr.message}, removing copy`);
        fs.unlinkSync(destination);
        return false;
      }
      console.log(`Moved file (copy+delete): ${path.basename(source)}`);
      return true;
    } catch (copyErr) {
      console.error(`Failed to move file ${source}:`, copyErr.message);
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
      console.log(`Removed empty directory: ${dir}`);
      // Recursively check parent
      cleanupEmptyDirectories(path.dirname(dir));
    }
  } catch (_err) {
    // Directory doesn't exist or isn't empty, that's fine
  }
}

/**
 * Get all chapter file paths for a multi-file audiobook
 *
 * @param {number} audiobookId - Audiobook ID
 * @returns {Promise<string[]>} Array of chapter file paths
 */
function getChapterFiles(audiobookId) {
  return new Promise((resolve, reject) => {
    db.all(
      'SELECT file_path FROM audiobook_chapters WHERE audiobook_id = ? ORDER BY chapter_number',
      [audiobookId],
      (err, rows) => {
        if (err) reject(err);
        else resolve(rows ? rows.map(r => r.file_path) : []);
      }
    );
  });
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
    // Update all chapter paths by replacing the old directory with new
    db.run(
      `UPDATE audiobook_chapters
       SET file_path = REPLACE(file_path, ?, ?)
       WHERE audiobook_id = ?`,
      [oldDir, newDir, audiobookId],
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

    // Check if source file exists
    if (!fs.existsSync(audiobook.file_path)) {
      return { moved: false, error: 'Source file not found' };
    }

    const currentDir = path.dirname(audiobook.file_path);
    const targetDir = getTargetDirectory(audiobook);
    const originalFilename = path.basename(audiobook.file_path);
    const targetFilename = getTargetFilename(audiobook, audiobook.file_path);

    console.log(`Organizing: "${audiobook.title}" by ${audiobook.author}`);
    console.log(`  From: ${path.join(currentDir, originalFilename)}`);
    console.log(`  To: ${path.join(targetDir, targetFilename)}`);

    // Create target directory
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    // Handle potential filename conflicts
    let newFilePath = path.join(targetDir, targetFilename);
    let counter = 1;
    while (fs.existsSync(newFilePath) && newFilePath !== audiobook.file_path) {
      const ext = path.extname(targetFilename);
      const base = path.basename(targetFilename, ext);
      newFilePath = path.join(targetDir, `${base} (${counter})${ext}`);
      counter++;
    }

    // Move main audio file
    if (!moveFile(audiobook.file_path, newFilePath)) {
      return { moved: false, error: 'Failed to move audio file' };
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

    // Handle multi-file audiobooks (move all chapter files)
    if (audiobook.is_multi_file) {
      const chapterFiles = await getChapterFiles(audiobook.id);
      for (const chapterPath of chapterFiles) {
        if (fs.existsSync(chapterPath) && path.dirname(chapterPath) === currentDir) {
          const chapterFileName = path.basename(chapterPath);
          const targetChapterPath = path.join(targetDir, chapterFileName);
          moveFile(chapterPath, targetChapterPath);
        }
      }
      // Update chapter paths in database
      await updateChapterPaths(audiobook.id, currentDir, targetDir);
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

    // Clean up empty directories
    cleanupEmptyDirectories(currentDir);

    // Broadcast update to connected clients
    websocketManager.broadcastLibraryUpdate('library.update', { id: audiobook.id, file_path: newFilePath });

    console.log(`  Successfully organized to: ${newFilePath}`);
    return { moved: true, newPath: newFilePath };

  } catch (error) {
    console.error(`Error organizing audiobook ${audiobook.id}:`, error.message);
    return { moved: false, error: error.message };
  }
}

/**
 * Organize all audiobooks in the library
 *
 * @returns {Promise<{moved: number, skipped: number, errors: number}>}
 */
async function organizeLibrary() {
  console.log('Starting library organization...');

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

  console.log(`Found ${audiobooks.length} audiobooks to check`);

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

  console.log('Library organization complete:', stats);
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
      const targetFilename = getTargetFilename(audiobook, audiobook.file_path);
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
