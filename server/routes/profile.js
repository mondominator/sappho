/**
 * Profile Routes
 *
 * API endpoints for user profile management
 */

const express = require('express');
const rateLimit = require('express-rate-limit');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const { createDbHelpers } = require('../utils/db');

/**
 * Default dependencies - used when route is required directly
 */
const defaultDependencies = {
  db: () => require('../database'),
  auth: () => require('../auth'),
  genres: () => require('../utils/genres'),
};

// SECURITY: Rate limiting for profile endpoints
const profileLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 60, // 60 requests per minute per IP
  message: { error: 'Too many requests. Please slow down.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const profileWriteLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10, // 10 profile updates per minute
  message: { error: 'Too many profile updates. Please slow down.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const passwordChangeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 password changes per 15 minutes
  message: { error: 'Too many password change attempts. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Configure multer for avatar upload
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = path.join(__dirname, '../../data/avatars');
    console.log('[Avatar] Upload directory:', uploadDir);
    if (!fs.existsSync(uploadDir)) {
      console.log('[Avatar] Creating directory:', uploadDir);
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname);
    const filename = `user-${req.user.id}${ext}`;
    console.log('[Avatar] Saving file:', filename, 'original:', file.originalname, 'mimetype:', file.mimetype);
    cb(null, filename);
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: function (req, file, cb) {
    const allowedTypes = /jpeg|jpg|png|gif|webp/;
    const ext = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mime = allowedTypes.test(file.mimetype);

    if (ext && mime) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'));
    }
  }
});

/**
 * Create profile routes with injectable dependencies
 * @param {Object} deps - Dependencies (for testing)
 * @param {Object} deps.db - Database module
 * @param {Object} deps.auth - Auth module
 * @param {Object} deps.genres - Genres utility module
 * @returns {express.Router}
 */
