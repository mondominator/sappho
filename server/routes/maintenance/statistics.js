/**
 * Statistics Routes
 * Library statistics and format breakdowns.
 */
const { maintenanceLimiter } = require('./helpers');

function register(router, { db, authenticateToken }) {
  // Get library statistics
  router.get('/statistics', maintenanceLimiter, authenticateToken, async (req, res) => {
    if (!req.user.is_admin) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    try {
      // Total storage and count
      const totals = await new Promise((resolve, reject) => {
        db.get(
          `SELECT
            COUNT(*) as totalBooks,
            COALESCE(SUM(file_size), 0) as totalSize,
            COALESCE(SUM(duration), 0) as totalDuration,
            COALESCE(AVG(duration), 0) as avgDuration
          FROM audiobooks`,
          (err, row) => {
            if (err) reject(err);
            else resolve(row);
          }
        );
      });

      // Storage by format - extract extension from file_path
      const byFormat = await new Promise((resolve, reject) => {
        db.all(
          `SELECT
            LOWER(REPLACE(file_path, RTRIM(file_path, REPLACE(file_path, '.', '')), '')) as format,
            COUNT(*) as count,
            COALESCE(SUM(file_size), 0) as size
          FROM audiobooks
          WHERE file_path IS NOT NULL AND file_path LIKE '%.%'
          GROUP BY format
          ORDER BY size DESC`,
          (err, rows) => {
            if (err) reject(err);
            else resolve(rows || []);
          }
        );
      });

      // Top authors by storage
      const topAuthors = await new Promise((resolve, reject) => {
        db.all(
          `SELECT
            author,
            COUNT(*) as count,
            COALESCE(SUM(file_size), 0) as size,
            COALESCE(SUM(duration), 0) as duration
          FROM audiobooks
          WHERE author IS NOT NULL AND author != ''
          GROUP BY author
          ORDER BY size DESC
          LIMIT 10`,
          (err, rows) => {
            if (err) reject(err);
            else resolve(rows || []);
          }
        );
      });

      // Top series by storage
      const topSeries = await new Promise((resolve, reject) => {
        db.all(
          `SELECT
            series,
            COUNT(*) as count,
            COALESCE(SUM(file_size), 0) as size,
            COALESCE(SUM(duration), 0) as duration
          FROM audiobooks
          WHERE series IS NOT NULL AND series != ''
          GROUP BY series
          ORDER BY count DESC
          LIMIT 10`,
          (err, rows) => {
            if (err) reject(err);
            else resolve(rows || []);
          }
        );
      });

      // Books added over time (last 12 months)
      const addedOverTime = await new Promise((resolve, reject) => {
        db.all(
          `SELECT
            strftime('%Y-%m', created_at) as month,
            COUNT(*) as count,
            COALESCE(SUM(file_size), 0) as size
          FROM audiobooks
          WHERE created_at >= date('now', '-12 months')
          GROUP BY month
          ORDER BY month ASC`,
          (err, rows) => {
            if (err) reject(err);
            else resolve(rows || []);
          }
        );
      });

      // User statistics
      const userStats = await new Promise((resolve, reject) => {
        db.all(
          `SELECT
            u.username,
            COUNT(DISTINCT pp.audiobook_id) as booksStarted,
            SUM(CASE WHEN pp.completed = 1 THEN 1 ELSE 0 END) as booksCompleted,
            COALESCE(SUM(pp.position), 0) as totalListenTime
          FROM users u
          LEFT JOIN playback_progress pp ON u.id = pp.user_id
          GROUP BY u.id
          ORDER BY totalListenTime DESC`,
          (err, rows) => {
            if (err) reject(err);
            else resolve(rows || []);
          }
        );
      });

      // Narrator statistics
      const topNarrators = await new Promise((resolve, reject) => {
        db.all(
          `SELECT
            narrator,
            COUNT(*) as count,
            COALESCE(SUM(duration), 0) as duration
          FROM audiobooks
          WHERE narrator IS NOT NULL AND narrator != ''
          GROUP BY narrator
          ORDER BY count DESC
          LIMIT 10`,
          (err, rows) => {
            if (err) reject(err);
            else resolve(rows || []);
          }
        );
      });

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
      res.status(500).json({ error: error.message });
    }
  });

  // Get audiobooks by file format
  router.get('/books-by-format/:format', authenticateToken, async (req, res) => {
    if (!req.user.is_admin) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    try {
      const format = req.params.format.toLowerCase();
      const books = await new Promise((resolve, reject) => {
        db.all(
          `SELECT id, title, author, cover_image, file_size, duration
           FROM audiobooks
           WHERE LOWER(REPLACE(file_path, RTRIM(file_path, REPLACE(file_path, '.', '')), '')) = ?
           ORDER BY title ASC`,
          [format],
          (err, rows) => {
            if (err) reject(err);
            else resolve(rows || []);
          }
        );
      });
      res.json(books);
    } catch (error) {
      console.error('Error fetching books by format:', error);
      res.status(500).json({ error: error.message });
    }
  });
}

module.exports = { register };
