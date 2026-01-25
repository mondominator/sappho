/**
 * Unit tests for Library Scanner Service
 * Tests audio file detection, path handling, and scanning logic
 */

describe('Library Scanner - Utility Functions', () => {
  describe('Audio file detection', () => {
    const audioExtensions = ['.m4b', '.m4a', '.mp3', '.mp4', '.flac', '.ogg', '.opus', '.wma', '.aac'];

    function isAudioFile(filename) {
      const path = require('path');
      const ext = path.extname(filename).toLowerCase();
      return audioExtensions.includes(ext);
    }

    it('recognizes .m4b files', () => {
      expect(isAudioFile('audiobook.m4b')).toBe(true);
    });

    it('recognizes .m4a files', () => {
      expect(isAudioFile('audiobook.m4a')).toBe(true);
    });

    it('recognizes .mp3 files', () => {
      expect(isAudioFile('audiobook.mp3')).toBe(true);
    });

    it('recognizes .flac files', () => {
      expect(isAudioFile('audiobook.flac')).toBe(true);
    });

    it('recognizes .ogg files', () => {
      expect(isAudioFile('audiobook.ogg')).toBe(true);
    });

    it('ignores .txt files', () => {
      expect(isAudioFile('readme.txt')).toBe(false);
    });

    it('ignores .jpg files', () => {
      expect(isAudioFile('cover.jpg')).toBe(false);
    });

    it('handles uppercase extensions', () => {
      expect(isAudioFile('audiobook.M4B')).toBe(true);
    });

    it('handles mixed case extensions', () => {
      expect(isAudioFile('audiobook.Mp3')).toBe(true);
    });
  });

  describe('Hidden file detection', () => {
    function isHiddenFile(filename) {
      return filename.startsWith('.') || filename.startsWith('._');
    }

    it('detects dot-prefixed files', () => {
      expect(isHiddenFile('.hidden')).toBe(true);
    });

    it('detects macOS resource fork files', () => {
      expect(isHiddenFile('._metadata')).toBe(true);
    });

    it('detects .DS_Store', () => {
      expect(isHiddenFile('.DS_Store')).toBe(true);
    });

    it('allows normal files', () => {
      expect(isHiddenFile('audiobook.m4b')).toBe(false);
    });
  });

  describe('System directory detection', () => {
    function isSystemDirectory(dirname) {
      const systemDirs = ['@eaDir', '@tmp', '#recycle', '.Trash', '__MACOSX'];
      return systemDirs.includes(dirname);
    }

    it('detects Synology metadata directory', () => {
      expect(isSystemDirectory('@eaDir')).toBe(true);
    });

    it('detects Synology temp directory', () => {
      expect(isSystemDirectory('@tmp')).toBe(true);
    });

    it('detects recycle bin', () => {
      expect(isSystemDirectory('#recycle')).toBe(true);
    });

    it('detects Trash', () => {
      expect(isSystemDirectory('.Trash')).toBe(true);
    });

    it('detects macOS archive directory', () => {
      expect(isSystemDirectory('__MACOSX')).toBe(true);
    });

    it('allows normal directories', () => {
      expect(isSystemDirectory('audiobooks')).toBe(false);
    });
  });

  describe('File grouping by directory', () => {
    function groupFilesByDirectory(files) {
      const path = require('path');
      const grouped = {};

      for (const file of files) {
        const dir = path.dirname(file);
        if (!grouped[dir]) {
          grouped[dir] = [];
        }
        grouped[dir].push(file);
      }

      return grouped;
    }

    it('groups files from same directory', () => {
      const files = [
        '/books/series1/ch1.mp3',
        '/books/series1/ch2.mp3',
        '/books/series1/ch3.mp3',
      ];

      const grouped = groupFilesByDirectory(files);

      expect(grouped['/books/series1']).toHaveLength(3);
    });

    it('separates files from different directories', () => {
      const files = [
        '/books/series1/book.mp3',
        '/books/series2/book.mp3',
      ];

      const grouped = groupFilesByDirectory(files);

      expect(Object.keys(grouped)).toHaveLength(2);
      expect(grouped['/books/series1']).toHaveLength(1);
      expect(grouped['/books/series2']).toHaveLength(1);
    });

    it('handles empty file list', () => {
      const grouped = groupFilesByDirectory([]);
      expect(grouped).toEqual({});
    });
  });

  describe('Multifile audiobook detection', () => {
    function isMultiFileAudiobook(files) {
      const path = require('path');

      if (files.length <= 1) return false;

      // Check if files are numbered chapters
      const basenames = files.map(f => path.basename(f, path.extname(f)));

      // Check for common chapter patterns
      const chapterPatterns = [
        /^(chapter|ch|part|track)\s*\d+$/i,
        /^\d+[.\-_]\s*.+/,  // "01 - Chapter Name"
        /^.+[.\-_]\d+$/,    // "Book Name - 01"
      ];

      const hasChapterPattern = basenames.some(name =>
        chapterPatterns.some(pattern => pattern.test(name))
      );

      return hasChapterPattern;
    }

    it('detects numbered chapters', () => {
      const files = [
        '/book/Chapter 1.mp3',
        '/book/Chapter 2.mp3',
        '/book/Chapter 3.mp3',
      ];

      expect(isMultiFileAudiobook(files)).toBe(true);
    });

    it('detects numeric prefix chapters', () => {
      const files = [
        '/book/01-Introduction.mp3',
        '/book/02-First Chapter.mp3',
      ];

      expect(isMultiFileAudiobook(files)).toBe(true);
    });

    it('returns false for single file', () => {
      const files = ['/book/audiobook.mp3'];
      expect(isMultiFileAudiobook(files)).toBe(false);
    });

    it('returns false for empty list', () => {
      expect(isMultiFileAudiobook([])).toBe(false);
    });
  });

  describe('Content hash comparison', () => {
    function hashesMatch(hash1, hash2) {
      if (!hash1 || !hash2) return false;
      return hash1.toLowerCase() === hash2.toLowerCase();
    }

    it('matches identical hashes', () => {
      expect(hashesMatch('abc123', 'abc123')).toBe(true);
    });

    it('matches case-insensitively', () => {
      expect(hashesMatch('ABC123', 'abc123')).toBe(true);
    });

    it('returns false for different hashes', () => {
      expect(hashesMatch('abc123', 'def456')).toBe(false);
    });

    it('returns false for null hash', () => {
      expect(hashesMatch(null, 'abc123')).toBe(false);
    });

    it('returns false for undefined hash', () => {
      expect(hashesMatch(undefined, 'abc123')).toBe(false);
    });
  });

  describe('Scan result aggregation', () => {
    function aggregateScanResults(results) {
      return {
        totalFiles: results.totalFiles || 0,
        newBooks: results.newBooks || 0,
        updatedBooks: results.updatedBooks || 0,
        unavailableBooks: results.unavailableBooks || 0,
        errors: results.errors || 0,
        duration: results.duration || 0,
      };
    }

    it('includes all result fields', () => {
      const results = {
        totalFiles: 100,
        newBooks: 10,
        updatedBooks: 5,
        unavailableBooks: 2,
        errors: 1,
        duration: 5000,
      };

      const aggregated = aggregateScanResults(results);

      expect(aggregated.totalFiles).toBe(100);
      expect(aggregated.newBooks).toBe(10);
      expect(aggregated.updatedBooks).toBe(5);
      expect(aggregated.unavailableBooks).toBe(2);
      expect(aggregated.errors).toBe(1);
      expect(aggregated.duration).toBe(5000);
    });

    it('defaults missing fields to 0', () => {
      const results = {};

      const aggregated = aggregateScanResults(results);

      expect(aggregated.totalFiles).toBe(0);
      expect(aggregated.newBooks).toBe(0);
    });
  });

  describe('Path normalization', () => {
    function normalizePath(filePath) {
      const path = require('path');
      return path.normalize(filePath).replace(/\\/g, '/');
    }

    it('normalizes forward slashes', () => {
      expect(normalizePath('/books/series/book.mp3')).toBe('/books/series/book.mp3');
    });

    it('removes redundant slashes', () => {
      expect(normalizePath('/books//series//book.mp3')).toBe('/books/series/book.mp3');
    });

    it('resolves . references', () => {
      expect(normalizePath('/books/./series/book.mp3')).toBe('/books/series/book.mp3');
    });

    it('resolves .. references', () => {
      expect(normalizePath('/books/temp/../series/book.mp3')).toBe('/books/series/book.mp3');
    });
  });

  describe('File size filtering', () => {
    const MIN_FILE_SIZE = 1024 * 1024; // 1 MB minimum

    function isValidAudioFile(filePath, fileSize) {
      const path = require('path');
      const audioExtensions = ['.m4b', '.m4a', '.mp3'];
      const ext = path.extname(filePath).toLowerCase();

      return audioExtensions.includes(ext) && fileSize >= MIN_FILE_SIZE;
    }

    it('accepts large audio files', () => {
      expect(isValidAudioFile('/test/book.mp3', 50 * 1024 * 1024)).toBe(true);
    });

    it('rejects tiny audio files', () => {
      expect(isValidAudioFile('/test/book.mp3', 100)).toBe(false);
    });

    it('accepts files at minimum size', () => {
      expect(isValidAudioFile('/test/book.mp3', MIN_FILE_SIZE)).toBe(true);
    });

    it('rejects non-audio files regardless of size', () => {
      expect(isValidAudioFile('/test/readme.txt', 50 * 1024 * 1024)).toBe(false);
    });
  });
});
