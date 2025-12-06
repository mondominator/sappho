const express = require('express');
const router = express.Router();
const db = require('../database');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const { authenticateToken, validatePassword, invalidateUserTokens } = require('../auth');

// Configure multer for avatar upload
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = path.join(__dirname, '../../data/avatars');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname);
    cb(null, `user-${req.user.id}${ext}`);
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
router.get('/', authenticateToken, (req, res) => {
  db.get(
    'SELECT id, username, email, display_name, avatar, is_admin, created_at FROM users WHERE id = ?',
    [req.user.id],
    (err, user) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }
      res.json(user);
    }
  );
});

// Get user listening stats
router.get('/stats', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

    // Get all stats in parallel using Promise.all
    const stats = await new Promise((resolve, reject) => {
      const result = {};

      // Total listen time (sum of all positions)
      db.get(
        `SELECT COALESCE(SUM(position), 0) as totalListenTime
         FROM playback_progress WHERE user_id = ?`,
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

                      // Top authors by listen time
                      db.all(
                        `SELECT a.author, SUM(p.position) as listenTime, COUNT(DISTINCT a.id) as bookCount
                         FROM playback_progress p
                         JOIN audiobooks a ON p.audiobook_id = a.id
                         WHERE p.user_id = ? AND a.author IS NOT NULL AND a.author != ''
                         GROUP BY a.author
                         ORDER BY listenTime DESC
                         LIMIT 5`,
                        [userId],
                        (err, rows) => {
                          if (err) return reject(err);
                          result.topAuthors = rows || [];

                          // Top genres by listen time
                          db.all(
                            `SELECT a.genre, SUM(p.position) as listenTime, COUNT(DISTINCT a.id) as bookCount
                             FROM playback_progress p
                             JOIN audiobooks a ON p.audiobook_id = a.id
                             WHERE p.user_id = ? AND a.genre IS NOT NULL AND a.genre != ''
                             GROUP BY a.genre
                             ORDER BY listenTime DESC
                             LIMIT 5`,
                            [userId],
                            (err, rows) => {
                              if (err) return reject(err);
                              result.topGenres = rows || [];

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

// Update profile
router.put('/', authenticateToken, upload.single('avatar'), (req, res) => {
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
      res.json({ message: 'Profile updated successfully' });
    }
  );
});

// Get avatar
router.get('/avatar', authenticateToken, (req, res) => {
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
router.delete('/avatar', authenticateToken, (req, res) => {
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
router.put('/password', authenticateToken, (req, res) => {
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
