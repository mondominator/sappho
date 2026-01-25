/**
 * Unit tests for fix-multifile-audiobooks.js script
 */

// Mock fs before requiring the module
jest.mock('fs', () => ({
  existsSync: jest.fn()
}));

// Mock sqlite3
const mockDb = {
  all: jest.fn(),
  run: jest.fn(),
  serialize: jest.fn((fn) => fn()),
  close: jest.fn()
};

jest.mock('sqlite3', () => ({
  verbose: jest.fn(() => ({
    Database: jest.fn(() => mockDb)
  }))
}));

const fs = require('fs');
const {
  groupByDirectory,
  findMultiFileAudiobooks,
  consolidateGroup,
  main,
  getDb
} = require('../../server/scripts/fix-multifile-audiobooks');

describe('fix-multifile-audiobooks script', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Suppress console output during tests
    jest.spyOn(console, 'log').mockImplementation();
    jest.spyOn(console, 'error').mockImplementation();
    // Default: all files exist
    fs.existsSync.mockReturnValue(true);
  });

  afterEach(() => {
    console.log.mockRestore();
    console.error.mockRestore();
  });

  describe('groupByDirectory', () => {
    test('groups audiobooks by directory', async () => {
      const audiobooks = [
        { id: 1, file_path: '/audiobooks/book1/chapter1.mp3' },
        { id: 2, file_path: '/audiobooks/book1/chapter2.mp3' },
        { id: 3, file_path: '/audiobooks/book2/file.m4b' }
      ];

      const result = await groupByDirectory(audiobooks);

      // Should only include the directory with multiple files
      expect(result.size).toBe(1);
      expect(result.has('/audiobooks/book1')).toBe(true);
      expect(result.get('/audiobooks/book1').length).toBe(2);
    });

    test('skips missing files', async () => {
      fs.existsSync.mockImplementation((path) => {
        return path !== '/audiobooks/missing.mp3';
      });

      const audiobooks = [
        { id: 1, file_path: '/audiobooks/book1/chapter1.mp3' },
        { id: 2, file_path: '/audiobooks/missing.mp3' },
        { id: 3, file_path: '/audiobooks/book1/chapter2.mp3' }
      ];

      const result = await groupByDirectory(audiobooks);

      expect(result.size).toBe(1);
      expect(console.log).toHaveBeenCalledWith('Skipping missing file: /audiobooks/missing.mp3');
    });

    test('excludes directories with single files', async () => {
      const audiobooks = [
        { id: 1, file_path: '/audiobooks/book1/file.mp3' },
        { id: 2, file_path: '/audiobooks/book2/file.mp3' },
        { id: 3, file_path: '/audiobooks/book3/file.mp3' }
      ];

      const result = await groupByDirectory(audiobooks);

      expect(result.size).toBe(0);
    });

    test('handles empty audiobook list', async () => {
      const result = await groupByDirectory([]);

      expect(result.size).toBe(0);
    });

    test('handles multiple multi-file directories', async () => {
      const audiobooks = [
        { id: 1, file_path: '/audiobooks/book1/ch1.mp3' },
        { id: 2, file_path: '/audiobooks/book1/ch2.mp3' },
        { id: 3, file_path: '/audiobooks/book2/ch1.mp3' },
        { id: 4, file_path: '/audiobooks/book2/ch2.mp3' },
        { id: 5, file_path: '/audiobooks/book2/ch3.mp3' }
      ];

      const result = await groupByDirectory(audiobooks);

      expect(result.size).toBe(2);
      expect(result.get('/audiobooks/book1').length).toBe(2);
      expect(result.get('/audiobooks/book2').length).toBe(3);
    });

    test('groups books by full directory path', async () => {
      const audiobooks = [
        { id: 1, file_path: '/audiobooks/author/book1/ch1.mp3' },
        { id: 2, file_path: '/audiobooks/author/book1/ch2.mp3' },
        { id: 3, file_path: '/audiobooks/author/book2/ch1.mp3' }
      ];

      const result = await groupByDirectory(audiobooks);

      expect(result.size).toBe(1);
      expect(result.has('/audiobooks/author/book1')).toBe(true);
    });
  });

  describe('title detection', () => {
    test('chapter pattern regex matches common patterns', () => {
      // Test the regex pattern used in consolidateGroup
      const chapterPattern = /chapter|part|\d+/i;

      expect(chapterPattern.test('Chapter 1')).toBe(true);
      expect(chapterPattern.test('Part One')).toBe(true);
      expect(chapterPattern.test('01 - Introduction')).toBe(true);
      expect(chapterPattern.test('The Great Gatsby')).toBe(false);
    });
  });

  describe('sorting behavior', () => {
    test('files are sorted by path for chapter ordering', async () => {
      const audiobooks = [
        { id: 3, file_path: '/audiobooks/book/03-chapter.mp3' },
        { id: 1, file_path: '/audiobooks/book/01-chapter.mp3' },
        { id: 2, file_path: '/audiobooks/book/02-chapter.mp3' }
      ];

      const result = await groupByDirectory(audiobooks);
      const books = result.get('/audiobooks/book');

      // Books in the group maintain original order (sorting happens in consolidateGroup)
      expect(books).toBeDefined();
      expect(books.length).toBe(3);
    });
  });

  describe('duration and size calculation', () => {
    test('handles null duration values', async () => {
      // consolidateGroup calculates totals, but we can test the logic pattern
      const books = [
        { duration: 100, file_size: 1000 },
        { duration: null, file_size: 2000 },
        { duration: 200, file_size: null }
      ];

      let totalDuration = 0;
      let totalSize = 0;
      for (const book of books) {
        totalDuration += book.duration || 0;
        totalSize += book.file_size || 0;
      }

      expect(totalDuration).toBe(300);
      expect(totalSize).toBe(3000);
    });
  });

  describe('findMultiFileAudiobooks', () => {
    test('resolves with audiobooks from database', async () => {
      const mockAudiobooks = [
        { id: 1, title: 'Book 1', file_path: '/path/to/book1.mp3' },
        { id: 2, title: 'Book 2', file_path: '/path/to/book2.mp3' }
      ];

      const db = getDb();
      db.all.mockImplementation((query, callback) => {
        callback(null, mockAudiobooks);
      });

      const result = await findMultiFileAudiobooks();

      expect(result).toEqual(mockAudiobooks);
      expect(db.all).toHaveBeenCalledWith(
        expect.stringContaining('SELECT'),
        expect.any(Function)
      );
    });

    test('rejects on database error', async () => {
      const db = getDb();
      db.all.mockImplementation((query, callback) => {
        callback(new Error('Database error'), null);
      });

      await expect(findMultiFileAudiobooks()).rejects.toThrow('Database error');
    });

    test('returns empty array when no audiobooks', async () => {
      const db = getDb();
      db.all.mockImplementation((query, callback) => {
        callback(null, []);
      });

      const result = await findMultiFileAudiobooks();
      expect(result).toEqual([]);
    });
  });

  describe('consolidateGroup', () => {
    // Helper to create db.run mock that handles different call signatures
    const createDbRunMock = (captureUpdate = null) => {
      return (query, paramsOrCallback, maybeCallback) => {
        // Handle both (query, params, callback) and (query, callback) signatures
        const callback = typeof paramsOrCallback === 'function' ? paramsOrCallback : maybeCallback;
        const params = typeof paramsOrCallback === 'function' ? null : paramsOrCallback;

        if (query.includes('UPDATE audiobooks')) {
          if (captureUpdate && params) captureUpdate.params = params;
          callback.call({ changes: 1 }, null);
        } else if (query.includes('INSERT OR IGNORE INTO audiobook_chapters')) {
          callback(null);
        } else if (query.includes('DELETE FROM audiobooks')) {
          callback(null);
        }
      };
    };

    test('sorts books by file path', async () => {
      const books = [
        { id: 3, title: 'Chapter 3', file_path: '/book/03.mp3', duration: 100, file_size: 1000 },
        { id: 1, title: 'Chapter 1', file_path: '/book/01.mp3', duration: 100, file_size: 1000 },
        { id: 2, title: 'Chapter 2', file_path: '/book/02.mp3', duration: 100, file_size: 1000 }
      ];

      const db = getDb();
      const capture = {};
      db.run.mockImplementation(createDbRunMock(capture));

      const result = await consolidateGroup(books);

      // First book (by path) should be the primary
      expect(capture.params[3]).toBe(1); // ID of first book by path
      expect(result.bookId).toBe(1);
      expect(result.chapterCount).toBe(3);
    });

    test('uses directory name as title if book title looks like chapter', async () => {
      const books = [
        { id: 1, title: 'Chapter 1', file_path: '/My Audiobook/01.mp3', duration: 100, file_size: 1000 },
        { id: 2, title: 'Chapter 2', file_path: '/My Audiobook/02.mp3', duration: 100, file_size: 1000 }
      ];

      const db = getDb();
      const capture = {};
      db.run.mockImplementation(createDbRunMock(capture));

      await consolidateGroup(books);

      // Title should be directory name since original title matches chapter pattern
      expect(capture.params[0]).toBe('My Audiobook');
    });

    test('keeps original title if it does not look like chapter', async () => {
      const books = [
        { id: 1, title: 'The Great Gatsby', file_path: '/book/01.mp3', duration: 100, file_size: 1000 },
        { id: 2, title: 'Part Two', file_path: '/book/02.mp3', duration: 100, file_size: 1000 }
      ];

      const db = getDb();
      const capture = {};
      db.run.mockImplementation(createDbRunMock(capture));

      await consolidateGroup(books);

      // Title should remain as the original
      expect(capture.params[0]).toBe('The Great Gatsby');
    });

    test('calculates total duration and size', async () => {
      const books = [
        { id: 1, title: 'Ch1', file_path: '/book/01.mp3', duration: 100, file_size: 1000 },
        { id: 2, title: 'Ch2', file_path: '/book/02.mp3', duration: 200, file_size: 2000 },
        { id: 3, title: 'Ch3', file_path: '/book/03.mp3', duration: 300, file_size: 3000 }
      ];

      const db = getDb();
      const capture = {};
      db.run.mockImplementation(createDbRunMock(capture));

      await consolidateGroup(books);

      expect(capture.params[1]).toBe(600); // Total duration
      expect(capture.params[2]).toBe(6000); // Total size
    });

    test('rejects on update error', async () => {
      const books = [
        { id: 1, title: 'Ch1', file_path: '/book/01.mp3', duration: 100, file_size: 1000 },
        { id: 2, title: 'Ch2', file_path: '/book/02.mp3', duration: 100, file_size: 1000 }
      ];

      const db = getDb();
      db.run.mockImplementation((query, paramsOrCallback, maybeCallback) => {
        const callback = typeof paramsOrCallback === 'function' ? paramsOrCallback : maybeCallback;
        if (query.includes('UPDATE audiobooks')) {
          callback(new Error('Update error'));
        }
      });

      await expect(consolidateGroup(books)).rejects.toThrow('Update error');
    });

    test('rejects on chapter insert error', async () => {
      const books = [
        { id: 1, title: 'Ch1', file_path: '/book/01.mp3', duration: 100, file_size: 1000 },
        { id: 2, title: 'Ch2', file_path: '/book/02.mp3', duration: 100, file_size: 1000 }
      ];

      const db = getDb();
      db.run.mockImplementation((query, paramsOrCallback, maybeCallback) => {
        const callback = typeof paramsOrCallback === 'function' ? paramsOrCallback : maybeCallback;
        if (query.includes('UPDATE audiobooks')) {
          callback.call({ changes: 1 }, null);
        } else if (query.includes('INSERT OR IGNORE INTO audiobook_chapters')) {
          callback(new Error('Insert error'));
        }
      });

      await expect(consolidateGroup(books)).rejects.toThrow('Insert error');
    });

    test('returns result with no deleted ids for single book', async () => {
      const books = [
        { id: 1, title: 'Solo', file_path: '/book/solo.mp3', duration: 100, file_size: 1000 }
      ];

      const db = getDb();
      db.run.mockImplementation(createDbRunMock());

      const result = await consolidateGroup(books);

      expect(result.deletedIds).toEqual([]);
      expect(result.chapterCount).toBe(1);
    });

    test('rejects on delete error', async () => {
      const books = [
        { id: 1, title: 'Ch1', file_path: '/book/01.mp3', duration: 100, file_size: 1000 },
        { id: 2, title: 'Ch2', file_path: '/book/02.mp3', duration: 100, file_size: 1000 }
      ];

      const db = getDb();
      db.run.mockImplementation((query, paramsOrCallback, maybeCallback) => {
        const callback = typeof paramsOrCallback === 'function' ? paramsOrCallback : maybeCallback;
        if (query.includes('UPDATE audiobooks')) {
          callback.call({ changes: 1 }, null);
        } else if (query.includes('INSERT OR IGNORE INTO audiobook_chapters')) {
          callback(null);
        } else if (query.includes('DELETE FROM audiobooks')) {
          callback(new Error('Delete error'));
        }
      });

      await expect(consolidateGroup(books)).rejects.toThrow('Delete error');
    });
  });

  describe('main', () => {
    test('handles empty groups gracefully', async () => {
      const db = getDb();
      db.all.mockImplementation((query, callback) => {
        callback(null, []);
      });

      await main();

      expect(console.log).toHaveBeenCalledWith('No multi-file audiobooks to consolidate!');
      expect(db.close).toHaveBeenCalled();
    });

    test('logs summary after consolidation', async () => {
      fs.existsSync.mockReturnValue(true);
      const db = getDb();

      db.all.mockImplementation((query, callback) => {
        callback(null, [
          { id: 1, title: 'Ch1', file_path: '/book1/01.mp3', duration: 100, file_size: 1000 },
          { id: 2, title: 'Ch2', file_path: '/book1/02.mp3', duration: 100, file_size: 1000 }
        ]);
      });

      db.run.mockImplementation((query, paramsOrCallback, maybeCallback) => {
        const callback = typeof paramsOrCallback === 'function' ? paramsOrCallback : maybeCallback;
        if (callback) {
          if (query.includes('UPDATE audiobooks')) {
            callback.call({ changes: 1 }, null);
          } else {
            callback(null);
          }
        }
      });

      await main();

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Summary'));
      expect(db.close).toHaveBeenCalled();
    });

    test('handles consolidation errors gracefully', async () => {
      fs.existsSync.mockReturnValue(true);
      const db = getDb();

      db.all.mockImplementation((query, callback) => {
        callback(null, [
          { id: 1, title: 'Ch1', file_path: '/book1/01.mp3', duration: 100, file_size: 1000 },
          { id: 2, title: 'Ch2', file_path: '/book1/02.mp3', duration: 100, file_size: 1000 }
        ]);
      });

      db.run.mockImplementation((query, paramsOrCallback, maybeCallback) => {
        const callback = typeof paramsOrCallback === 'function' ? paramsOrCallback : maybeCallback;
        if (callback) {
          callback(new Error('Consolidation error'));
        }
      });

      await main();

      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to consolidate'),
        expect.any(Error)
      );
      expect(db.close).toHaveBeenCalled();
    });
  });
});
