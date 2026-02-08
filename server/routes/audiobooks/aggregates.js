/**
 * Aggregate/meta route handlers for audiobooks
 * Handles series, authors, genres, recent, in-progress, up-next, and finished queries
 */

function register(router, { db, authenticateToken, normalizeGenres, GENRE_MAPPINGS, DEFAULT_GENRE_METADATA }) {
  // Get all series with cover IDs
  router.get('/meta/series', authenticateToken, (req, res) => {
    const userId = req.user.id;

    db.all(
      `SELECT
         a.series,
         COUNT(DISTINCT a.id) as book_count,
         GROUP_CONCAT(DISTINCT a.id ORDER BY a.series_position) as book_ids,
         COUNT(DISTINCT CASE WHEN p.completed = 1 THEN a.id END) as completed_count,
         (SELECT AVG(ur.rating) FROM user_ratings ur
          INNER JOIN audiobooks a2 ON ur.audiobook_id = a2.id
          WHERE a2.series = a.series AND ur.rating IS NOT NULL
          AND (a2.is_available = 1 OR a2.is_available IS NULL)) as average_rating,
         (SELECT COUNT(*) FROM user_ratings ur
          INNER JOIN audiobooks a2 ON ur.audiobook_id = a2.id
          WHERE a2.series = a.series AND ur.rating IS NOT NULL
          AND (a2.is_available = 1 OR a2.is_available IS NULL)) as rating_count
       FROM audiobooks a
       LEFT JOIN playback_progress p ON a.id = p.audiobook_id AND p.user_id = ?
       WHERE a.series IS NOT NULL AND (a.is_available = 1 OR a.is_available IS NULL)
       GROUP BY a.series
       ORDER BY a.series ASC`,
      [userId],
      (err, series) => {
        if (err) {
          return res.status(500).json({ error: 'Internal server error' });
        }
        // Convert comma-separated IDs to array and take first 4
        // Filter out series with only one book
        const seriesWithCovers = series
          .filter(s => s.book_count > 1)
          .map(s => ({
            ...s,
            cover_ids: s.book_ids ? s.book_ids.split(',').slice(0, 4) : [],
            completed_count: s.completed_count || 0,
            average_rating: s.average_rating ? Math.round(s.average_rating * 10) / 10 : null,
            rating_count: s.rating_count || 0
          }));
        res.json(seriesWithCovers);
      }
    );
  });

  // Get all authors with cover IDs and completion stats
  router.get('/meta/authors', authenticateToken, (req, res) => {
    const userId = req.user.id;

    db.all(
      `SELECT
         a.author,
         COUNT(DISTINCT a.id) as book_count,
         GROUP_CONCAT(DISTINCT a.id) as book_ids,
         COUNT(DISTINCT CASE WHEN p.completed = 1 THEN a.id END) as completed_count
       FROM audiobooks a
       LEFT JOIN playback_progress p ON a.id = p.audiobook_id AND p.user_id = ?
       WHERE a.author IS NOT NULL AND (a.is_available = 1 OR a.is_available IS NULL)
       GROUP BY a.author
       ORDER BY author ASC`,
      [userId],
      (err, authors) => {
        if (err) {
          return res.status(500).json({ error: 'Internal server error' });
        }
        // Convert comma-separated IDs to array and take first 4 for covers
        const authorsWithCovers = authors.map(a => ({
          ...a,
          cover_ids: a.book_ids ? a.book_ids.split(',').slice(0, 4) : [],
          completed_count: a.completed_count || 0
        }));
        // Remove book_ids from response
        authorsWithCovers.forEach(a => delete a.book_ids);
        res.json(authorsWithCovers);
      }
    );
  });

  // Get genre category mappings (for client-side filtering)
  // Returns full genre metadata including keywords, colors, and icons
  router.get('/meta/genre-mappings', authenticateToken, (req, res) => {
    res.json({
      genres: GENRE_MAPPINGS,
      defaults: DEFAULT_GENRE_METADATA
    });
  });

  // Get all genres (normalized to major categories) with cover IDs
  router.get('/meta/genres', authenticateToken, (req, res) => {
    db.all(
      'SELECT id, genre, cover_image FROM audiobooks WHERE genre IS NOT NULL AND genre != \'\' AND (is_available = 1 OR is_available IS NULL)',
      [],
      (err, books) => {
        if (err) {
          return res.status(500).json({ error: 'Internal server error' });
        }

        // Build genre data with counts and cover IDs
        const genreData = {};

        books.forEach(book => {
          // Normalize the genre string to get categories
          const normalizedGenres = normalizeGenres(book.genre);
          if (!normalizedGenres) return;

          const categories = normalizedGenres.split(', ');
          categories.forEach(genre => {
            if (!genreData[genre]) {
              genreData[genre] = {
                genre,
                count: 0,
                cover_ids: []
              };
            }
            genreData[genre].count++;
            // Collect cover IDs (up to 4 for display)
            if (book.cover_image && genreData[genre].cover_ids.length < 4) {
              genreData[genre].cover_ids.push(book.id);
            }
          });
        });

        // Convert to array and sort by count descending
        const genres = Object.values(genreData)
          .sort((a, b) => b.count - a.count);

        res.json(genres);
      }
    );
  });

  // Get recently added audiobooks
  router.get('/meta/recent', authenticateToken, (req, res) => {
    const limit = parseInt(req.query.limit) || 10;
    const userId = req.user.id;

    db.all(
      `SELECT a.*, p.position as progress_position, p.completed as progress_completed,
              CASE WHEN f.id IS NOT NULL THEN 1 ELSE 0 END as is_favorite
       FROM audiobooks a
       LEFT JOIN playback_progress p ON a.id = p.audiobook_id AND p.user_id = ?
       LEFT JOIN user_favorites f ON a.id = f.audiobook_id AND f.user_id = ?
       WHERE (a.is_available = 1 OR a.is_available IS NULL)
       ORDER BY a.created_at DESC
       LIMIT ?`,
      [userId, userId, limit],
      (err, audiobooks) => {
        if (err) {
          return res.status(500).json({ error: 'Internal server error' });
        }

        // Transform progress fields into nested object
        const transformedAudiobooks = audiobooks.map(book => ({
          ...book,
          normalized_genre: normalizeGenres(book.genre),
          is_favorite: !!book.is_favorite,
          progress: book.progress_position !== null ? {
            position: book.progress_position,
            completed: book.progress_completed
          } : null
        }));
        transformedAudiobooks.forEach(b => {
          delete b.progress_position;
          delete b.progress_completed;
        });

        res.json(transformedAudiobooks);
      }
    );
  });

  // Get in-progress audiobooks (Continue Listening) - ordered by most recently played
  // Deduplicates by series: only shows most recently played book per series
  // Standalone books (no series) are shown individually
  router.get('/meta/in-progress', authenticateToken, (req, res) => {
    const limit = parseInt(req.query.limit) || 10;
    const userId = req.user.id;

    db.all(
      `WITH RankedBooks AS (
         SELECT a.*, p.position as progress_position, p.completed as progress_completed,
                p.updated_at as last_played, p.queued_at,
                CASE WHEN f.id IS NOT NULL THEN 1 ELSE 0 END as is_favorite,
                ROW_NUMBER() OVER (
                  PARTITION BY CASE
                    WHEN a.series IS NOT NULL AND a.series != '' THEN a.series
                    ELSE 'standalone_' || a.id
                  END
                  ORDER BY p.updated_at DESC
                ) as rn
         FROM audiobooks a
         INNER JOIN playback_progress p ON a.id = p.audiobook_id
         LEFT JOIN user_favorites f ON a.id = f.audiobook_id AND f.user_id = ?
         WHERE p.user_id = ? AND p.completed = 0
           AND (p.position >= 5 OR p.queued_at IS NOT NULL)
           AND (a.is_available = 1 OR a.is_available IS NULL)
       )
       SELECT * FROM RankedBooks
       WHERE rn = 1
       ORDER BY last_played DESC
       LIMIT ?`,
      [userId, userId, limit],
      (err, audiobooks) => {
        if (err) {
          return res.status(500).json({ error: 'Internal server error' });
        }

        // Transform progress fields into nested object
        const transformedAudiobooks = audiobooks.map(book => ({
          ...book,
          normalized_genre: normalizeGenres(book.genre),
          is_favorite: !!book.is_favorite,
          is_queued: !!book.queued_at,
          progress: {
            position: book.progress_position,
            completed: book.progress_completed
          }
        }));
        transformedAudiobooks.forEach(b => {
          delete b.progress_position;
          delete b.progress_completed;
          delete b.queued_at;
          delete b.rn;
        });

        res.json(transformedAudiobooks);
      }
    );
  });

  // Get ALL in-progress audiobooks (all users) - for monitoring systems
  router.get('/meta/in-progress/all', authenticateToken, (req, res) => {
    const limit = parseInt(req.query.limit) || 100;

    db.all(
      `SELECT a.*, p.position, p.updated_at as last_played, p.user_id
       FROM audiobooks a
       INNER JOIN playback_progress p ON a.id = p.audiobook_id
       WHERE p.completed = 0 AND p.position >= 5
       ORDER BY p.updated_at DESC
       LIMIT ?`,
      [limit],
      (err, audiobooks) => {
        if (err) {
          return res.status(500).json({ error: 'Internal server error' });
        }
        // Add normalized genre
        const transformedAudiobooks = audiobooks.map(book => ({
          ...book,
          normalized_genre: normalizeGenres(book.genre)
        }));
        res.json(transformedAudiobooks);
      }
    );
  });

  // Get "up next" books - next unstarted book in series where user has started or completed books
  router.get('/meta/up-next', authenticateToken, (req, res) => {
    const limit = parseInt(req.query.limit) || 10;
    const userId = req.user.id;

    // Find the next UNSTARTED book in each series where user has progress on any book
    // This excludes books that are in-progress or queued (those appear in "Continue Listening")
    // Ordered by most recent activity in each series (so current series appears first)
    db.all(
      `WITH SeriesWithProgress AS (
         -- Find series where user has progress, with most recent activity time
         SELECT a.series, MAX(p.updated_at) as last_activity
         FROM audiobooks a
         INNER JOIN playback_progress p ON a.id = p.audiobook_id AND p.user_id = ?
         WHERE a.series IS NOT NULL AND a.series != ''
         AND (p.completed = 1 OR p.position > 0)
         AND (a.is_available = 1 OR a.is_available IS NULL)
         GROUP BY a.series
       ),
       NextUnstartedBooks AS (
         -- For each such series, find the first book that has NO progress at all
         SELECT a.*,
                p.position as progress_position,
                p.completed as progress_completed,
                s.last_activity,
                CASE WHEN f.id IS NOT NULL THEN 1 ELSE 0 END as is_favorite,
                ROW_NUMBER() OVER (
                  PARTITION BY a.series
                  ORDER BY COALESCE(a.series_index, a.series_position, 0) ASC
                ) as row_num
         FROM audiobooks a
         INNER JOIN SeriesWithProgress s ON a.series = s.series
         LEFT JOIN playback_progress p ON a.id = p.audiobook_id AND p.user_id = ?
         LEFT JOIN user_favorites f ON a.id = f.audiobook_id AND f.user_id = ?
         WHERE (a.series_index IS NOT NULL OR a.series_position IS NOT NULL)
         AND (p.position IS NULL OR p.position = 0)
         AND (p.completed IS NULL OR p.completed = 0)
         AND (p.queued_at IS NULL)
         AND (a.is_available = 1 OR a.is_available IS NULL)
       )
       SELECT * FROM NextUnstartedBooks
       WHERE row_num = 1
       ORDER BY last_activity DESC
       LIMIT ?`,
      [userId, userId, userId, limit],
      (err, audiobooks) => {
        if (err) {
          console.error('Error in up-next query:', err);
          return res.status(500).json({ error: 'Internal server error' });
        }

        // Transform progress fields into nested object
        const transformedAudiobooks = audiobooks.map(book => ({
          ...book,
          normalized_genre: normalizeGenres(book.genre),
          is_favorite: !!book.is_favorite,
          progress: book.progress_position !== null ? {
            position: book.progress_position,
            completed: book.progress_completed
          } : null
        }));
        transformedAudiobooks.forEach(b => {
          delete b.progress_position;
          delete b.progress_completed;
          delete b.last_activity;
          delete b.row_num;
        });

        res.json(transformedAudiobooks);
      }
    );
  });

  // Get finished audiobooks (completed = 1) in random order
  router.get('/meta/finished', authenticateToken, (req, res) => {
    const limit = parseInt(req.query.limit) || 10;
    const userId = req.user.id;

    db.all(
      `SELECT a.*, p.position as progress_position, p.completed as progress_completed,
              CASE WHEN f.id IS NOT NULL THEN 1 ELSE 0 END as is_favorite
       FROM audiobooks a
       INNER JOIN playback_progress p ON a.id = p.audiobook_id
       LEFT JOIN user_favorites f ON a.id = f.audiobook_id AND f.user_id = ?
       WHERE p.user_id = ? AND p.completed = 1 AND (a.is_available = 1 OR a.is_available IS NULL)
       ORDER BY RANDOM()
       LIMIT ?`,
      [userId, userId, limit],
      (err, audiobooks) => {
        if (err) {
          return res.status(500).json({ error: 'Internal server error' });
        }

        // Transform progress fields into nested object
        const transformedAudiobooks = audiobooks.map(book => ({
          ...book,
          normalized_genre: normalizeGenres(book.genre),
          is_favorite: !!book.is_favorite,
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
}

module.exports = { register };
