/**
 * Core CRUD routes for audiobooks
 * - GET / (list with filters, pagination, ratings)
 * - GET /favorites (user favorites)
 * - GET /:id (single audiobook)
 * - DELETE /:id (admin delete)
 */
const fs = require('fs');
const path = require('path');
const { sanitizeFtsQuery } = require('../../utils/ftsSearch');
const { createDbHelpers } = require('../../utils/db');
const { createQueryHelpers } = require('../../utils/queryHelpers');

function register(router, { db, authenticateToken, requireAdmin, normalizeGenres }) {
  const { dbGet, dbAll, dbRun } = createDbHelpers(db);
  const { getAudiobookById, transformAudiobookRow } = createQueryHelpers(db);

  /**
   * Execute the audiobooks list query. When a search term is provided,
   * attempts FTS5 first for speed, then falls back to LIKE if FTS5 fails
   * (e.g. missing table on first run before migration completes).
   */
  async function executeListQuery(req, res, { useFts = true } = {}) {
    const { genre, author, series, search, favorites, includeUnavailable, limit: rawLimit = 50, offset: rawOffset = 0 } = req.query;
    const limit = Math.min(Math.max(1, parseInt(rawLimit) || 50), 2000);
    const offset = Math.max(0, parseInt(rawOffset) || 0);
    const userId = req.user.id;

    const ftsQuery = search ? sanitizeFtsQuery(search) : '';
    const useFtsSearch = useFts && search && ftsQuery;

    let query = `SELECT a.*, p.position as progress_position, p.completed as progress_completed,
                        p.updated_at as progress_updated_at,
                        CASE WHEN f.id IS NOT NULL THEN 1 ELSE 0 END as is_favorite,
                        ur.rating as user_rating,
                        (SELECT AVG(ur2.rating) FROM user_ratings ur2 WHERE ur2.audiobook_id = a.id AND ur2.rating IS NOT NULL) as average_rating
                 FROM audiobooks a
                 LEFT JOIN playback_progress p ON a.id = p.audiobook_id AND p.user_id = ?
                 LEFT JOIN user_favorites f ON a.id = f.audiobook_id AND f.user_id = ?
                 LEFT JOIN user_ratings ur ON a.id = ur.audiobook_id AND ur.user_id = ?`;
    const params = [userId, userId, userId];

    // Join FTS table when using full-text search
    if (useFtsSearch) {
      query += ' INNER JOIN audiobooks_fts fts ON a.id = fts.rowid';
    }

    query += ' WHERE 1=1';

    // Filter out unavailable books by default (unless includeUnavailable=true)
    if (includeUnavailable !== 'true') {
      query += ' AND (a.is_available = 1 OR a.is_available IS NULL)';
    }

    if (genre) {
      query += ' AND a.genre LIKE ?';
      params.push(`%${genre}%`);
    }

    if (author) {
      query += ' AND a.author LIKE ?';
      params.push(`%${author}%`);
    }

    if (series) {
      query += ' AND a.series LIKE ?';
      params.push(`%${series}%`);
    }

    if (search) {
      if (useFtsSearch) {
        query += ' AND audiobooks_fts MATCH ?';
        params.push(ftsQuery);
      } else {
        query += ' AND (a.title LIKE ? OR a.author LIKE ? OR a.narrator LIKE ? OR a.series LIKE ?)';
        params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
      }
    }

    if (favorites === 'true') {
      query += ' AND f.id IS NOT NULL';
    }

    // Use FTS5 rank for relevance ordering when searching, title otherwise
    if (useFtsSearch) {
      query += ' ORDER BY rank, a.title ASC LIMIT ? OFFSET ?';
    } else {
      query += ' ORDER BY a.title ASC LIMIT ? OFFSET ?';
    }
    params.push(parseInt(limit), parseInt(offset));

    let audiobooks;
    try {
      audiobooks = await dbAll(query, params);
    } catch (_err) {
      // Fall back to LIKE if FTS5 query failed (malformed input, missing table, etc.)
      if (useFtsSearch) {
        return executeListQuery(req, res, { useFts: false });
      }
      return res.status(500).json({ error: 'Internal server error' });
    }

    // Transform progress and rating fields into nested/clean format
    const transformedAudiobooks = audiobooks.map(book => transformAudiobookRow(book, normalizeGenres));

    // Get total count
    let countQuery;
    const countParams = [];

    if (favorites === 'true') {
      countQuery = `SELECT COUNT(*) as total FROM audiobooks a
         INNER JOIN user_favorites f ON a.id = f.audiobook_id AND f.user_id = ?
         WHERE 1=1`;
      countParams.push(userId);
    } else {
      countQuery = 'SELECT COUNT(*) as total FROM audiobooks a WHERE 1=1';
    }

    // Join FTS for count query too when using full-text search
    if (useFtsSearch) {
      // Rewrite count query with FTS join
      if (favorites === 'true') {
        countQuery = `SELECT COUNT(*) as total FROM audiobooks a
           INNER JOIN user_favorites f ON a.id = f.audiobook_id AND f.user_id = ?
           INNER JOIN audiobooks_fts fts ON a.id = fts.rowid
           WHERE 1=1`;
      } else {
        countQuery = `SELECT COUNT(*) as total FROM audiobooks a
           INNER JOIN audiobooks_fts fts ON a.id = fts.rowid
           WHERE 1=1`;
      }
    }

    // Filter out unavailable books by default (unless includeUnavailable=true)
    if (includeUnavailable !== 'true') {
      countQuery += ' AND (a.is_available = 1 OR a.is_available IS NULL)';
    }

    if (genre) {
      countQuery += ' AND a.genre LIKE ?';
      countParams.push(`%${genre}%`);
    }

    if (author) {
      countQuery += ' AND a.author LIKE ?';
      countParams.push(`%${author}%`);
    }

    if (series) {
      countQuery += ' AND a.series LIKE ?';
      countParams.push(`%${series}%`);
    }

    if (search) {
      if (useFtsSearch) {
        countQuery += ' AND audiobooks_fts MATCH ?';
        countParams.push(ftsQuery);
      } else {
        countQuery += ' AND (a.title LIKE ? OR a.author LIKE ? OR a.narrator LIKE ? OR a.series LIKE ?)';
        countParams.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
      }
    }

    try {
      const count = await dbGet(countQuery, countParams);
      res.json({ audiobooks: transformedAudiobooks, total: count.total });
    } catch (_err) {
      res.status(500).json({ error: 'Internal server error' });
    }
  }

  // Get all audiobooks
  router.get('/', authenticateToken, (req, res) => {
    executeListQuery(req, res);
  });

  // Get all favorites for the current user
  // NOTE: This route MUST be defined before /:id to avoid being matched as an ID
  router.get('/favorites', authenticateToken, async (req, res) => {
    const { sort } = req.query;

    // Determine ORDER BY clause based on sort parameter
    let orderClause;
    switch (sort) {
      case 'date':
        orderClause = 'ORDER BY f.created_at DESC';
        break;
      case 'title':
        orderClause = 'ORDER BY a.title ASC';
        break;
      case 'custom':
        orderClause = 'ORDER BY f.list_order ASC';
        break;
      case 'priority':
      default:
        // Priority-first is the new default: high priority (1) first, then by position
        // priority=0 (none/unset) sorts last
        orderClause = 'ORDER BY CASE WHEN f.priority = 0 THEN 4 ELSE f.priority END ASC, f.list_order ASC';
        break;
    }

    try {
      const audiobooks = await dbAll(
        `SELECT a.*,
                p.position as progress_position,
                p.completed as progress_completed,
                f.created_at as favorited_at,
                f.priority,
                f.list_order
         FROM user_favorites f
         INNER JOIN audiobooks a ON f.audiobook_id = a.id
         LEFT JOIN playback_progress p ON a.id = p.audiobook_id AND p.user_id = ?
         WHERE f.user_id = ?
         ${orderClause}`,
        [req.user.id, req.user.id]
      );

      // Transform progress fields into nested object
      const transformedAudiobooks = audiobooks.map(book => ({
        ...book,
        normalized_genre: normalizeGenres(book.genre),
        is_favorite: true,
        progress: {
          position: book.progress_position,
          completed: book.progress_completed
        }
      }));
      transformedAudiobooks.forEach(b => {
        delete b.progress_position;
        delete b.progress_completed;
      });

      res.json(transformedAudiobooks);
    } catch (err) {
      console.error('Error fetching favorites:', err);
      res.status(500).json({ error: 'Failed to fetch favorites' });
    }
  });

  // Get single audiobook
  router.get('/:id', authenticateToken, async (req, res) => {
    try {
      const audiobook = await getAudiobookById(req.params.id);
      if (!audiobook) {
        return res.status(404).json({ error: 'Audiobook not found' });
      }

      // Check if audiobook is in user's favorites
      const favorite = await dbGet(
        'SELECT id FROM user_favorites WHERE user_id = ? AND audiobook_id = ?',
        [req.user.id, req.params.id]
      );
      res.json({ ...audiobook, normalized_genre: normalizeGenres(audiobook.genre), is_favorite: !!favorite });
    } catch (_err) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Delete audiobook (admin only)
  router.delete('/:id', authenticateToken, requireAdmin, async (req, res) => {
    try {
      const audiobook = await getAudiobookById(req.params.id);
      if (!audiobook) {
        return res.status(404).json({ error: 'Audiobook not found' });
      }

      // Delete related data first (explicit cleanup ensures no orphans)
      await dbRun('DELETE FROM playback_progress WHERE audiobook_id = ?', [req.params.id]);
      await dbRun('DELETE FROM collection_items WHERE audiobook_id = ?', [req.params.id]);
      await dbRun('DELETE FROM audiobooks WHERE id = ?', [req.params.id]);

      // Delete entire audiobook directory (contains audio file, cover, etc.)
      if (audiobook.file_path) {
        const audioDir = path.dirname(audiobook.file_path);
        if (fs.existsSync(audioDir)) {
          fs.rmSync(audioDir, { recursive: true, force: true });
          console.log(`Deleted audiobook directory: ${audioDir}`);

          // Remove empty parent directory (e.g., author folder)
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
      }

      res.json({ message: 'Audiobook deleted successfully' });
    } catch (_err) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });
}

module.exports = { register };
