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

  describe('ALTER TABLE migrations', () => {
    it('adds display_name column when missing', async () => {
      await jest.isolateModulesAsync(async () => {
        jest.spyOn(console, 'log').mockImplementation(() => {});
        const fsMock = mockFsExists();

        const runCalls = [];
        const runHandler = jest.fn((sql, ...args) => {
          runCalls.push(sql);
          const cb = args.find(a => typeof a === 'function');
          if (cb) cb(null);
        });
        const allHandler = jest.fn((sql, ...args) => {
          const cb = args.find(a => typeof a === 'function');
          if (!cb) return;
          if (sql.includes('table_info(users)')) {
            cb(null, [{ name: 'id' }, { name: 'username' }]); // missing display_name and avatar
          } else if (sql.includes('table_info(audiobooks)')) {
            cb(null, [{ name: 'id' }, { name: 'series_index' }]);
          } else {
            cb(null, []);
          }
        });
        const { mockDb, DatabaseConstructor } = createMockSetup({ allHandler, runHandler });

        await requireDatabaseWithMocks(fsMock, mockDb, DatabaseConstructor);
        const alterCalls = runCalls.filter(s => s.includes('ALTER TABLE'));
        expect(alterCalls.some(s => s.includes('display_name'))).toBe(true);
        expect(alterCalls.some(s => s.includes('avatar'))).toBe(true);
      });
    });

    it('skips display_name and avatar columns when they already exist', async () => {
      await jest.isolateModulesAsync(async () => {
        const fsMock = mockFsExists();

        const runCalls = [];
        const runHandler = jest.fn((sql, ...args) => {
          runCalls.push(sql);
          const cb = args.find(a => typeof a === 'function');
          if (cb) cb(null);
        });
        const { mockDb, DatabaseConstructor } = createMockSetup({
          allHandler: allColumnsPresent(),
          runHandler,
        });

        await requireDatabaseWithMocks(fsMock, mockDb, DatabaseConstructor);
        const alterCalls = runCalls.filter(s => s.includes('ALTER TABLE users'));
        expect(alterCalls).toHaveLength(0);
      });
    });

    it('handles PRAGMA table_info error for users table', async () => {
      await jest.isolateModulesAsync(async () => {
        const fsMock = mockFsExists();

        const allHandler = jest.fn((sql, ...args) => {
          const cb = args.find(a => typeof a === 'function');
          if (!cb) return;
          if (sql.includes('table_info(users)')) {
            cb(new Error('Table info error'), null);
          } else if (sql.includes('table_info(audiobooks)')) {
            cb(null, [{ name: 'id' }, { name: 'series_index' }]);
          } else {
            cb(null, []);
          }
        });
        const { mockDb, DatabaseConstructor } = createMockSetup({ allHandler });

        // Should not throw - error is handled internally
        const db = await requireDatabaseWithMocks(fsMock, mockDb, DatabaseConstructor);
        expect(db).toBeDefined();
      });
    });

    it('adds series_index column and migrates data when missing', async () => {
      await jest.isolateModulesAsync(async () => {
        jest.spyOn(console, 'log').mockImplementation(() => {});
        const fsMock = mockFsExists();

        const runCalls = [];
        const runHandler = jest.fn((sql, ...args) => {
          runCalls.push(sql);
          const cb = args.find(a => typeof a === 'function');
          if (cb) cb(null);
        });
        const allHandler = jest.fn((sql, ...args) => {
          const cb = args.find(a => typeof a === 'function');
          if (!cb) return;
          if (sql.includes('table_info(users)')) {
            cb(null, [{ name: 'id' }, { name: 'display_name' }, { name: 'avatar' }]);
          } else if (sql.includes('table_info(audiobooks)')) {
            cb(null, [{ name: 'id' }, { name: 'series_position' }]); // missing series_index
          } else {
            cb(null, []);
          }
        });
        const { mockDb, DatabaseConstructor } = createMockSetup({ allHandler, runHandler });

        await requireDatabaseWithMocks(fsMock, mockDb, DatabaseConstructor);
        expect(runCalls.some(s => s.includes('ADD COLUMN series_index'))).toBe(true);
        expect(runCalls.some(s => s.includes('UPDATE audiobooks SET series_index'))).toBe(true);
      });
    });

    it('handles ALTER TABLE series_index error', async () => {
      await jest.isolateModulesAsync(async () => {
        const mockLogger = createMockLogger();
        const fsMock = mockFsExists();

        const runHandler = jest.fn((sql, ...args) => {
          const cb = args.find(a => typeof a === 'function');
          if (sql.includes('ALTER TABLE audiobooks ADD COLUMN series_index')) {
            if (cb) cb(new Error('ALTER TABLE failed'));
            return;
          }
          if (cb) cb(null);
        });
        const allHandler = jest.fn((sql, ...args) => {
          const cb = args.find(a => typeof a === 'function');
          if (!cb) return;
          if (sql.includes('table_info(users)')) {
            cb(null, [{ name: 'id' }, { name: 'display_name' }, { name: 'avatar' }]);
          } else if (sql.includes('table_info(audiobooks)')) {
            cb(null, [{ name: 'id' }]); // missing series_index
          } else {
            cb(null, []);
          }
        });
        const { mockDb, DatabaseConstructor } = createMockSetup({ allHandler, runHandler });

        await requireDatabaseWithMocks(fsMock, mockDb, DatabaseConstructor, mockLogger);
        expect(mockLogger.error).toHaveBeenCalledWith(
          expect.objectContaining({ err: expect.any(Error) }),
          'Error adding series_index column'
        );
      });
    });

    it('handles UPDATE series_position migration error', async () => {
      await jest.isolateModulesAsync(async () => {
        const mockLogger = createMockLogger();
        const fsMock = mockFsExists();

        const runHandler = jest.fn((sql, ...args) => {
          const cb = args.find(a => typeof a === 'function');
          if (sql.includes('UPDATE audiobooks SET series_index')) {
            if (cb) cb(new Error('Migration data copy failed'));
            return;
          }
          if (cb) cb(null);
        });
        const allHandler = jest.fn((sql, ...args) => {
          const cb = args.find(a => typeof a === 'function');
          if (!cb) return;
          if (sql.includes('table_info(users)')) {
            cb(null, [{ name: 'id' }, { name: 'display_name' }, { name: 'avatar' }]);
          } else if (sql.includes('table_info(audiobooks)')) {
            cb(null, [{ name: 'id' }]); // missing series_index
          } else {
            cb(null, []);
          }
        });
        const { mockDb, DatabaseConstructor } = createMockSetup({ allHandler, runHandler });

        await requireDatabaseWithMocks(fsMock, mockDb, DatabaseConstructor, mockLogger);
        expect(mockLogger.error).toHaveBeenCalledWith(
          expect.objectContaining({ err: expect.any(Error) }),
          'Error migrating series_position to series_index'
        );
      });
    });

    it('handles PRAGMA table_info error for audiobooks table', async () => {
      await jest.isolateModulesAsync(async () => {
        const fsMock = mockFsExists();

        const runCalls = [];
        const runHandler = jest.fn((sql, ...args) => {
          runCalls.push(sql);
          const cb = args.find(a => typeof a === 'function');
          if (cb) cb(null);
        });
        const allHandler = jest.fn((sql, ...args) => {
          const cb = args.find(a => typeof a === 'function');
          if (!cb) return;
          if (sql.includes('table_info(users)')) {
            cb(null, [{ name: 'id' }, { name: 'display_name' }, { name: 'avatar' }]);
          } else if (sql.includes('table_info(audiobooks)')) {
            cb(new Error('Table info error'), null);
          } else {
            cb(null, []);
          }
        });
        const { mockDb, DatabaseConstructor } = createMockSetup({ allHandler, runHandler });

        await requireDatabaseWithMocks(fsMock, mockDb, DatabaseConstructor);
        expect(runCalls.filter(s => s.includes('ALTER TABLE audiobooks'))).toHaveLength(0);
      });
    });
  });

  describe('Migrations', () => {
    it('handles missing migrations directory', async () => {
      await jest.isolateModulesAsync(async () => {
        const mockLogger = createMockLogger();
        const fsMock = {
          existsSync: jest.fn().mockImplementation((p) => {
            if (p.includes('migrations')) return false;
            return true;
          }),
          mkdirSync: jest.fn(),
          readdirSync: jest.fn().mockReturnValue([]),
          renameSync: jest.fn(),
        };
        const { mockDb, DatabaseConstructor } = createMockSetup({
          allHandler: allColumnsPresent(),
        });

        await requireDatabaseWithMocks(fsMock, mockDb, DatabaseConstructor, mockLogger);
        expect(mockLogger.debug).toHaveBeenCalledWith('No migrations directory found');
      });
    });

    it('runs migration files in order and filters non-js files', async () => {
      await jest.isolateModulesAsync(async () => {
        const mockLogger = createMockLogger();
        const migrationUp = jest.fn();

        const fsMock = {
          existsSync: jest.fn().mockReturnValue(true),
          mkdirSync: jest.fn(),
          readdirSync: jest.fn().mockImplementation((dir) => {
            if (dir.includes('migrations')) {
              return ['001_test.js', '002_test.js', 'readme.md'];
            }
            return [];
          }),
          renameSync: jest.fn(),
        };

        const mockMigration = { up: migrationUp, down: jest.fn() };
        jest.doMock('../../server/migrations/001_test.js', () => mockMigration, { virtual: true });
        jest.doMock('../../server/migrations/002_test.js', () => mockMigration, { virtual: true });

        const { mockDb, DatabaseConstructor } = createMockSetup({
          allHandler: allColumnsPresent(),
        });

        await requireDatabaseWithMocks(fsMock, mockDb, DatabaseConstructor, mockLogger);
        expect(mockLogger.info).toHaveBeenCalledWith({ count: 2 }, 'Found migrations');
        expect(migrationUp).toHaveBeenCalledTimes(2);
      });
    });

    it('handles broken migration file gracefully', async () => {
      await jest.isolateModulesAsync(async () => {
        const mockLogger = createMockLogger();

        const fsMock = {
          existsSync: jest.fn().mockReturnValue(true),
          mkdirSync: jest.fn(),
          readdirSync: jest.fn().mockImplementation((dir) => {
            if (dir.includes('migrations')) return ['001_broken.js'];
            return [];
          }),
          renameSync: jest.fn(),
        };

        jest.doMock('../../server/migrations/001_broken.js', () => ({
          up: () => { throw new Error('Migration syntax error'); },
          down: jest.fn(),
        }), { virtual: true });

        const { mockDb, DatabaseConstructor } = createMockSetup({
          allHandler: allColumnsPresent(),
        });

        await requireDatabaseWithMocks(fsMock, mockDb, DatabaseConstructor, mockLogger);
        expect(mockLogger.error).toHaveBeenCalledWith(
          expect.objectContaining({ err: expect.any(Error), file: '001_broken.js' }),
          'Error running migration'
        );
      });
    });

    it('handles migration file with missing up function', async () => {
      await jest.isolateModulesAsync(async () => {
        const mockLogger = createMockLogger();

        const fsMock = {
          existsSync: jest.fn().mockReturnValue(true),
          mkdirSync: jest.fn(),
          readdirSync: jest.fn().mockImplementation((dir) => {
            if (dir.includes('migrations')) return ['001_noup.js'];
            return [];
          }),
          renameSync: jest.fn(),
        };

        jest.doMock('../../server/migrations/001_noup.js', () => ({
          down: jest.fn(),
        }), { virtual: true });

        const { mockDb, DatabaseConstructor } = createMockSetup({
          allHandler: allColumnsPresent(),
        });

        await requireDatabaseWithMocks(fsMock, mockDb, DatabaseConstructor, mockLogger);
        expect(mockLogger.error).toHaveBeenCalledWith(
          expect.objectContaining({ err: expect.any(Error), file: '001_noup.js' }),
          'Error running migration'
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
