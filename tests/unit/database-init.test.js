/**
 * Unit tests for database.js initialization and error paths
 * Uses jest.isolateModules() because database.js has top-level side effects
 *
 * Key insight: sqlite3.Database() returns the db object synchronously, then calls
 * its callback asynchronously. Our mock must replicate this: return mockDb from
 * the constructor immediately, then invoke the callback via process.nextTick.
 */

// Save original env
const originalEnv = { ...process.env };

beforeEach(() => {
  process.env = { ...originalEnv };
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = 'test-secret-for-jest-testing-only';
  process.env.DATABASE_PATH = ':memory:';
  jest.restoreAllMocks();
});

afterEach(() => {
  process.env = originalEnv;
});

/**
 * Helper: create a mock sqlite3 Database object and a Database constructor.
 * The constructor returns mockDb immediately and fires the callback on nextTick,
 * matching real sqlite3 behavior where `const db = new Database(...)` assigns `db`
 * before the callback runs.
 */
function createMockSetup({ openErr = null, allHandler, runHandler } = {}) {
  const mockDb = {
    run: runHandler || jest.fn((sql, ...args) => {
      const cb = args.find(a => typeof a === 'function');
      if (cb) cb(null);
    }),
    get: jest.fn((sql, params, cb) => {
      if (cb) cb(null, null);
    }),
    all: allHandler || jest.fn((sql, ...args) => {
      const cb = args.find(a => typeof a === 'function');
      if (cb) cb(null, []);
    }),
    serialize: jest.fn((fn) => { if (fn) fn(); }),
    close: jest.fn((cb) => { if (cb) cb(null); }),
  };

  const DatabaseConstructor = jest.fn(function(_path, cb) {
    // Schedule callback on nextTick so `const db = new Database(...)` assigns first
    if (cb) process.nextTick(() => cb(openErr));
    return mockDb;
  });

  return { mockDb, DatabaseConstructor };
}

/** Standard fs mock that says everything exists */
function mockFsExists() {
  return {
    existsSync: jest.fn().mockReturnValue(true),
    mkdirSync: jest.fn(),
    readdirSync: jest.fn().mockReturnValue([]),
    renameSync: jest.fn(),
  };
}


/** Create a mock logger that captures all log calls */
function createMockLogger() {
  return {
    fatal: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
    trace: jest.fn(),
    child: jest.fn().mockReturnThis(),
  };
}
/** allHandler that returns full columns for users and audiobooks (no ALTER needed) */
function allColumnsPresent() {
  return jest.fn((sql, ...args) => {
    const cb = args.find(a => typeof a === 'function');
    if (!cb) return;
    if (sql.includes('table_info(users)')) {
      cb(null, [{ name: 'id' }, { name: 'username' }, { name: 'display_name' }, { name: 'avatar' }]);
    } else if (sql.includes('table_info(audiobooks)')) {
      cb(null, [{ name: 'id' }, { name: 'series_index' }]);
    } else {
      cb(null, []);
    }
  });
}

/**
 * Helper to require database.js with mocks and wait for async initialization.
 * Returns the exported db object after all nextTick callbacks have resolved.
 */
function requireDatabaseWithMocks(fsMock, mockDb, DatabaseConstructor, mockLogger) {
  jest.doMock('fs', () => fsMock);
  jest.doMock('sqlite3', () => ({
    verbose: () => ({ Database: DatabaseConstructor }),
  }));
  if (mockLogger) {
    jest.doMock('../../server/utils/logger', () => mockLogger);
  }

  const db = require('../../server/database');

  // Return a promise that resolves after the nextTick callback chain completes
  return new Promise((resolve) => {
    // Give enough ticks for the initialization chain to complete
    setImmediate(() => setImmediate(() => resolve(db)));
  });
}

