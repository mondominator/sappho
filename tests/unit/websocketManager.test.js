/**
 * Unit tests for WebSocket Manager
 */

// Get the class constructor for testing
const WebSocketManager = require('../../server/services/websocketManager').constructor;

describe('WebSocketManager', () => {
  let wsManager;

  beforeEach(() => {
    wsManager = new WebSocketManager();
  });

  afterEach(() => {
    wsManager.close();
  });

  describe('constructor', () => {
    test('initializes with null wss', () => {
      expect(wsManager.wss).toBeNull();
    });

    test('initializes with empty clients map', () => {
      expect(wsManager.clients).toBeInstanceOf(Map);
      expect(wsManager.clients.size).toBe(0);
    });
  });

  describe('broadcastSessionUpdate', () => {
    test('creates correctly structured session message', () => {
      const mockSession = {
        sessionId: 'session-123',
        userId: 1,
        username: 'testuser',
        audiobookId: 42,
        title: 'Test Audiobook',
        author: 'Test Author',
        series: 'Test Series',
        cover: '/cover.jpg',
        state: 'playing',
        position: 1800,
        duration: 36000,
        progressPercent: 5,
        clientName: 'Web Player',
        platform: 'Web'
      };

      // Spy on broadcast method
      const broadcastSpy = jest.spyOn(wsManager, 'broadcast').mockImplementation(() => {});

      wsManager.broadcastSessionUpdate(mockSession, 'session.update');

      expect(broadcastSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'session.update',
          timestamp: expect.any(String),
          session: expect.objectContaining({
            sessionId: 'session-123',
            userId: 1,
            username: 'testuser',
            audiobook: expect.objectContaining({
              id: 42,
              title: 'Test Audiobook',
              author: 'Test Author'
            }),
            playback: expect.objectContaining({
              state: 'playing',
              position: 1800,
              progressPercent: 5
            }),
            client: expect.objectContaining({
              name: 'Web Player',
              platform: 'Web'
            })
          })
        })
      );

      broadcastSpy.mockRestore();
    });

    test('defaults eventType to session.update', () => {
      const mockSession = {
        sessionId: 'session-123',
        userId: 1,
        username: 'testuser',
        audiobookId: 42,
        title: 'Test',
        state: 'playing'
      };

      const broadcastSpy = jest.spyOn(wsManager, 'broadcast').mockImplementation(() => {});

      wsManager.broadcastSessionUpdate(mockSession);

      expect(broadcastSpy).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'session.update' })
      );

      broadcastSpy.mockRestore();
    });
  });

  describe('broadcastLibraryUpdate', () => {
    test('creates correctly structured library message', () => {
      const mockAudiobook = {
        id: 1,
        title: 'New Book',
        author: 'Author Name',
        series: 'Series Name',
        cover_image: '/cover.jpg'
      };

      const broadcastSpy = jest.spyOn(wsManager, 'broadcast').mockImplementation(() => {});

      wsManager.broadcastLibraryUpdate('library.add', mockAudiobook);

      expect(broadcastSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'library.add',
          timestamp: expect.any(String),
          audiobook: expect.objectContaining({
            id: 1,
            title: 'New Book',
            author: 'Author Name',
            series: 'Series Name',
            cover_image: '/cover.jpg'
          })
        })
      );

      broadcastSpy.mockRestore();
    });

    test('handles null audiobook for delete events', () => {
      const broadcastSpy = jest.spyOn(wsManager, 'broadcast').mockImplementation(() => {});

      wsManager.broadcastLibraryUpdate('library.delete', null);

      expect(broadcastSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'library.delete',
          audiobook: null
        })
      );

      broadcastSpy.mockRestore();
    });
  });

  describe('broadcastProgressUpdate', () => {
    test('creates correctly structured progress message', () => {
      const progress = {
        position: 3600,
        completed: false,
        state: 'playing'
      };

      const broadcastSpy = jest.spyOn(wsManager, 'broadcast').mockImplementation(() => {});

      wsManager.broadcastProgressUpdate(1, 42, progress);

      expect(broadcastSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'progress.update',
          timestamp: expect.any(String),
          userId: 1,
          audiobookId: 42,
          progress: expect.objectContaining({
            position: 3600,
            completed: false,
            state: 'playing'
          })
        })
      );

      broadcastSpy.mockRestore();
    });
  });

  describe('broadcastJobUpdate', () => {
    test('creates correctly structured job message', () => {
      const broadcastSpy = jest.spyOn(wsManager, 'broadcast').mockImplementation(() => {});

      wsManager.broadcastJobUpdate('library-scan', 'completed', { booksAdded: 5 });

      expect(broadcastSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'job.update',
          timestamp: expect.any(String),
          job: expect.objectContaining({
            name: 'library-scan',
            status: 'completed',
            booksAdded: 5
          })
        })
      );

      broadcastSpy.mockRestore();
    });

    test('works without extra details', () => {
      const broadcastSpy = jest.spyOn(wsManager, 'broadcast').mockImplementation(() => {});

      wsManager.broadcastJobUpdate('backup', 'started');

      expect(broadcastSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          job: expect.objectContaining({
            name: 'backup',
            status: 'started'
          })
        })
      );

      broadcastSpy.mockRestore();
    });
  });

  describe('getClientCount', () => {
    test('returns 0 for no clients', () => {
      expect(wsManager.getClientCount()).toBe(0);
    });

    test('returns correct count when clients connected', () => {
      // Simulate clients
      wsManager.clients.set({}, { authenticated: true });
      wsManager.clients.set({}, { authenticated: true });

      expect(wsManager.getClientCount()).toBe(2);
    });
  });

  describe('sendToClient', () => {
    test('sends JSON message to open WebSocket', () => {
      const mockWs = {
        readyState: 1, // WebSocket.OPEN
        send: jest.fn()
      };

      const message = { type: 'test', data: 'hello' };
      wsManager.sendToClient(mockWs, message);

      expect(mockWs.send).toHaveBeenCalledWith(JSON.stringify(message));
    });

    test('does not send to closed WebSocket', () => {
      const mockWs = {
        readyState: 3, // WebSocket.CLOSED
        send: jest.fn()
      };

      wsManager.sendToClient(mockWs, { type: 'test' });

      expect(mockWs.send).not.toHaveBeenCalled();
    });
  });

  describe('broadcast', () => {
    test('sends to all authenticated open clients', () => {
      const mockWs1 = { readyState: 1, send: jest.fn() };
      const mockWs2 = { readyState: 1, send: jest.fn() };
      const mockWs3 = { readyState: 3, send: jest.fn() }; // Closed

      wsManager.clients.set(mockWs1, { authenticated: true });
      wsManager.clients.set(mockWs2, { authenticated: true });
      wsManager.clients.set(mockWs3, { authenticated: true });

      const message = { type: 'test' };
      wsManager.broadcast(message);

      expect(mockWs1.send).toHaveBeenCalledWith(JSON.stringify(message));
      expect(mockWs2.send).toHaveBeenCalledWith(JSON.stringify(message));
      expect(mockWs3.send).not.toHaveBeenCalled();
    });

    test('skips unauthenticated clients', () => {
      const mockWs1 = { readyState: 1, send: jest.fn() };
      const mockWs2 = { readyState: 1, send: jest.fn() };

      wsManager.clients.set(mockWs1, { authenticated: true });
      wsManager.clients.set(mockWs2, { authenticated: false });

      wsManager.broadcast({ type: 'test' });

      expect(mockWs1.send).toHaveBeenCalled();
      expect(mockWs2.send).not.toHaveBeenCalled();
    });
  });

  describe('message structure', () => {
    test('all messages have timestamp in ISO format', () => {
      const broadcastSpy = jest.spyOn(wsManager, 'broadcast').mockImplementation(() => {});

      wsManager.broadcastSessionUpdate({ sessionId: '1', userId: 1, username: 'test' });

      const call = broadcastSpy.mock.calls[0][0];
      expect(call.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);

      broadcastSpy.mockRestore();
    });
  });
});
