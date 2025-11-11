const express = require('express');
const router = express.Router();
const db = require('../database');
const fs = require('fs');
const path = require('path');
const { authenticateToken } = require('../auth');

// Get all audiobooks
router.get('/', authenticateToken, (req, res) => {
  const { genre, author, series, search, limit = 50, offset = 0 } = req.query;
  const userId = req.user.id;

  let query = `SELECT a.*, p.position as progress_position, p.completed as progress_completed
               FROM audiobooks a
               LEFT JOIN playback_progress p ON a.id = p.audiobook_id AND p.user_id = ?
               WHERE 1=1`;
  const params = [userId];

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
    query += ' AND (a.title LIKE ? OR a.author LIKE ? OR a.narrator LIKE ? OR a.series LIKE ?)';
    params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
  }

  query += ' ORDER BY a.title ASC LIMIT ? OFFSET ?';
  params.push(parseInt(limit), parseInt(offset));

  db.all(query, params, (err, audiobooks) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }

    // Transform progress fields into nested object
    const transformedAudiobooks = audiobooks.map(book => ({
      ...book,
      progress: book.progress_position !== null ? {
        position: book.progress_position,
        completed: book.progress_completed
      } : null
    }));
    delete transformedAudiobooks.forEach(b => {
      delete b.progress_position;
      delete b.progress_completed;
    });

    // Get total count
    let countQuery = 'SELECT COUNT(*) as total FROM audiobooks WHERE 1=1';
    const countParams = [];

    if (genre) {
      countQuery += ' AND genre LIKE ?';
      countParams.push(`%${genre}%`);
    }

    if (author) {
      countQuery += ' AND author LIKE ?';
      countParams.push(`%${author}%`);
    }

    if (series) {
      countQuery += ' AND series LIKE ?';
      countParams.push(`%${series}%`);
    }

    if (search) {
      countQuery += ' AND (title LIKE ? OR author LIKE ? OR narrator LIKE ? OR series LIKE ?)';
      countParams.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
    }

    db.get(countQuery, countParams, (err, count) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      res.json({ audiobooks: transformedAudiobooks, total: count.total });
    });
  });
});

// Get single audiobook
router.get('/:id', authenticateToken, (req, res) => {
  db.get('SELECT * FROM audiobooks WHERE id = ?', [req.params.id], (err, audiobook) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    if (!audiobook) {
      return res.status(404).json({ error: 'Audiobook not found' });
    }
    res.json(audiobook);
  });
});

// Get chapters for a multi-file audiobook
router.get('/:id/chapters', authenticateToken, (req, res) => {
  db.all(
    'SELECT * FROM audiobook_chapters WHERE audiobook_id = ? ORDER BY chapter_number ASC',
    [req.params.id],
    (err, chapters) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      res.json(chapters || []);
    }
  );
});

// Stream audiobook
router.get('/:id/stream', authenticateToken, (req, res) => {
  db.get('SELECT * FROM audiobooks WHERE id = ?', [req.params.id], (err, audiobook) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    if (!audiobook) {
      return res.status(404).json({ error: 'Audiobook not found' });
    }

    const filePath = audiobook.file_path;

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Audio file not found' });
    }

    const stat = fs.statSync(filePath);
    const fileSize = stat.size;
    const range = req.headers.range;

    if (range) {
      const parts = range.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunksize = (end - start) + 1;
      const file = fs.createReadStream(filePath, { start, end });
      const head = {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunksize,
        'Content-Type': 'audio/mpeg',
      };
      res.writeHead(206, head);
      file.pipe(res);
    } else {
      const head = {
        'Content-Length': fileSize,
        'Content-Type': 'audio/mpeg',
      };
      res.writeHead(200, head);
      fs.createReadStream(filePath).pipe(res);
    }
  });
});

// Download audiobook
router.get('/:id/download', authenticateToken, (req, res) => {
  db.get('SELECT * FROM audiobooks WHERE id = ?', [req.params.id], (err, audiobook) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    if (!audiobook) {
      return res.status(404).json({ error: 'Audiobook not found' });
    }

    const filePath = audiobook.file_path;

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Audio file not found' });
    }

    const filename = path.basename(filePath);
    res.download(filePath, `${audiobook.title}.${filename.split('.').pop()}`);
  });
});

