const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const db = require('../database');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const { authenticateToken, authenticateMediaToken, validatePassword, invalidateUserTokens } = require('../auth');
const { normalizeGenres } = require('../utils/genres');

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

// Get profile
router.get('/', profileLimiter, authenticateToken, (req, res) => {
  db.get(
    'SELECT id, username, email, display_name, avatar, is_admin, must_change_password, created_at FROM users WHERE id = ?',
    [req.user.id],
    (err, user) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }
      res.json({
        ...user,
        must_change_password: !!user.must_change_password
      });
    }
  );
});

// Get user listening stats
router.get('/stats', profileLimiter, authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

    // Get all stats in parallel using Promise.all
    const stats = await new Promise((resolve, reject) => {
      const result = {};

      // Total listen time (sum of durations for COMPLETED books only)
      db.get(
        `SELECT COALESCE(SUM(a.duration), 0) as totalListenTime
         FROM playback_progress p
         JOIN audiobooks a ON p.audiobook_id = a.id
         WHERE p.user_id = ? AND p.completed = 1`,
        [userId],
        (err, row) => {
          if (err) return reject(err);
          result.totalListenTime = row.totalListenTime;

          // Books started (any progress)
          db.get(
            `SELECT COUNT(DISTINCT audiobook_id) as booksStarted
             FROM playback_progress WHERE user_id = ? AND position > 0`,
            [userId],
            (err, row) => {
              if (err) return reject(err);
              result.booksStarted = row.booksStarted;

              // Books completed
              db.get(
                `SELECT COUNT(*) as booksCompleted
                 FROM playback_progress WHERE user_id = ? AND completed = 1`,
                [userId],
                (err, row) => {
                  if (err) return reject(err);
                  result.booksCompleted = row.booksCompleted;

                  // Currently listening (in progress, not completed)
                  db.get(
                    `SELECT COUNT(*) as currentlyListening
                     FROM playback_progress WHERE user_id = ? AND position > 0 AND completed = 0`,
                    [userId],
                    (err, row) => {
                      if (err) return reject(err);
                      result.currentlyListening = row.currentlyListening;

                      // Top authors by listen time (sum of durations for COMPLETED books)
                      db.all(
                        `SELECT a.author, SUM(a.duration) as listenTime, COUNT(DISTINCT a.id) as bookCount
                         FROM playback_progress p
                         JOIN audiobooks a ON p.audiobook_id = a.id
                         WHERE p.user_id = ? AND p.completed = 1 AND a.author IS NOT NULL AND a.author != ''
                         GROUP BY a.author
                         ORDER BY listenTime DESC
                         LIMIT 5`,
                        [userId],
                        (err, rows) => {
                          if (err) return reject(err);
                          result.topAuthors = rows || [];

                          // Top genres by listen time (sum of durations for COMPLETED books, normalize genres in JavaScript)
                          db.all(
                            `SELECT a.genre, a.duration, a.id
                             FROM playback_progress p
                             JOIN audiobooks a ON p.audiobook_id = a.id
                             WHERE p.user_id = ? AND p.completed = 1 AND a.genre IS NOT NULL AND a.genre != ''`,
                            [userId],
                            (err, rows) => {
                              if (err) return reject(err);

                              // Normalize genres and aggregate by normalized genre
                              const genreStats = {};
                              for (const row of (rows || [])) {
                                const normalized = normalizeGenres(row.genre);
                                if (normalized) {
                                  // Each normalized genre string may contain multiple categories
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

                              // Convert to array and sort by listen time
                              result.topGenres = Object.values(genreStats)
                                .map(g => ({ genre: g.genre, listenTime: g.listenTime, bookCount: g.bookIds.size }))
                                .sort((a, b) => b.listenTime - a.listenTime)
                                .slice(0, 5);

                              // Recent activity (last 5 books listened to)
                              db.all(
                                `SELECT a.id, a.title, a.author, a.cover_image, p.position, a.duration, p.completed, p.updated_at
                                 FROM playback_progress p
                                 JOIN audiobooks a ON p.audiobook_id = a.id
                                 WHERE p.user_id = ? AND p.position > 0
                                 ORDER BY p.updated_at DESC
                                 LIMIT 5`,
                                [userId],
                                (err, rows) => {
                                  if (err) return reject(err);
                                  result.recentActivity = rows || [];

                                  // Listening streak (days with activity in last 30 days)
                                  db.all(
                                    `SELECT DATE(updated_at) as day
                                     FROM playback_progress
                                     WHERE user_id = ? AND updated_at >= datetime('now', '-30 days')
                                     GROUP BY DATE(updated_at)
                                     ORDER BY day DESC`,
                                    [userId],
                                    (err, rows) => {
                                      if (err) return reject(err);
                                      result.activeDaysLast30 = rows ? rows.length : 0;

                                      // Calculate current streak
                                      let streak = 0;
                                      if (rows && rows.length > 0) {
                                        const today = new Date().toISOString().split('T')[0];
                                        const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];

                                        // Check if first day is today or yesterday
                                        if (rows[0].day === today || rows[0].day === yesterday) {
                                          streak = 1;
                                          for (let i = 1; i < rows.length; i++) {
                                            const prevDate = new Date(rows[i - 1].day);
                                            const currDate = new Date(rows[i].day);
                                            const diff = (prevDate - currDate) / 86400000;
                                            if (diff === 1) {
                                              streak++;
                                            } else {
                                              break;
                                            }
                                          }
                                        }
                                      }
                                      result.currentStreak = streak;

                                      // Average session length
                                      db.get(
                                        `SELECT AVG(position) as avgPosition
                                         FROM playback_progress
                                         WHERE user_id = ? AND position > 60`,
                                        [userId],
                                        (err, row) => {
                                          if (err) return reject(err);
                                          result.avgSessionLength = row?.avgPosition || 0;

                                          resolve(result);
                                        }
                                      );
                                    }
                                  );
                                }
                              );
                            }
                          );
                        }
                      );
                    }
                  );
                }
              );
            }
          );
        }
      );
    });

    res.json(stats);
  } catch (error) {
    console.error('Error fetching user stats:', error);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

// Update profile with multer error handling
router.put('/', profileWriteLimiter, authenticateToken, (req, res) => {
  upload.single('avatar')(req, res, function (err) {
    if (err instanceof multer.MulterError) {
      console.error('[Profile Update] Multer error:', err.message);
      return res.status(400).json({ error: `Upload error: ${err.message}` });
    } else if (err) {
      console.error('[Profile Update] Upload error:', err.message);
      return res.status(400).json({ error: err.message });
    }

    console.log('[Profile Update] req.file:', req.file ? { filename: req.file.filename, path: req.file.path, size: req.file.size } : 'none');
    console.log('[Profile Update] req.body:', req.body);

  const { displayName, email } = req.body;
  const updates = [];
  const params = [];

  if (displayName !== undefined) {
    updates.push('display_name = ?');
    params.push(displayName || null);
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

  db.run(
    `UPDATE users SET ${updates.join(', ')} WHERE id = ?`,
    params,
    function (err) {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      if (this.changes === 0) {
        return res.status(404).json({ error: 'User not found' });
      }
      // Return the updated user object
      db.get(
        'SELECT id, username, email, display_name, avatar, is_admin, must_change_password, created_at FROM users WHERE id = ?',
        [req.user.id],
        (err, user) => {
          if (err) {
            return res.status(500).json({ error: err.message });
          }
          res.json({
            ...user,
            must_change_password: !!user.must_change_password
          });
        }
      );
    }
  );
  }); // End of upload callback
});

// Get avatar (uses media token for img src compatibility)
router.get('/avatar', profileLimiter, authenticateMediaToken, (req, res) => {
  db.get(
    'SELECT avatar FROM users WHERE id = ?',
    [req.user.id],
    (err, user) => {
      if (err || !user || !user.avatar) {
        return res.status(404).json({ error: 'Avatar not found' });
      }

      const avatarPath = path.join(__dirname, '../../data/avatars', user.avatar);

      if (!fs.existsSync(avatarPath)) {
        return res.status(404).json({ error: 'Avatar file not found' });
      }

      res.sendFile(avatarPath);
    }
  );
});

// Delete avatar
router.delete('/avatar', profileWriteLimiter, authenticateToken, (req, res) => {
  db.get('SELECT avatar FROM users WHERE id = ?', [req.user.id], (err, user) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }

    if (user && user.avatar) {
      const avatarPath = path.join(__dirname, '../../data/avatars', user.avatar);
      if (fs.existsSync(avatarPath)) {
        fs.unlinkSync(avatarPath);
      }
    }

    db.run(
      'UPDATE users SET avatar = NULL WHERE id = ?',
      [req.user.id],
      function (err) {
        if (err) {
          return res.status(500).json({ error: err.message });
        }
        res.json({ message: 'Avatar removed successfully' });
      }
    );
  });
});

// Change password
router.put('/password', passwordChangeLimiter, authenticateToken, (req, res) => {
  const { currentPassword, newPassword } = req.body;

  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'Current password and new password are required' });
  }

  // SECURITY: Validate password complexity
  const passwordErrors = validatePassword(newPassword);
  if (passwordErrors.length > 0) {
    return res.status(400).json({ error: passwordErrors.join('. ') });
  }

  // Get user's current password hash
  db.get(
    'SELECT password_hash FROM users WHERE id = ?',
    [req.user.id],
    (err, user) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
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
      db.run(
        'UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?',
        [newPasswordHash, req.user.id],
        function (err) {
          if (err) {
            return res.status(500).json({ error: err.message });
          }

          // SECURITY: Invalidate all existing tokens after password change
          invalidateUserTokens(req.user.id);

          res.json({
            message: 'Password updated successfully. Please log in again on all devices.'
          });
        }
      );
    }
  );
});

module.exports = router;
