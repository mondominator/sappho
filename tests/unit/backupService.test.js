/**
 * Unit tests for Backup Service
 */

// Mock fs before requiring the module
jest.mock('fs', () => ({
  existsSync: jest.fn(),
  mkdirSync: jest.fn(),
  mkdtempSync: jest.fn(),
  readdirSync: jest.fn(),
  statSync: jest.fn(),
  unlinkSync: jest.fn(),
  createWriteStream: jest.fn(),
  createReadStream: jest.fn(),
  copyFileSync: jest.fn(),
  openSync: jest.fn(),
  readSync: jest.fn(),
  closeSync: jest.fn(),
  rmSync: jest.fn(),
}));

// Mock database module for restore operations
jest.mock('../../server/database', () => ({
  checkpoint: jest.fn().mockResolvedValue(),
  closeDatabase: jest.fn().mockResolvedValue(),
  dbPath: '/app/data/sappho.db',
}));

// Mock archiver
const mockArchive = {
  pipe: jest.fn(),
  file: jest.fn(),
  directory: jest.fn(),
  append: jest.fn(),
  finalize: jest.fn(),
  on: jest.fn()
};
jest.mock('archiver', () => jest.fn(() => mockArchive));

// Mock unzipper
jest.mock('unzipper', () => ({
  Parse: jest.fn()
}));

const fs = require('fs');
const archiver = require('archiver');
const {
  createBackup,
  listBackups,
  getBackupPath,
  deleteBackup,
  restoreBackup,
  applyRetention,
  startScheduledBackups,
  stopScheduledBackups,
  getStatus,
  BACKUP_DIR
} = require('../../server/services/backupService');

