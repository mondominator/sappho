/**
 * Unit tests for Path Cache Service
 * Tests ISBN/ASIN lookup functions with cache and DB fallback
 */

describe('Path Cache - ISBN/ASIN lookups', () => {
  let pathCache;
  let mockDb;

  beforeEach(() => {
    jest.resetModules();

    mockDb = {
      all: jest.fn((sql, params, cb) => {
        if (typeof params === 'function') { params(null, []); return; }
        if (cb) cb(null, []);
      }),
      get: jest.fn((sql, params, cb) => {
        if (cb) cb(null, null);
      }),
    };

    jest.doMock('../../server/database', () => mockDb);
    jest.spyOn(console, 'log').mockImplementation(() => {});

    pathCache = require('../../server/services/pathCache');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('audiobookExistsByIsbn', () => {
    it('returns null for null ISBN', async () => {
      expect(await pathCache.audiobookExistsByIsbn(null)).toBeNull();
      expect(mockDb.get).not.toHaveBeenCalled();
    });

    it('returns null for empty string ISBN', async () => {
      expect(await pathCache.audiobookExistsByIsbn('')).toBeNull();
      expect(mockDb.get).not.toHaveBeenCalled();
    });

    it('returns null for whitespace-only ISBN', async () => {
      expect(await pathCache.audiobookExistsByIsbn('   ')).toBeNull();
      expect(mockDb.get).not.toHaveBeenCalled();
    });

    it('queries DB when cache not loaded', async () => {
      const mockRow = { id: 1, title: 'Test Book', file_path: '/test.m4b' };
      mockDb.get = jest.fn((sql, params, cb) => cb(null, mockRow));

      const result = await pathCache.audiobookExistsByIsbn('978-123');
      expect(result).toEqual(mockRow);
      expect(mockDb.get).toHaveBeenCalledWith(
        expect.stringContaining('isbn = ?'),
        ['978-123'],
        expect.any(Function)
      );
    });

    it('returns null when DB has no match', async () => {
      mockDb.get = jest.fn((sql, params, cb) => cb(null, null));
      const result = await pathCache.audiobookExistsByIsbn('978-999');
      expect(result).toBeNull();
    });

    it('trims whitespace from ISBN before querying', async () => {
      mockDb.get = jest.fn((sql, params, cb) => cb(null, null));
      await pathCache.audiobookExistsByIsbn('  978-123  ');
      expect(mockDb.get).toHaveBeenCalledWith(
        expect.any(String),
        ['978-123'],
        expect.any(Function)
      );
    });

    it('uses in-memory cache when loaded', async () => {
      // Load the cache with test data
      mockDb.all = jest.fn((sql, params, cb) => {
        cb(null, [
          { id: 1, file_path: '/a.m4b', title: 'Book A', isbn: '978-A', asin: null, is_available: 1 },
          { id: 2, file_path: '/b.m4b', title: 'Book B', isbn: '978-B', asin: 'B00TEST', is_available: 1 },
        ]);
      });
      await pathCache.loadPathCache();

      // ISBN lookup should use cache, not DB
      mockDb.get = jest.fn();
      const result = await pathCache.audiobookExistsByIsbn('978-A');
      expect(result).toEqual({ id: 1, title: 'Book A', file_path: '/a.m4b' });
      expect(mockDb.get).not.toHaveBeenCalled();

      // Non-existent ISBN returns null from cache
      const miss = await pathCache.audiobookExistsByIsbn('978-ZZZ');
      expect(miss).toBeNull();
      expect(mockDb.get).not.toHaveBeenCalled();

      pathCache.clearPathCache();
    });

    it('does not cache unavailable books', async () => {
      mockDb.all = jest.fn((sql, params, cb) => {
        cb(null, [
          { id: 1, file_path: '/a.m4b', title: 'Book A', isbn: '978-GONE', asin: null, is_available: 0 },
        ]);
      });
      await pathCache.loadPathCache();

      const result = await pathCache.audiobookExistsByIsbn('978-GONE');
      expect(result).toBeNull();

      pathCache.clearPathCache();
    });

    it('rejects on database error', async () => {
      mockDb.get = jest.fn((sql, params, cb) => cb(new Error('SQLITE_BUSY')));
      await expect(pathCache.audiobookExistsByIsbn('978-123')).rejects.toThrow('SQLITE_BUSY');
    });
  });

  describe('audiobookExistsByAsin', () => {
    it('returns null for null ASIN', async () => {
      expect(await pathCache.audiobookExistsByAsin(null)).toBeNull();
    });

    it('returns null for empty string ASIN', async () => {
      expect(await pathCache.audiobookExistsByAsin('')).toBeNull();
    });

    it('queries DB when cache not loaded', async () => {
      const mockRow = { id: 2, title: 'Test Book 2', file_path: '/test2.m4b' };
      mockDb.get = jest.fn((sql, params, cb) => cb(null, mockRow));

      const result = await pathCache.audiobookExistsByAsin('B00TEST');
      expect(result).toEqual(mockRow);
      expect(mockDb.get).toHaveBeenCalledWith(
        expect.stringContaining('asin = ?'),
        ['B00TEST'],
        expect.any(Function)
      );
    });

    it('uses in-memory cache when loaded', async () => {
      mockDb.all = jest.fn((sql, params, cb) => {
        cb(null, [
          { id: 2, file_path: '/b.m4b', title: 'Book B', isbn: null, asin: 'B00TEST', is_available: 1 },
        ]);
      });
      await pathCache.loadPathCache();

      mockDb.get = jest.fn();
      const result = await pathCache.audiobookExistsByAsin('B00TEST');
      expect(result).toEqual({ id: 2, title: 'Book B', file_path: '/b.m4b' });
      expect(mockDb.get).not.toHaveBeenCalled();

      pathCache.clearPathCache();
    });

    it('rejects on database error', async () => {
      mockDb.get = jest.fn((sql, params, cb) => cb(new Error('SQLITE_CORRUPT')));
      await expect(pathCache.audiobookExistsByAsin('B00TEST')).rejects.toThrow('SQLITE_CORRUPT');
    });
  });

  describe('clearPathCache', () => {
    it('clears ISBN and ASIN caches', async () => {
      mockDb.all = jest.fn((sql, params, cb) => {
        cb(null, [
          { id: 1, file_path: '/a.m4b', title: 'Book', isbn: '978-X', asin: 'B00X', is_available: 1 },
        ]);
      });
      await pathCache.loadPathCache();

      // Verify cache works
      mockDb.get = jest.fn();
      expect(await pathCache.audiobookExistsByIsbn('978-X')).not.toBeNull();
      expect(mockDb.get).not.toHaveBeenCalled();

      // Clear and verify fallback to DB
      pathCache.clearPathCache();
      mockDb.get = jest.fn((sql, params, cb) => cb(null, null));
      await pathCache.audiobookExistsByIsbn('978-X');
      expect(mockDb.get).toHaveBeenCalled();
    });
  });
});
