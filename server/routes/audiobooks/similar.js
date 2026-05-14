/**
 * Similar Books Routes
 *
 * Provides endpoint for fetching similar audiobook suggestions:
 * - More by this author
 * - More by this narrator
 * - Similar audiobooks (multi-factor matching)
 */

const logger = require('../../utils/logger');
const {
  scoreBook,
  filterCompletedBooks,
  deduplicateCategories,
  limitResults
} = require('../../utils/similarBooks');

/**
 * Register similar books routes
 * @param {express.Router} router - Express router instance
 * @param {Object} deps - Shared dependencies
 */
function register(router, deps) {
  const { db, authenticateToken } = deps;

  /**
   * GET /api/audiobooks/:id/similar
   *
   * Returns three categories of similar audiobooks:
   * - more_by_author: Other books by the same author
   * - More by narrator: Other books narrated by the same narrator
   * - similar_audiobooks: Books with high similarity scores based on genre, series, publisher, duration
   *
   * Query params:
   * - limit: Maximum number of results per category (default: 6, max: 20)
   *
   * Requires authentication.
   */
  router.get('/:id/similar', authenticateToken, (req, res) => {
    const audiobookId = parseInt(req.params.id, 10);
    const userId = req.user.id;

    // Validate and parse limit parameter
    let limit = 6; // default
    if (req.query.limit !== undefined) {
      const parsedLimit = parseInt(req.query.limit, 10);
      if (isNaN(parsedLimit) || parsedLimit < 1) {
        return res.status(400).json({ error: 'Limit must be a positive integer' });
      }
      limit = Math.min(parsedLimit, 20); // Max 20
    }

    // Validate audiobook ID
    if (isNaN(audiobookId)) {
      return res.status(400).json({ error: 'Invalid audiobook ID' });
    }

    // First, fetch the base audiobook
    db.get(
      `SELECT
        id,
        title,
        author,
        narrator,
        series,
        genre,
        publisher,
        duration,
        description
       FROM audiobooks
       WHERE id = ? AND is_available = 1`,
      [audiobookId],
      (err, baseBook) => {
        if (err) {
          logger.error({ err, audiobookId }, 'Failed to fetch audiobook for similar books');
          return res.status(500).json({ error: 'Failed to fetch audiobook' });
        }

        if (!baseBook) {
          return res.status(404).json({ error: 'Audiobook not found' });
        }

        // Fetch user's recommendation preferences
        db.get(
          'SELECT exclude_completed FROM user_recommendation_prefs WHERE user_id = ?',
          [userId],
          (prefErr, userPrefs) => {
            if (prefErr) {
              logger.error({ err: prefErr, userId }, 'Failed to fetch recommendation preferences; defaulting to include completed');
            }
            const excludeCompleted = userPrefs?.exclude_completed === 1;

            // Fetch completed books for this user (if needed)
            if (excludeCompleted) {
              db.all(
                `SELECT audiobook_id FROM playback_progress
                 WHERE user_id = ? AND completed = 1`,
                [userId],
                (progressErr, completedRows) => {
                  if (progressErr) {
                    logger.error({ err: progressErr, userId }, 'Failed to fetch completed books');
                  }
                  const completedIds = completedRows?.map(row => row.audiobook_id) || [];
                  fetchSimilarBooks(baseBook, completedIds, excludeCompleted);
                }
              );
            } else {
              fetchSimilarBooks(baseBook, [], false);
            }
          }
        );

        function fetchSimilarBooks(baseBook, completedIds, excludeCompleted) {
          // Fetch all candidate audiobooks in parallel
          db.all(
            `SELECT
              id,
              title,
              author,
              narrator,
              series,
              genre,
              publisher,
              duration,
              cover_image,
              cover_path
             FROM audiobooks
             WHERE is_available = 1
             AND id != ?
             ORDER BY title ASC`,
            [baseBook.id],
            (candidateErr, candidates) => {
              if (candidateErr) {
                logger.error({ err: candidateErr, audiobookId }, 'Failed to fetch candidate audiobooks');
                return res.status(500).json({ error: 'Failed to fetch similar audiobooks' });
              }

              if (!candidates || candidates.length === 0) {
                return res.json({
                  more_by_author: [],
                  more_by_narrator: [],
                  similar_audiobooks: []
                });
              }

              // Filter out completed books if preference is enabled
              const filteredCandidates = filterCompletedBooks(candidates, completedIds, excludeCompleted);

              // Get more by author (sorted by title for consistency)
              const moreByAuthor = baseBook.author
                ? filteredCandidates.filter(book =>
                    book.author &&
                    book.author.toLowerCase() === baseBook.author.toLowerCase()
                  ).sort((a, b) => (a.title || '').localeCompare(b.title || ''))
                : [];

              // Get more by narrator (sorted by title for consistency)
              const moreByNarrator = baseBook.narrator
                ? filteredCandidates.filter(book =>
                    book.narrator &&
                    book.narrator.toLowerCase() === baseBook.narrator.toLowerCase()
                  ).sort((a, b) => (a.title || '').localeCompare(b.title || ''))
                : [];

              // Calculate similarity scores for similar audiobooks
              const scoredBooks = filteredCandidates
                .map(book => ({
                  ...book,
                  scoreData: scoreBook(baseBook, book)
                }))
                .filter(book => book.scoreData.score > 0) // Only include books with at least one matching factor
                .sort((a, b) => {
                  // Primary sort by score descending, secondary by title for consistency
                  if (b.scoreData.score !== a.scoreData.score) {
                    return b.scoreData.score - a.scoreData.score;
                  }
                  return (a.title || '').localeCompare(b.title || '');
                });

              const similarAudiobooks = scoredBooks.map(({ scoreData: _scoreData, ...book }) => book);

              // Deduplicate across categories (priority: author > narrator > similar)
              const categories = {
                more_by_author: moreByAuthor,
                more_by_narrator: moreByNarrator,
                similar_audiobooks: similarAudiobooks
              };

              const deduplicated = deduplicateCategories(categories);

              // Limit results
              const result = {
                more_by_author: limitResults(deduplicated.more_by_author, limit),
                more_by_narrator: limitResults(deduplicated.more_by_narrator, limit),
                similar_audiobooks: limitResults(deduplicated.similar_audiobooks, limit)
              };

              res.json(result);
            }
          );
        }
      }
    );
  });

  /**
   * POST /api/audiobooks/similar/preferences
   *
   * Update user's recommendation preferences
   * Body: { exclude_completed: boolean }
   */
  router.post('/similar/preferences', authenticateToken, (req, res) => {
    const { exclude_completed } = req.body;

    if (typeof exclude_completed !== 'boolean') {
      return res.status(400).json({ error: 'exclude_completed must be a boolean' });
    }

    db.run(
      `INSERT INTO user_recommendation_prefs (user_id, exclude_completed, updated_at)
       VALUES (?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(user_id) DO UPDATE SET
         exclude_completed = excluded.exclude_completed,
         updated_at = CURRENT_TIMESTAMP`,
      [req.user.id, exclude_completed ? 1 : 0],
      (err) => {
        if (err) {
          logger.error({ err, userId: req.user.id }, 'Failed to update recommendation preferences');
          return res.status(500).json({ error: 'Failed to update preferences' });
        }

        res.json({
          success: true,
          exclude_completed: exclude_completed
        });
      }
    );
  });

  /**
   * GET /api/audiobooks/similar/preferences
   *
   * Get user's recommendation preferences
   */
  router.get('/similar/preferences', authenticateToken, (req, res) => {
    db.get(
      'SELECT exclude_completed FROM user_recommendation_prefs WHERE user_id = ?',
      [req.user.id],
      (err, row) => {
        if (err) {
          logger.error({ err, userId: req.user.id }, 'Failed to fetch recommendation preferences');
          return res.status(500).json({ error: 'Failed to fetch preferences' });
        }

        res.json({
          exclude_completed: row?.exclude_completed === 1 || false
        });
      }
    );
  });
}

module.exports = { register };