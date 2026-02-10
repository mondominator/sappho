/**
 * Statistics Routes
 * Library statistics and format breakdowns.
 */
const { maintenanceLimiter } = require('./helpers');
const { createDbHelpers } = require('../../utils/db');

function register(router, { db, authenticateToken, requireAdmin }) {
  const { dbGet, dbAll } = createDbHelpers(db);

  // Get library statistics
  router.get('/statistics', maintenanceLimiter, authenticateToken, requireAdmin, async (req, res) => {
    try {
      const totals = await dbGet(
        `SELECT
          COUNT(*) as totalBooks,
          COALESCE(SUM(file_size), 0) as totalSize,
          COALESCE(SUM(duration), 0) as totalDuration,
          COALESCE(AVG(duration), 0) as avgDuration
        FROM audiobooks`
      );

      const byFormat = await dbAll(
        `SELECT
          LOWER(REPLACE(file_path, RTRIM(file_path, REPLACE(file_path, '.', '')), '')) as format,
          COUNT(*) as count,
          COALESCE(SUM(file_size), 0) as size
        FROM audiobooks
        WHERE file_path IS NOT NULL AND file_path LIKE '%.%'
        GROUP BY format
        ORDER BY size DESC`
      );

      const topAuthors = await dbAll(
        `SELECT
          author,
          COUNT(*) as count,
          COALESCE(SUM(file_size), 0) as size,
          COALESCE(SUM(duration), 0) as duration
        FROM audiobooks
        WHERE author IS NOT NULL AND author != ''
        GROUP BY author
        ORDER BY size DESC
        LIMIT 10`
      );

      const topSeries = await dbAll(
        `SELECT
          series,
          COUNT(*) as count,
          COALESCE(SUM(file_size), 0) as size,
          COALESCE(SUM(duration), 0) as duration
        FROM audiobooks
        WHERE series IS NOT NULL AND series != ''
        GROUP BY series
        ORDER BY count DESC
        LIMIT 10`
      );

      const addedOverTime = await dbAll(
        `SELECT
          strftime('%Y-%m', created_at) as month,
          COUNT(*) as count,
          COALESCE(SUM(file_size), 0) as size
        FROM audiobooks
        WHERE created_at >= date('now', '-12 months')
        GROUP BY month
        ORDER BY month ASC`
      );

      const userStats = await dbAll(
        `SELECT
          u.username,
          COUNT(DISTINCT pp.audiobook_id) as booksStarted,
          SUM(CASE WHEN pp.completed = 1 THEN 1 ELSE 0 END) as booksCompleted,
          COALESCE(SUM(pp.position), 0) as totalListenTime
        FROM users u
        LEFT JOIN playback_progress pp ON u.id = pp.user_id
        GROUP BY u.id
        ORDER BY totalListenTime DESC`
      );

      const topNarrators = await dbAll(
        `SELECT
          narrator,
          COUNT(*) as count,
          COALESCE(SUM(duration), 0) as duration
        FROM audiobooks
        WHERE narrator IS NOT NULL AND narrator != ''
        GROUP BY narrator
        ORDER BY count DESC
        LIMIT 10`
      );

      res.json({
        totals: {
          books: totals.totalBooks,
          size: totals.totalSize,
          duration: totals.totalDuration,
          avgDuration: totals.avgDuration,
        },
        byFormat,
        topAuthors,
        topSeries,
        topNarrators,
        addedOverTime,
        userStats,
      });
    } catch (error) {
      console.error('Error fetching statistics:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Get audiobooks by file format
  router.get('/books-by-format/:format', authenticateToken, requireAdmin, async (req, res) => {
    try {
      const format = req.params.format.toLowerCase();
      const books = await dbAll(
        `SELECT id, title, author, cover_image, file_size, duration
         FROM audiobooks
         WHERE LOWER(REPLACE(file_path, RTRIM(file_path, REPLACE(file_path, '.', '')), '')) = ?
         ORDER BY title ASC`,
        [format]
      );
      res.json(books);
    } catch (error) {
      console.error('Error fetching books by format:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });
}

module.exports = { register };
