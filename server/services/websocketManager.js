const WebSocket = require('ws');
const url = require('url');
const jwt = require('jsonwebtoken');

// SECURITY: JWT_SECRET is validated at startup in auth.js
// This will throw if auth.js hasn't been loaded first (which is fine - it means misconfiguration)
const JWT_SECRET = process.env.JWT_SECRET;

/**
 * WebSocket Manager - Broadcasts real-time session updates
 * Similar to Plex's WebSocket notifications
 */
class WebSocketManager {
  constructor() {
    this.wss = null;
    this.clients = new Map(); // WebSocket -> { userId, authenticated }
  }

  /**
   * Initialize WebSocket server
   */
  initialize(server) {
    this.wss = new WebSocket.Server({
      server,
      path: '/ws/notifications',
    });

    this.wss.on('connection', (ws, req) => {
      console.log('🔌 New WebSocket connection');

      // Parse token from query string
      const params = url.parse(req.url, true).query;
      const token = params.token;

      if (!token) {
        ws.close(1008, 'Authentication required');
        return;
      }

      // Verify token (JWT or API key)
      this.authenticateClient(ws, token);

      ws.on('close', () => {
        this.clients.delete(ws);
        console.log('🔌 WebSocket connection closed');
      });

      ws.on('error', (error) => {
        console.error('WebSocket error:', error.message);
      });

      // Send initial connection success message
      this.sendToClient(ws, {
        type: 'connected',
        message: 'Successfully connected to Sapho notifications',
      });
    });

    console.log('✅ WebSocket server initialized at /ws/notifications');
  }

  /**
   * Authenticate WebSocket client
   */
  authenticateClient(ws, token) {
    // Try JWT first
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      this.clients.set(ws, {
        userId: decoded.id,
        username: decoded.username,
        authenticated: true,
      });
      console.log(`✅ WebSocket client authenticated (JWT): ${decoded.username}`);
      return;
    } catch (_jwtError) {
      // JWT failed, try API key
    }

    // Try API key authentication
    if (token && token.startsWith('sapho_')) {
      const db = require('../database');
      const crypto = require('crypto');
      const keyHash = crypto.createHash('sha256').update(token).digest('hex');

      try {
        const key = db.get('SELECT * FROM api_keys WHERE key_hash = ? AND is_active = 1', [keyHash]);
        if (key && (!key.expires_at || new Date(key.expires_at) >= new Date())) {
          const user = db.get('SELECT id, username FROM users WHERE id = ?', [key.user_id]);
          if (user) {
            this.clients.set(ws, {
              userId: user.id,
              username: user.username,
              authenticated: true,
            });
            console.log(`✅ WebSocket client authenticated (API Key): ${user.username}`);
            return;
          }
        }
      } catch (error) {
        console.error('API key auth error:', error.message);
      }
    }

    // Authentication failed
    ws.close(1008, 'Invalid authentication token');
  }

  /**
   * Broadcast session update to all connected clients
   */
  broadcastSessionUpdate(session, eventType = 'session.update') {
    const message = {
      type: eventType, // 'session.start', 'session.update', 'session.stop'
      timestamp: new Date().toISOString(),
      session: {
        sessionId: session.sessionId,
        userId: session.userId,
        username: session.username,
        audiobook: {
          id: session.audiobookId,
          title: session.title,
          author: session.author,
          series: session.series,
        },
        playback: {
          state: session.state,
          position: session.position,
          duration: session.duration,
          progressPercent: session.progressPercent,
        },
        client: {
          name: session.clientName,
          platform: session.platform,
        },
      },
    };

    this.broadcast(message);
  }

  /**
   * Broadcast library update (new book, updated book, deleted book)
   */
  broadcastLibraryUpdate(eventType, audiobook) {
    const message = {
      type: eventType, // 'library.add', 'library.update', 'library.delete'
      timestamp: new Date().toISOString(),
      audiobook: audiobook ? {
        id: audiobook.id,
        title: audiobook.title,
        author: audiobook.author,
        series: audiobook.series,
        cover_image: audiobook.cover_image,
      } : null,
    };

    this.broadcast(message);
  }

  /**
   * Broadcast progress update for a specific audiobook
   */
  broadcastProgressUpdate(userId, audiobookId, progress) {
    const message = {
      type: 'progress.update',
      timestamp: new Date().toISOString(),
      userId,
      audiobookId,
      progress: {
        position: progress.position,
        completed: progress.completed,
        state: progress.state,
      },
    };

    this.broadcast(message);
  }

  /**
   * Broadcast job status update
   */
  broadcastJobUpdate(jobName, status, details = {}) {
    const message = {
      type: 'job.update',
      timestamp: new Date().toISOString(),
      job: {
        name: jobName,
        status,
        ...details,
      },
    };

    this.broadcast(message);
  }

  /**
   * Send message to specific client
   */
  sendToClient(ws, message) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  /**
   * Broadcast message to all authenticated clients
   */
  broadcast(message) {
    const payload = JSON.stringify(message);
    let sentCount = 0;

    for (const [ws, clientInfo] of this.clients.entries()) {
      if (clientInfo.authenticated && ws.readyState === WebSocket.OPEN) {
        ws.send(payload);
        sentCount++;
      }
    }

    if (sentCount > 0) {
      console.log(`📡 Broadcasted ${message.type} to ${sentCount} client(s)`);
    }
  }

  /**
   * Get connected client count
   */
  getClientCount() {
    return this.clients.size;
  }

  /**
   * Shutdown
   */
  close() {
    if (this.wss) {
      this.wss.close();
    }
  }
}

// Export singleton instance
const websocketManager = new WebSocketManager();
module.exports = websocketManager;
