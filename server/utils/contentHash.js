const crypto = require('crypto');

/**
 * Generate a stable content-based hash for an audiobook.
 * This hash remains consistent across rescans and database rebuilds.
 *
 * @param {string} title - Book title
 * @param {string} author - Book author
 * @param {number} duration - Duration in seconds
 * @returns {string} 16-character hex hash
 */
function generateContentHash(title, author, duration) {
  const normalizedTitle = (title || '').toLowerCase().trim();
  const normalizedAuthor = (author || '').toLowerCase().trim();
  const normalizedDuration = Math.floor(duration || 0);

  const input = `${normalizedTitle}|${normalizedAuthor}|${normalizedDuration}`;
  return crypto.createHash('sha256').update(input).digest('hex').substring(0, 16);
}

/**
 * Generate a fallback hash based on file path when metadata is insufficient.
 *
 * @param {string} filePath - Path to the audio file
 * @returns {string} 16-character hex hash
 */
function generateFilePathHash(filePath) {
  const normalizedPath = (filePath || '').toLowerCase().trim();
  return crypto.createHash('sha256').update(normalizedPath).digest('hex').substring(0, 16);
}

/**
 * Generate the best available content hash for an audiobook.
 * Uses metadata if available, falls back to file path hash.
 *
 * @param {Object} metadata - Audiobook metadata
 * @param {string} metadata.title - Book title
 * @param {string} metadata.author - Book author
 * @param {number} metadata.duration - Duration in seconds
 * @param {string} filePath - Path to the audio file
 * @returns {string} 16-character hex hash
 */
function generateBestHash(metadata, filePath) {
  const { title, author, duration } = metadata || {};

  // If we have sufficient metadata, use content hash
  if (title && (author || duration)) {
    return generateContentHash(title, author, duration);
  }

  // Fall back to file path hash
  return generateFilePathHash(filePath);
}

module.exports = {
  generateContentHash,
  generateFilePathHash,
  generateBestHash
};
