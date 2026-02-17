const crypto = require('crypto');

/**
 * Generate a stable content-based hash for an audiobook.
 * This hash remains consistent across rescans and database rebuilds.
 *
 * @param {string} title - Book title
 * @param {string} author - Book author
 * @param {number} duration - Duration in seconds
 * @param {number} [fileSize] - File size in bytes (optional, improves uniqueness)
 * @returns {string} 32-character hex hash
 */
function generateContentHash(title, author, duration, fileSize) {
  const normalizedTitle = (title || '').toLowerCase().trim();
  const normalizedAuthor = (author || '').toLowerCase().trim();
  const normalizedDuration = Math.floor(duration || 0);

  let input = `${normalizedTitle}|${normalizedAuthor}|${normalizedDuration}`;
  if (fileSize) {
    input += `|${fileSize}`;
  }
  return crypto.createHash('sha256').update(input).digest('hex').substring(0, 32);
}

/**
 * Generate a fallback hash based on file path when metadata is insufficient.
 *
 * @param {string} filePath - Path to the audio file
 * @returns {string} 32-character hex hash
 */
function generateFilePathHash(filePath) {
  const normalizedPath = (filePath || '').toLowerCase().trim();
  return crypto.createHash('sha256').update(normalizedPath).digest('hex').substring(0, 32);
}

/**
 * Generate the best available content hash for an audiobook.
 * Uses metadata if available, falls back to file path hash.
 *
 * @param {Object} metadata - Audiobook metadata
 * @param {string} metadata.title - Book title
 * @param {string} metadata.author - Book author
 * @param {number} metadata.duration - Duration in seconds
 * @param {number} [metadata.fileSize] - File size in bytes
 * @param {string} filePath - Path to the audio file
 * @returns {string} 32-character hex hash
 */
function generateBestHash(metadata, filePath) {
  const { title, author, duration, fileSize } = metadata || {};

  // If we have sufficient metadata, use content hash
  if (title && (author || duration)) {
    return generateContentHash(title, author, duration, fileSize);
  }

  // Fall back to file path hash
  return generateFilePathHash(filePath);
}

module.exports = {
  generateBestHash,
  // Export for testing
  _internal: {
    generateContentHash,
    generateFilePathHash
  }
};
