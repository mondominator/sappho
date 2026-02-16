/**
 * File System Utilities
 *
 * Recursive directory scanning, chapter extraction, subdirectory merging,
 * and empty directory cleanup for the library scanner.
 */

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

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
function cleanupAllEmptyDirectories(audiobooksDir) {
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

module.exports = {
  audioExtensions,
  scanDirectory,
  extractM4BChapters,
  mergeSubdirectories,
  cleanupAllEmptyDirectories
};