function createProfileRouter(deps = {}) {
  const router = express.Router();

  // Resolve dependencies (use provided or defaults)
  const db = deps.db || defaultDependencies.db();
  const auth = deps.auth || defaultDependencies.auth();
  const genres = deps.genres || defaultDependencies.genres();
  const { dbGet, dbAll, dbRun } = createDbHelpers(db);

  const { authenticateToken, authenticateMediaToken, validatePassword, invalidateUserTokens } = auth;
  const { normalizeGenres } = genres;

  // Get profile
  router.get('/', profileLimiter, authenticateToken, async (req, res) => {
    try {
      const user = await dbGet(
        'SELECT id, username, email, display_name, avatar, is_admin, must_change_password, created_at FROM users WHERE id = ?',
        [req.user.id]
      );
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }
      res.json({
        ...user,
        must_change_password: !!user.must_change_password
      });
    } catch (_err) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Get user listening stats
  router.get('/stats', profileLimiter, authenticateToken, async (req, res) => {
    try {
      const userId = req.user.id;

      // Total listen time (sum of durations for COMPLETED books only)
      const listenTimeRow = await dbGet(
        `SELECT COALESCE(SUM(a.duration), 0) as totalListenTime
         FROM playback_progress p
         JOIN audiobooks a ON p.audiobook_id = a.id
         WHERE p.user_id = ? AND p.completed = 1`,
        [userId]
      );

      // Books started (any progress)
      const startedRow = await dbGet(
        `SELECT COUNT(DISTINCT audiobook_id) as booksStarted
         FROM playback_progress WHERE user_id = ? AND position > 0`,
        [userId]
      );

      // Books completed
      const completedRow = await dbGet(
        `SELECT COUNT(*) as booksCompleted
         FROM playback_progress WHERE user_id = ? AND completed = 1`,
        [userId]
      );

      // Currently listening (in progress, not completed)
      // Matches criteria used by /api/audiobooks/meta/in-progress endpoint
      // Deduplicates by series (only counts most recent book per series)
      const listeningRow = await dbGet(
        `WITH RankedBooks AS (
           SELECT a.id,
                  ROW_NUMBER() OVER (
                    PARTITION BY CASE
                      WHEN a.series IS NOT NULL AND a.series != '' THEN a.series
                      ELSE 'standalone_' || a.id
                    END
                    ORDER BY p.updated_at DESC
                  ) as rn
           FROM playback_progress p
           JOIN audiobooks a ON p.audiobook_id = a.id
           WHERE p.user_id = ? AND p.completed = 0
             AND (p.position >= 5 OR p.queued_at IS NOT NULL)
             AND (a.is_available = 1 OR a.is_available IS NULL)
         )
         SELECT COUNT(*) as currentlyListening FROM RankedBooks WHERE rn = 1`,
        [userId]
      );

      // Top authors by listen time (sum of durations for COMPLETED books)
      const topAuthors = await dbAll(
        `SELECT a.author, SUM(a.duration) as listenTime, COUNT(DISTINCT a.id) as bookCount
         FROM playback_progress p
         JOIN audiobooks a ON p.audiobook_id = a.id
         WHERE p.user_id = ? AND p.completed = 1 AND a.author IS NOT NULL AND a.author != ''
         GROUP BY a.author
         ORDER BY listenTime DESC
         LIMIT 5`,
        [userId]
      );

      // Top genres by listen time (sum of durations for COMPLETED books, normalize genres in JavaScript)
      const genreRows = await dbAll(
        `SELECT a.genre, a.duration, a.id
         FROM playback_progress p
         JOIN audiobooks a ON p.audiobook_id = a.id
         WHERE p.user_id = ? AND p.completed = 1 AND a.genre IS NOT NULL AND a.genre != ''`,
        [userId]
      );

      // Normalize genres and aggregate by normalized genre
      const genreStats = {};
      for (const row of genreRows) {
        const normalized = normalizeGenres(row.genre);
        if (normalized) {
          const categories = normalized.split(',').map(g => g.trim());
          for (const category of categories) {
            if (!genreStats[category]) {
              genreStats[category] = { genre: category, listenTime: 0, bookIds: new Set() };
            }
            genreStats[category].listenTime += row.duration || 0;
            genreStats[category].bookIds.add(row.id);
          }
        }
      }

      const topGenres = Object.values(genreStats)
        .map(g => ({ genre: g.genre, listenTime: g.listenTime, bookCount: g.bookIds.size }))
        .sort((a, b) => b.listenTime - a.listenTime)
        .slice(0, 5);

      // Recent activity (last 5 books listened to)
      const recentActivity = await dbAll(
        `SELECT a.id, a.title, a.author, a.cover_image, p.position, a.duration, p.completed, p.updated_at
         FROM playback_progress p
         JOIN audiobooks a ON p.audiobook_id = a.id
         WHERE p.user_id = ? AND p.position > 0
         ORDER BY p.updated_at DESC
         LIMIT 5`,
        [userId]
      );

      // Listening streak (days with activity in last 30 days)
      const activityDays = await dbAll(
        `SELECT DATE(updated_at) as day
         FROM playback_progress
         WHERE user_id = ? AND updated_at >= datetime('now', '-30 days')
         GROUP BY DATE(updated_at)
         ORDER BY day DESC`,
        [userId]
      );

      // Calculate current streak
      let streak = 0;
      if (activityDays.length > 0) {
        const today = new Date().toISOString().split('T')[0];
        const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];

        if (activityDays[0].day === today || activityDays[0].day === yesterday) {
          streak = 1;
          for (let i = 1; i < activityDays.length; i++) {
            const prevDate = new Date(activityDays[i - 1].day);
            const currDate = new Date(activityDays[i].day);
            const diff = (prevDate - currDate) / 86400000;
            if (diff === 1) {
              streak++;
            } else {
              break;
            }
          }
        }
      }

      // Average session length
      const avgRow = await dbGet(
        `SELECT AVG(position) as avgPosition
         FROM playback_progress
         WHERE user_id = ? AND position > 60`,
        [userId]
      );

      res.json({
        totalListenTime: listenTimeRow.totalListenTime,
        booksStarted: startedRow.booksStarted,
        booksCompleted: completedRow.booksCompleted,
        currentlyListening: listeningRow.currentlyListening,
        topAuthors,
        topGenres,
        recentActivity,
        activeDaysLast30: activityDays.length,
        currentStreak: streak,
        avgSessionLength: avgRow?.avgPosition || 0
      });
    } catch (error) {
      console.error('Error fetching user stats:', error);
      res.status(500).json({ error: 'Failed to fetch stats' });
    }
  });

  // Update profile with multer error handling
  router.put('/', profileWriteLimiter, authenticateToken, (req, res) => {
    upload.single('avatar')(req, res, async function (err) {
      if (err instanceof multer.MulterError) {
        console.error('[Profile Update] Multer error:', err.message);
        return res.status(400).json({ error: 'Upload failed' });
      } else if (err) {
        console.error('[Profile Update] Upload error:', err.message);
        return res.status(400).json({ error: 'Upload failed' });
      }

      console.log('[Profile Update] req.file:', req.file ? { filename: req.file.filename, path: req.file.path, size: req.file.size } : 'none');
      console.log('[Profile Update] req.body:', req.body);

      const { displayName, email } = req.body;
      const updates = [];
      const params = [];

      if (displayName !== undefined) {
        // VALIDATION: Display name must not be empty or whitespace-only
        const trimmedDisplayName = displayName ? displayName.trim() : '';
        if (trimmedDisplayName.length === 0) {
          return res.status(400).json({ error: 'Display name cannot be empty or whitespace-only' });
        }
        if (trimmedDisplayName.length > 100) {
          return res.status(400).json({ error: 'Display name must be 100 characters or less' });
        }
        updates.push('display_name = ?');
        params.push(trimmedDisplayName);
      }

      if (email !== undefined) {
        updates.push('email = ?');
        params.push(email || null);
      }

      if (req.file) {
        updates.push('avatar = ?');
        params.push(req.file.filename);
      }

      if (updates.length === 0) {
        return res.status(400).json({ error: 'No fields to update' });
      }

      params.push(req.user.id);

      try {
        const { changes } = await dbRun(
          `UPDATE users SET ${updates.join(', ')} WHERE id = ?`,
          params
        );
        if (changes === 0) {
          return res.status(404).json({ error: 'User not found' });
        }
        const user = await dbGet(
          'SELECT id, username, email, display_name, avatar, is_admin, must_change_password, created_at FROM users WHERE id = ?',
          [req.user.id]
        );
        res.json({
          ...user,
          must_change_password: !!user.must_change_password
        });
      } catch (_err) {
        res.status(500).json({ error: 'Internal server error' });
      }
    }); // End of upload callback
  });

  // Get avatar (uses media token for img src compatibility)
  router.get('/avatar', profileLimiter, authenticateMediaToken, async (req, res) => {
    try {
      const user = await dbGet(
        'SELECT avatar FROM users WHERE id = ?',
        [req.user.id]
      );
      if (!user || !user.avatar) {
        return res.status(404).json({ error: 'Avatar not found' });
      }

      // SECURITY: Validate avatar filename pattern to prevent path traversal
      if (!/^user-\d+\.(jpg|jpeg|png|gif|webp)$/i.test(user.avatar)) {
        console.warn(`⚠️ Invalid avatar filename pattern: ${user.avatar}`);
        return res.status(404).json({ error: 'Invalid avatar' });
      }

      const avatarsDir = path.resolve(__dirname, '../../data/avatars');
      const avatarPath = path.join(avatarsDir, user.avatar);
      const resolvedPath = path.resolve(avatarPath);

      // SECURITY: Ensure resolved path is within avatars directory
      if (!resolvedPath.startsWith(avatarsDir + path.sep)) {
        console.warn(`⚠️ Avatar path escapes avatars directory: ${user.avatar}`);
        return res.status(403).json({ error: 'Invalid avatar path' });
      }

      if (!fs.existsSync(resolvedPath)) {
        return res.status(404).json({ error: 'Avatar file not found' });
      }

      res.sendFile(resolvedPath);
    } catch (_err) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Delete avatar
  router.delete('/avatar', profileWriteLimiter, authenticateToken, async (req, res) => {
    try {
      const user = await dbGet('SELECT avatar FROM users WHERE id = ?', [req.user.id]);

      if (user && user.avatar) {
        const avatarPath = path.join(__dirname, '../../data/avatars', user.avatar);
        if (fs.existsSync(avatarPath)) {
          fs.unlinkSync(avatarPath);
        }
      }

      await dbRun(
        'UPDATE users SET avatar = NULL WHERE id = ?',
        [req.user.id]
      );
      res.json({ message: 'Avatar removed successfully' });
    } catch (_err) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Change password
  router.put('/password', passwordChangeLimiter, authenticateToken, async (req, res) => {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Current password and new password are required' });
    }

    // SECURITY: Validate password complexity
    const passwordErrors = validatePassword(newPassword);
    if (passwordErrors.length > 0) {
      return res.status(400).json({ error: passwordErrors.join('. ') });
    }

    try {
      const user = await dbGet(
        'SELECT password_hash FROM users WHERE id = ?',
        [req.user.id]
      );
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      // Verify current password
      const isValid = bcrypt.compareSync(currentPassword, user.password_hash);
      if (!isValid) {
        return res.status(401).json({ error: 'Current password is incorrect' });
      }

      // Hash new password and update, also clear must_change_password flag
      const newPasswordHash = bcrypt.hashSync(newPassword, 10);
      await dbRun(
        'UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?',
        [newPasswordHash, req.user.id]
      );

      // SECURITY: Invalidate all existing tokens after password change
      invalidateUserTokens(req.user.id);

      res.json({
        message: 'Password updated successfully. Please log in again on all devices.'
      });
    } catch (_err) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  return router;
}

// Export default router for backwards compatibility with index.js
module.exports = createProfileRouter();
// Export factory function for testing
module.exports.createProfileRouter = createProfileRouter;
