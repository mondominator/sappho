/**
 * Session Manager - Tracks active playback sessions
 * Similar to how Plex/Emby track active streams
 */
class SessionManager {
  constructor() {
    this.sessions = new Map(); // sessionId -> session data
    this.userSessions = new Map(); // userId -> Set of sessionIds
    this.SESSION_TIMEOUT = 5 * 60 * 1000; // 5 minutes - mark stale if no updates
    this.cleanupInterval = setInterval(() => this.cleanupStaleSessions(), 15 * 1000).unref(); // Check every 15 seconds
  }

  /**
   * Create or update a session
   * Expects full audiobook and user data to be passed in
   */
  updateSession(sessionData) {
    const {
      sessionId,
      userId,
      username,
      audiobook, // Full audiobook object
      position,
      state, // 'playing', 'paused', 'stopped'
      clientInfo, // { name, platform, ipAddress }
    } = sessionData;

    if (!audiobook) {
      console.error('Audiobook data is required for session tracking');
      return null;
    }

    if (!userId || !username) {
      console.error('User ID and username are required for session tracking');
      return null;
    }

    // Get file metadata for codec info
    const fileExt = audiobook.file_path ? audiobook.file_path.split('.').pop().toLowerCase() : 'unknown';
    const audioCodec = this.detectAudioCodec(fileExt);
    const container = fileExt;

    const session = {
      sessionId,
      userId: userId,
      username: username,
      audiobookId: audiobook.id,
      title: audiobook.title,
      author: audiobook.author,
      narrator: audiobook.narrator,
      series: audiobook.series,
      seriesPosition: audiobook.series_position,
      year: audiobook.published_year,
      cover: audiobook.cover_image,
      duration: audiobook.duration,
      position: position || 0,
      progressPercent: audiobook.duration ? Math.round((position / audiobook.duration) * 100) : 0,
      state: state || 'playing',
      lastUpdated: Date.now(),
      // Client info
      clientName: clientInfo?.name || 'Web Player',
      platform: clientInfo?.platform || 'Web',
      ipAddress: clientInfo?.ipAddress || null,
      // Media info
      audioCodec,
      container,
      bitrate: this.estimateBitrate(audiobook.file_size, audiobook.duration),
      transcoding: false, // Sappho doesn't transcode
    };

    this.sessions.set(sessionId, session);

    // Track user sessions
    if (!this.userSessions.has(userId)) {
      this.userSessions.set(userId, new Set());
    }
    this.userSessions.get(userId).add(sessionId);

    return session;
  }

  /**
   * Get a specific session
   */
  getSession(sessionId) {
    return this.sessions.get(sessionId);
  }

  /**
   * Get all active sessions
   * Only returns playing or recently paused sessions (like Plex/Emby)
   * Excludes stopped sessions completely
   */
  getAllSessions() {
    // Only return sessions that are actively playing or recently paused
    // This matches Plex/Emby behavior: when playback stops, session disappears from API
    return Array.from(this.sessions.values()).filter(
      session => session.state === 'playing' || session.state === 'paused'
    );
  }

  /**
   * Get sessions for a specific user
   */
  getUserSessions(userId) {
    const sessionIds = this.userSessions.get(userId) || new Set();
    return Array.from(sessionIds)
      .map(id => this.sessions.get(id))
      .filter(Boolean)
      .filter(session => session.state !== 'stopped');
  }

  /**
   * Stop a session
   */
  stopSession(sessionId) {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.state = 'stopped';
      session.lastUpdated = Date.now();

      // Remove from user sessions
      if (this.userSessions.has(session.userId)) {
        this.userSessions.get(session.userId).delete(sessionId);
      }

      // Remove from sessions map after a delay
      setTimeout(() => this.sessions.delete(sessionId), 30000).unref(); // Keep for 30s for reporting
    }
  }

  /**
   * Clean up stale sessions (no updates for SESSION_TIMEOUT)
   */
  cleanupStaleSessions() {
    const now = Date.now();
    for (const [sessionId, session] of this.sessions.entries()) {
      if (now - session.lastUpdated > this.SESSION_TIMEOUT) {
        console.log(`Cleaning up stale session: ${sessionId} (${session.title})`);
        this.stopSession(sessionId);
      }
    }
  }

  /**
   * Detect audio codec from file extension
   */
  detectAudioCodec(ext) {
    const codecMap = {
      'mp3': 'mp3',
      'm4a': 'aac',
      'm4b': 'aac',
      'aac': 'aac',
      'opus': 'opus',
      'ogg': 'vorbis',
      'flac': 'flac',
      'wav': 'pcm',
      'wma': 'wma',
    };
    return codecMap[ext] || 'unknown';
  }

  /**
   * Estimate bitrate from file size and duration
   */
  estimateBitrate(fileSizeBytes, durationSeconds) {
    if (!fileSizeBytes || !durationSeconds) return null;
    // Convert to kbps
    const bitrateKbps = (fileSizeBytes * 8) / durationSeconds / 1000;
    return Math.round(bitrateKbps);
  }

  /**
   * Shutdown cleanup
   */
  destroy() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
  }
}

// Export singleton instance
const sessionManager = new SessionManager();
module.exports = sessionManager;
