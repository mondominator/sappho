/**
 * Similar Books Scoring Algorithm
 *
 * Calculates similarity scores between audiobooks based on multiple factors:
 * - Same series: 3 points (strongest signal)
 * - Same genre: 2 points (high weight)
 * - Same publisher: 1 point (medium weight)
 * - Similar duration (±20%): 1 point (low weight)
 */

const logger = require('./logger');

/**
 * Calculate similarity scores for a candidate book against a base book,
 * excluding books that match the current book exactly (same author + title)
 * @param {Object} baseBook - The reference audiobook
 * @param {Object} candidateBook - The audiobook to score
 * @returns {Object} Score object with score and reasons
 */
function scoreBook(baseBook, candidateBook) {
  try {
    // Skip if it's the same book
    if (baseBook.id === candidateBook.id) {
      return { score: 0, reasons: [] };
    }

    // Skip if it's the same book by author + title (duplicate editions)
    if (baseBook.author && baseBook.title &&
        candidateBook.author && candidateBook.title) {
      const sameAuthor = baseBook.author.toLowerCase() === candidateBook.author.toLowerCase();
      const sameTitle = baseBook.title.toLowerCase() === candidateBook.title.toLowerCase();
      if (sameAuthor && sameTitle) {
        return { score: 0, reasons: ['duplicate'] };
      }
    }

    let score = 0;
    const reasons = [];

    // Same series (strongest signal) - 3 points
    if (baseBook.series && candidateBook.series &&
        baseBook.series.toLowerCase() === candidateBook.series.toLowerCase()) {
      score += 3;
      reasons.push('series');
    }

    // Same genre - 2 points
    if (baseBook.genre && candidateBook.genre &&
        baseBook.genre.toLowerCase() === candidateBook.genre.toLowerCase()) {
      score += 2;
      reasons.push('genre');
    }

    // Same publisher - 1 point
    if (baseBook.publisher && candidateBook.publisher &&
        baseBook.publisher.toLowerCase() === candidateBook.publisher.toLowerCase()) {
      score += 1;
      reasons.push('publisher');
    }

    // Similar duration (±20%) - 1 point
    if (baseBook.duration && candidateBook.duration) {
      const durationDiff = Math.abs(baseBook.duration - candidateBook.duration);
      const durationThreshold = baseBook.duration * 0.2; // 20% threshold
      if (durationDiff <= durationThreshold) {
        score += 1;
        reasons.push('duration');
      }
    }

    return { score, reasons };
  } catch (error) {
    logger.error({ error, baseBookId: baseBook.id, candidateBookId: candidateBook.id }, 'Error scoring book');
    return { score: 0, reasons: [] };
  }
}

/**
 * Filter out books the user has completed (if preference is enabled)
 * @param {Array} books - Array of audiobook objects
 * @param {Array} completedBooks - Array of completed audiobook IDs
 * @param {boolean} excludeCompleted - Whether to exclude completed books
 * @returns {Array} Filtered array of books
 */
function filterCompletedBooks(books, completedBooks = [], excludeCompleted = false) {
  try {
    if (!Array.isArray(books)) return [];
    if (!excludeCompleted || !Array.isArray(completedBooks) || !completedBooks.length) {
      return books;
    }

    const completedSet = new Set(completedBooks);
    return books.filter(book => book && book.id && !completedSet.has(book.id));
  } catch (error) {
    logger.error({ error }, 'Error filtering completed books');
    return books;
  }
}

/**
 * Deduplicate books across multiple categories
 * Ensures each book appears only in the first category it qualifies for
 * @param {Object} categories - Object with category arrays (more_by_author, more_by_narrator, similar_audiobooks)
 * @returns {Object} Deduplicated categories
 */
function deduplicateCategories(categories) {
  try {
    const seen = new Set();
    const result = {};

    for (const [categoryName, books] of Object.entries(categories)) {
      if (!Array.isArray(books)) {
        result[categoryName] = [];
        continue;
      }

      result[categoryName] = books.filter(book => {
        if (!book || !book.id) return false;
        if (seen.has(book.id)) {
          return false;
        }
        seen.add(book.id);
        return true;
      });
    }

    return result;
  } catch (error) {
    logger.error({ error }, 'Error deduplicating categories');
    return { more_by_author: [], more_by_narrator: [], similar_audiobooks: [] };
  }
}

/**
 * Limit results to specified count
 * @param {Array} books - Array of audiobooks
 * @param {number} limit - Maximum number to return
 * @returns {Array} Limited array
 */
function limitResults(books, limit = 6) {
  return books.slice(0, limit);
}

module.exports = {
  scoreBook,
  filterCompletedBooks,
  deduplicateCategories,
  limitResults
};