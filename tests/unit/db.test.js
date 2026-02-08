const { createDbHelpers } = require('../../server/utils/db');

describe('createDbHelpers', () => {
  let mockDb;

  beforeEach(() => {
    mockDb = {
      get: jest.fn(),
      all: jest.fn(),
      run: jest.fn(),
    };
  });

  it('returns dbGet, dbAll, dbRun functions', () => {
    const helpers = createDbHelpers(mockDb);
    expect(typeof helpers.dbGet).toBe('function');
    expect(typeof helpers.dbAll).toBe('function');
    expect(typeof helpers.dbRun).toBe('function');
  });

  describe('dbGet', () => {
    it('resolves with row on success', async () => {
      const row = { id: 1, name: 'test' };
      mockDb.get.mockImplementation((sql, params, cb) => cb(null, row));
      const { dbGet } = createDbHelpers(mockDb);
      const result = await dbGet('SELECT * FROM t WHERE id = ?', [1]);
      expect(result).toEqual(row);
      expect(mockDb.get).toHaveBeenCalledWith('SELECT * FROM t WHERE id = ?', [1], expect.any(Function));
    });

    it('resolves with null when no row found', async () => {
      mockDb.get.mockImplementation((sql, params, cb) => cb(null, undefined));
      const { dbGet } = createDbHelpers(mockDb);
      const result = await dbGet('SELECT * FROM t WHERE id = ?', [999]);
      expect(result).toBeNull();
    });

    it('rejects on error', async () => {
      const err = new Error('db error');
      mockDb.get.mockImplementation((sql, params, cb) => cb(err));
      const { dbGet } = createDbHelpers(mockDb);
      await expect(dbGet('SELECT 1')).rejects.toThrow('db error');
    });

    it('uses empty array as default params', async () => {
      mockDb.get.mockImplementation((sql, params, cb) => cb(null, null));
      const { dbGet } = createDbHelpers(mockDb);
      await dbGet('SELECT 1');
      expect(mockDb.get).toHaveBeenCalledWith('SELECT 1', [], expect.any(Function));
    });
  });

  describe('dbAll', () => {
    it('resolves with rows on success', async () => {
      const rows = [{ id: 1 }, { id: 2 }];
      mockDb.all.mockImplementation((sql, params, cb) => cb(null, rows));
      const { dbAll } = createDbHelpers(mockDb);
      const result = await dbAll('SELECT * FROM t');
      expect(result).toEqual(rows);
    });

    it('resolves with empty array when no rows found', async () => {
      mockDb.all.mockImplementation((sql, params, cb) => cb(null, undefined));
      const { dbAll } = createDbHelpers(mockDb);
      const result = await dbAll('SELECT * FROM t');
      expect(result).toEqual([]);
    });

    it('rejects on error', async () => {
      const err = new Error('query failed');
      mockDb.all.mockImplementation((sql, params, cb) => cb(err));
      const { dbAll } = createDbHelpers(mockDb);
      await expect(dbAll('SELECT 1')).rejects.toThrow('query failed');
    });

    it('uses empty array as default params', async () => {
      mockDb.all.mockImplementation((sql, params, cb) => cb(null, []));
      const { dbAll } = createDbHelpers(mockDb);
      await dbAll('SELECT 1');
      expect(mockDb.all).toHaveBeenCalledWith('SELECT 1', [], expect.any(Function));
    });
  });

  describe('dbRun', () => {
    it('resolves with lastID and changes on success', async () => {
      mockDb.run.mockImplementation(function(sql, params, cb) {
        cb.call({ lastID: 5, changes: 1 }, null);
      });
      const { dbRun } = createDbHelpers(mockDb);
      const result = await dbRun('INSERT INTO t VALUES (?)', ['val']);
      expect(result).toEqual({ lastID: 5, changes: 1 });
    });

    it('rejects on error', async () => {
      const err = new Error('insert failed');
      mockDb.run.mockImplementation(function(sql, params, cb) {
        cb.call({ lastID: 0, changes: 0 }, err);
      });
      const { dbRun } = createDbHelpers(mockDb);
      await expect(dbRun('INSERT INTO t VALUES (?)', ['val'])).rejects.toThrow('insert failed');
    });

    it('uses empty array as default params', async () => {
      mockDb.run.mockImplementation(function(sql, params, cb) {
        cb.call({ lastID: 0, changes: 0 }, null);
      });
      const { dbRun } = createDbHelpers(mockDb);
      await dbRun('DELETE FROM t');
      expect(mockDb.run).toHaveBeenCalledWith('DELETE FROM t', [], expect.any(Function));
    });
  });
});
