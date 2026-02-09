/**
 * Thumbnail Service
 *
 * Generates and caches resized cover image thumbnails using sharp.
 * Thumbnails are stored in a dedicated directory keyed by audiobook ID and width.
 */

const fs = require('fs');
const path = require('path');

// Allowed thumbnail widths -- only these sizes can be requested
const ALLOWED_WIDTHS = [120, 300, 600];

// In-flight generation promises keyed by "{audiobookId}_{width}" to deduplicate
// concurrent requests for the same thumbnail
const inFlight = new Map();

// Central thumbnails cache directory
const THUMBNAILS_DIR = path.join(process.env.DATA_DIR || '/app/data', 'thumbnails');

/**
 * Check whether a requested width is valid
 * @param {number} width
 * @returns {boolean}
 */
function isValidWidth(width) {
  return Number.isInteger(width) && ALLOWED_WIDTHS.includes(width);
}

/**
 * Build the cache file path for a given audiobook + width
 * @param {number|string} audiobookId
 * @param {number} width
 * @returns {string}
 */
function getThumbnailPath(audiobookId, width) {
  return path.join(THUMBNAILS_DIR, `${audiobookId}_${width}.jpg`);
}

/**
 * Get or generate a thumbnail for a cover image.
 *
 * Returns the absolute path to the (possibly cached) thumbnail file.
 * If the thumbnail already exists on disk it is returned immediately.
 * Otherwise, sharp resizes the original and writes it to the cache.
 *
 * @param {string} originalCoverPath - Absolute path to the full-size cover image
 * @param {number|string} audiobookId - The audiobook's database ID
 * @param {number} width - Desired width in pixels (must be in ALLOWED_WIDTHS)
 * @returns {Promise<string>} Absolute path to the thumbnail file
 */
async function getOrGenerateThumbnail(originalCoverPath, audiobookId, width) {
  const thumbPath = getThumbnailPath(audiobookId, width);

  // Fast path: thumbnail already cached on disk
  if (fs.existsSync(thumbPath)) {
    return thumbPath;
  }

  // Deduplicate concurrent requests for the same thumbnail
  const key = `${audiobookId}_${width}`;
  if (inFlight.has(key)) {
    return inFlight.get(key);
  }

  const promise = (async () => {
    // Ensure the thumbnails directory exists
    await fs.promises.mkdir(THUMBNAILS_DIR, { recursive: true });

    // Lazy-load sharp so the module can be required even when sharp is absent
    const sharp = require('sharp');

    await sharp(originalCoverPath)
      .resize(width, width, { fit: 'cover' })
      .jpeg({ quality: 80 })
      .toFile(thumbPath);

    return thumbPath;
  })();

  inFlight.set(key, promise);
  try {
    return await promise;
  } finally {
    inFlight.delete(key);
  }
}

/**
 * Remove all cached thumbnails for a specific audiobook.
 * Call this when the cover image for an audiobook changes.
 *
 * @param {number|string} audiobookId
 */
function invalidateThumbnails(audiobookId) {
  for (const w of ALLOWED_WIDTHS) {
    const thumbPath = getThumbnailPath(audiobookId, w);
    try {
      if (fs.existsSync(thumbPath)) {
        fs.unlinkSync(thumbPath);
      }
    } catch (err) {
      console.error(`Failed to remove thumbnail ${thumbPath}:`, err.message);
    }
  }
}

/**
 * Remove the entire thumbnails cache directory.
 * Useful during force-rescan or cleanup maintenance tasks.
 */
function clearAllThumbnails() {
  try {
    if (fs.existsSync(THUMBNAILS_DIR)) {
      fs.rmSync(THUMBNAILS_DIR, { recursive: true, force: true });
      console.log('Cleared all cached thumbnails');
    }
  } catch (err) {
    console.error('Failed to clear thumbnails directory:', err.message);
  }
}

module.exports = {
  ALLOWED_WIDTHS,
  THUMBNAILS_DIR,
  isValidWidth,
  getThumbnailPath,
  getOrGenerateThumbnail,
  invalidateThumbnails,
  clearAllThumbnails,
};
