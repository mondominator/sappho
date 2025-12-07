const express = require('express');
const router = express.Router();
const { db } = require('../database');
const { authenticateToken } = require('../auth');

// Get all collections for current user
router.get('/', authenticateToken, (req, res) => {
  db.all(
    `SELECT c.*,
            COUNT(ci.id) as book_count,
            (SELECT a.cover_image FROM collection_items ci2
             JOIN audiobooks a ON ci2.audiobook_id = a.id
             WHERE ci2.collection_id = c.id
             ORDER BY ci2.position ASC LIMIT 1) as first_cover
     FROM user_collections c
     LEFT JOIN collection_items ci ON c.id = ci.collection_id
     WHERE c.user_id = ?
     GROUP BY c.id
     ORDER BY c.updated_at DESC`,
    [req.user.id],
    (err, collections) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      res.json(collections || []);
    }
  );
});

// Create a new collection
router.post('/', authenticateToken, (req, res) => {
  const { name, description } = req.body;

  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Collection name is required' });
  }

  db.run(
    'INSERT INTO user_collections (user_id, name, description) VALUES (?, ?, ?)',
    [req.user.id, name.trim(), description || null],
    function(err) {
      if (err) {
        return res.status(500).json({ error: err.message });
      }

      db.get(
        'SELECT * FROM user_collections WHERE id = ?',
        [this.lastID],
        (err, collection) => {
          if (err) {
            return res.status(500).json({ error: err.message });
          }
          res.status(201).json(collection);
        }
      );
    }
  );
});

// Get a single collection with its books
router.get('/:id', authenticateToken, (req, res) => {
  const collectionId = req.params.id;

  // First get the collection
  db.get(
    'SELECT * FROM user_collections WHERE id = ? AND user_id = ?',
    [collectionId, req.user.id],
    (err, collection) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      if (!collection) {
        return res.status(404).json({ error: 'Collection not found' });
      }

      // Then get the books in this collection
      db.all(
        `SELECT a.*, ci.position, ci.added_at,
                pp.position as progress_position, pp.completed as progress_completed
         FROM collection_items ci
         JOIN audiobooks a ON ci.audiobook_id = a.id
         LEFT JOIN playback_progress pp ON a.id = pp.audiobook_id AND pp.user_id = ?
         WHERE ci.collection_id = ?
         ORDER BY ci.position ASC`,
        [req.user.id, collectionId],
        (err, books) => {
          if (err) {
            return res.status(500).json({ error: err.message });
          }
          res.json({
            ...collection,
            books: books || []
          });
        }
      );
    }
  );
});

// Update a collection
router.put('/:id', authenticateToken, (req, res) => {
  const collectionId = req.params.id;
  const { name, description } = req.body;

  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Collection name is required' });
  }

  db.run(
    `UPDATE user_collections
     SET name = ?, description = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND user_id = ?`,
    [name.trim(), description || null, collectionId, req.user.id],
    function(err) {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      if (this.changes === 0) {
        return res.status(404).json({ error: 'Collection not found' });
      }

      db.get(
        'SELECT * FROM user_collections WHERE id = ?',
        [collectionId],
        (err, collection) => {
          if (err) {
            return res.status(500).json({ error: err.message });
          }
          res.json(collection);
        }
      );
    }
  );
});

// Delete a collection
router.delete('/:id', authenticateToken, (req, res) => {
  const collectionId = req.params.id;

  db.run(
    'DELETE FROM user_collections WHERE id = ? AND user_id = ?',
    [collectionId, req.user.id],
    function(err) {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      if (this.changes === 0) {
        return res.status(404).json({ error: 'Collection not found' });
      }
      res.json({ success: true });
    }
  );
});

