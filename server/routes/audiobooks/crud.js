/**
 * Core CRUD routes for audiobooks
 * - GET / (list with filters, pagination, ratings)
 * - GET /favorites (user favorites)
 * - GET /:id (single audiobook)
 * - DELETE /:id (admin delete)
 */
const fs = require('fs');
const { sanitizeFtsQuery } = require('../../utils/ftsSearch');

function register(router, { db, authenticateToken, requireAdmin, normalizeGenres }) {

  /**
   * Execute the audiobooks list query. When a search term is provided,
   * attempts FTS5 first for speed, then falls back to LIKE if FTS5 fails
   * (e.g. missing table on first run before migration completes).
   */
  function executeListQuery(req, res, { useFts = true } = {}) {
    const { genre, author, series, search, favorites, includeUnavailable, limit: rawLimit = 50, offset: rawOffset = 0 } = req.query;
    const limit = Math.min(Math.max(1, parseInt(rawLimit) || 50), 200);
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

    db.all(query, params, (err, audiobooks) => {
      if (err) {
        // Fall back to LIKE if FTS5 query failed (malformed input, missing table, etc.)
        if (useFtsSearch) {
          return executeListQuery(req, res, { useFts: false });
        }
        return res.status(500).json({ error: 'Internal server error' });
      }

      // Transform progress and rating fields into nested/clean format
      const transformedAudiobooks = audiobooks.map(book => {
        const { progress_position, progress_completed, progress_updated_at, is_favorite, user_rating, average_rating, ...rest } = book;
        return {
          ...rest,
          normalized_genre: normalizeGenres(book.genre),
          is_favorite: !!is_favorite,
          user_rating: user_rating || null,
          average_rating: average_rating ? Math.round(average_rating * 10) / 10 : null,
          progress: progress_position !== null ? {
            position: progress_position,
            completed: progress_completed,
            updated_at: progress_updated_at
          } : null
        };
      });

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

      db.get(countQuery, countParams, (err, count) => {
        if (err) {
          return res.status(500).json({ error: 'Internal server error' });
        }
        res.json({ audiobooks: transformedAudiobooks, total: count.total });
      });
    });
  }

  // Get all audiobooks
  router.get('/', authenticateToken, (req, res) => {
    executeListQuery(req, res);
  });

  // Get all favorites for the current user
  // NOTE: This route MUST be defined before /:id to avoid being matched as an ID
  router.get('/favorites', authenticateToken, (req, res) => {
    db.all(
      `SELECT a.*,
              p.position as progress_position,
              p.completed as progress_completed,
              f.created_at as favorited_at
       FROM user_favorites f
       INNER JOIN audiobooks a ON f.audiobook_id = a.id
       LEFT JOIN playback_progress p ON a.id = p.audiobook_id AND p.user_id = ?
       WHERE f.user_id = ?
       ORDER BY f.created_at DESC`,
      [req.user.id, req.user.id],
      (err, audiobooks) => {
        if (err) {
          console.error('Error fetching favorites:', err);
          return res.status(500).json({ error: 'Failed to fetch favorites' });
        }

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
      }
    );
  });

  // Get single audiobook
  router.get('/:id', authenticateToken, (req, res) => {
    db.get('SELECT * FROM audiobooks WHERE id = ?', [req.params.id], (err, audiobook) => {
      if (err) {
        return res.status(500).json({ error: 'Internal server error' });
      }
      if (!audiobook) {
        return res.status(404).json({ error: 'Audiobook not found' });
      }

      // Check if audiobook is in user's favorites
      db.get(
        'SELECT id FROM user_favorites WHERE user_id = ? AND audiobook_id = ?',
        [req.user.id, req.params.id],
        (err, favorite) => {
          if (err) {
            console.error('Error checking favorite status:', err);
            // Don't fail the whole request, just skip favorite status
            return res.json({ ...audiobook, normalized_genre: normalizeGenres(audiobook.genre) });
          }
          res.json({ ...audiobook, normalized_genre: normalizeGenres(audiobook.genre), is_favorite: !!favorite });
        }
      );
    });
  });

  // Delete audiobook (admin only)
  router.delete('/:id', authenticateToken, requireAdmin, (req, res) => {
    db.get('SELECT * FROM audiobooks WHERE id = ?', [req.params.id], (err, audiobook) => {
      if (err) {
        return res.status(500).json({ error: 'Internal server error' });
      }
      if (!audiobook) {
        return res.status(404).json({ error: 'Audiobook not found' });
      }

      // Delete file
      if (fs.existsSync(audiobook.file_path)) {
        fs.unlinkSync(audiobook.file_path);
      }

      // Delete cover image if exists
      if (audiobook.cover_image && fs.existsSync(audiobook.cover_image)) {
        fs.unlinkSync(audiobook.cover_image);
      }

      // Delete from database
      db.run('DELETE FROM audiobooks WHERE id = ?', [req.params.id], (err) => {
        if (err) {
          return res.status(500).json({ error: 'Internal server error' });
        }
        res.json({ message: 'Audiobook deleted successfully' });
      });
    });
  });
}

module.exports = { register };
