const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../auth');
const db = require('../database');

// Get current user's rating for an audiobook
router.get('/audiobook/:audiobookId', authenticateToken, (req, res) => {
  const { audiobookId } = req.params;

  db.get(
    'SELECT * FROM user_ratings WHERE user_id = ? AND audiobook_id = ?',
    [req.user.id, audiobookId],
    (err, rating) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      res.json(rating || null);
    }
  );
});

// Get all ratings for an audiobook (for displaying average)
router.get('/audiobook/:audiobookId/all', authenticateToken, (req, res) => {
  const { audiobookId } = req.params;

  db.all(
    `SELECT ur.*, u.username, u.display_name
     FROM user_ratings ur
     JOIN users u ON ur.user_id = u.id
     WHERE ur.audiobook_id = ?
     ORDER BY ur.updated_at DESC`,
    [audiobookId],
    (err, ratings) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      res.json(ratings || []);
    }
  );
});

// Get average rating for an audiobook
router.get('/audiobook/:audiobookId/average', authenticateToken, (req, res) => {
  const { audiobookId } = req.params;

  db.get(
    `SELECT
       AVG(rating) as average_rating,
       COUNT(*) as rating_count
     FROM user_ratings
     WHERE audiobook_id = ? AND rating IS NOT NULL`,
    [audiobookId],
    (err, result) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      res.json({
        average: result.average_rating ? Math.round(result.average_rating * 10) / 10 : null,
        count: result.rating_count || 0
      });
    }
  );
});

// Set or update rating/review for an audiobook
router.post('/audiobook/:audiobookId', authenticateToken, (req, res) => {
  const { audiobookId } = req.params;
  const { rating, review } = req.body;

  // Validate rating if provided
  if (rating !== undefined && rating !== null) {
    const ratingNum = parseInt(rating);
    if (isNaN(ratingNum) || ratingNum < 1 || ratingNum > 5) {
      return res.status(400).json({ error: 'Rating must be between 1 and 5' });
    }
  }

  // Check if rating already exists
  db.get(
    'SELECT id FROM user_ratings WHERE user_id = ? AND audiobook_id = ?',
    [req.user.id, audiobookId],
    (err, existing) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }

      if (existing) {
        // Update existing rating
        db.run(
          `UPDATE user_ratings
           SET rating = ?, review = ?, updated_at = CURRENT_TIMESTAMP
           WHERE user_id = ? AND audiobook_id = ?`,
          [rating || null, review || null, req.user.id, audiobookId],
          function(err) {
            if (err) {
              return res.status(500).json({ error: err.message });
            }

            db.get(
              'SELECT * FROM user_ratings WHERE id = ?',
              [existing.id],
              (err, updated) => {
                if (err) {
                  return res.status(500).json({ error: err.message });
                }
                res.json(updated);
              }
            );
          }
        );
      } else {
        // Create new rating
        db.run(
          'INSERT INTO user_ratings (user_id, audiobook_id, rating, review) VALUES (?, ?, ?, ?)',
          [req.user.id, audiobookId, rating || null, review || null],
          function(err) {
            if (err) {
              return res.status(500).json({ error: err.message });
            }

            db.get(
              'SELECT * FROM user_ratings WHERE id = ?',
              [this.lastID],
              (err, created) => {
                if (err) {
                  return res.status(500).json({ error: err.message });
                }
                res.status(201).json(created);
              }
            );
          }
        );
      }
    }
  );
});

// Delete rating/review for an audiobook
router.delete('/audiobook/:audiobookId', authenticateToken, (req, res) => {
  const { audiobookId } = req.params;

  db.run(
    'DELETE FROM user_ratings WHERE user_id = ? AND audiobook_id = ?',
    [req.user.id, audiobookId],
    function(err) {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      if (this.changes === 0) {
        return res.status(404).json({ error: 'Rating not found' });
      }
      res.json({ success: true });
    }
  );
});

// Get all ratings by current user
router.get('/my-ratings', authenticateToken, (req, res) => {
  db.all(
    `SELECT ur.*, a.title, a.author, a.cover_image
     FROM user_ratings ur
     JOIN audiobooks a ON ur.audiobook_id = a.id
     WHERE ur.user_id = ?
     ORDER BY ur.updated_at DESC`,
    [req.user.id],
    (err, ratings) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      res.json(ratings || []);
    }
  );
});

module.exports = router;
