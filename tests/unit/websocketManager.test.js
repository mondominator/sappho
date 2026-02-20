/**
 * Unit tests for WebSocket Manager
 */

// Set up JWT_SECRET before requiring websocketManager
process.env.JWT_SECRET = 'test-secret-key-at-least-32-characters-long';

// Mock database before requiring websocketManager
jest.mock('../../server/database', () => ({
  get: jest.fn()
}));

// Mock auth module before requiring websocketManager
const mockIsTokenBlacklisted = jest.fn().mockReturnValue(false);
const mockIsUserTokenInvalidated = jest.fn().mockReturnValue(false);
jest.mock('../../server/auth', () => ({
  isTokenBlacklisted: mockIsTokenBlacklisted,
  isUserTokenInvalidated: mockIsUserTokenInvalidated,
}));

// Get the class constructor for testing
const WebSocketManager = require('../../server/services/websocketManager').constructor;
const jwt = require('jsonwebtoken');
const db = require('../../server/database');

describe('WebSocketManager', () => {
  let wsManager;

  beforeEach(() => {
    jest.clearAllMocks();
    mockIsTokenBlacklisted.mockReturnValue(false);
    mockIsUserTokenInvalidated.mockReturnValue(false);
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

  describe('initialize', () => {
    test('creates WebSocket server and sets up connection handler', () => {
      // Create a mock HTTP server
      const mockServer = {};

      // Create mock WebSocket.Server that captures the connection handler
      let connectionHandler = null;
      const mockWss = {
        on: jest.fn((event, handler) => {
          if (event === 'connection') {
            connectionHandler = handler;
          }
        }),
        close: jest.fn()
      };

      // Mock the WebSocket module
      const WebSocket = require('ws');
      const originalServer = WebSocket.Server;
      WebSocket.Server = jest.fn().mockImplementation(() => mockWss);

      const testManager = new WebSocketManager();
      testManager.initialize(mockServer);

      expect(WebSocket.Server).toHaveBeenCalledWith({
        server: mockServer,
        path: '/ws/notifications'
      });
      expect(mockWss.on).toHaveBeenCalledWith('connection', expect.any(Function));
      expect(testManager.wss).toBe(mockWss);

      // Restore
      WebSocket.Server = originalServer;
      testManager.close();
    });

    test('closes connection when no token provided', () => {
      const mockServer = {};
      let connectionHandler = null;
      const mockWss = {
        on: jest.fn((event, handler) => {
          if (event === 'connection') connectionHandler = handler;
        }),
        close: jest.fn()
      };

      const WebSocket = require('ws');
      const originalServer = WebSocket.Server;
      WebSocket.Server = jest.fn().mockImplementation(() => mockWss);

      const testManager = new WebSocketManager();
      testManager.initialize(mockServer);

      // Simulate a connection without token
      const mockWs = {
        close: jest.fn(),
        on: jest.fn()
      };
      const mockReq = { url: '/ws/notifications' };

      connectionHandler(mockWs, mockReq);

      expect(mockWs.close).toHaveBeenCalledWith(1008, 'Authentication required');

      WebSocket.Server = originalServer;
      testManager.close();
    });

    test('authenticates and sets up handlers when token provided', () => {
      const mockServer = {};
      let connectionHandler = null;
      const mockWss = {
        on: jest.fn((event, handler) => {
          if (event === 'connection') connectionHandler = handler;
        }),
        close: jest.fn()
      };

      const WebSocket = require('ws');
      const originalServer = WebSocket.Server;
      WebSocket.Server = jest.fn().mockImplementation(() => mockWss);

      // Mock DB for user lookup during JWT auth
      db.get.mockImplementation((sql, params, callback) => {
        callback(null, { id: 1, username: 'testuser', account_disabled: 0 });
      });

      const testManager = new WebSocketManager();
      testManager.initialize(mockServer);

      // Create valid token
      const validToken = jwt.sign({ id: 1, username: 'testuser' }, process.env.JWT_SECRET, { expiresIn: '1h' });

      // Simulate a connection with token
      const mockWs = {
        readyState: 1,
        close: jest.fn(),
        on: jest.fn(),
        send: jest.fn()
      };
      const mockReq = { url: `/ws/notifications?token=${validToken}` };

      connectionHandler(mockWs, mockReq);

      // Should set up close and error handlers
      expect(mockWs.on).toHaveBeenCalledWith('close', expect.any(Function));
      expect(mockWs.on).toHaveBeenCalledWith('error', expect.any(Function));

      // Should send connection message after auth completes
      expect(mockWs.send).toHaveBeenCalledWith(
        expect.stringContaining('connected')
      );

      WebSocket.Server = originalServer;
      testManager.close();
    });

    test('removes client on close event', () => {
      const mockServer = {};
      let connectionHandler = null;
      const mockWss = {
        on: jest.fn((event, handler) => {
          if (event === 'connection') connectionHandler = handler;
        }),
        close: jest.fn()
      };

      const WebSocket = require('ws');
      const originalServer = WebSocket.Server;
      WebSocket.Server = jest.fn().mockImplementation(() => mockWss);

      // Mock DB for user lookup during JWT auth
      db.get.mockImplementation((sql, params, callback) => {
        callback(null, { id: 1, username: 'testuser', account_disabled: 0 });
      });

      const testManager = new WebSocketManager();
      testManager.initialize(mockServer);

      const validToken = jwt.sign({ id: 1, username: 'testuser' }, process.env.JWT_SECRET, { expiresIn: '1h' });

      let closeHandler = null;
      const mockWs = {
        readyState: 1,
        close: jest.fn(),
        on: jest.fn((event, handler) => {
          if (event === 'close') closeHandler = handler;
        }),
        send: jest.fn()
      };
      const mockReq = { url: `/ws/notifications?token=${validToken}` };

      connectionHandler(mockWs, mockReq);
      expect(testManager.clients.has(mockWs)).toBe(true);

      // Trigger close handler
      closeHandler();
      expect(testManager.clients.has(mockWs)).toBe(false);

      WebSocket.Server = originalServer;
      testManager.close();
    });

    test('handles error event gracefully', () => {
      const mockServer = {};
      let connectionHandler = null;
      const mockWss = {
        on: jest.fn((event, handler) => {
          if (event === 'connection') connectionHandler = handler;
        }),
        close: jest.fn()
      };

      const WebSocket = require('ws');
      const originalServer = WebSocket.Server;
      WebSocket.Server = jest.fn().mockImplementation(() => mockWss);

      // Mock DB for user lookup during JWT auth
      db.get.mockImplementation((sql, params, callback) => {
        callback(null, { id: 1, username: 'testuser', account_disabled: 0 });
      });

      const testManager = new WebSocketManager();
      testManager.initialize(mockServer);

      const validToken = jwt.sign({ id: 1, username: 'testuser' }, process.env.JWT_SECRET, { expiresIn: '1h' });

      let errorHandler = null;
      const mockWs = {
        readyState: 1,
        close: jest.fn(),
        on: jest.fn((event, handler) => {
          if (event === 'error') errorHandler = handler;
        }),
        send: jest.fn()
      };
      const mockReq = { url: `/ws/notifications?token=${validToken}` };

      connectionHandler(mockWs, mockReq);

      // Trigger error handler - should not throw
      expect(() => errorHandler(new Error('Test error'))).not.toThrow();

      WebSocket.Server = originalServer;
      testManager.close();
    });
  });

  describe('authenticateClient', () => {
    test('authenticates valid JWT token after DB check', () => {
      const mockWs = {
        readyState: 1,
        send: jest.fn(),
        close: jest.fn()
      };

      // Mock DB to return active user
      db.get.mockImplementation((sql, params, callback) => {
        callback(null, { id: 1, username: 'testuser', account_disabled: 0 });
      });

      const validToken = jwt.sign(
        { id: 1, username: 'testuser' },
        process.env.JWT_SECRET,
        { expiresIn: '1h' }
      );

      wsManager.authenticateClient(mockWs, validToken);

      expect(wsManager.clients.has(mockWs)).toBe(true);
      const clientInfo = wsManager.clients.get(mockWs);
      expect(clientInfo.authenticated).toBe(true);
      expect(clientInfo.userId).toBe(1);
      expect(clientInfo.username).toBe('testuser');
      expect(mockWs.close).not.toHaveBeenCalled();
      // Should send connected message after auth
      expect(mockWs.send).toHaveBeenCalledWith(expect.stringContaining('connected'));
    });

    test('rejects blacklisted JWT token', () => {
      const mockWs = {
        readyState: 1,
        send: jest.fn(),
        close: jest.fn()
      };

      mockIsTokenBlacklisted.mockReturnValue(true);

      const validToken = jwt.sign(
        { id: 1, username: 'testuser' },
        process.env.JWT_SECRET,
        { expiresIn: '1h' }
      );

      wsManager.authenticateClient(mockWs, validToken);

      expect(mockWs.close).toHaveBeenCalledWith(1008, 'Token has been revoked');
      expect(wsManager.clients.has(mockWs)).toBe(false);
    });

    test('rejects JWT when user tokens have been invalidated', () => {
      const mockWs = {
        readyState: 1,
        send: jest.fn(),
        close: jest.fn()
      };

      mockIsUserTokenInvalidated.mockReturnValue(true);

      const validToken = jwt.sign(
        { id: 1, username: 'testuser' },
        process.env.JWT_SECRET,
        { expiresIn: '1h' }
      );

      wsManager.authenticateClient(mockWs, validToken);

      expect(mockWs.close).toHaveBeenCalledWith(1008, 'Token has been invalidated');
      expect(wsManager.clients.has(mockWs)).toBe(false);
    });

    test('rejects JWT when user account is disabled', () => {
      const mockWs = {
        readyState: 1,
        send: jest.fn(),
        close: jest.fn()
      };

      db.get.mockImplementation((sql, params, callback) => {
        callback(null, { id: 1, username: 'testuser', account_disabled: 1 });
      });

      const validToken = jwt.sign(
        { id: 1, username: 'testuser' },
        process.env.JWT_SECRET,
        { expiresIn: '1h' }
      );

      wsManager.authenticateClient(mockWs, validToken);

      expect(mockWs.close).toHaveBeenCalledWith(1008, 'Account is disabled');
      expect(wsManager.clients.has(mockWs)).toBe(false);
    });

    test('rejects JWT when user not found in DB', () => {
      const mockWs = {
        readyState: 1,
        send: jest.fn(),
        close: jest.fn()
      };

      db.get.mockImplementation((sql, params, callback) => {
        callback(null, null);
      });

      const validToken = jwt.sign(
        { id: 999, username: 'deleteduser' },
        process.env.JWT_SECRET,
        { expiresIn: '1h' }
      );

      wsManager.authenticateClient(mockWs, validToken);

      expect(mockWs.close).toHaveBeenCalledWith(1008, 'User not found');
    });

    test('closes connection for invalid JWT token', () => {
      const mockWs = {
        readyState: 1,
        send: jest.fn(),
        close: jest.fn()
      };

      wsManager.authenticateClient(mockWs, 'invalid-token');

      expect(mockWs.close).toHaveBeenCalledWith(1008, 'Invalid authentication token');
    });

    test('closes connection for expired JWT token', () => {
      const mockWs = {
        readyState: 1,
        send: jest.fn(),
        close: jest.fn()
      };

      const expiredToken = jwt.sign(
        { id: 1, username: 'testuser' },
        process.env.JWT_SECRET,
        { expiresIn: '-1s' }
      );

      wsManager.authenticateClient(mockWs, expiredToken);

      expect(mockWs.close).toHaveBeenCalledWith(1008, 'Invalid authentication token');
    });

    test('attempts API key auth when JWT fails and token starts with sapho_', () => {
      const mockWs = {
        readyState: 1,
        send: jest.fn(),
        close: jest.fn()
      };

      // Mock db.get with callback - key not found
      db.get.mockImplementation((sql, params, callback) => {
        callback(null, null);
      });

      wsManager.authenticateClient(mockWs, 'sapho_test_api_key');

      // Should close because API key lookup returns null
      expect(mockWs.close).toHaveBeenCalledWith(1008, 'Invalid or expired API key');
    });

    test('authenticates valid API key', () => {
      const mockWs = {
        readyState: 1,
        send: jest.fn(),
        close: jest.fn()
      };

      // Mock db.get with callbacks - first call returns key, second returns user
      let callCount = 0;
      db.get.mockImplementation((sql, params, callback) => {
        callCount++;
        if (callCount === 1) {
          callback(null, { id: 1, user_id: 1, is_active: 1, expires_at: null });
        } else {
          callback(null, { id: 1, username: 'apiuser', account_disabled: 0 });
        }
      });

      wsManager.authenticateClient(mockWs, 'sapho_valid_api_key');

      expect(wsManager.clients.has(mockWs)).toBe(true);
      const clientInfo = wsManager.clients.get(mockWs);
      expect(clientInfo.authenticated).toBe(true);
      expect(clientInfo.username).toBe('apiuser');
      expect(mockWs.close).not.toHaveBeenCalled();
      // Should send connected message after auth
      expect(mockWs.send).toHaveBeenCalledWith(expect.stringContaining('connected'));
    });

    test('rejects API key when user account is disabled', () => {
      const mockWs = {
        readyState: 1,
        send: jest.fn(),
        close: jest.fn()
      };

      let callCount = 0;
      db.get.mockImplementation((sql, params, callback) => {
        callCount++;
        if (callCount === 1) {
          callback(null, { id: 1, user_id: 1, is_active: 1, expires_at: null });
        } else {
          callback(null, { id: 1, username: 'disableduser', account_disabled: 1 });
        }
      });

      wsManager.authenticateClient(mockWs, 'sapho_disabled_user_key');

      expect(mockWs.close).toHaveBeenCalledWith(1008, 'Account is disabled');
      expect(wsManager.clients.has(mockWs)).toBe(false);
    });

    test('rejects expired API key', () => {
      const mockWs = {
        readyState: 1,
        send: jest.fn(),
        close: jest.fn()
      };

      // Mock db.get with callback - return expired API key
      db.get.mockImplementation((sql, params, callback) => {
        callback(null, {
          id: 1,
          user_id: 1,
          is_active: 1,
          expires_at: '2020-01-01T00:00:00Z' // Expired
        });
      });

      wsManager.authenticateClient(mockWs, 'sapho_expired_api_key');

      expect(mockWs.close).toHaveBeenCalledWith(1008, 'Invalid or expired API key');
    });

    test('handles API key lookup errors gracefully', () => {
      const mockWs = {
        readyState: 1,
        send: jest.fn(),
        close: jest.fn()
      };

      // Mock db.get with callback - return error
      db.get.mockImplementation((sql, params, callback) => {
        callback(new Error('Database connection failed'), null);
      });

      wsManager.authenticateClient(mockWs, 'sapho_error_key');

      expect(mockWs.close).toHaveBeenCalledWith(1008, 'Authentication error');
    });
  });

  describe('close', () => {
    test('closes WebSocket server when initialized', () => {
      const mockWss = {
        close: jest.fn()
      };
      wsManager.wss = mockWss;

      wsManager.close();

      expect(mockWss.close).toHaveBeenCalled();
    });

    test('handles close when wss is null', () => {
      wsManager.wss = null;

      // Should not throw
      expect(() => wsManager.close()).not.toThrow();
    });
  });
});
