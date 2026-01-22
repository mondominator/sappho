/**
 * Unit tests for Activity Service
 */

// Mock database before requiring the module
jest.mock('../../server/database', () => ({
  get: jest.fn(),
  run: jest.fn(),
  all: jest.fn()
}));

const db = require('../../server/database');

// Now require the service after mocks are set up
const {
  EVENT_TYPES,
  recordActivity,
  getActivityFeed,
  getPersonalActivity,
  getServerActivity,
  updatePrivacySettings,
  getPrivacySettings,
  cleanupOldActivity
} = require('../../server/services/activityService');

describe('Activity Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('EVENT_TYPES', () => {
    test('contains expected event types', () => {
      expect(EVENT_TYPES.STARTED_LISTENING).toBe('started_listening');
      expect(EVENT_TYPES.FINISHED_BOOK).toBe('finished_book');
      expect(EVENT_TYPES.RATED_BOOK).toBe('rated_book');
      expect(EVENT_TYPES.ADDED_TO_COLLECTION).toBe('added_to_collection');
      expect(EVENT_TYPES.PROGRESS_MILESTONE).toBe('progress_milestone');
      expect(EVENT_TYPES.BOOK_ADDED).toBe('book_added');
    });
  });

  describe('recordActivity', () => {
    test('records activity event with audiobook and metadata', async () => {
      db.run.mockImplementation(function(query, params, callback) {
        callback.call({ lastID: 1 }, null);
      });

      const result = await recordActivity(1, 'started_listening', 5, { progress: 0 });

      expect(result).toEqual({ id: 1 });
      expect(db.run).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO activity_events'),
        [1, 'started_listening', 5, JSON.stringify({ progress: 0 })],
        expect.any(Function)
      );
    });

    test('records activity event without audiobook or metadata', async () => {
      db.run.mockImplementation(function(query, params, callback) {
        callback.call({ lastID: 2 }, null);
      });

      const result = await recordActivity(1, 'book_added');

      expect(result).toEqual({ id: 2 });
      expect(db.run).toHaveBeenCalledWith(
        expect.any(String),
        [1, 'book_added', null, null],
        expect.any(Function)
      );
    });

    test('rejects on database error', async () => {
      db.run.mockImplementation((query, params, callback) => {
        callback(new Error('Database error'));
      });

      await expect(recordActivity(1, 'started_listening')).rejects.toThrow('Database error');
    });
  });

  describe('getActivityFeed', () => {
    test('returns activity feed with defaults', async () => {
      const mockRows = [
        {
          id: 1,
          event_type: 'started_listening',
          created_at: '2024-01-01',
          metadata: JSON.stringify({ progress: 0 }),
          user_id: 1,
          username: 'testuser',
          audiobook_id: 5,
          book_title: 'Test Book',
          book_author: 'Test Author'
        }
      ];

      db.all.mockImplementation((query, params, callback) => {
        callback(null, mockRows);
      });

      const result = await getActivityFeed(1);

      expect(result).toHaveLength(1);
      expect(result[0].metadata).toEqual({ progress: 0 });
      expect(db.all).toHaveBeenCalledWith(
        expect.stringContaining('SELECT'),
        expect.arrayContaining([1, 50, 0]),
        expect.any(Function)
      );
    });

    test('applies type filter', async () => {
      db.all.mockImplementation((query, params, callback) => {
        callback(null, []);
      });

      await getActivityFeed(1, { type: 'started_listening' });

      expect(db.all).toHaveBeenCalledWith(
        expect.stringContaining('ae.event_type = ?'),
        expect.arrayContaining([1, 'started_listening']),
        expect.any(Function)
      );
    });

    test('excludes own activity when includeOwn is false', async () => {
      db.all.mockImplementation((query, params, callback) => {
        callback(null, []);
      });

      await getActivityFeed(1, { includeOwn: false });

      expect(db.all).toHaveBeenCalledWith(
        expect.stringContaining('ae.user_id != ?'),
        expect.arrayContaining([1, 1]),
        expect.any(Function)
      );
    });

    test('applies pagination', async () => {
      db.all.mockImplementation((query, params, callback) => {
        callback(null, []);
      });

      await getActivityFeed(1, { limit: 20, offset: 10 });

      expect(db.all).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining([20, 10]),
        expect.any(Function)
      );
    });

    test('handles null metadata', async () => {
      const mockRows = [
        {
          id: 1,
          event_type: 'book_added',
          created_at: '2024-01-01',
          metadata: null,
          user_id: 1,
          username: 'testuser'
        }
      ];

      db.all.mockImplementation((query, params, callback) => {
        callback(null, mockRows);
      });

      const result = await getActivityFeed(1);

      expect(result[0].metadata).toBeNull();
    });

    test('rejects on database error', async () => {
      db.all.mockImplementation((query, params, callback) => {
        callback(new Error('Database error'), null);
      });

      await expect(getActivityFeed(1)).rejects.toThrow('Database error');
    });
  });

  describe('getPersonalActivity', () => {
    test('returns personal activity with defaults', async () => {
      const mockRows = [
        {
          id: 1,
          event_type: 'finished_book',
          created_at: '2024-01-01',
          metadata: JSON.stringify({ rating: 5 }),
          audiobook_id: 5,
          book_title: 'Finished Book'
        }
      ];

      db.all.mockImplementation((query, params, callback) => {
        callback(null, mockRows);
      });

      const result = await getPersonalActivity(1);

      expect(result).toHaveLength(1);
      expect(result[0].metadata).toEqual({ rating: 5 });
      expect(db.all).toHaveBeenCalledWith(
        expect.stringContaining('WHERE ae.user_id = ?'),
        expect.arrayContaining([1, 50, 0]),
        expect.any(Function)
      );
    });

    test('applies type filter', async () => {
      db.all.mockImplementation((query, params, callback) => {
        callback(null, []);
      });

      await getPersonalActivity(1, { type: 'rated_book' });

      expect(db.all).toHaveBeenCalledWith(
        expect.stringContaining('ae.event_type = ?'),
        expect.arrayContaining([1, 'rated_book']),
        expect.any(Function)
      );
    });

    test('applies pagination', async () => {
      db.all.mockImplementation((query, params, callback) => {
        callback(null, []);
      });

      await getPersonalActivity(1, { limit: 10, offset: 5 });

      expect(db.all).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining([1, 10, 5]),
        expect.any(Function)
      );
    });

    test('rejects on database error', async () => {
      db.all.mockImplementation((query, params, callback) => {
        callback(new Error('Database error'), null);
      });

      await expect(getPersonalActivity(1)).rejects.toThrow('Database error');
    });
  });

  describe('getServerActivity', () => {
    test('returns server-wide shared activity', async () => {
      const mockRows = [
        {
          id: 1,
          event_type: 'started_listening',
          created_at: '2024-01-01',
          metadata: null,
          user_id: 2,
          username: 'anotheruser',
          audiobook_id: 10,
          book_title: 'Popular Book'
        }
      ];

      db.all.mockImplementation((query, params, callback) => {
        callback(null, mockRows);
      });

      const result = await getServerActivity();

      expect(result).toHaveLength(1);
      expect(db.all).toHaveBeenCalledWith(
        expect.stringContaining('share_activity = 1 AND u.show_in_feed = 1'),
        expect.arrayContaining([50, 0]),
        expect.any(Function)
      );
    });

    test('applies type filter', async () => {
      db.all.mockImplementation((query, params, callback) => {
        callback(null, []);
      });

      await getServerActivity({ type: 'finished_book' });

      expect(db.all).toHaveBeenCalledWith(
        expect.stringContaining('ae.event_type = ?'),
        expect.arrayContaining(['finished_book']),
        expect.any(Function)
      );
    });

    test('applies pagination', async () => {
      db.all.mockImplementation((query, params, callback) => {
        callback(null, []);
      });

      await getServerActivity({ limit: 25, offset: 50 });

      expect(db.all).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining([25, 50]),
        expect.any(Function)
      );
    });

    test('rejects on database error', async () => {
      db.all.mockImplementation((query, params, callback) => {
        callback(new Error('Database error'), null);
      });

      await expect(getServerActivity()).rejects.toThrow('Database error');
    });
  });

  describe('updatePrivacySettings', () => {
    test('updates privacy settings', async () => {
      db.run.mockImplementation(function(query, params, callback) {
        callback.call({ changes: 1 }, null);
      });

      const result = await updatePrivacySettings(1, { shareActivity: true, showInFeed: false });

      expect(result).toEqual({ changes: 1 });
      expect(db.run).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE users SET share_activity'),
        [1, 0, 1],
        expect.any(Function)
      );
    });

    test('converts boolean values to 1/0', async () => {
      db.run.mockImplementation(function(query, params, callback) {
        callback.call({ changes: 1 }, null);
      });

      await updatePrivacySettings(1, { shareActivity: false, showInFeed: true });

      expect(db.run).toHaveBeenCalledWith(
        expect.any(String),
        [0, 1, 1],
        expect.any(Function)
      );
    });

    test('rejects on database error', async () => {
      db.run.mockImplementation((query, params, callback) => {
        callback(new Error('Database error'));
      });

      await expect(updatePrivacySettings(1, {})).rejects.toThrow('Database error');
    });
  });

  describe('getPrivacySettings', () => {
    test('returns privacy settings', async () => {
      db.get.mockImplementation((query, params, callback) => {
        callback(null, { share_activity: 1, show_in_feed: 0 });
      });

      const result = await getPrivacySettings(1);

      expect(result).toEqual({
        shareActivity: true,
        showInFeed: false
      });
    });

    test('returns false for missing settings', async () => {
      db.get.mockImplementation((query, params, callback) => {
        callback(null, null);
      });

      const result = await getPrivacySettings(999);

      expect(result).toEqual({
        shareActivity: false,
        showInFeed: false
      });
    });

    test('rejects on database error', async () => {
      db.get.mockImplementation((query, params, callback) => {
        callback(new Error('Database error'), null);
      });

      await expect(getPrivacySettings(1)).rejects.toThrow('Database error');
    });
  });

  describe('cleanupOldActivity', () => {
    test('deletes old activity with default days', async () => {
      db.run.mockImplementation(function(query, params, callback) {
        callback.call({ changes: 50 }, null);
      });

      const result = await cleanupOldActivity();

      expect(result).toEqual({ deleted: 50 });
      expect(db.run).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM activity_events'),
        [90],
        expect.any(Function)
      );
    });

    test('deletes old activity with custom days', async () => {
      db.run.mockImplementation(function(query, params, callback) {
        callback.call({ changes: 10 }, null);
      });

      const result = await cleanupOldActivity(30);

      expect(result).toEqual({ deleted: 10 });
      expect(db.run).toHaveBeenCalledWith(
        expect.any(String),
        [30],
        expect.any(Function)
      );
    });

    test('returns 0 when no old activity', async () => {
      db.run.mockImplementation(function(query, params, callback) {
        callback.call({ changes: 0 }, null);
      });

      const result = await cleanupOldActivity();

      expect(result).toEqual({ deleted: 0 });
    });

    test('rejects on database error', async () => {
      db.run.mockImplementation((query, params, callback) => {
        callback(new Error('Database error'));
      });

      await expect(cleanupOldActivity()).rejects.toThrow('Database error');
    });
  });
});
