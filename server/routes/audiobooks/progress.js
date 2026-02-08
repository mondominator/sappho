/**
 * Audiobook progress route handlers
 * Handles playback progress: get, update, clear, and previous book status
 */
const { getOrCreateSessionId, clearSessionId, getClientIP, activeSessionIds } = require('./helpers');

function register(router, { db, authenticateToken, activityService }) {
  /**
   * Queue the next book in a series when the current book is finished.
   * This makes the next book appear at the top of "Continue Listening".
   */
  function queueNextInSeries(userId, finishedAudiobookId) {
    // Get the finished audiobook's series info
    db.get(
      'SELECT series, series_position, series_index FROM audiobooks WHERE id = ?',
      [finishedAudiobookId],
      (err, finishedBook) => {
        if (err || !finishedBook || !finishedBook.series) {
          return; // No series, nothing to queue
        }

        const currentPosition = finishedBook.series_position || finishedBook.series_index || 0;

        // Find the next unfinished book in the series
        db.get(
          `SELECT a.id, a.title FROM audiobooks a
           LEFT JOIN playback_progress p ON a.id = p.audiobook_id AND p.user_id = ?
           WHERE a.series = ?
             AND COALESCE(a.series_position, a.series_index, 0) > ?
             AND (a.is_available = 1 OR a.is_available IS NULL)
             AND (p.completed IS NULL OR p.completed = 0)
           ORDER BY COALESCE(a.series_position, a.series_index, 0) ASC
           LIMIT 1`,
          [userId, finishedBook.series, currentPosition],
          (err, nextBook) => {
            if (err || !nextBook) {
              return; // No next book found
            }

            // Queue the next book by setting queued_at
            db.run(
              `INSERT INTO playback_progress (user_id, audiobook_id, position, completed, queued_at, updated_at)
               VALUES (?, ?, 0, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
               ON CONFLICT(user_id, audiobook_id) DO UPDATE SET
                 queued_at = CURRENT_TIMESTAMP,
                 updated_at = CURRENT_TIMESTAMP`,
              [userId, nextBook.id],
              (err) => {
                if (!err) {
                  console.log(`Queued next book in series: "${nextBook.title}" for user ${userId}`);
                }
              }
            );
          }
        );
      }
    );
  }

  // Get/Update playback progress
  router.get('/:id/progress', authenticateToken, (req, res) => {
    db.get(
      'SELECT * FROM playback_progress WHERE user_id = ? AND audiobook_id = ?',
      [req.user.id, req.params.id],
      (err, progress) => {
        if (err) {
          return res.status(500).json({ error: 'Internal server error' });
        }
        res.json(progress || { position: 0, completed: 0 });
      }
    );
  });

  router.post('/:id/progress', authenticateToken, (req, res) => {
    const { position, completed = 0, state = 'playing', clientInfo = {} } = req.body;
    const audiobookId = req.params.id;
    const userId = req.user.id;

    // Don't save progress until user has listened for at least 5 seconds
    // (unless marking as completed). This prevents tiny accidental progress.
    if (position < 5 && !completed) {
      return res.json({ success: true, skipped: true, message: 'Progress not saved until 5 seconds' });
    }

    // Update progress in database
    // Clear queued_at when user starts playing (position > 0), so it's no longer marked as "up next"
    db.run(
      `INSERT INTO playback_progress (user_id, audiobook_id, position, completed, updated_at)
       VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(user_id, audiobook_id) DO UPDATE SET
         position = excluded.position,
         completed = excluded.completed,
         updated_at = excluded.updated_at,
         queued_at = CASE WHEN excluded.position > 0 THEN NULL ELSE queued_at END`,
      [userId, audiobookId, position, completed],
      (err) => {
        if (err) {
          return res.status(500).json({ error: 'Internal server error' });
        }

        // If book was marked as completed, queue the next book in the series
        if (completed) {
          queueNextInSeries(userId, audiobookId);
          // Record activity for finished book
          activityService.recordActivity(
            userId,
            activityService.EVENT_TYPES.FINISHED_BOOK,
            parseInt(audiobookId)
          ).catch(err => console.error('Failed to record finish activity:', err));
        }

        // Update session tracking
        const sessionManager = require('../../services/sessionManager');
        const websocketManager = require('../../services/websocketManager');

        // SECURITY: Use random session ID instead of predictable pattern
        const sessionId = getOrCreateSessionId(userId, audiobookId);

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
              // Clear the session ID mapping
              clearSessionId(userId, audiobookId);
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
                  ipAddress: getClientIP(req),
                },
              });

              if (session) {
                // Broadcast to WebSocket clients based on state
                const eventType = actualState === 'playing' ? 'session.update' : 'session.pause';
                websocketManager.broadcastSessionUpdate(session, eventType);
              }
            }

            // Broadcast progress update for cross-device sync (so other devices refresh their UI)
            websocketManager.broadcastProgressUpdate(userId, audiobookId, {
              position: parseInt(position),
              completed: completed,
              state: actualState,
            });
          }
        });

        res.json({ message: 'Progress updated' });
      }
    );
  });

  // Clear/delete playback progress (removes the record entirely)
  router.delete('/:id/progress', authenticateToken, (req, res) => {
    const audiobookId = req.params.id;
    const userId = req.user.id;

    db.run(
      'DELETE FROM playback_progress WHERE user_id = ? AND audiobook_id = ?',
      [userId, audiobookId],
      function(err) {
        if (err) {
          return res.status(500).json({ error: 'Internal server error' });
        }

        // Also stop any active session
        const sessionManager = require('../../services/sessionManager');
        const websocketManager = require('../../services/websocketManager');
        // SECURITY: Use the tracked session ID, not a predictable one
        const sessionKey = `${userId}-${audiobookId}`;
        const sessionId = activeSessionIds.get(sessionKey);

        if (sessionId) {
          const session = sessionManager.getSession(sessionId);
          if (session) {
            websocketManager.broadcastSessionUpdate(session, 'session.stop');
            sessionManager.stopSession(sessionId);
          }
          clearSessionId(userId, audiobookId);
        }

        res.json({ message: 'Progress cleared' });
      }
    );
  });

  // Check if the immediately previous book in a series is completed
  // Returns { previousBookCompleted: boolean, previousBook: { id, title, series_position } | null }
  router.get('/:id/previous-book-status', authenticateToken, async (req, res) => {
    const audiobookId = parseInt(req.params.id);
    const userId = req.user.id;

    try {
      // Get the current book's series and position
      const currentBook = await new Promise((resolve, reject) => {
        db.get(
          'SELECT id, series, series_position FROM audiobooks WHERE id = ?',
          [audiobookId],
          (err, row) => {
            if (err) reject(err);
            else resolve(row);
          }
        );
      });

      if (!currentBook) {
        return res.status(404).json({ error: 'Audiobook not found' });
      }

      // If book is not in a series or has no position, no previous book
      if (!currentBook.series || !currentBook.series_position) {
        return res.json({ previousBookCompleted: false, previousBook: null });
      }

      const currentPosition = currentBook.series_position;

      // Find the immediately previous book in the series (the one with the highest position less than current)
      const previousBook = await new Promise((resolve, reject) => {
        db.get(
          `SELECT a.id, a.title, a.series_position, COALESCE(p.completed, 0) as completed
           FROM audiobooks a
           LEFT JOIN playback_progress p ON a.id = p.audiobook_id AND p.user_id = ?
           WHERE a.series = ? AND a.series_position < ?
           ORDER BY a.series_position DESC
           LIMIT 1`,
          [userId, currentBook.series, currentPosition],
          (err, row) => {
            if (err) reject(err);
            else resolve(row);
          }
        );
      });

      if (!previousBook) {
        // No previous book in series (this is book 1 or first with a position)
        return res.json({ previousBookCompleted: false, previousBook: null });
      }

      res.json({
        previousBookCompleted: previousBook.completed === 1,
        previousBook: {
          id: previousBook.id,
          title: previousBook.title,
          series_position: previousBook.series_position
        }
      });

    } catch (error) {
      console.error('Error checking previous book status:', error);
      res.status(500).json({ error: 'Failed to check previous book status' });
    }
  });
}

module.exports = { register };
