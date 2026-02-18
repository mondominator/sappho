/**
 * Batch, Favorites, and Recap Routes
 *
 * Handles favorite toggling, AI-powered book recaps,
 * and batch operations (mark finished, clear progress, reading list, collections, delete).
 */

const fs = require('fs');
const path = require('path');
const { batchDeleteLimiter } = require('./helpers');
const { createDbHelpers } = require('../../utils/db');
const { createQueryHelpers } = require('../../utils/queryHelpers');
const { callAI, getModelUsed, generateRecapHash } = require('../../services/aiProvider');

function register(router, { db, authenticateToken, requireAdmin }) {
  const { dbGet, dbAll, dbRun } = createDbHelpers(db);
  const { getAudiobookById } = createQueryHelpers(db);

  // ============================================
  // FAVORITES ENDPOINTS (/:id routes only - /favorites GET is defined earlier)
  // ============================================

  // Check if a specific audiobook is a favorite
  router.get('/:id/favorite', authenticateToken, async (req, res) => {
    const audiobookId = parseInt(req.params.id);

    try {
      const row = await dbGet(
        'SELECT id FROM user_favorites WHERE user_id = ? AND audiobook_id = ?',
        [req.user.id, audiobookId]
      );
      res.json({ is_favorite: !!row });
    } catch (err) {
      console.error('Error checking favorite status:', err);
      res.status(500).json({ error: 'Failed to check favorite status' });
    }
  });

  // Add audiobook to favorites
  router.post('/:id/favorite', authenticateToken, async (req, res) => {
    const audiobookId = parseInt(req.params.id);

    try {
      // First check if audiobook exists
      const audiobook = await dbGet('SELECT id FROM audiobooks WHERE id = ?', [audiobookId]);
      if (!audiobook) {
        return res.status(404).json({ error: 'Audiobook not found' });
      }

      // Get next list_order for this user
      const maxOrder = await dbGet(
        'SELECT COALESCE(MAX(list_order), -1) + 1 as next_order FROM user_favorites WHERE user_id = ?',
        [req.user.id]
      );

      // Add to favorites (IGNORE if already exists)
      await dbRun(
        'INSERT OR IGNORE INTO user_favorites (user_id, audiobook_id, list_order) VALUES (?, ?, ?)',
        [req.user.id, audiobookId, maxOrder.next_order]
      );
      res.json({ success: true, is_favorite: true });
    } catch (err) {
      console.error('Error adding favorite:', err);
      res.status(500).json({ error: 'Failed to add favorite' });
    }
  });

  // Remove audiobook from favorites
  router.delete('/:id/favorite', authenticateToken, async (req, res) => {
    const audiobookId = parseInt(req.params.id);

    try {
      await dbRun(
        'DELETE FROM user_favorites WHERE user_id = ? AND audiobook_id = ?',
        [req.user.id, audiobookId]
      );
      res.json({ success: true, is_favorite: false });
    } catch (err) {
      console.error('Error removing favorite:', err);
      res.status(500).json({ error: 'Failed to remove favorite' });
    }
  });

  // Toggle favorite status (convenience endpoint)
  router.post('/:id/favorite/toggle', authenticateToken, async (req, res) => {
    const audiobookId = parseInt(req.params.id);

    try {
      // Check current status
      const row = await dbGet(
        'SELECT id FROM user_favorites WHERE user_id = ? AND audiobook_id = ?',
        [req.user.id, audiobookId]
      );

      if (row) {
        // Currently a favorite - remove it
        await dbRun(
          'DELETE FROM user_favorites WHERE user_id = ? AND audiobook_id = ?',
          [req.user.id, audiobookId]
        );
        res.json({ success: true, is_favorite: false });
      } else {
        // Not a favorite - add it (but first check audiobook exists)
        const audiobook = await dbGet('SELECT id FROM audiobooks WHERE id = ?', [audiobookId]);
        if (!audiobook) {
          return res.status(404).json({ error: 'Audiobook not found' });
        }

        // Get next list_order for this user
        const maxOrder = await dbGet(
          'SELECT COALESCE(MAX(list_order), -1) + 1 as next_order FROM user_favorites WHERE user_id = ?',
          [req.user.id]
        );

        await dbRun(
          'INSERT INTO user_favorites (user_id, audiobook_id, list_order) VALUES (?, ?, ?)',
          [req.user.id, audiobookId, maxOrder.next_order]
        );
        res.json({ success: true, is_favorite: true });
      }
    } catch (err) {
      console.error('Error toggling favorite:', err);
      res.status(500).json({ error: 'Failed to toggle favorite' });
    }
  });

  // ============================================
  // READING LIST ORDERING ENDPOINTS
  // ============================================

  // Update priority for a favorite
  router.put('/:id/favorite/priority', authenticateToken, async (req, res) => {
    const audiobookId = parseInt(req.params.id);
    const { priority } = req.body;

    // Validate priority is 0-3
    if (priority === undefined || priority === null || ![0, 1, 2, 3].includes(priority)) {
      return res.status(400).json({ error: 'Priority must be 0 (none), 1 (high), 2 (medium), or 3 (low)' });
    }

    try {
      // Check that this book is in the user's favorites
      const favorite = await dbGet(
        'SELECT id FROM user_favorites WHERE user_id = ? AND audiobook_id = ?',
        [req.user.id, audiobookId]
      );
      if (!favorite) {
        return res.status(404).json({ error: 'Audiobook is not in your reading list' });
      }

      await dbRun(
        'UPDATE user_favorites SET priority = ? WHERE user_id = ? AND audiobook_id = ?',
        [priority, req.user.id, audiobookId]
      );
      res.json({ success: true, priority });
    } catch (err) {
      console.error('Error updating favorite priority:', err);
      res.status(500).json({ error: 'Failed to update priority' });
    }
  });

  // Bulk reorder reading list items
  router.put('/favorites/reorder', authenticateToken, async (req, res) => {
    const { order } = req.body; // Array of audiobook_ids in new order

    if (!Array.isArray(order)) {
      return res.status(400).json({ error: 'order must be an array of audiobook IDs' });
    }

    try {
      // Validate all IDs belong to user's favorites
      const placeholders = order.map(() => '?').join(',');
      const favorites = await dbAll(
        `SELECT audiobook_id FROM user_favorites WHERE user_id = ? AND audiobook_id IN (${placeholders})`,
        [req.user.id, ...order]
      );

      const favoriteIds = new Set(favorites.map(f => f.audiobook_id));
      const invalidIds = order.filter(id => !favoriteIds.has(id));
      if (invalidIds.length > 0) {
        return res.status(400).json({ error: 'Some audiobook IDs are not in your reading list', invalid_ids: invalidIds });
      }

      // Update list_order = index for each item
      for (let i = 0; i < order.length; i++) {
        await dbRun(
          'UPDATE user_favorites SET list_order = ? WHERE user_id = ? AND audiobook_id = ?',
          [i, req.user.id, order[i]]
        );
      }

      res.json({ success: true });
    } catch (err) {
      console.error('Error reordering favorites:', err);
      res.status(500).json({ error: 'Failed to reorder reading list' });
    }
  });

  // ============================================
  // Book Recap (Catch Me Up) - AI-powered recap
  // ============================================

  // Get book recap (catch me up)
  router.get('/:id/recap', authenticateToken, async (req, res) => {
    const userId = req.user.id;
    const audiobookId = parseInt(req.params.id);
    const { getRecapPrompt } = require('../settings');

    try {
      // Get the audiobook
      const audiobook = await dbGet(
        `SELECT a.*, COALESCE(p.position, 0) as position, COALESCE(p.completed, 0) as completed
         FROM audiobooks a
         LEFT JOIN playback_progress p ON a.id = p.audiobook_id AND p.user_id = ?
         WHERE a.id = ?`,
        [userId, audiobookId]
      );

      if (!audiobook) {
        return res.status(404).json({ error: 'Audiobook not found' });
      }

      // Check if user has progress on this book
      if (audiobook.position === 0 && audiobook.completed !== 1) {
        return res.status(400).json({
          error: 'No progress on this book yet',
          message: 'Start listening to this book to get a recap.'
        });
      }

      // Get prior books in series if this is part of a series
      let priorBooks = [];
      if (audiobook.series) {
        priorBooks = await dbAll(
          `SELECT a.id, a.title, a.author, a.description, a.series_position,
                  COALESCE(p.position, 0) as position,
                  COALESCE(p.completed, 0) as completed
           FROM audiobooks a
           LEFT JOIN playback_progress p ON a.id = p.audiobook_id AND p.user_id = ?
           WHERE a.series = ? AND a.id != ?
             AND (COALESCE(p.position, 0) > 0 OR COALESCE(p.completed, 0) = 1)
             AND (a.series_position IS NULL OR a.series_position < ?)
           ORDER BY a.series_position ASC, a.title ASC`,
          [userId, audiobook.series, audiobookId, audiobook.series_position || 999]
        );
      }

      // Generate cache hash
      const recapHash = generateRecapHash(audiobookId, priorBooks);

      // Check cache first
      const cached = await dbGet(
        `SELECT recap_text, created_at FROM book_recaps
         WHERE user_id = ? AND audiobook_id = ? AND books_hash = ?`,
        [userId, audiobookId, recapHash]
      );

      if (cached) {
        return res.json({
          recap: cached.recap_text,
          cached: true,
          cachedAt: cached.created_at,
          book: { id: audiobook.id, title: audiobook.title },
          priorBooks: priorBooks.map(b => ({ id: b.id, title: b.title, position: b.series_position }))
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

      // Get the system prompt from settings
      const systemPrompt = getRecapPrompt();

      // Build prompt
      let prompt = '';

      if (priorBooks.length > 0) {
        const priorBooksText = priorBooks.map(b => {
          const status = b.completed ? 'completed' : 'in progress';
          return `Book ${b.series_position || '?'}: "${b.title}" (${status})${b.description ? `\nDescription: ${b.description.substring(0, 500)}` : ''}`;
        }).join('\n\n');

        prompt = `Please provide a detailed recap to help a reader remember what happened before continuing "${audiobook.title}" by ${audiobook.author || 'Unknown Author'}.

This is book ${audiobook.series_position || '?'} in the "${audiobook.series}" series.

PRIOR BOOKS THE READER HAS READ:
${priorBooksText}

CURRENT BOOK:
"${audiobook.title}"${audiobook.description ? `\nDescription: ${audiobook.description.substring(0, 500)}` : ''}

Provide a thorough recap of the prior books including major plot points, character developments, and key events. Help the reader remember where the story left off before this book.`;
      } else {
        prompt = `Please provide a brief recap/refresher for "${audiobook.title}" by ${audiobook.author || 'Unknown Author'}.

${audiobook.description ? `Description: ${audiobook.description.substring(0, 1000)}` : ''}

The reader has started this book and wants to remember what it's about and any key setup from the beginning. Provide a helpful summary without major spoilers.`;
      }

      // Call AI provider
      const recap = await callAI(prompt, systemPrompt);

      // Cache the result
      await dbRun(
        `INSERT OR REPLACE INTO book_recaps (user_id, audiobook_id, books_hash, recap_text, model_used)
         VALUES (?, ?, ?, ?, ?)`,
        [userId, audiobookId, recapHash, recap, getModelUsed()]
      );

      res.json({
        recap,
        cached: false,
        book: { id: audiobook.id, title: audiobook.title },
        priorBooks: priorBooks.map(b => ({ id: b.id, title: b.title, position: b.series_position }))
      });

    } catch (error) {
      console.error('Error generating book recap:', error);
      res.status(500).json({
        error: 'Failed to generate recap',
        message: error.message
      });
    }
  });

  // Clear cached book recap (force regeneration)
  router.delete('/:id/recap', authenticateToken, async (req, res) => {
    const userId = req.user.id;
    const audiobookId = parseInt(req.params.id);

    try {
      await dbRun(
        'DELETE FROM book_recaps WHERE user_id = ? AND audiobook_id = ?',
        [userId, audiobookId]
      );
      res.json({ message: 'Recap cache cleared' });
    } catch (error) {
      console.error('Error clearing recap cache:', error);
      res.status(500).json({ error: 'Failed to clear cache' });
    }
  });

  // ============================================
  // Batch Actions
  // ============================================

  // Batch mark as finished
  router.post('/batch/mark-finished', authenticateToken, async (req, res) => {
    const { audiobook_ids } = req.body;
    const userId = req.user.id;

    if (!Array.isArray(audiobook_ids) || audiobook_ids.length === 0) {
      return res.status(400).json({ error: 'audiobook_ids must be a non-empty array' });
    }

    if (audiobook_ids.length > 100) {
      return res.status(400).json({ error: 'Maximum 100 audiobooks per batch' });
    }

    try {
      let successCount = 0;

      for (const audiobookId of audiobook_ids) {
        await dbRun(
          `INSERT INTO playback_progress (user_id, audiobook_id, position, completed, updated_at)
           VALUES (?, ?, 0, 1, CURRENT_TIMESTAMP)
           ON CONFLICT(user_id, audiobook_id) DO UPDATE SET
             completed = 1,
             updated_at = CURRENT_TIMESTAMP`,
          [userId, audiobookId]
        );
        successCount++;
      }

      res.json({ success: true, count: successCount });
    } catch (error) {
      console.error('Error in batch mark finished:', error);
      res.status(500).json({ error: 'Failed to mark audiobooks as finished' });
    }
  });

  // Batch clear progress
  router.post('/batch/clear-progress', authenticateToken, async (req, res) => {
    const { audiobook_ids } = req.body;
    const userId = req.user.id;

    if (!Array.isArray(audiobook_ids) || audiobook_ids.length === 0) {
      return res.status(400).json({ error: 'audiobook_ids must be a non-empty array' });
    }

    if (audiobook_ids.length > 100) {
      return res.status(400).json({ error: 'Maximum 100 audiobooks per batch' });
    }

    try {
      const placeholders = audiobook_ids.map(() => '?').join(',');
      await dbRun(
        `DELETE FROM playback_progress WHERE user_id = ? AND audiobook_id IN (${placeholders})`,
        [userId, ...audiobook_ids]
      );
      res.json({ success: true, count: audiobook_ids.length });
    } catch (error) {
      console.error('Error in batch clear progress:', error);
      res.status(500).json({ error: 'Failed to clear progress' });
    }
  });

  // Batch add to reading list (favorites)
  router.post('/batch/add-to-reading-list', authenticateToken, async (req, res) => {
    const { audiobook_ids } = req.body;
    const userId = req.user.id;

    if (!Array.isArray(audiobook_ids) || audiobook_ids.length === 0) {
      return res.status(400).json({ error: 'audiobook_ids must be a non-empty array' });
    }

    if (audiobook_ids.length > 100) {
      return res.status(400).json({ error: 'Maximum 100 audiobooks per batch' });
    }

    try {
      let successCount = 0;

      // Get current max list_order for this user
      const maxOrderRow = await dbGet(
        'SELECT COALESCE(MAX(list_order), -1) as max_order FROM user_favorites WHERE user_id = ?',
        [userId]
      );
      let nextOrder = maxOrderRow.max_order + 1;

      for (const audiobookId of audiobook_ids) {
        const { changes } = await dbRun(
          'INSERT OR IGNORE INTO user_favorites (user_id, audiobook_id, list_order) VALUES (?, ?, ?)',
          [userId, audiobookId, nextOrder]
        );
        if (changes > 0) {
          successCount++;
          nextOrder++;
        }
      }

      res.json({ success: true, count: successCount });
    } catch (error) {
      console.error('Error in batch add to reading list:', error);
      res.status(500).json({ error: 'Failed to add to reading list' });
    }
  });

  // Batch remove from reading list
  router.post('/batch/remove-from-reading-list', authenticateToken, async (req, res) => {
    const { audiobook_ids } = req.body;
    const userId = req.user.id;

    if (!Array.isArray(audiobook_ids) || audiobook_ids.length === 0) {
      return res.status(400).json({ error: 'audiobook_ids must be a non-empty array' });
    }

    if (audiobook_ids.length > 100) {
      return res.status(400).json({ error: 'Maximum 100 audiobooks per batch' });
    }

    try {
      const placeholders = audiobook_ids.map(() => '?').join(',');
      const { changes } = await dbRun(
        `DELETE FROM user_favorites WHERE user_id = ? AND audiobook_id IN (${placeholders})`,
        [userId, ...audiobook_ids]
      );
      res.json({ success: true, count: changes });
    } catch (error) {
      console.error('Error in batch remove from reading list:', error);
      res.status(500).json({ error: 'Failed to remove from reading list' });
    }
  });

  // Batch add to collection
  router.post('/batch/add-to-collection', authenticateToken, async (req, res) => {
    const { audiobook_ids, collection_id } = req.body;
    const userId = req.user.id;

    if (!Array.isArray(audiobook_ids) || audiobook_ids.length === 0) {
      return res.status(400).json({ error: 'audiobook_ids must be a non-empty array' });
    }

    if (!collection_id) {
      return res.status(400).json({ error: 'collection_id is required' });
    }

    if (audiobook_ids.length > 100) {
      return res.status(400).json({ error: 'Maximum 100 audiobooks per batch' });
    }

    try {
      // Verify collection belongs to user OR is public
      const collection = await dbGet(
        'SELECT id FROM user_collections WHERE id = ? AND (user_id = ? OR is_public = 1)',
        [collection_id, userId]
      );

      if (!collection) {
        return res.status(404).json({ error: 'Collection not found' });
      }

      // Get current max position
      const maxPosRow = await dbGet(
        'SELECT MAX(position) as max_pos FROM collection_items WHERE collection_id = ?',
        [collection_id]
      );

      let successCount = 0;
      let position = maxPosRow?.max_pos || 0;

      for (const audiobookId of audiobook_ids) {
        position++;
        const { changes } = await dbRun(
          'INSERT OR IGNORE INTO collection_items (collection_id, audiobook_id, position) VALUES (?, ?, ?)',
          [collection_id, audiobookId, position]
        );
        if (changes > 0) successCount++;
      }

      res.json({ success: true, count: successCount });
    } catch (error) {
      console.error('Error in batch add to collection:', error);
      res.status(500).json({ error: 'Failed to add to collection' });
    }
  });

  // Batch delete (admin only)
  router.post('/batch/delete', batchDeleteLimiter, authenticateToken, requireAdmin, async (req, res) => {
    // Accept both snake_case and camelCase keys (Android Gson may send camelCase)
    const audiobook_ids = req.body.audiobook_ids || req.body.audiobookIds;
    const delete_files = req.body.delete_files !== undefined ? req.body.delete_files : req.body.deleteFiles;

    if (!Array.isArray(audiobook_ids) || audiobook_ids.length === 0) {
      console.error('Batch delete validation failed. req.body keys:', Object.keys(req.body), 'audiobook_ids type:', typeof audiobook_ids);
      return res.status(400).json({ error: 'audiobook_ids must be a non-empty array' });
    }

    if (audiobook_ids.length > 100) {
      return res.status(400).json({ error: 'Maximum 100 audiobooks per batch' });
    }

    try {
      let successCount = 0;
      const errors = [];

      for (const audiobookId of audiobook_ids) {
        try {
          // Get audiobook info first
          const audiobook = await getAudiobookById(audiobookId);

          if (!audiobook) {
            errors.push({ id: audiobookId, error: 'Not found' });
            continue;
          }

          // Delete from database
          await dbRun('DELETE FROM audiobooks WHERE id = ?', [audiobookId]);

          // Optionally delete files and directory
          if (delete_files && audiobook.file_path) {
            try {
              const audioDir = path.dirname(audiobook.file_path);

              // Delete entire audiobook directory (contains audio file, cover, etc.)
              if (fs.existsSync(audioDir)) {
                fs.rmSync(audioDir, { recursive: true, force: true });
                console.log(`Deleted audiobook directory: ${audioDir}`);

                // Also try to remove empty parent directories (author folder if empty)
                const parentDir = path.dirname(audioDir);
                try {
                  const parentContents = fs.readdirSync(parentDir);
                  if (parentContents.length === 0) {
                    fs.rmdirSync(parentDir);
                    console.log(`Removed empty parent directory: ${parentDir}`);
                  }
                } catch (_parentErr) {
                  // Parent not empty or can't remove - that's fine
                }
              }
            } catch (fileErr) {
              console.error('Failed to delete files for audiobook:', audiobookId, fileErr.message);
            }
          }

          successCount++;
        } catch (err) {
          errors.push({ id: audiobookId, error: err.message });
        }
      }

      res.json({ success: true, count: successCount, errors: errors.length > 0 ? errors : undefined });
    } catch (error) {
      console.error('Error in batch delete:', error);
      res.status(500).json({ error: 'Failed to delete audiobooks' });
    }
  });
}

module.exports = { register };