describe('Backup Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation();
    jest.spyOn(console, 'error').mockImplementation();
  });

  afterEach(() => {
    console.log.mockRestore();
    console.error.mockRestore();
    stopScheduledBackups();
  });

  describe('BACKUP_DIR', () => {
    test('exports backup directory path', () => {
      expect(BACKUP_DIR).toBeDefined();
      expect(typeof BACKUP_DIR).toBe('string');
      expect(BACKUP_DIR).toContain('backups');
    });
  });

  describe('listBackups', () => {
    test('returns empty array when no backups exist', () => {
      fs.existsSync.mockReturnValue(true);
      fs.readdirSync.mockReturnValue([]);

      const result = listBackups();

      expect(result).toEqual([]);
    });

    test('creates backup directory if it does not exist', () => {
      fs.existsSync.mockReturnValue(false);
      fs.readdirSync.mockReturnValue([]);

      listBackups();

      expect(fs.mkdirSync).toHaveBeenCalledWith(
        expect.stringContaining('backups'),
        { recursive: true }
      );
    });

    test('returns formatted backup list', () => {
      fs.existsSync.mockReturnValue(true);
      fs.readdirSync.mockReturnValue([
        'sappho-backup-2024-01-15T10-00-00.zip',
        'sappho-backup-2024-01-14T10-00-00.zip'
      ]);
      fs.statSync.mockReturnValue({
        size: 1048576,
        mtime: new Date('2024-01-15T10:00:00Z')
      });

      const result = listBackups();

      expect(result.length).toBe(2);
      expect(result[0].filename).toContain('sappho-backup');
      expect(result[0].size).toBe(1048576);
      expect(result[0].sizeFormatted).toBe('1 MB');
    });

    test('filters out non-backup files', () => {
      fs.existsSync.mockReturnValue(true);
      fs.readdirSync.mockReturnValue([
        'sappho-backup-2024-01-15T10-00-00.zip',
        'other-file.txt',
        'random.zip'
      ]);
      fs.statSync.mockReturnValue({ size: 1024, mtime: new Date() });

      const result = listBackups();

      expect(result.length).toBe(1);
    });

    test('sorts backups by date descending', () => {
      fs.existsSync.mockReturnValue(true);
      fs.readdirSync.mockReturnValue([
        'sappho-backup-2024-01-13T10-00-00.zip',
        'sappho-backup-2024-01-15T10-00-00.zip',
        'sappho-backup-2024-01-14T10-00-00.zip'
      ]);
      fs.statSync.mockReturnValue({ size: 1024, mtime: new Date() });

      const result = listBackups();

      expect(result[0].filename).toContain('2024-01-15');
      expect(result[1].filename).toContain('2024-01-14');
      expect(result[2].filename).toContain('2024-01-13');
    });
  });

  describe('getBackupPath', () => {
    test('returns path for valid backup filename', () => {
      fs.existsSync.mockReturnValue(true);

      const result = getBackupPath('sappho-backup-2024-01-15T10-00-00.zip');

      expect(result).toContain('sappho-backup-2024-01-15T10-00-00.zip');
    });

    test('throws error for invalid filename without prefix', () => {
      expect(() => getBackupPath('malicious.zip')).toThrow('Invalid backup filename');
    });

    test('throws error for invalid filename without .zip', () => {
      expect(() => getBackupPath('sappho-backup-2024-01-15T10-00-00.tar')).toThrow('Invalid backup filename');
    });

    test('throws error when backup not found', () => {
      fs.existsSync.mockReturnValue(false);

      expect(() => getBackupPath('sappho-backup-2024-01-15T10-00-00.zip')).toThrow('Backup not found');
    });

    test('prevents directory traversal', () => {
      fs.existsSync.mockReturnValue(true);

      const result = getBackupPath('../../../etc/sappho-backup-2024-01-15T10-00-00.zip');

      expect(result).not.toContain('..');
      expect(result).toContain('sappho-backup-2024-01-15T10-00-00.zip');
    });
  });

  describe('deleteBackup', () => {
    test('deletes valid backup file', () => {
      fs.existsSync.mockReturnValue(true);

      const result = deleteBackup('sappho-backup-2024-01-15T10-00-00.zip');

      expect(fs.unlinkSync).toHaveBeenCalled();
      expect(result.success).toBe(true);
      expect(result.filename).toBe('sappho-backup-2024-01-15T10-00-00.zip');
    });

    test('logs deletion message', () => {
      fs.existsSync.mockReturnValue(true);

      deleteBackup('sappho-backup-2024-01-15T10-00-00.zip');

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('deleted'));
    });
  });

  describe('applyRetention', () => {
    test('does nothing when below retention limit', () => {
      fs.existsSync.mockReturnValue(true);
      fs.readdirSync.mockReturnValue([
        'sappho-backup-2024-01-15T10-00-00.zip',
        'sappho-backup-2024-01-14T10-00-00.zip'
      ]);
      fs.statSync.mockReturnValue({ size: 1024, mtime: new Date() });

      const result = applyRetention(7);

      expect(result.deleted).toBe(0);
      expect(fs.unlinkSync).not.toHaveBeenCalled();
    });

    test('deletes old backups over retention limit', () => {
      fs.existsSync.mockReturnValue(true);
      fs.readdirSync.mockReturnValue([
        'sappho-backup-2024-01-10T10-00-00.zip',
        'sappho-backup-2024-01-09T10-00-00.zip',
        'sappho-backup-2024-01-08T10-00-00.zip',
        'sappho-backup-2024-01-07T10-00-00.zip'
      ]);
      fs.statSync.mockReturnValue({ size: 1024, mtime: new Date() });

      const result = applyRetention(2);

      expect(result.deleted).toBe(2);
      expect(fs.unlinkSync).toHaveBeenCalledTimes(2);
    });

    test('handles deletion errors gracefully', () => {
      fs.existsSync.mockReturnValue(true);
      fs.readdirSync.mockReturnValue([
        'sappho-backup-2024-01-10T10-00-00.zip',
        'sappho-backup-2024-01-09T10-00-00.zip',
        'sappho-backup-2024-01-08T10-00-00.zip'
      ]);
      fs.statSync.mockReturnValue({ size: 1024, mtime: new Date() });
      fs.unlinkSync.mockImplementation(() => {
        throw new Error('Permission denied');
      });

      const result = applyRetention(1);

      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to delete'),
        expect.any(String)
      );
      expect(result.deleted).toBe(0);
    });
  });

  describe('startScheduledBackups', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    test('logs start message', () => {
      startScheduledBackups(24);

      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('Starting scheduled backups')
      );
    });

    test('does not start if already running', () => {
      startScheduledBackups(24);
      jest.clearAllMocks();

      startScheduledBackups(24);

      expect(console.log).toHaveBeenCalledWith('Scheduled backups already running');
    });
  });

  describe('stopScheduledBackups', () => {
    test('stops scheduled backups', () => {
      jest.useFakeTimers();
      startScheduledBackups(24);

      stopScheduledBackups();

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('stopped'));
      jest.useRealTimers();
    });

    test('does nothing if not running', () => {
      stopScheduledBackups();
      // Should not throw
    });
  });

  describe('getStatus', () => {
    test('returns status object', () => {
      fs.existsSync.mockReturnValue(true);
      fs.readdirSync.mockReturnValue([]);

      const status = getStatus();

      expect(status).toHaveProperty('backupDir');
      expect(status).toHaveProperty('scheduledBackups');
      expect(status).toHaveProperty('lastBackup');
      expect(status).toHaveProperty('lastResult');
      expect(status).toHaveProperty('backupCount');
    });

    test('reports scheduled backup status', () => {
      fs.existsSync.mockReturnValue(true);
      fs.readdirSync.mockReturnValue([]);

      let status = getStatus();
      expect(status.scheduledBackups).toBe(false);

      jest.useFakeTimers();
      startScheduledBackups(24);
      status = getStatus();
      expect(status.scheduledBackups).toBe(true);

      stopScheduledBackups();
      jest.useRealTimers();
    });

    test('reports backup count', () => {
      fs.existsSync.mockReturnValue(true);
      fs.readdirSync.mockReturnValue([
        'sappho-backup-2024-01-15T10-00-00.zip',
        'sappho-backup-2024-01-14T10-00-00.zip'
      ]);
      fs.statSync.mockReturnValue({ size: 1024, mtime: new Date() });

      const status = getStatus();

      expect(status.backupCount).toBe(2);
    });
  });

  describe('createBackup', () => {
    let mockOutput;

    beforeEach(() => {
      mockOutput = {
        on: jest.fn()
      };
      fs.createWriteStream.mockReturnValue(mockOutput);
      fs.existsSync.mockReturnValue(true);
      fs.readdirSync.mockReturnValue(['cover1.jpg', 'cover2.png']);
      fs.statSync.mockReturnValue({ size: 5242880 }); // 5 MB
    });

    test('creates backup archive with database', async () => {
      mockOutput.on.mockImplementation((event, callback) => {
        if (event === 'close') {
          setTimeout(callback, 0);
        }
        return mockOutput;
      });

      mockArchive.on.mockImplementation((event, callback) => {
        return mockArchive;
      });

      const resultPromise = createBackup(false);

      // Wait for the close callback to be triggered
      await new Promise(resolve => setTimeout(resolve, 10));

      const result = await resultPromise;

      expect(archiver).toHaveBeenCalledWith('zip', { zlib: { level: 9 } });
      expect(mockArchive.pipe).toHaveBeenCalledWith(mockOutput);
      expect(mockArchive.file).toHaveBeenCalled();
      expect(mockArchive.append).toHaveBeenCalled();
      expect(mockArchive.finalize).toHaveBeenCalled();
      expect(result.success).toBe(true);
      expect(result.filename).toContain('sappho-backup-');
    });

    test('includes covers when requested', async () => {
      mockOutput.on.mockImplementation((event, callback) => {
        if (event === 'close') {
          setTimeout(callback, 0);
        }
        return mockOutput;
      });

      mockArchive.on.mockReturnValue(mockArchive);

      const resultPromise = createBackup(true);
      await new Promise(resolve => setTimeout(resolve, 10));
      await resultPromise;

      expect(mockArchive.directory).toHaveBeenCalled();
    });

    test('handles archive error event', async () => {
      let errorCallback;
      mockOutput.on.mockReturnValue(mockOutput);
      mockArchive.on.mockImplementation((event, callback) => {
        if (event === 'error') {
          errorCallback = callback;
        }
        return mockArchive;
      });

      const resultPromise = createBackup(false);

      // Trigger the error callback
      if (errorCallback) {
        errorCallback(new Error('Archive failed'));
      }

      await expect(resultPromise).rejects.toThrow('Archive failed');
    });

    test('skips covers if directory is empty', async () => {
      fs.readdirSync.mockReturnValue([]);

      mockOutput.on.mockImplementation((event, callback) => {
        if (event === 'close') {
          setTimeout(callback, 0);
        }
        return mockOutput;
      });
      mockArchive.on.mockReturnValue(mockArchive);

      const resultPromise = createBackup(true);
      await new Promise(resolve => setTimeout(resolve, 10));
      await resultPromise;

      expect(mockArchive.directory).not.toHaveBeenCalled();
    });

    test('formats backup size correctly', async () => {
      fs.statSync.mockReturnValue({ size: 0 }); // 0 bytes

      mockOutput.on.mockImplementation((event, callback) => {
        if (event === 'close') {
          setTimeout(callback, 0);
        }
        return mockOutput;
      });
      mockArchive.on.mockReturnValue(mockArchive);

      const resultPromise = createBackup(false);
      await new Promise(resolve => setTimeout(resolve, 10));
      const result = await resultPromise;

      expect(result.size).toBe(0);
    });
  });

  describe('restoreBackup', () => {
    let mockReadStream;
    let mockParseStream;

    beforeEach(() => {
      const unzipper = require('unzipper');
      const db = require('../../server/database');

      mockParseStream = {
        on: jest.fn()
      };
      mockReadStream = {
        pipe: jest.fn().mockReturnValue(mockParseStream)
      };

      fs.createReadStream.mockReturnValue(mockReadStream);
      fs.mkdtempSync.mockReturnValue('/tmp/sappho-restore-test');
      unzipper.Parse.mockReturnValue({});

      // Reset database mocks
      db.checkpoint.mockResolvedValue();
      db.closeDatabase.mockResolvedValue();
    });

    test('throws error if backup file not found', async () => {
      fs.existsSync.mockReturnValue(false);

      await expect(restoreBackup('/path/to/nonexistent.zip')).rejects.toThrow('Backup file not found');
    });

    test('extracts backup to temp directory before applying', async () => {
      fs.existsSync.mockReturnValue(true);

      mockParseStream.on.mockImplementation((event, callback) => {
        if (event === 'close') {
          setTimeout(callback, 0);
        }
        return mockParseStream;
      });

      const resultPromise = restoreBackup('/path/to/backup.zip');
      await new Promise(resolve => setTimeout(resolve, 10));

      const result = await resultPromise;

      expect(fs.mkdtempSync).toHaveBeenCalled();
      expect(result).toHaveProperty('database');
      expect(result).toHaveProperty('covers');
      expect(result).toHaveProperty('manifest');
    });

    test('restores without database when restoreCovers only', async () => {
      fs.existsSync.mockReturnValue(true);

      mockParseStream.on.mockImplementation((event, callback) => {
        if (event === 'close') {
          setTimeout(callback, 0);
        }
        return mockParseStream;
      });

      const resultPromise = restoreBackup('/path/to/backup.zip', { restoreDatabase: false, restoreCovers: true });
      await new Promise(resolve => setTimeout(resolve, 10));

      const result = await resultPromise;

      expect(result.database).toBe(false);
      expect(result.covers).toBe(0);
    });

    test('handles stream error event', async () => {
      fs.existsSync.mockReturnValue(true);

      let errorCallback;
      mockParseStream.on.mockImplementation((event, callback) => {
        if (event === 'error') {
          errorCallback = callback;
        }
        return mockParseStream;
      });

      const resultPromise = restoreBackup('/path/to/backup.zip');

      if (errorCallback) {
        errorCallback(new Error('Stream error'));
      }

      await expect(resultPromise).rejects.toThrow('Stream error');
    });

    test('processes manifest entry', async () => {
      fs.existsSync.mockReturnValue(true);

      let entryCallback;
      let closeCallback;
      mockParseStream.on.mockImplementation((event, callback) => {
        if (event === 'entry') entryCallback = callback;
        if (event === 'close') closeCallback = callback;
        return mockParseStream;
      });

      const resultPromise = restoreBackup('/path/to/backup.zip');

      if (entryCallback) {
        const mockEntry = {
          path: 'manifest.json',
          buffer: jest.fn().mockResolvedValue(Buffer.from(JSON.stringify({ version: '1.0', includes: ['database'] })))
        };
        await entryCallback(mockEntry);
      }

      if (closeCallback) closeCallback();

      const result = await resultPromise;
      expect(result.manifest).toEqual({ version: '1.0', includes: ['database'] });
    });

    test('validates SQLite header before restoring database', async () => {
      fs.existsSync.mockReturnValue(true);

      const mockWriteStream = {
        on: jest.fn((event, cb) => {
          if (event === 'finish') setTimeout(cb, 0);
          return mockWriteStream;
        })
      };
      fs.createWriteStream.mockReturnValue(mockWriteStream);
      fs.openSync.mockReturnValue(42);
      // Return valid SQLite header
      fs.readSync.mockImplementation((fd, buffer) => {
        Buffer.from('SQLite format 3\0').copy(buffer);
        return 16;
      });

      let entryCallback;
      let closeCallback;
      mockParseStream.on.mockImplementation((event, callback) => {
        if (event === 'entry') entryCallback = callback;
        if (event === 'close') closeCallback = callback;
        return mockParseStream;
      });

      const resultPromise = restoreBackup('/path/to/backup.zip');

      if (entryCallback) {
        const mockEntry = {
          path: 'sappho.db',
          pipe: jest.fn().mockReturnValue(mockWriteStream)
        };
        await entryCallback(mockEntry);
      }

      await new Promise(resolve => setTimeout(resolve, 20));
      if (closeCallback) closeCallback();

      const result = await resultPromise;
      expect(result.database).toBe(true);
      expect(fs.openSync).toHaveBeenCalled();
      expect(fs.copyFileSync).toHaveBeenCalled();
    });

    test('rejects invalid SQLite database file', async () => {
      fs.existsSync.mockReturnValue(true);

      const mockWriteStream = {
        on: jest.fn((event, cb) => {
          if (event === 'finish') setTimeout(cb, 0);
          return mockWriteStream;
        })
      };
      fs.createWriteStream.mockReturnValue(mockWriteStream);
      fs.openSync.mockReturnValue(42);
      // Return invalid header
      fs.readSync.mockImplementation((fd, buffer) => {
        Buffer.from('not a database!!').copy(buffer);
        return 16;
      });

      let entryCallback;
      let closeCallback;
      mockParseStream.on.mockImplementation((event, callback) => {
        if (event === 'entry') entryCallback = callback;
        if (event === 'close') closeCallback = callback;
        return mockParseStream;
      });

      const resultPromise = restoreBackup('/path/to/backup.zip');

      if (entryCallback) {
        const mockEntry = {
          path: 'sappho.db',
          pipe: jest.fn().mockReturnValue(mockWriteStream)
        };
        await entryCallback(mockEntry);
      }

      await new Promise(resolve => setTimeout(resolve, 20));
      if (closeCallback) closeCallback();

      await expect(resultPromise).rejects.toThrow('Invalid backup');
    });

    test('checkpoints WAL and closes DB before overwriting', async () => {
      const db = require('../../server/database');
      fs.existsSync.mockReturnValue(true);

      const mockWriteStream = {
        on: jest.fn((event, cb) => {
          if (event === 'finish') setTimeout(cb, 0);
          return mockWriteStream;
        })
      };
      fs.createWriteStream.mockReturnValue(mockWriteStream);
      fs.openSync.mockReturnValue(42);
      fs.readSync.mockImplementation((fd, buffer) => {
        Buffer.from('SQLite format 3\0').copy(buffer);
        return 16;
      });

      let entryCallback;
      let closeCallback;
      mockParseStream.on.mockImplementation((event, callback) => {
        if (event === 'entry') entryCallback = callback;
        if (event === 'close') closeCallback = callback;
        return mockParseStream;
      });

      const resultPromise = restoreBackup('/path/to/backup.zip');

      if (entryCallback) {
        const mockEntry = {
          path: 'sappho.db',
          pipe: jest.fn().mockReturnValue(mockWriteStream)
        };
        await entryCallback(mockEntry);
      }

      await new Promise(resolve => setTimeout(resolve, 20));
      if (closeCallback) closeCallback();

      await resultPromise;
      expect(db.checkpoint).toHaveBeenCalled();
      expect(db.closeDatabase).toHaveBeenCalled();
    });

    test('autodrains unhandled entries', async () => {
      fs.existsSync.mockReturnValue(true);

      let entryCallback;
      let closeCallback;
      mockParseStream.on.mockImplementation((event, callback) => {
        if (event === 'entry') entryCallback = callback;
        if (event === 'close') closeCallback = callback;
        return mockParseStream;
      });

      const resultPromise = restoreBackup('/path/to/backup.zip');

      if (entryCallback) {
        const mockEntry = {
          path: 'some-other-file.txt',
          autodrain: jest.fn()
        };
        await entryCallback(mockEntry);
        expect(mockEntry.autodrain).toHaveBeenCalled();
      }

      if (closeCallback) closeCallback();
      await resultPromise;
    });

    test('autodrains empty cover directory entry', async () => {
      fs.existsSync.mockReturnValue(true);

      let entryCallback;
      let closeCallback;
      mockParseStream.on.mockImplementation((event, callback) => {
        if (event === 'entry') entryCallback = callback;
        if (event === 'close') closeCallback = callback;
        return mockParseStream;
      });

      const resultPromise = restoreBackup('/path/to/backup.zip');

      if (entryCallback) {
        const mockEntry = {
          path: 'covers/',
          autodrain: jest.fn()
        };
        await entryCallback(mockEntry);
        expect(mockEntry.autodrain).toHaveBeenCalled();
      }

      if (closeCallback) closeCallback();
      await resultPromise;
    });

    test('cleans up temp directory after restore', async () => {
      fs.existsSync.mockReturnValue(true);

      mockParseStream.on.mockImplementation((event, callback) => {
        if (event === 'close') setTimeout(callback, 0);
        return mockParseStream;
      });

      const resultPromise = restoreBackup('/path/to/backup.zip');
      await new Promise(resolve => setTimeout(resolve, 10));
      await resultPromise;

      expect(fs.rmSync).toHaveBeenCalledWith('/tmp/sappho-restore-test', { recursive: true, force: true });
    });

    test('continues restore even if WAL checkpoint fails', async () => {
      const db = require('../../server/database');
      db.checkpoint.mockRejectedValue(new Error('Not in WAL mode'));
      fs.existsSync.mockReturnValue(true);

      const mockWriteStream = {
        on: jest.fn((event, cb) => {
          if (event === 'finish') setTimeout(cb, 0);
          return mockWriteStream;
        })
      };
      fs.createWriteStream.mockReturnValue(mockWriteStream);
      fs.openSync.mockReturnValue(42);
      fs.readSync.mockImplementation((fd, buffer) => {
        Buffer.from('SQLite format 3\0').copy(buffer);
        return 16;
      });

      jest.spyOn(console, 'warn').mockImplementation();

      let entryCallback;
      let closeCallback;
      mockParseStream.on.mockImplementation((event, callback) => {
        if (event === 'entry') entryCallback = callback;
        if (event === 'close') closeCallback = callback;
        return mockParseStream;
      });

      const resultPromise = restoreBackup('/path/to/backup.zip');

      if (entryCallback) {
        const mockEntry = {
          path: 'sappho.db',
          pipe: jest.fn().mockReturnValue(mockWriteStream)
        };
        await entryCallback(mockEntry);
      }

      await new Promise(resolve => setTimeout(resolve, 20));
      if (closeCallback) closeCallback();

      const result = await resultPromise;
      expect(result.database).toBe(true);
      console.warn.mockRestore();
    });
  });
});
