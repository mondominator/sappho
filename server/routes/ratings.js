/**
 * Ratings Routes
 *
 * API endpoints for audiobook ratings and reviews
 */

const express = require('express');
const rateLimit = require('express-rate-limit');
const { createDbHelpers } = require('../utils/db');

/**
 * Default dependencies - used when route is required directly
 */
const defaultDependencies = {
  auth: () => require('../auth'),
  db: () => require('../database'),
};

/**
 * Create ratings routes with injectable dependencies
 * @param {Object} deps - Dependencies (for testing)
 * @param {Object} deps.auth - Authentication module (authenticateToken)
 * @param {Object} deps.db - Database module
 * @returns {express.Router}
 */
function createRatingsRouter(deps = {}) {
  const router = express.Router();

  // Resolve dependencies (use provided or defaults)
  const auth = deps.auth || defaultDependencies.auth();
  const db = deps.db || defaultDependencies.db();
  const { authenticateToken } = auth;
  const { dbGet, dbAll, dbRun } = createDbHelpers(db);

  // SECURITY: Rate limiting for rating endpoints
  const ratingLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 60, // 60 requests per minute per IP
    message: { error: 'Too many requests. Please slow down.' },
    standardHeaders: true,
    legacyHeaders: false,
  });

  const ratingWriteLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 20, // 20 rating changes per minute
    message: { error: 'Too many rating updates. Please slow down.' },
    standardHeaders: true,
    legacyHeaders: false,
  });

  /**
   * GET /api/ratings/audiobook/:audiobookId
   * Get current user's rating for an audiobook
   */
  router.get('/audiobook/:audiobookId', ratingLimiter, authenticateToken, async (req, res) => {
    try {
      const rating = await dbGet(
        'SELECT * FROM user_ratings WHERE user_id = ? AND audiobook_id = ?',
        [req.user.id, req.params.audiobookId]
      );
      res.json(rating || null);
    } catch (_err) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * GET /api/ratings/audiobook/:audiobookId/all
   * Get all ratings for an audiobook (for displaying average)
   */
  router.get('/audiobook/:audiobookId/all', ratingLimiter, authenticateToken, async (req, res) => {
    try {
      const ratings = await dbAll(
        `SELECT ur.*, u.username, u.display_name
         FROM user_ratings ur
         JOIN users u ON ur.user_id = u.id
         WHERE ur.audiobook_id = ? AND (ur.rating IS NOT NULL OR (ur.review IS NOT NULL AND ur.review != ''))
         ORDER BY ur.updated_at DESC`,
        [req.params.audiobookId]
      );
      res.json(ratings);
    } catch (_err) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * GET /api/ratings/audiobook/:audiobookId/average
   * Get community average rating for an audiobook, blended with the
   * external source rating (Audible/Google) weighted by its ratings count.
   * When the external source didn't provide a count, we use a modest
   * prior (EXTERNAL_PRIOR_WEIGHT) so one aggregated rating doesn't wash
   * out a handful of local user ratings.
   */
  router.get('/audiobook/:audiobookId/average', ratingLimiter, authenticateToken, async (req, res) => {
    const EXTERNAL_PRIOR_WEIGHT = 10;
    try {
      const [userResult, bookResult] = await Promise.all([
        dbGet(
          `SELECT COALESCE(SUM(rating), 0) as rating_sum,
                  COUNT(*) as rating_count
           FROM user_ratings
           WHERE audiobook_id = ? AND rating IS NOT NULL`,
          [req.params.audiobookId]
        ),
        dbGet(
          'SELECT rating, rating_count FROM audiobooks WHERE id = ?',
          [req.params.audiobookId]
        ),
      ]);

      const userSum = Number(userResult?.rating_sum) || 0;
      const userCount = Number(userResult?.rating_count) || 0;

      const extRating = bookResult?.rating !== null && bookResult?.rating !== undefined
        ? parseFloat(bookResult.rating)
        : NaN;
      const extCountRaw = Number(bookResult?.rating_count);
      const hasExternal = Number.isFinite(extRating) && extRating > 0;
      const extWeight = hasExternal
        ? (Number.isFinite(extCountRaw) && extCountRaw > 0 ? extCountRaw : EXTERNAL_PRIOR_WEIGHT)
        : 0;

      const totalWeight = userCount + extWeight;
      const blended = totalWeight > 0
        ? (userSum + (hasExternal ? extRating * extWeight : 0)) / totalWeight
        : null;

      res.json({
        average: blended !== null ? Math.round(blended * 10) / 10 : null,
        count: userCount + (hasExternal ? extWeight : 0),
        user_count: userCount,
        external_count: hasExternal ? extWeight : 0,
      });
    } catch (_err) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * POST /api/ratings/audiobook/:audiobookId
   * Set or update rating/review for an audiobook
   */
  router.post('/audiobook/:audiobookId', ratingWriteLimiter, authenticateToken, async (req, res) => {
    const { audiobookId } = req.params;
    const { rating, review } = req.body;

    // Validate rating if provided
    if (rating !== undefined && rating !== null) {
      const ratingNum = parseInt(rating);
      if (isNaN(ratingNum) || ratingNum < 1 || ratingNum > 5) {
        return res.status(400).json({ error: 'Rating must be between 1 and 5' });
      }
    }

    // Must provide at least a rating or a review
    const hasRating = rating !== undefined && rating !== null;
    const hasReview = review && typeof review === 'string' && review.trim() !== '';
    if (!hasRating && !hasReview) {
      return res.status(400).json({ error: 'Rating or review is required' });
    }

    try {
      const existing = await dbGet(
        'SELECT id FROM user_ratings WHERE user_id = ? AND audiobook_id = ?',
        [req.user.id, audiobookId]
      );

      if (existing) {
        await dbRun(
          `UPDATE user_ratings
           SET rating = ?, review = ?, updated_at = CURRENT_TIMESTAMP
           WHERE user_id = ? AND audiobook_id = ?`,
          [rating || null, review || null, req.user.id, audiobookId]
        );
        const updated = await dbGet('SELECT * FROM user_ratings WHERE id = ?', [existing.id]);
        res.json(updated);
      } else {
        const { lastID } = await dbRun(
          'INSERT INTO user_ratings (user_id, audiobook_id, rating, review) VALUES (?, ?, ?, ?)',
          [req.user.id, audiobookId, rating || null, review || null]
        );
        const created = await dbGet('SELECT * FROM user_ratings WHERE id = ?', [lastID]);
        res.status(201).json(created);
      }
    } catch (_err) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * DELETE /api/ratings/audiobook/:audiobookId
   * Delete rating/review for an audiobook
   */
  router.delete('/audiobook/:audiobookId', ratingWriteLimiter, authenticateToken, async (req, res) => {
    try {
      const { changes } = await dbRun(
        'DELETE FROM user_ratings WHERE user_id = ? AND audiobook_id = ?',
        [req.user.id, req.params.audiobookId]
      );
      if (changes === 0) {
        return res.status(404).json({ error: 'Rating not found' });
      }
      res.json({ success: true });
    } catch (_err) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * GET /api/ratings/my-ratings
   * Get all ratings by current user
   */
  router.get('/my-ratings', ratingLimiter, authenticateToken, async (req, res) => {
    try {
      const ratings = await dbAll(
        `SELECT ur.*, a.title, a.author, a.cover_image
         FROM user_ratings ur
         JOIN audiobooks a ON ur.audiobook_id = a.id
         WHERE ur.user_id = ?
         ORDER BY ur.updated_at DESC`,
        [req.user.id]
      );
      res.json(ratings);
    } catch (_err) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  return router;
}

// Export default router for backwards compatibility with index.js
module.exports = createRatingsRouter();
// Export factory function for testing
module.exports.createRatingsRouter = createRatingsRouter;
