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

/**
 * Tests for actual libraryScanner.js module exports
 * These test the real functions with mocked dependencies
 */
describe('Library Scanner - Module Exports', () => {
  let libraryScanner;
  let mockDb;
  let mockWebsocketManager;

  beforeEach(() => {
    jest.resetModules();

    // Mock database
    mockDb = {
      run: jest.fn((sql, params, cb) => {
        if (typeof params === 'function') { params(null); return; }
        if (cb) cb.call({ changes: 1 }, null);
      }),
      get: jest.fn((sql, params, cb) => {
        if (cb) cb(null, null);
      }),
      all: jest.fn((sql, params, cb) => {
        if (typeof params === 'function') { params(null, []); return; }
        if (cb) cb(null, []);
      }),
      serialize: jest.fn((fn) => { if (fn) fn(); }),
    };

    mockWebsocketManager = {
      broadcastLibraryUpdate: jest.fn(),
    };

    // Mock all dependencies
    jest.doMock('../../server/database', () => mockDb);
    jest.doMock('../../server/services/websocketManager', () => mockWebsocketManager);
    jest.doMock('../../server/services/fileProcessor', () => ({
      extractFileMetadata: jest.fn().mockResolvedValue({
        title: 'Test Book', author: 'Author', duration: 3600,
      }),
    }));
    jest.doMock('../../server/utils/contentHash', () => ({
      generateBestHash: jest.fn().mockReturnValue('testhash123'),
    }));
    jest.doMock('../../server/services/fileOrganizer', () => ({
      organizeAudiobook: jest.fn().mockResolvedValue(null),
    }));
    jest.doMock('../../server/services/emailService', () => ({
      notifyNewAudiobook: jest.fn().mockResolvedValue(null),
    }));
    jest.doMock('../../server/utils/externalMetadata', () => ({
      readExternalMetadata: jest.fn().mockResolvedValue({}),
      mergeExternalMetadata: jest.fn(),
    }));
    jest.doMock('../../server/services/backupService', () => ({
      getStatus: jest.fn().mockReturnValue({
        scheduledBackups: false,
        lastBackup: null,
        lastResult: null,
      }),
    }));
    jest.doMock('../../server/routes/audiobooks', () => ({
      isDirectoryBeingConverted: jest.fn().mockReturnValue(false),
    }));

    // Suppress console output
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    // Stop any periodic scans that might be running
    if (libraryScanner) {
      libraryScanner.stopPeriodicScan();
    }
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  function loadScanner() {
    // Mock fs for the module-level existsSync + mkdirSync call
    jest.doMock('fs', () => ({
      existsSync: jest.fn().mockReturnValue(true),
      mkdirSync: jest.fn(),
      readdirSync: jest.fn().mockReturnValue([]),
      statSync: jest.fn().mockReturnValue({ size: 1000000 }),
      rmdirSync: jest.fn(),
    }));

    libraryScanner = require('../../server/services/libraryScanner');
    return libraryScanner;
  }

  describe('lockScanning / unlockScanning / isScanningLocked', () => {
    it('starts unlocked', () => {
      loadScanner();
      expect(libraryScanner.isScanningLocked()).toBe(false);
    });

    it('locks scanning', () => {
      loadScanner();
      libraryScanner.lockScanning();
      expect(libraryScanner.isScanningLocked()).toBe(true);
    });

    it('unlocks scanning', () => {
      loadScanner();
      libraryScanner.lockScanning();
      libraryScanner.unlockScanning();
      expect(libraryScanner.isScanningLocked()).toBe(false);
    });
  });

  describe('getJobStatus', () => {
    it('returns job status object with expected keys', () => {
      loadScanner();
      const status = libraryScanner.getJobStatus();

      expect(status.libraryScanner).toBeDefined();
      expect(status.libraryScanner.name).toBe('Library Scanner');
      expect(status.libraryScanner.status).toBe('idle');
      expect(status.libraryScanner.canTrigger).toBe(true);

      expect(status.autoBackup).toBeDefined();
      expect(status.sessionCleanup).toBeDefined();
      expect(status.logRotator).toBeDefined();
    });

    it('reports locked status when scanning is locked', () => {
      loadScanner();
      libraryScanner.lockScanning();
      const status = libraryScanner.getJobStatus();
      expect(status.libraryScanner.status).toBe('locked');
      libraryScanner.unlockScanning();
    });
  });

  describe('startPeriodicScan / stopPeriodicScan', () => {
    it('starts and stops periodic scanning', () => {
      jest.useFakeTimers();
      loadScanner();

      libraryScanner.startPeriodicScan(10);
      // Calling again should not create a second interval
      libraryScanner.startPeriodicScan(10);
      libraryScanner.stopPeriodicScan();
    });

    it('stopPeriodicScan is idempotent', () => {
      loadScanner();
      // Calling stop when not started should not throw
      libraryScanner.stopPeriodicScan();
      libraryScanner.stopPeriodicScan();
    });
  });

  describe('markAvailable', () => {
    it('marks audiobook as available without new path', async () => {
      loadScanner();
      mockDb.run = jest.fn((sql, params, cb) => {
        if (cb) cb(null);
      });

      await libraryScanner.markAvailable(1);
      expect(mockDb.run).toHaveBeenCalledWith(
        expect.stringContaining('is_available = 1'),
        [1],
        expect.any(Function)
      );
    });

    it('marks audiobook as available with new file path', async () => {
      loadScanner();
      mockDb.run = jest.fn((sql, params, cb) => {
        if (cb) cb(null);
      });

      await libraryScanner.markAvailable(1, '/new/path.m4b');
      expect(mockDb.run).toHaveBeenCalledWith(
        expect.stringContaining('file_path = ?'),
        ['/new/path.m4b', 1],
        expect.any(Function)
      );
    });

    it('rejects on database error', async () => {
      loadScanner();
      mockDb.run = jest.fn((sql, params, cb) => {
        if (cb) cb(new Error('DB error'));
      });

      await expect(libraryScanner.markAvailable(1)).rejects.toThrow('DB error');
    });
  });

  describe('markUnavailable', () => {
    it('marks audiobook as unavailable and broadcasts', async () => {
      loadScanner();
      mockDb.run = jest.fn((sql, params, cb) => {
        if (cb) cb(null);
      });

      await libraryScanner.markUnavailable(42);
      expect(mockDb.run).toHaveBeenCalledWith(
        expect.stringContaining('is_available = 0'),
        [42],
        expect.any(Function)
      );
      expect(mockWebsocketManager.broadcastLibraryUpdate).toHaveBeenCalledWith(
        'library.unavailable',
        { id: 42 }
      );
    });

    it('rejects on database error', async () => {
      loadScanner();
      mockDb.run = jest.fn((sql, params, cb) => {
        if (cb) cb(new Error('DB error'));
      });

      await expect(libraryScanner.markUnavailable(1)).rejects.toThrow('DB error');
    });
  });

  describe('checkAvailability', () => {
    it('marks missing files as unavailable', async () => {
      const mockFs = {
        existsSync: jest.fn().mockImplementation((p) => {
          if (p === '/books/missing.m4b') return false;
          return true;
        }),
        mkdirSync: jest.fn(),
        readdirSync: jest.fn().mockReturnValue([]),
        statSync: jest.fn().mockReturnValue({ size: 1000000 }),
        rmdirSync: jest.fn(),
      };
      jest.doMock('fs', () => mockFs);

      libraryScanner = require('../../server/services/libraryScanner');

      mockDb.all = jest.fn((sql, params, cb) => {
        if (typeof params === 'function') { params(null, []); return; }
        if (sql.includes('SELECT * FROM audiobooks')) {
          cb(null, [
            { id: 1, file_path: '/books/missing.m4b', is_available: 1, is_multi_file: 0 },
          ]);
        } else {
          cb(null, []);
        }
      });

      mockDb.run = jest.fn((sql, params, cb) => {
        if (cb) cb(null);
      });

      const result = await libraryScanner.checkAvailability();
      expect(result.missing).toBe(1);
      expect(result.restored).toBe(0);
    });

    it('restores returned files', async () => {
      const mockFs = {
        existsSync: jest.fn().mockReturnValue(true),
        mkdirSync: jest.fn(),
        readdirSync: jest.fn().mockReturnValue([]),
        statSync: jest.fn().mockReturnValue({ size: 1000000 }),
        rmdirSync: jest.fn(),
      };
      jest.doMock('fs', () => mockFs);

      libraryScanner = require('../../server/services/libraryScanner');

      mockDb.all = jest.fn((sql, params, cb) => {
        if (typeof params === 'function') { params(null, []); return; }
        if (sql.includes('SELECT * FROM audiobooks')) {
          cb(null, [
            { id: 1, file_path: '/books/returned.m4b', is_available: 0, is_multi_file: 0 },
          ]);
        } else {
          cb(null, []);
        }
      });

      mockDb.run = jest.fn((sql, params, cb) => {
        if (cb) cb(null);
      });

      const result = await libraryScanner.checkAvailability();
      expect(result.restored).toBe(1);
      expect(result.missing).toBe(0);
    });
  });

  describe('scanLibrary', () => {
    it('creates audiobooks directory if missing', async () => {
      let mkdirCalled = false;
      const mockFs = {
        existsSync: jest.fn().mockImplementation((p) => {
          // Audiobooks dir does not exist initially
          if (p.includes('audiobooks') && !mkdirCalled) return false;
          return true;
        }),
        mkdirSync: jest.fn().mockImplementation(() => { mkdirCalled = true; }),
        readdirSync: jest.fn().mockReturnValue([]),
        statSync: jest.fn().mockReturnValue({ size: 1000000 }),
        rmdirSync: jest.fn(),
      };
      jest.doMock('fs', () => mockFs);

      libraryScanner = require('../../server/services/libraryScanner');

      const result = await libraryScanner.scanLibrary();
      expect(result.imported).toBe(0);
      expect(result.skipped).toBe(0);
      expect(result.errors).toBe(0);
    });

    it('returns stats for empty library', async () => {
      const mockFs = {
        existsSync: jest.fn().mockReturnValue(true),
        mkdirSync: jest.fn(),
        readdirSync: jest.fn().mockImplementation((dir, opts) => {
          if (opts && opts.withFileTypes) return [];
          return [];
        }),
        statSync: jest.fn().mockReturnValue({ size: 1000000 }),
        rmdirSync: jest.fn(),
      };
      jest.doMock('fs', () => mockFs);

      libraryScanner = require('../../server/services/libraryScanner');

      // Mock loadPathCache db.all
      mockDb.all = jest.fn((sql, params, cb) => {
        if (typeof params === 'function') { params(null, []); return; }
        cb(null, []);
      });
      mockDb.run = jest.fn((sql, params, cb) => {
        if (cb) cb(null);
      });

      const result = await libraryScanner.scanLibrary();
      expect(result).toHaveProperty('imported');
      expect(result).toHaveProperty('skipped');
      expect(result).toHaveProperty('errors');
      expect(result).toHaveProperty('totalFiles');
    });
  });
});
