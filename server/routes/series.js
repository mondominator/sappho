/**
 * Series Routes
 *
 * API endpoints for series recaps using AI
 */

const express = require('express');
const crypto = require('crypto');
const { createDbHelpers } = require('../utils/db');
const { callAI, getModelUsed } = require('../services/aiProvider');

/**
 * Default dependencies - used when route is required directly
 */
const defaultDependencies = {
  db: () => require('../database'),
  auth: () => require('../auth'),
  settings: () => require('./settings'),
};

/**
 * Helper to generate hash of books read for cache key
 */
const generateBooksHash = (books) => {
  const bookIds = books.map(b => b.id).sort().join(',');
  return crypto.createHash('md5').update(bookIds).digest('hex');
};

/**
 * Create series routes with injectable dependencies
 * @param {Object} deps - Dependencies (for testing)
 * @param {Object} deps.db - Database module
 * @param {Object} deps.auth - Auth module
 * @param {Object} deps.settings - Settings module (for getRecapPrompt)
 * @returns {express.Router}
 */
function createSeriesRouter(deps = {}) {
  const router = express.Router();

  // Resolve dependencies (use provided or defaults)
  const db = deps.db || defaultDependencies.db();
  const auth = deps.auth || defaultDependencies.auth();
  const settings = deps.settings || defaultDependencies.settings();
  const { authenticateToken } = auth;
  const { getRecapPrompt } = settings;
  const { dbGet, dbAll, dbRun } = createDbHelpers(db);

  /**
   * GET /api/series/:seriesName/recap
   * Get series recap (catch me up)
   */
  router.get('/:seriesName/recap', authenticateToken, async (req, res) => {
    const userId = req.user.id;
    const seriesName = decodeURIComponent(req.params.seriesName);

    try {
      // Get all books in this series with user's progress
      const books = await dbAll(
        `SELECT a.id, a.title, a.author, a.description, a.series_position,
                COALESCE(p.position, 0) as position,
                COALESCE(p.completed, 0) as completed,
                a.duration
         FROM audiobooks a
         LEFT JOIN playback_progress p ON a.id = p.audiobook_id AND p.user_id = ?
         WHERE a.series = ?
         ORDER BY a.series_position ASC, a.title ASC`,
        [userId, seriesName]
      );

      if (books.length === 0) {
        return res.status(404).json({ error: 'Series not found' });
      }

      // Determine which books the user has read or is reading
      const booksRead = books.filter(b => b.completed === 1 || b.position > 0);

      if (booksRead.length === 0) {
        return res.status(400).json({
          error: 'No progress in this series yet',
          message: 'Start listening to a book in this series to get a recap.'
        });
      }

      // Generate cache hash based on books read
      const booksHash = generateBooksHash(booksRead);

      // Check cache first
      const cached = await dbGet(
        `SELECT recap_text, created_at FROM series_recaps
         WHERE user_id = ? AND series_name = ? AND books_hash = ?`,
        [userId, seriesName, booksHash]
      );

      if (cached) {
        return res.json({
          recap: cached.recap_text,
          cached: true,
          cachedAt: cached.created_at,
          booksIncluded: booksRead.map(b => ({ id: b.id, title: b.title, position: b.series_position }))
        });
      }

      // Check if AI is configured
      const provider = process.env.AI_PROVIDER || 'openai';
      const hasApiKey = provider === 'gemini'
        ? !!process.env.GEMINI_API_KEY
        : !!process.env.OPENAI_API_KEY;

      if (!hasApiKey) {
        return res.status(400).json({
          error: 'AI not configured',
          message: 'Please configure an AI provider in Administration > AI settings.'
        });
      }

      // Build prompt
      const booksNotRead = books.filter(b => b.completed !== 1 && b.position === 0);

      // Get the system prompt from settings (supports custom prompt and offensive mode)
      const systemPrompt = getRecapPrompt();

      const bookDescriptions = booksRead.map(b => {
        const status = b.completed ? 'completed' : 'in progress';
        return `Book ${b.series_position || '?'}: "${b.title}" (${status})${b.description ? `\nDescription: ${b.description.substring(0, 500)}` : ''}`;
      }).join('\n\n');

      const booksToAvoid = booksNotRead.length > 0
        ? `\n\nBOOKS NOT YET READ (DO NOT SPOIL): ${booksNotRead.map(b => `"${b.title}"`).join(', ')}`
        : '';

      const prompt = `Please provide a detailed recap of the "${seriesName}" series by ${books[0].author || 'Unknown Author'}.

The reader has read/is reading the following books:

${bookDescriptions}
${booksToAvoid}

Provide a thorough recap including major plot points, twists, and revelations from COMPLETED books. The reader wants to remember what happened before continuing. Only avoid spoilers for books not yet started.`;

      // Call AI provider
      const recap = await callAI(prompt, systemPrompt);

      // Cache the result
      await dbRun(
        `INSERT OR REPLACE INTO series_recaps (user_id, series_name, books_hash, recap_text, model_used)
         VALUES (?, ?, ?, ?, ?)`,
        [userId, seriesName, booksHash, recap, getModelUsed()]
      );

      res.json({
        recap,
        cached: false,
        booksIncluded: booksRead.map(b => ({ id: b.id, title: b.title, position: b.series_position }))
      });

    } catch (error) {
      console.error('Error generating series recap:', error);
      res.status(500).json({
        error: 'Failed to generate recap',
        message: error.message
      });
    }
  });

  /**
   * DELETE /api/series/:seriesName/recap
   * Clear cached recap (force regeneration)
   */
  router.delete('/:seriesName/recap', authenticateToken, async (req, res) => {
    const userId = req.user.id;
    const seriesName = decodeURIComponent(req.params.seriesName);

    try {
      await dbRun(
        'DELETE FROM series_recaps WHERE user_id = ? AND series_name = ?',
        [userId, seriesName]
      );

      res.json({ message: 'Recap cache cleared' });
    } catch (error) {
      console.error('Error clearing recap cache:', error);
      res.status(500).json({ error: 'Failed to clear cache' });
    }
  });

  return router;
}

// Export default router for backwards compatibility with index.js
module.exports = createSeriesRouter();
// Export factory function for testing
module.exports.createSeriesRouter = createSeriesRouter;