// Delete audiobook
router.delete('/:id', authenticateToken, (req, res) => {
  db.get('SELECT * FROM audiobooks WHERE id = ?', [req.params.id], (err, audiobook) => {
    if (err) {
      return res.status(500).json({ error: err.message });
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
        return res.status(500).json({ error: err.message });
      }
      res.json({ message: 'Audiobook deleted successfully' });
    });
  });
});

// Update audiobook metadata
router.put('/:id', authenticateToken, (req, res) => {
  const { title, author, narrator, description, genre, series, series_position, published_year } = req.body;

  db.run(
    `UPDATE audiobooks
     SET title = ?, author = ?, narrator = ?, description = ?, genre = ?,
         series = ?, series_position = ?, published_year = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [title, author, narrator, description, genre, series, series_position, published_year, req.params.id],
    function (err) {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      if (this.changes === 0) {
        return res.status(404).json({ error: 'Audiobook not found' });
      }
      res.json({ message: 'Audiobook updated successfully' });
    }
  );
});

// Get/Update playback progress
router.get('/:id/progress', authenticateToken, (req, res) => {
  db.get(
    'SELECT * FROM playback_progress WHERE user_id = ? AND audiobook_id = ?',
    [req.user.id, req.params.id],
    (err, progress) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      res.json(progress || { position: 0, completed: 0 });
    }
  );
});

router.post('/:id/progress', authenticateToken, (req, res) => {
  const { position, completed = 0, state = 'playing', clientInfo = {} } = req.body;
  const audiobookId = req.params.id;
  const userId = req.user.id;

  // Update progress in database
  db.run(
    `INSERT INTO playback_progress (user_id, audiobook_id, position, completed, updated_at)
     VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(user_id, audiobook_id) DO UPDATE SET
       position = excluded.position,
       completed = excluded.completed,
       updated_at = excluded.updated_at`,
    [userId, audiobookId, position, completed],
    (err) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }

      // Update session tracking
      const sessionManager = require('../services/sessionManager');
      const websocketManager = require('../services/websocketManager');

      const sessionId = `sapho-${userId}-${audiobookId}`;

      // Get audiobook details for session tracking
      db.get('SELECT * FROM audiobooks WHERE id = ?', [audiobookId], (err, audiobook) => {
        if (!err && audiobook) {
          const actualState = completed ? 'stopped' : state;

          // If stopped, remove session from active tracking (like Plex/Emby)
          if (actualState === 'stopped' || completed) {
            // Get session before stopping for WebSocket broadcast
            const session = sessionManager.getSession(sessionId);
            if (session) {
              // Broadcast stop event
              websocketManager.broadcastSessionUpdate(session, 'session.stop');
            }
            // Remove from active sessions (so /api/sessions won't return it)
            sessionManager.stopSession(sessionId);
          } else {
            // Update session for playing/paused states
            const session = sessionManager.updateSession({
              sessionId,
              userId,
              username: req.user.username,
              audiobook: audiobook,
              position: parseInt(position),
              state: actualState,
              clientInfo: {
                name: clientInfo.name || 'Web Player',
                platform: clientInfo.platform || 'Web',
                ipAddress: req.ip || req.connection.remoteAddress,
              },
            });

            if (session) {
              // Broadcast to WebSocket clients based on state
              const eventType = actualState === 'playing' ? 'session.update' : 'session.pause';
              websocketManager.broadcastSessionUpdate(session, eventType);
            }
          }
        }
      });

      res.json({ message: 'Progress updated' });
    }
  );
});

// Get cover art
router.get('/:id/cover', authenticateToken, (req, res) => {
  db.get('SELECT cover_image FROM audiobooks WHERE id = ?', [req.params.id], (err, audiobook) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    if (!audiobook || !audiobook.cover_image) {
      return res.status(404).json({ error: 'Cover image not found' });
    }

    const coverPath = audiobook.cover_image;

    if (!fs.existsSync(coverPath)) {
      return res.status(404).json({ error: 'Cover image file not found' });
    }

    res.sendFile(path.resolve(coverPath));
  });
});

// Get all series with cover IDs
router.get('/meta/series', authenticateToken, (req, res) => {
  const userId = req.user.id;

  db.all(
    `SELECT
       a.series,
       COUNT(DISTINCT a.id) as book_count,
       GROUP_CONCAT(DISTINCT a.id ORDER BY a.series_position) as book_ids,
       COUNT(DISTINCT CASE WHEN p.completed = 1 THEN a.id END) as completed_count
     FROM audiobooks a
     LEFT JOIN playback_progress p ON a.id = p.audiobook_id AND p.user_id = ?
     WHERE a.series IS NOT NULL
     GROUP BY a.series
     ORDER BY a.series ASC`,
    [userId],
    (err, series) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      // Convert comma-separated IDs to array and take first 4
      const seriesWithCovers = series.map(s => ({
        ...s,
        cover_ids: s.book_ids ? s.book_ids.split(',').slice(0, 4) : [],
        completed_count: s.completed_count || 0
      }));
      res.json(seriesWithCovers);
    }
  );
});

// Get all authors
router.get('/meta/authors', authenticateToken, (req, res) => {
  db.all(
    `SELECT DISTINCT author, COUNT(*) as book_count
     FROM audiobooks
     WHERE author IS NOT NULL
     GROUP BY author
     ORDER BY author ASC`,
    [],
    (err, authors) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      res.json(authors);
    }
  );
});

// Get recently added audiobooks
router.get('/meta/recent', authenticateToken, (req, res) => {
  const limit = parseInt(req.query.limit) || 10;
  const userId = req.user.id;

  db.all(
    `SELECT a.*, p.position as progress_position, p.completed as progress_completed
     FROM audiobooks a
     LEFT JOIN playback_progress p ON a.id = p.audiobook_id AND p.user_id = ?
     ORDER BY a.created_at DESC
     LIMIT ?`,
    [userId, limit],
    (err, audiobooks) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }

      // Transform progress fields into nested object
      const transformedAudiobooks = audiobooks.map(book => ({
        ...book,
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

// Get in-progress audiobooks (Up Next / Continue Listening)
router.get('/meta/in-progress', authenticateToken, (req, res) => {
  const limit = parseInt(req.query.limit) || 10;

  db.all(
    `SELECT a.*, p.position as progress_position, p.completed as progress_completed, p.updated_at as last_played
     FROM audiobooks a
     INNER JOIN playback_progress p ON a.id = p.audiobook_id
     WHERE p.user_id = ? AND p.completed = 0 AND p.position > 0
     ORDER BY p.updated_at DESC
     LIMIT ?`,
    [req.user.id, limit],
    (err, audiobooks) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }

      // Transform progress fields into nested object
      const transformedAudiobooks = audiobooks.map(book => ({
        ...book,
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

// Get ALL in-progress audiobooks (all users) - for monitoring systems
router.get('/meta/in-progress/all', authenticateToken, (req, res) => {
  const limit = parseInt(req.query.limit) || 100;

  db.all(
    `SELECT a.*, p.position, p.updated_at as last_played, p.user_id
     FROM audiobooks a
     INNER JOIN playback_progress p ON a.id = p.audiobook_id
     WHERE p.completed = 0 AND p.position > 0
     ORDER BY p.updated_at DESC
     LIMIT ?`,
    [limit],
    (err, audiobooks) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      res.json(audiobooks);
    }
  );
});

// Get "up next" books - next book in series after currently listening books
router.get('/meta/up-next', authenticateToken, (req, res) => {
  const limit = parseInt(req.query.limit) || 10;

  db.all(
    `SELECT DISTINCT a.*, p.position as progress_position, p.completed as progress_completed
     FROM audiobooks a
     LEFT JOIN playback_progress p ON a.id = p.audiobook_id AND p.user_id = ?
     WHERE a.series IS NOT NULL AND a.series != ''
     AND a.series_index IS NOT NULL
     AND EXISTS (
       SELECT 1
       FROM audiobooks a2
       INNER JOIN playback_progress p2 ON a2.id = p2.audiobook_id
       WHERE p2.user_id = ?
       AND p2.completed = 0
       AND p2.position > 0
       AND a2.series = a.series
       AND a2.series_index < a.series_index
     )
     AND (p.position IS NULL OR p.position = 0 OR p.completed = 0)
     ORDER BY a.series, a.series_index ASC
     LIMIT ?`,
    [req.user.id, req.user.id, limit],
    (err, audiobooks) => {
      if (err) {
        console.error('Error in up-next query:', err);
        return res.status(500).json({ error: err.message });
      }

      // Transform progress fields into nested object
      const transformedAudiobooks = audiobooks.map(book => ({
        ...book,
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

module.exports = router;
