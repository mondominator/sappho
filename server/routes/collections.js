const express = require('express');
const router = express.Router();
const { db } = require('../database');
const { authenticateToken } = require('../auth');

// Get all collections for current user (private + all public)
router.get('/', authenticateToken, (req, res) => {
  db.all(
    `SELECT c.*,
            u.username as creator_username,
            COUNT(ci.id) as book_count,
            (SELECT a.cover_image FROM collection_items ci2
             JOIN audiobooks a ON ci2.audiobook_id = a.id
             WHERE ci2.collection_id = c.id
             ORDER BY ci2.position ASC LIMIT 1) as first_cover,
            CASE WHEN c.user_id = ? THEN 1 ELSE 0 END as is_owner
     FROM user_collections c
     LEFT JOIN collection_items ci ON c.id = ci.collection_id
     LEFT JOIN users u ON c.user_id = u.id
     WHERE c.user_id = ? OR c.is_public = 1
     GROUP BY c.id
     ORDER BY c.updated_at DESC`,
    [req.user.id, req.user.id],
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
  const { name, description, is_public } = req.body;

  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Collection name is required' });
  }

  db.run(
    'INSERT INTO user_collections (user_id, name, description, is_public) VALUES (?, ?, ?, ?)',
    [req.user.id, name.trim(), description || null, is_public ? 1 : 0],
    function(err) {
      if (err) {
        return res.status(500).json({ error: err.message });
      }

      db.get(
        `SELECT c.*, u.username as creator_username,
                CASE WHEN c.user_id = ? THEN 1 ELSE 0 END as is_owner
         FROM user_collections c
         LEFT JOIN users u ON c.user_id = u.id
         WHERE c.id = ?`,
        [req.user.id, this.lastID],
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

// Get collections that contain a specific book (user's private + public)
// NOTE: This route MUST be before /:id to avoid "for-book" being matched as an ID
router.get('/for-book/:bookId', authenticateToken, (req, res) => {
  const bookId = req.params.bookId;

  db.all(
    `SELECT c.id, c.name, c.is_public, c.user_id, u.username as creator_username,
            CASE WHEN ci.audiobook_id IS NOT NULL THEN 1 ELSE 0 END as contains_book,
            CASE WHEN c.user_id = ? THEN 1 ELSE 0 END as is_owner
     FROM user_collections c
     LEFT JOIN collection_items ci ON c.id = ci.collection_id AND ci.audiobook_id = ?
     LEFT JOIN users u ON c.user_id = u.id
     WHERE c.user_id = ? OR c.is_public = 1
     ORDER BY c.name ASC`,
    [req.user.id, bookId, req.user.id],
    (err, collections) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      res.json(collections || []);
    }
  );
});

// Get a single collection with its books
router.get('/:id', authenticateToken, (req, res) => {
  const collectionId = req.params.id;

  // Get collection if user owns it OR it's public
  db.get(
    `SELECT c.*, u.username as creator_username,
            CASE WHEN c.user_id = ? THEN 1 ELSE 0 END as is_owner
     FROM user_collections c
     LEFT JOIN users u ON c.user_id = u.id
     WHERE c.id = ? AND (c.user_id = ? OR c.is_public = 1)`,
    [req.user.id, collectionId, req.user.id],
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

// Update a collection (name, description, visibility)
router.put('/:id', authenticateToken, (req, res) => {
  const collectionId = req.params.id;
  const { name, description, is_public } = req.body;

  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Collection name is required' });
  }

  // Only the owner can update a collection
  db.run(
    `UPDATE user_collections
     SET name = ?, description = ?, is_public = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND user_id = ?`,
    [name.trim(), description || null, is_public ? 1 : 0, collectionId, req.user.id],
    function(err) {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      if (this.changes === 0) {
        return res.status(404).json({ error: 'Collection not found or not owned by you' });
      }

      db.get(
        `SELECT c.*, u.username as creator_username,
                CASE WHEN c.user_id = ? THEN 1 ELSE 0 END as is_owner
         FROM user_collections c
         LEFT JOIN users u ON c.user_id = u.id
         WHERE c.id = ?`,
        [req.user.id, collectionId],
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

// Delete a collection (owner only)
router.delete('/:id', authenticateToken, (req, res) => {
  const collectionId = req.params.id;

  // Only the owner can delete a collection
  db.run(
    'DELETE FROM user_collections WHERE id = ? AND user_id = ?',
    [collectionId, req.user.id],
    function(err) {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      if (this.changes === 0) {
        return res.status(404).json({ error: 'Collection not found or not owned by you' });
      }
      res.json({ success: true });
    }
  );
});

// Helper to check if user can edit collection (owner OR public collection)
const canEditCollection = (collectionId, userId, callback) => {
  db.get(
    'SELECT id, user_id, is_public FROM user_collections WHERE id = ?',
    [collectionId],
    (err, collection) => {
      if (err) {
        callback(err, null);
        return;
      }
      if (!collection) {
        callback(null, { allowed: false, reason: 'Collection not found' });
        return;
      }
      // Can edit if owner OR if collection is public
      const allowed = collection.user_id === userId || collection.is_public === 1;
      callback(null, { allowed, collection });
    }
  );
};

// Add a book to a collection (owner or anyone for public collections)
router.post('/:id/items', authenticateToken, (req, res) => {
  const collectionId = req.params.id;
  const { audiobook_id } = req.body;

  if (!audiobook_id) {
    return res.status(400).json({ error: 'audiobook_id is required' });
  }

  canEditCollection(collectionId, req.user.id, (err, result) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    if (!result.allowed) {
      return res.status(404).json({ error: result.reason || 'Collection not found' });
    }

    // Get the next position
    db.get(
      'SELECT COALESCE(MAX(position), -1) + 1 as next_position FROM collection_items WHERE collection_id = ?',
      [collectionId],
      (err, posResult) => {
        if (err) {
          return res.status(500).json({ error: err.message });
        }

        db.run(
          'INSERT INTO collection_items (collection_id, audiobook_id, position) VALUES (?, ?, ?)',
          [collectionId, audiobook_id, posResult.next_position],
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
  });
});

// Remove a book from a collection (owner or anyone for public collections)
router.delete('/:id/items/:bookId', authenticateToken, (req, res) => {
  const { id: collectionId, bookId } = req.params;

  canEditCollection(collectionId, req.user.id, (err, result) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    if (!result.allowed) {
      return res.status(404).json({ error: result.reason || 'Collection not found' });
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
  });
});

// Reorder books in a collection (owner or anyone for public collections)
router.put('/:id/items/reorder', authenticateToken, (req, res) => {
  const collectionId = req.params.id;
  const { order } = req.body; // Array of audiobook_ids in new order

  if (!Array.isArray(order)) {
    return res.status(400).json({ error: 'order must be an array of audiobook IDs' });
  }

  canEditCollection(collectionId, req.user.id, (err, result) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    if (!result.allowed) {
      return res.status(404).json({ error: result.reason || 'Collection not found' });
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
  });
});

module.exports = router;
