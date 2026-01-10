/**
 * Unit tests for SessionManager service
 */

// Create a fresh instance for testing (don't use the singleton)
const SessionManager = require('../../server/services/sessionManager').constructor;

describe('SessionManager', () => {
  let sessionManager;

  beforeEach(() => {
    // Create a fresh instance for each test
    sessionManager = new SessionManager();
  });

  afterEach(() => {
    // Clean up intervals
    sessionManager.destroy();
  });

  describe('updateSession', () => {
    const mockAudiobook = {
      id: 1,
      title: 'Test Audiobook',
      author: 'Test Author',
      narrator: 'Test Narrator',
      series: 'Test Series',
      series_position: 1,
      published_year: 2020,
      cover_image: '/covers/test.jpg',
      duration: 36000, // 10 hours
      file_path: '/audiobooks/test.m4b',
      file_size: 500000000 // 500MB
    };

    test('creates new session with all data', () => {
      const session = sessionManager.updateSession({
        sessionId: 'session-1',
        userId: 1,
        username: 'testuser',
        audiobook: mockAudiobook,
        position: 1800,
        state: 'playing',
        clientInfo: { name: 'Web Player', platform: 'Web', ipAddress: '192.168.1.1' }
      });

      expect(session).not.toBeNull();
      expect(session.sessionId).toBe('session-1');
      expect(session.userId).toBe(1);
      expect(session.username).toBe('testuser');
      expect(session.title).toBe('Test Audiobook');
      expect(session.author).toBe('Test Author');
      expect(session.position).toBe(1800);
      expect(session.state).toBe('playing');
      expect(session.ipAddress).toBe('192.168.1.1');
    });

    test('calculates progress percentage correctly', () => {
      const session = sessionManager.updateSession({
        sessionId: 'session-1',
        userId: 1,
        username: 'testuser',
        audiobook: mockAudiobook,
        position: 18000, // 5 hours into 10 hour book
        state: 'playing'
      });

      expect(session.progressPercent).toBe(50);
    });

    test('returns null if audiobook is missing', () => {
      const session = sessionManager.updateSession({
        sessionId: 'session-1',
        userId: 1,
        username: 'testuser',
        audiobook: null,
        position: 0,
        state: 'playing'
      });

      expect(session).toBeNull();
    });

    test('returns null if user info is missing', () => {
      const session = sessionManager.updateSession({
        sessionId: 'session-1',
        userId: null,
        username: null,
        audiobook: mockAudiobook,
        position: 0,
        state: 'playing'
      });

      expect(session).toBeNull();
    });

    test('updates existing session', () => {
      // Create initial session
      sessionManager.updateSession({
        sessionId: 'session-1',
        userId: 1,
        username: 'testuser',
        audiobook: mockAudiobook,
        position: 1000,
        state: 'playing'
      });

      // Update position
      const updated = sessionManager.updateSession({
        sessionId: 'session-1',
        userId: 1,
        username: 'testuser',
        audiobook: mockAudiobook,
        position: 2000,
        state: 'paused'
      });

      expect(updated.position).toBe(2000);
      expect(updated.state).toBe('paused');
    });

    test('tracks user sessions', () => {
      sessionManager.updateSession({
        sessionId: 'session-1',
        userId: 1,
        username: 'testuser',
        audiobook: mockAudiobook,
        position: 0,
        state: 'playing'
      });

      sessionManager.updateSession({
        sessionId: 'session-2',
        userId: 1,
        username: 'testuser',
        audiobook: { ...mockAudiobook, id: 2, title: 'Another Book' },
        position: 0,
        state: 'playing'
      });

      const userSessions = sessionManager.getUserSessions(1);
      expect(userSessions.length).toBe(2);
    });

    test('defaults position to 0', () => {
      const session = sessionManager.updateSession({
        sessionId: 'session-1',
        userId: 1,
        username: 'testuser',
        audiobook: mockAudiobook,
        state: 'playing'
      });

      expect(session.position).toBe(0);
    });

    test('defaults state to playing', () => {
      const session = sessionManager.updateSession({
        sessionId: 'session-1',
        userId: 1,
        username: 'testuser',
        audiobook: mockAudiobook,
        position: 0
      });

      expect(session.state).toBe('playing');
    });
  });

  describe('getSession', () => {
    test('returns session by ID', () => {
      const mockAudiobook = { id: 1, title: 'Test', duration: 3600, file_path: '/test.m4b' };

      sessionManager.updateSession({
        sessionId: 'session-1',
        userId: 1,
        username: 'testuser',
        audiobook: mockAudiobook,
        position: 0,
        state: 'playing'
      });

      const session = sessionManager.getSession('session-1');
      expect(session).not.toBeNull();
      expect(session.sessionId).toBe('session-1');
    });

    test('returns undefined for non-existent session', () => {
      const session = sessionManager.getSession('non-existent');
      expect(session).toBeUndefined();
    });
  });

  describe('getAllSessions', () => {
    const mockAudiobook = { id: 1, title: 'Test', duration: 3600, file_path: '/test.m4b' };

    test('returns only playing and paused sessions', () => {
      // Playing session
      sessionManager.updateSession({
        sessionId: 'session-1',
        userId: 1,
        username: 'user1',
        audiobook: mockAudiobook,
        position: 0,
        state: 'playing'
      });

      // Paused session
      sessionManager.updateSession({
        sessionId: 'session-2',
        userId: 2,
        username: 'user2',
        audiobook: mockAudiobook,
        position: 0,
        state: 'paused'
      });

      // Stopped session
      sessionManager.updateSession({
        sessionId: 'session-3',
        userId: 3,
        username: 'user3',
        audiobook: mockAudiobook,
        position: 0,
        state: 'stopped'
      });

      const sessions = sessionManager.getAllSessions();
      expect(sessions.length).toBe(2);
      expect(sessions.every(s => s.state !== 'stopped')).toBe(true);
    });

    test('returns empty array when no sessions', () => {
      const sessions = sessionManager.getAllSessions();
      expect(sessions).toEqual([]);
    });
  });

  describe('getUserSessions', () => {
    const mockAudiobook = { id: 1, title: 'Test', duration: 3600, file_path: '/test.m4b' };

    test('returns sessions for specific user', () => {
      sessionManager.updateSession({
        sessionId: 'session-1',
        userId: 1,
        username: 'user1',
        audiobook: mockAudiobook,
        position: 0,
        state: 'playing'
      });

      sessionManager.updateSession({
        sessionId: 'session-2',
        userId: 2,
        username: 'user2',
        audiobook: mockAudiobook,
        position: 0,
        state: 'playing'
      });

      const user1Sessions = sessionManager.getUserSessions(1);
      expect(user1Sessions.length).toBe(1);
      expect(user1Sessions[0].userId).toBe(1);
    });

    test('excludes stopped sessions', () => {
      sessionManager.updateSession({
        sessionId: 'session-1',
        userId: 1,
        username: 'user1',
        audiobook: mockAudiobook,
        position: 0,
        state: 'playing'
      });

      sessionManager.stopSession('session-1');

      const sessions = sessionManager.getUserSessions(1);
      expect(sessions.length).toBe(0);
    });

    test('returns empty array for user with no sessions', () => {
      const sessions = sessionManager.getUserSessions(999);
      expect(sessions).toEqual([]);
    });
  });

  describe('stopSession', () => {
    const mockAudiobook = { id: 1, title: 'Test', duration: 3600, file_path: '/test.m4b' };

    test('marks session as stopped', () => {
      sessionManager.updateSession({
        sessionId: 'session-1',
        userId: 1,
        username: 'testuser',
        audiobook: mockAudiobook,
        position: 0,
        state: 'playing'
      });

      sessionManager.stopSession('session-1');

      const session = sessionManager.getSession('session-1');
      expect(session.state).toBe('stopped');
    });

    test('removes session from user sessions', () => {
      sessionManager.updateSession({
        sessionId: 'session-1',
        userId: 1,
        username: 'testuser',
        audiobook: mockAudiobook,
        position: 0,
        state: 'playing'
      });

      sessionManager.stopSession('session-1');

      const userSessions = sessionManager.getUserSessions(1);
      expect(userSessions.length).toBe(0);
    });

    test('handles non-existent session gracefully', () => {
      // Should not throw
      expect(() => sessionManager.stopSession('non-existent')).not.toThrow();
    });
  });

  describe('detectAudioCodec', () => {
    test('detects MP3 codec', () => {
      expect(sessionManager.detectAudioCodec('mp3')).toBe('mp3');
    });

    test('detects AAC codec for M4B/M4A', () => {
      expect(sessionManager.detectAudioCodec('m4b')).toBe('aac');
      expect(sessionManager.detectAudioCodec('m4a')).toBe('aac');
      expect(sessionManager.detectAudioCodec('aac')).toBe('aac');
    });

    test('detects Opus codec', () => {
      expect(sessionManager.detectAudioCodec('opus')).toBe('opus');
    });

    test('detects Vorbis codec for OGG', () => {
      expect(sessionManager.detectAudioCodec('ogg')).toBe('vorbis');
    });

    test('detects FLAC codec', () => {
      expect(sessionManager.detectAudioCodec('flac')).toBe('flac');
    });

    test('detects PCM codec for WAV', () => {
      expect(sessionManager.detectAudioCodec('wav')).toBe('pcm');
    });

    test('returns unknown for unrecognized extension', () => {
      expect(sessionManager.detectAudioCodec('xyz')).toBe('unknown');
      expect(sessionManager.detectAudioCodec('')).toBe('unknown');
    });
  });

  describe('estimateBitrate', () => {
    test('calculates bitrate correctly', () => {
      // 100MB file, 1 hour duration
      // (100 * 1024 * 1024 * 8) / 3600 / 1000 = ~233 kbps
      const bitrate = sessionManager.estimateBitrate(100 * 1024 * 1024, 3600);
      expect(bitrate).toBeCloseTo(233, 0);
    });

    test('returns null for missing file size', () => {
      expect(sessionManager.estimateBitrate(null, 3600)).toBeNull();
      expect(sessionManager.estimateBitrate(0, 3600)).toBeNull();
    });

    test('returns null for missing duration', () => {
      expect(sessionManager.estimateBitrate(1000000, null)).toBeNull();
      expect(sessionManager.estimateBitrate(1000000, 0)).toBeNull();
    });

    test('returns rounded integer', () => {
      const bitrate = sessionManager.estimateBitrate(50000000, 3600);
      expect(Number.isInteger(bitrate)).toBe(true);
    });
  });

  describe('destroy', () => {
    test('clears cleanup interval', () => {
      const clearIntervalSpy = jest.spyOn(global, 'clearInterval');
      sessionManager.destroy();
      expect(clearIntervalSpy).toHaveBeenCalled();
      clearIntervalSpy.mockRestore();
    });
  });
});
