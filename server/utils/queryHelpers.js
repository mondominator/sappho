/**
 * Shared query helpers for common database patterns.
 *
 * Usage:
 *   const { createQueryHelpers } = require('../../utils/queryHelpers');
 *   const { getAudiobookById, transformAudiobookRow } = createQueryHelpers(db);
 */

const { createDbHelpers } = require('./db');

/**
 * Create shared query helpers bound to a specific database instance.
 * @param {Object} db - sqlite3 database instance
 * @returns {{ getAudiobookById, transformAudiobookRow }}
 */
function createQueryHelpers(db) {
  const { dbGet } = createDbHelpers(db);

  /**
   * Fetch a single audiobook by ID.
   * @param {number|string} id
   * @returns {Promise<Object|null>}
   */
  async function getAudiobookById(id) {
    return dbGet('SELECT * FROM audiobooks WHERE id = ?', [id]);
  }

  /**
   * Transform a flat DB row (with joined progress/rating fields) into a
   * clean nested object.  Works with rows produced by queries that LEFT JOIN
   * playback_progress, user_favorites, and user_ratings.
   *
   * @param {Object} book - raw DB row
   * @param {Function} [normalizeGenres] - optional genre normalizer
   * @returns {Object} transformed row
   */
  function transformAudiobookRow(book, normalizeGenres) {
    const {
      progress_position, progress_completed, progress_updated_at,
      is_favorite, user_rating, average_rating, ...rest
    } = book;
    return {
      ...rest,
      normalized_genre: normalizeGenres ? normalizeGenres(book.genre) : book.genre,
      is_favorite: !!is_favorite,
      user_rating: user_rating || null,
      average_rating: average_rating ? Math.round(average_rating * 10) / 10 : null,
      progress: progress_position !== null ? {
        position: progress_position,
        completed: progress_completed,
        updated_at: progress_updated_at
      } : null
    };
  }

  return { getAudiobookById, transformAudiobookRow };
}

module.exports = { createQueryHelpers };