// Add a book to a collection
router.post('/:id/items', authenticateToken, (req, res) => {
  const collectionId = req.params.id;
  const { audiobook_id } = req.body;

  if (!audiobook_id) {
    return res.status(400).json({ error: 'audiobook_id is required' });
  }

  // Verify collection belongs to user
  db.get(
    'SELECT id FROM user_collections WHERE id = ? AND user_id = ?',
    [collectionId, req.user.id],
    (err, collection) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      if (!collection) {
        return res.status(404).json({ error: 'Collection not found' });
      }

      // Get the next position
      db.get(
        'SELECT COALESCE(MAX(position), -1) + 1 as next_position FROM collection_items WHERE collection_id = ?',
        [collectionId],
        (err, result) => {
          if (err) {
            return res.status(500).json({ error: err.message });
          }

          db.run(
            'INSERT INTO collection_items (collection_id, audiobook_id, position) VALUES (?, ?, ?)',
            [collectionId, audiobook_id, result.next_position],
            function(err) {
              if (err) {
                if (err.message.includes('UNIQUE constraint')) {
                  return res.status(409).json({ error: 'Book already in collection' });
                }
                return res.status(500).json({ error: err.message });
              }

              // Update collection's updated_at
              db.run(
                'UPDATE user_collections SET updated_at = CURRENT_TIMESTAMP WHERE id = ?',
                [collectionId]
              );

              res.status(201).json({ success: true, id: this.lastID });
            }
          );
        }
      );
    }
  );
});

// Remove a book from a collection
router.delete('/:id/items/:bookId', authenticateToken, (req, res) => {
  const { id: collectionId, bookId } = req.params;

  // Verify collection belongs to user
  db.get(
    'SELECT id FROM user_collections WHERE id = ? AND user_id = ?',
    [collectionId, req.user.id],
    (err, collection) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      if (!collection) {
        return res.status(404).json({ error: 'Collection not found' });
      }

      db.run(
        'DELETE FROM collection_items WHERE collection_id = ? AND audiobook_id = ?',
        [collectionId, bookId],
        function(err) {
          if (err) {
            return res.status(500).json({ error: err.message });
          }
          if (this.changes === 0) {
            return res.status(404).json({ error: 'Book not in collection' });
          }

          // Update collection's updated_at
          db.run(
            'UPDATE user_collections SET updated_at = CURRENT_TIMESTAMP WHERE id = ?',
            [collectionId]
          );

          res.json({ success: true });
        }
      );
    }
  );
});

// Reorder books in a collection
router.put('/:id/items/reorder', authenticateToken, (req, res) => {
  const collectionId = req.params.id;
  const { order } = req.body; // Array of audiobook_ids in new order

  if (!Array.isArray(order)) {
    return res.status(400).json({ error: 'order must be an array of audiobook IDs' });
  }

  // Verify collection belongs to user
  db.get(
    'SELECT id FROM user_collections WHERE id = ? AND user_id = ?',
    [collectionId, req.user.id],
    (err, collection) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      if (!collection) {
        return res.status(404).json({ error: 'Collection not found' });
      }

      // Update positions
      const updates = order.map((audiobookId, index) => {
        return new Promise((resolve, reject) => {
          db.run(
            'UPDATE collection_items SET position = ? WHERE collection_id = ? AND audiobook_id = ?',
            [index, collectionId, audiobookId],
            (err) => {
              if (err) reject(err);
              else resolve();
            }
          );
        });
      });

      Promise.all(updates)
        .then(() => {
          // Update collection's updated_at
          db.run(
            'UPDATE user_collections SET updated_at = CURRENT_TIMESTAMP WHERE id = ?',
            [collectionId]
          );
          res.json({ success: true });
        })
        .catch(err => {
          res.status(500).json({ error: err.message });
        });
    }
  );
});

// Get collections that contain a specific book
router.get('/for-book/:bookId', authenticateToken, (req, res) => {
  const bookId = req.params.bookId;

  db.all(
    `SELECT c.id, c.name,
            CASE WHEN ci.audiobook_id IS NOT NULL THEN 1 ELSE 0 END as contains_book
     FROM user_collections c
     LEFT JOIN collection_items ci ON c.id = ci.collection_id AND ci.audiobook_id = ?
     WHERE c.user_id = ?
     ORDER BY c.name ASC`,
    [bookId, req.user.id],
    (err, collections) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      res.json(collections || []);
    }
  );
});

module.exports = router;
