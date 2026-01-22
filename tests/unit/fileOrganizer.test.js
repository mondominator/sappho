/**
 * Unit tests for File Organizer Service
 */

// Mock dependencies before requiring the module
jest.mock('../../server/database', () => ({
  all: jest.fn(),
  run: jest.fn()
}));
jest.mock('../../server/services/websocketManager', () => ({
  broadcastLibraryUpdate: jest.fn()
}));
jest.mock('fs');

// Set test environment variable
process.env.AUDIOBOOKS_DIR = '/test/audiobooks';

const path = require('path');
const fs = require('fs');
const db = require('../../server/database');
const websocketManager = require('../../server/services/websocketManager');

const {
  getTargetDirectory,
  getTargetFilename,
  needsOrganization,
  sanitizeName,
  cleanupEmptyDirectories,
  organizeAudiobook,
  organizeLibrary,
  getOrganizationPreview
} = require('../../server/services/fileOrganizer');

describe('File Organizer Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('sanitizeName', () => {
    test('removes invalid file path characters', () => {
      expect(sanitizeName('Test<>:"/\\|?*Book')).toBe('Test_________Book');
    });

    test('normalizes whitespace', () => {
      expect(sanitizeName('Test   Book')).toBe('Test Book');
    });

    test('trims whitespace', () => {
      expect(sanitizeName('  Test Book  ')).toBe('Test Book');
    });

    test('returns null for empty input', () => {
      expect(sanitizeName('')).toBeNull();
      expect(sanitizeName(null)).toBeNull();
      expect(sanitizeName(undefined)).toBeNull();
    });

    test('handles normal text unchanged', () => {
      expect(sanitizeName('Normal Book Title')).toBe('Normal Book Title');
    });

    test('removes control characters', () => {
      expect(sanitizeName('Test\x00Book')).toBe('Test_Book');
    });
  });

  describe('getTargetFilename', () => {
    test('uses audiobook title with original extension', () => {
      const audiobook = { title: 'The Great Gatsby' };
      const result = getTargetFilename(audiobook, '/path/to/file.m4b');
      expect(result).toBe('The Great Gatsby.m4b');
    });

    test('sanitizes title', () => {
      const audiobook = { title: 'Test: A Book?' };
      const result = getTargetFilename(audiobook, '/path/to/file.mp3');
      expect(result).toBe('Test_ A Book_.mp3');
    });

    test('uses Unknown Title when title is missing', () => {
      const audiobook = { title: null };
      const result = getTargetFilename(audiobook, '/path/to/file.m4b');
      expect(result).toBe('Unknown Title.m4b');
    });

    test('preserves different extensions', () => {
      const audiobook = { title: 'Test' };
      expect(getTargetFilename(audiobook, '/file.m4b')).toBe('Test.m4b');
      expect(getTargetFilename(audiobook, '/file.mp3')).toBe('Test.mp3');
      expect(getTargetFilename(audiobook, '/file.flac')).toBe('Test.flac');
    });
  });

  describe('getTargetDirectory', () => {
    test('creates Author/Title path without series', () => {
      const audiobook = {
        title: 'Standalone Book',
        author: 'John Author',
        series: null,
        series_position: null
      };

      const result = getTargetDirectory(audiobook);
      expect(result).toBe(path.join('/test/audiobooks', 'John Author', 'Standalone Book'));
    });

    test('creates Author/Series/Position - Title path with series', () => {
      const audiobook = {
        title: 'Book One',
        author: 'Jane Writer',
        series: 'The Series',
        series_position: 1
      };

      const result = getTargetDirectory(audiobook);
      expect(result).toBe(path.join('/test/audiobooks', 'Jane Writer', 'The Series', '01 - Book One'));
    });

    test('omits position prefix when position is null', () => {
      const audiobook = {
        title: 'Unnumbered Book',
        author: 'Author Name',
        series: 'Some Series',
        series_position: null
      };

      const result = getTargetDirectory(audiobook);
      expect(result).toBe(path.join('/test/audiobooks', 'Author Name', 'Some Series', 'Unnumbered Book'));
    });

    test('uses Unknown Author when author is missing', () => {
      const audiobook = {
        title: 'Orphan Book',
        author: null,
        series: null,
        series_position: null
      };

      const result = getTargetDirectory(audiobook);
      expect(result).toBe(path.join('/test/audiobooks', 'Unknown Author', 'Orphan Book'));
    });

    test('uses Unknown Title when title is missing', () => {
      const audiobook = {
        title: null,
        author: 'Known Author',
        series: null,
        series_position: null
      };

      const result = getTargetDirectory(audiobook);
      expect(result).toBe(path.join('/test/audiobooks', 'Known Author', 'Unknown Title'));
    });

    test('handles decimal series positions', () => {
      const audiobook = {
        title: 'Side Story',
        author: 'Author',
        series: 'Main Series',
        series_position: 1.5
      };

      const result = getTargetDirectory(audiobook);
      expect(result).toContain('01.5 - Side Story');
    });

    test('handles double digit series positions', () => {
      const audiobook = {
        title: 'Later Book',
        author: 'Author',
        series: 'Long Series',
        series_position: 12
      };

      const result = getTargetDirectory(audiobook);
      expect(result).toContain('12 - Later Book');
    });
  });

  describe('needsOrganization', () => {
    test('returns true when directory differs', () => {
      const audiobook = {
        title: 'Book Title',
        author: 'Author Name',
        series: null,
        series_position: null,
        file_path: '/old/path/file.m4b'
      };

      const result = needsOrganization(audiobook);
      expect(result).toBe(true);
    });

    test('returns true when filename differs', () => {
      const audiobook = {
        title: 'Book Title',
        author: 'Author Name',
        series: null,
        series_position: null,
        file_path: path.join('/test/audiobooks', 'Author Name', 'Book Title', 'wrong-name.m4b')
      };

      const result = needsOrganization(audiobook);
      expect(result).toBe(true);
    });

    test('returns false when file is already organized', () => {
      const audiobook = {
        title: 'Book Title',
        author: 'Author Name',
        series: null,
        series_position: null,
        file_path: path.join('/test/audiobooks', 'Author Name', 'Book Title', 'Book Title.m4b')
      };

      const result = needsOrganization(audiobook);
      expect(result).toBe(false);
    });
  });

  describe('cleanupEmptyDirectories', () => {
    test('does not delete main audiobooks directory', () => {
      cleanupEmptyDirectories('/test/audiobooks');
      expect(fs.rmdirSync).not.toHaveBeenCalled();
    });

    test('deletes empty directory and recurses', () => {
      fs.readdirSync.mockReturnValueOnce([]).mockReturnValueOnce(['something']);

      cleanupEmptyDirectories('/test/audiobooks/Author/Book');

      expect(fs.rmdirSync).toHaveBeenCalledWith('/test/audiobooks/Author/Book');
    });

    test('does not delete non-empty directory', () => {
      fs.readdirSync.mockReturnValue(['file.txt']);

      cleanupEmptyDirectories('/test/audiobooks/Author/Book');

      expect(fs.rmdirSync).not.toHaveBeenCalled();
    });

    test('handles errors gracefully', () => {
      fs.readdirSync.mockImplementation(() => {
        throw new Error('Directory not found');
      });

      // Should not throw
      expect(() => cleanupEmptyDirectories('/nonexistent/path')).not.toThrow();
    });
  });

  describe('organizeAudiobook', () => {
    test('returns moved: false when no organization needed', async () => {
      const audiobook = {
        id: 1,
        title: 'Book Title',
        author: 'Author Name',
        series: null,
        series_position: null,
        file_path: path.join('/test/audiobooks', 'Author Name', 'Book Title', 'Book Title.m4b')
      };

      const result = await organizeAudiobook(audiobook);
      expect(result).toEqual({ moved: false });
    });

    test('returns error when source file not found', async () => {
      fs.existsSync.mockReturnValue(false);

      const audiobook = {
        id: 1,
        title: 'Book Title',
        author: 'Author Name',
        series: null,
        series_position: null,
        file_path: '/old/path/file.m4b'
      };

      const result = await organizeAudiobook(audiobook);
      expect(result).toEqual({ moved: false, error: 'Source file not found' });
    });

    test('moves file and updates database', async () => {
      fs.existsSync.mockImplementation((p) => {
        // Source exists, target dir doesn't, target file doesn't
        if (p === '/old/path/file.m4b') return true;
        if (p.startsWith('/test/audiobooks')) return false;
        return false;
      });
      fs.renameSync.mockImplementation(() => {});
      fs.mkdirSync.mockImplementation(() => {});
      fs.readdirSync.mockReturnValue(['remaining-file.txt']);
      db.run.mockImplementation((query, params, callback) => {
        callback(null);
      });

      const audiobook = {
        id: 1,
        title: 'Book Title',
        author: 'Author Name',
        series: null,
        series_position: null,
        file_path: '/old/path/file.m4b',
        is_multi_file: false
      };

      const result = await organizeAudiobook(audiobook);
      expect(result.moved).toBe(true);
      expect(result.newPath).toContain('Book Title.m4b');
      expect(websocketManager.broadcastLibraryUpdate).toHaveBeenCalled();
    });

    test('handles filename conflicts', async () => {
      let existsCallCount = 0;
      fs.existsSync.mockImplementation((p) => {
        existsCallCount++;
        // Source exists
        if (p === '/old/path/file.m4b') return true;
        // Target dir exists
        if (p === path.join('/test/audiobooks', 'Author Name', 'Book Title')) return true;
        // First target file exists, second doesn't
        if (p.endsWith('Book Title.m4b') && existsCallCount <= 4) return true;
        return false;
      });
      fs.renameSync.mockImplementation(() => {});
      fs.mkdirSync.mockImplementation(() => {});
      fs.readdirSync.mockReturnValue(['remaining-file.txt']);
      db.run.mockImplementation((query, params, callback) => {
        callback(null);
      });

      const audiobook = {
        id: 1,
        title: 'Book Title',
        author: 'Author Name',
        series: null,
        series_position: null,
        file_path: '/old/path/file.m4b',
        is_multi_file: false
      };

      const result = await organizeAudiobook(audiobook);
      expect(result.moved).toBe(true);
      // Should have added a (1) suffix
      expect(result.newPath).toContain('(1)');
    });

    test('handles cross-filesystem move', async () => {
      fs.existsSync.mockImplementation((p) => {
        if (p === '/old/path/file.m4b') return true;
        if (p.startsWith('/test/audiobooks')) return false;
        return false;
      });
      fs.renameSync.mockImplementation(() => {
        const err = new Error('EXDEV: cross-device link not permitted');
        err.code = 'EXDEV';
        throw err;
      });
      fs.copyFileSync.mockImplementation(() => {});
      fs.statSync.mockReturnValue({ size: 1000000 });
      fs.unlinkSync.mockImplementation(() => {});
      fs.mkdirSync.mockImplementation(() => {});
      fs.readdirSync.mockReturnValue(['remaining-file.txt']);
      db.run.mockImplementation((query, params, callback) => {
        callback(null);
      });

      const audiobook = {
        id: 1,
        title: 'Book Title',
        author: 'Author Name',
        series: null,
        series_position: null,
        file_path: '/old/path/file.m4b',
        is_multi_file: false
      };

      const result = await organizeAudiobook(audiobook);
      expect(result.moved).toBe(true);
      expect(fs.copyFileSync).toHaveBeenCalled();
    });

    test('handles move failure', async () => {
      fs.existsSync.mockImplementation((p) => {
        if (p === '/old/path/file.m4b') return true;
        if (p.startsWith('/test/audiobooks')) return false;
        return false;
      });
      fs.renameSync.mockImplementation(() => {
        throw new Error('Permission denied');
      });
      fs.copyFileSync.mockImplementation(() => {
        throw new Error('Disk full');
      });
      fs.mkdirSync.mockImplementation(() => {});

      const audiobook = {
        id: 1,
        title: 'Book Title',
        author: 'Author Name',
        series: null,
        series_position: null,
        file_path: '/old/path/file.m4b',
        is_multi_file: false
      };

      const result = await organizeAudiobook(audiobook);
      expect(result.moved).toBe(false);
      expect(result.error).toBe('Failed to move audio file');
    });

    test('handles file size mismatch after copy', async () => {
      fs.existsSync.mockImplementation((p) => {
        if (p === '/old/path/file.m4b') return true;
        if (p.startsWith('/test/audiobooks')) return false;
        return false;
      });
      fs.renameSync.mockImplementation(() => {
        throw new Error('EXDEV');
      });
      fs.copyFileSync.mockImplementation(() => {});
      fs.statSync.mockImplementation((p) => {
        // Return different sizes for source and dest
        if (p === '/old/path/file.m4b') return { size: 1000000 };
        return { size: 999999 }; // Different size!
      });
      fs.unlinkSync.mockImplementation(() => {});
      fs.mkdirSync.mockImplementation(() => {});

      const audiobook = {
        id: 1,
        title: 'Book Title',
        author: 'Author Name',
        series: null,
        series_position: null,
        file_path: '/old/path/file.m4b',
        is_multi_file: false
      };

      const result = await organizeAudiobook(audiobook);
      expect(result.moved).toBe(false);
      expect(result.error).toBe('Failed to move audio file');
    });

    test('moves cover art when in same directory', async () => {
      fs.existsSync.mockImplementation((p) => {
        if (p === '/old/path/file.m4b') return true;
        if (p === '/old/path/cover.jpg') return true;
        if (p.startsWith('/test/audiobooks')) return false;
        return false;
      });
      fs.renameSync.mockImplementation(() => {});
      fs.mkdirSync.mockImplementation(() => {});
      fs.readdirSync.mockReturnValue(['remaining-file.txt']);
      db.run.mockImplementation((query, params, callback) => {
        callback(null);
      });

      const audiobook = {
        id: 1,
        title: 'Book Title',
        author: 'Author Name',
        series: null,
        series_position: null,
        file_path: '/old/path/file.m4b',
        cover_path: '/old/path/cover.jpg',
        is_multi_file: false
      };

      const result = await organizeAudiobook(audiobook);
      expect(result.moved).toBe(true);
      // Should have called rename twice (main file + cover)
      expect(fs.renameSync).toHaveBeenCalledTimes(2);
    });

    test('handles multi-file audiobooks', async () => {
      fs.existsSync.mockImplementation((p) => {
        if (p === '/old/path/file.m4b') return true;
        if (p === '/old/path/chapter1.mp3') return true;
        if (p === '/old/path/chapter2.mp3') return true;
        if (p.startsWith('/test/audiobooks')) return false;
        return false;
      });
      fs.renameSync.mockImplementation(() => {});
      fs.mkdirSync.mockImplementation(() => {});
      fs.readdirSync.mockReturnValue(['remaining-file.txt']);
      db.all.mockImplementation((query, params, callback) => {
        callback(null, [
          { file_path: '/old/path/chapter1.mp3' },
          { file_path: '/old/path/chapter2.mp3' }
        ]);
      });
      db.run.mockImplementation((query, params, callback) => {
        callback(null);
      });

      const audiobook = {
        id: 1,
        title: 'Book Title',
        author: 'Author Name',
        series: null,
        series_position: null,
        file_path: '/old/path/file.m4b',
        is_multi_file: true
      };

      const result = await organizeAudiobook(audiobook);
      expect(result.moved).toBe(true);
      // Main file + 2 chapters = 3 moves
      expect(fs.renameSync).toHaveBeenCalledTimes(3);
    });

    test('catches unexpected errors', async () => {
      fs.existsSync.mockImplementation((p) => {
        if (p === '/old/path/file.m4b') return true;
        if (p.startsWith('/test/audiobooks')) return false;
        return false;
      });
      fs.renameSync.mockImplementation(() => {});
      fs.mkdirSync.mockImplementation(() => {});
      fs.readdirSync.mockReturnValue(['file']);
      db.run.mockImplementation((query, params, callback) => {
        callback(new Error('Database error'));
      });

      const audiobook = {
        id: 1,
        title: 'Book Title',
        author: 'Author Name',
        series: null,
        series_position: null,
        file_path: '/old/path/file.m4b',
        is_multi_file: false
      };

      const result = await organizeAudiobook(audiobook);
      expect(result.moved).toBe(false);
      expect(result.error).toBe('Database error');
    });
  });

  describe('organizeLibrary', () => {
    test('organizes all audiobooks and returns stats', async () => {
      db.all.mockImplementation((query, params, callback) => {
        callback(null, [
          {
            id: 1,
            title: 'Book 1',
            author: 'Author',
            series: null,
            file_path: '/test/audiobooks/Author/Book 1/Book 1.m4b'
          },
          {
            id: 2,
            title: 'Book 2',
            author: 'Author',
            series: null,
            file_path: '/old/path/book2.m4b'
          }
        ]);
      });

      // First book is already organized, second needs moving
      fs.existsSync.mockImplementation((p) => {
        if (p === '/old/path/book2.m4b') return true;
        return false;
      });
      fs.renameSync.mockImplementation(() => {});
      fs.mkdirSync.mockImplementation(() => {});
      fs.readdirSync.mockReturnValue(['file']);
      db.run.mockImplementation((query, params, callback) => {
        callback(null);
      });

      const result = await organizeLibrary();
      expect(result.skipped).toBe(1); // First book
      expect(result.moved).toBe(1); // Second book
      expect(result.errors).toBe(0);
    });

    test('handles empty library', async () => {
      db.all.mockImplementation((query, params, callback) => {
        callback(null, []);
      });

      const result = await organizeLibrary();
      expect(result).toEqual({ moved: 0, skipped: 0, errors: 0 });
    });

    test('counts errors when organization fails', async () => {
      db.all.mockImplementation((query, params, callback) => {
        callback(null, [
          {
            id: 1,
            title: 'Book 1',
            author: 'Author',
            series: null,
            file_path: '/old/path/book1.m4b' // Needs organization
          }
        ]);
      });

      fs.existsSync.mockReturnValue(false); // File not found = error

      const result = await organizeLibrary();
      expect(result.errors).toBe(1);
      expect(result.moved).toBe(0);
      expect(result.skipped).toBe(0);
    });
  });

  describe('getOrganizationPreview', () => {
    test('returns list of books needing organization', async () => {
      db.all.mockImplementation((query, params, callback) => {
        callback(null, [
          {
            id: 1,
            title: 'Book 1',
            author: 'Author',
            series: null,
            file_path: '/test/audiobooks/Author/Book 1/Book 1.m4b'
          },
          {
            id: 2,
            title: 'Book 2',
            author: 'Author',
            series: null,
            file_path: '/old/path/book2.m4b'
          }
        ]);
      });

      const result = await getOrganizationPreview();
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(2);
      expect(result[0].currentPath).toBe('/old/path/book2.m4b');
      expect(result[0].targetPath).toContain('Book 2');
    });

    test('returns empty array when all books are organized', async () => {
      db.all.mockImplementation((query, params, callback) => {
        callback(null, [
          {
            id: 1,
            title: 'Book 1',
            author: 'Author',
            series: null,
            file_path: path.join('/test/audiobooks', 'Author', 'Book 1', 'Book 1.m4b')
          }
        ]);
      });

      const result = await getOrganizationPreview();
      expect(result).toHaveLength(0);
    });
  });
});