describe('Database Initialization - Error Paths', () => {
  describe('Directory creation', () => {
    it('creates data directory if it does not exist', async () => {
      await jest.isolateModulesAsync(async () => {
        const fsMock = {
          existsSync: jest.fn().mockReturnValue(false),
          mkdirSync: jest.fn(),
          readdirSync: jest.fn().mockReturnValue([]),
          renameSync: jest.fn(),
        };
        const { mockDb, DatabaseConstructor } = createMockSetup({
          allHandler: allColumnsPresent(),
        });

        await requireDatabaseWithMocks(fsMock, mockDb, DatabaseConstructor);
        expect(fsMock.mkdirSync).toHaveBeenCalled();
      });
    });

    it('handles directory creation failure', async () => {
      await jest.isolateModulesAsync(async () => {
        const fsMock = {
          existsSync: jest.fn().mockReturnValue(false),
          mkdirSync: jest.fn().mockImplementation(() => {
            throw new Error('EACCES: permission denied');
          }),
          readdirSync: jest.fn().mockReturnValue([]),
          renameSync: jest.fn(),
        };
        const { mockDb, DatabaseConstructor } = createMockSetup();

        jest.doMock('fs', () => fsMock);
        jest.doMock('sqlite3', () => ({
          verbose: () => ({ Database: DatabaseConstructor }),
        }));

        expect(() => {
          require('../../server/database');
        }).toThrow('EACCES: permission denied');
      });
    });
  });

  describe('Legacy database migration', () => {
    it('renames legacy sapho.db to sappho.db when found', async () => {
      await jest.isolateModulesAsync(async () => {
        delete process.env.DATABASE_PATH;

        const mockRenameSync = jest.fn();
        const fsMock = {
          existsSync: jest.fn().mockImplementation((p) => {
            if (p.endsWith('sappho.db')) return false;
            if (p.endsWith('sapho.db')) return true;
            return false;
          }),
          mkdirSync: jest.fn(),
          renameSync: mockRenameSync,
          readdirSync: jest.fn().mockReturnValue([]),
        };
        const { mockDb, DatabaseConstructor } = createMockSetup({
          allHandler: allColumnsPresent(),
        });

        await requireDatabaseWithMocks(fsMock, mockDb, DatabaseConstructor);
        expect(mockRenameSync).toHaveBeenCalled();
      });
    });

    it('handles legacy rename failure gracefully', async () => {
      await jest.isolateModulesAsync(async () => {
        delete process.env.DATABASE_PATH;

        const mockLogger = createMockLogger();
        const fsMock = {
          existsSync: jest.fn().mockImplementation((p) => {
            if (p.endsWith('sappho.db')) return false;
            if (p.endsWith('sapho.db')) return true;
            return false;
          }),
          mkdirSync: jest.fn(),
          renameSync: jest.fn().mockImplementation(() => {
            throw new Error('Rename failed');
          }),
          readdirSync: jest.fn().mockReturnValue([]),
        };
        const { mockDb, DatabaseConstructor } = createMockSetup({
          allHandler: allColumnsPresent(),
        });

        await requireDatabaseWithMocks(fsMock, mockDb, DatabaseConstructor, mockLogger);
        expect(mockLogger.error).toHaveBeenCalledWith(
          expect.objectContaining({ err: expect.any(Error) }),
          'Legacy database migration failed'
        );
      });
    });

    it('skips legacy migration when DATABASE_PATH env is set', async () => {
      await jest.isolateModulesAsync(async () => {
        process.env.DATABASE_PATH = '/custom/path/sappho.db';

        const mockRenameSync = jest.fn();
        const fsMock = {
          existsSync: jest.fn().mockReturnValue(true),
          mkdirSync: jest.fn(),
          renameSync: mockRenameSync,
          readdirSync: jest.fn().mockReturnValue([]),
        };
        const { mockDb, DatabaseConstructor } = createMockSetup({
          allHandler: allColumnsPresent(),
        });

        await requireDatabaseWithMocks(fsMock, mockDb, DatabaseConstructor);
        expect(mockRenameSync).not.toHaveBeenCalled();
      });
    });

    it('skips legacy migration when both files exist', async () => {
      await jest.isolateModulesAsync(async () => {
        delete process.env.DATABASE_PATH;

        const mockRenameSync = jest.fn();
        const fsMock = {
          existsSync: jest.fn().mockReturnValue(true),
          mkdirSync: jest.fn(),
          renameSync: mockRenameSync,
          readdirSync: jest.fn().mockReturnValue([]),
        };
        const { mockDb, DatabaseConstructor } = createMockSetup({
          allHandler: allColumnsPresent(),
        });

        await requireDatabaseWithMocks(fsMock, mockDb, DatabaseConstructor);
        expect(mockRenameSync).not.toHaveBeenCalled();
      });
    });

    it('skips legacy migration when neither file exists', async () => {
      await jest.isolateModulesAsync(async () => {
        delete process.env.DATABASE_PATH;

        const mockRenameSync = jest.fn();
        const fsMock = {
          existsSync: jest.fn().mockReturnValue(false),
          mkdirSync: jest.fn(),
          renameSync: mockRenameSync,
          readdirSync: jest.fn().mockReturnValue([]),
        };
        const { mockDb, DatabaseConstructor } = createMockSetup({
          allHandler: allColumnsPresent(),
        });

        await requireDatabaseWithMocks(fsMock, mockDb, DatabaseConstructor);
        expect(mockRenameSync).not.toHaveBeenCalled();
      });
    });
  });

  describe('Database connection', () => {
    it('handles sqlite3 Database constructor error', async () => {
      await jest.isolateModulesAsync(async () => {
        const mockLogger = createMockLogger();
        const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {});
        const fsMock = mockFsExists();
        const { mockDb, DatabaseConstructor } = createMockSetup({
          openErr: new Error('SQLITE_CANTOPEN'),
        });

        await requireDatabaseWithMocks(fsMock, mockDb, DatabaseConstructor, mockLogger);
        expect(mockLogger.fatal).toHaveBeenCalledWith(
          expect.objectContaining({ err: expect.any(Error) }),
          'Error opening database'
        );
        expect(exitSpy).toHaveBeenCalledWith(1);
        exitSpy.mockRestore();
      });
    });
  });

  describe('PRAGMA errors', () => {
    it('handles PRAGMA foreign_keys error', async () => {
      await jest.isolateModulesAsync(async () => {
        const mockLogger = createMockLogger();
        const fsMock = mockFsExists();

        const runHandler = jest.fn((sql, ...args) => {
          const cb = args.find(a => typeof a === 'function');
          if (sql.includes('PRAGMA foreign_keys')) {
            if (cb) cb(new Error('FK pragma failed'));
            return;
          }
          if (cb) cb(null);
        });
        const { mockDb, DatabaseConstructor } = createMockSetup({
          allHandler: allColumnsPresent(),
          runHandler,
        });

        await requireDatabaseWithMocks(fsMock, mockDb, DatabaseConstructor, mockLogger);
        expect(mockLogger.error).toHaveBeenCalledWith(
          expect.objectContaining({ err: expect.any(Error) }),
          'Error enabling foreign keys'
        );
      });
    });

    it('handles PRAGMA journal_mode WAL error', async () => {
      await jest.isolateModulesAsync(async () => {
        const mockLogger = createMockLogger();
        const fsMock = mockFsExists();

        const runHandler = jest.fn((sql, ...args) => {
          const cb = args.find(a => typeof a === 'function');
          if (sql.includes('PRAGMA journal_mode')) {
            if (cb) cb(new Error('WAL pragma failed'));
            return;
          }
          if (cb) cb(null);
        });
        const { mockDb, DatabaseConstructor } = createMockSetup({
          allHandler: allColumnsPresent(),
          runHandler,
        });

        await requireDatabaseWithMocks(fsMock, mockDb, DatabaseConstructor, mockLogger);
        expect(mockLogger.error).toHaveBeenCalledWith(
          expect.objectContaining({ err: expect.any(Error) }),
          'Error enabling WAL mode'
        );
      });
    });
  });


  describe('Database ready promise', () => {
    it('resolves dbReady promise after initialization', async () => {
      await jest.isolateModulesAsync(async () => {
        const fsMock = mockFsExists();
        const { mockDb, DatabaseConstructor } = createMockSetup({
          allHandler: allColumnsPresent(),
        });

        const db = await requireDatabaseWithMocks(fsMock, mockDb, DatabaseConstructor);
        expect(db.ready).toBeDefined();
        expect(db.ready).toBeInstanceOf(Promise);
        await db.ready;
      });
    });

    it('exports db object with standard methods', async () => {
      await jest.isolateModulesAsync(async () => {
        const fsMock = mockFsExists();
        const { mockDb, DatabaseConstructor } = createMockSetup({
          allHandler: allColumnsPresent(),
        });

        const db = await requireDatabaseWithMocks(fsMock, mockDb, DatabaseConstructor);
        expect(db.run).toBeDefined();
        expect(db.all).toBeDefined();
        expect(db.get).toBeDefined();
        expect(db.serialize).toBeDefined();
      });
    });
  });
});
