/**
 * Unit tests for ThumbnailService
 */

const fs = require('fs');
const path = require('path');

// Mock sharp before requiring the service
const mockSharpInstance = {
  resize: jest.fn().mockReturnThis(),
  jpeg: jest.fn().mockReturnThis(),
  toFile: jest.fn().mockResolvedValue({}),
};
jest.mock('sharp', () => jest.fn(() => mockSharpInstance), { virtual: true });

const {
  ALLOWED_WIDTHS,
  THUMBNAILS_DIR,
  isValidWidth,
  getThumbnailPath,
  getOrGenerateThumbnail,
  invalidateThumbnails,
  clearAllThumbnails,
} = require('../../server/services/thumbnailService');

describe('ThumbnailService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('ALLOWED_WIDTHS', () => {
    test('contains expected sizes', () => {
      expect(ALLOWED_WIDTHS).toEqual([120, 300, 600]);
    });
  });

  describe('isValidWidth', () => {
    test('returns true for allowed widths', () => {
      expect(isValidWidth(120)).toBe(true);
      expect(isValidWidth(300)).toBe(true);
      expect(isValidWidth(600)).toBe(true);
    });

    test('returns false for disallowed widths', () => {
      expect(isValidWidth(100)).toBe(false);
      expect(isValidWidth(200)).toBe(false);
      expect(isValidWidth(400)).toBe(false);
      expect(isValidWidth(1200)).toBe(false);
    });

    test('returns false for non-integer values', () => {
      expect(isValidWidth(120.5)).toBe(false);
      expect(isValidWidth(NaN)).toBe(false);
      expect(isValidWidth(null)).toBe(false);
      expect(isValidWidth(undefined)).toBe(false);
    });

    test('returns false for string values', () => {
      expect(isValidWidth('120')).toBe(false);
      expect(isValidWidth('300')).toBe(false);
    });

    test('returns false for zero and negative values', () => {
      expect(isValidWidth(0)).toBe(false);
      expect(isValidWidth(-120)).toBe(false);
    });
  });

  describe('getThumbnailPath', () => {
    test('returns correct path for numeric ID', () => {
      const result = getThumbnailPath(42, 300);
      expect(result).toBe(path.join(THUMBNAILS_DIR, '42_300.jpg'));
    });

    test('returns correct path for string ID', () => {
      const result = getThumbnailPath('42', 120);
      expect(result).toBe(path.join(THUMBNAILS_DIR, '42_120.jpg'));
    });

    test('returns different paths for different widths', () => {
      const path120 = getThumbnailPath(1, 120);
      const path300 = getThumbnailPath(1, 300);
      const path600 = getThumbnailPath(1, 600);

      expect(path120).not.toBe(path300);
      expect(path300).not.toBe(path600);
      expect(path120).not.toBe(path600);
    });
  });

  describe('getOrGenerateThumbnail', () => {
    const originalCover = '/app/data/audiobooks/test/cover.jpg';
    const audiobookId = 42;
    const width = 300;

    test('returns cached thumbnail when it exists', async () => {
      const expectedPath = getThumbnailPath(audiobookId, width);
      jest.spyOn(fs, 'existsSync').mockReturnValue(true);

      const result = await getOrGenerateThumbnail(originalCover, audiobookId, width);

      expect(result).toBe(expectedPath);
      // sharp should NOT have been called since cache hit
      const sharp = require('sharp');
      expect(sharp).not.toHaveBeenCalled();

      fs.existsSync.mockRestore();
    });

    test('generates thumbnail when cache miss', async () => {
      jest.spyOn(fs, 'existsSync').mockReturnValue(false);
      jest.spyOn(fs.promises, 'mkdir').mockResolvedValue(undefined);

      const result = await getOrGenerateThumbnail(originalCover, audiobookId, width);

      const expectedPath = getThumbnailPath(audiobookId, width);
      expect(result).toBe(expectedPath);

      // Verify sharp was called with correct parameters
      const sharp = require('sharp');
      expect(sharp).toHaveBeenCalledWith(originalCover);
      expect(mockSharpInstance.resize).toHaveBeenCalledWith(width, width, { fit: 'cover' });
      expect(mockSharpInstance.jpeg).toHaveBeenCalledWith({ quality: 80 });
      expect(mockSharpInstance.toFile).toHaveBeenCalledWith(expectedPath);

      fs.existsSync.mockRestore();
      fs.promises.mkdir.mockRestore();
    });

    test('creates thumbnails directory on cache miss', async () => {
      jest.spyOn(fs, 'existsSync').mockReturnValue(false);
      const mkdirSpy = jest.spyOn(fs.promises, 'mkdir').mockResolvedValue(undefined);

      await getOrGenerateThumbnail(originalCover, audiobookId, width);

      expect(mkdirSpy).toHaveBeenCalledWith(THUMBNAILS_DIR, { recursive: true });

      fs.existsSync.mockRestore();
      mkdirSpy.mockRestore();
    });

    test('propagates sharp errors', async () => {
      jest.spyOn(fs, 'existsSync').mockReturnValue(false);
      jest.spyOn(fs.promises, 'mkdir').mockResolvedValue(undefined);
      mockSharpInstance.toFile.mockRejectedValueOnce(new Error('Input file is missing'));

      await expect(
        getOrGenerateThumbnail(originalCover, audiobookId, width)
      ).rejects.toThrow('Input file is missing');

      fs.existsSync.mockRestore();
      fs.promises.mkdir.mockRestore();
    });
  });

  describe('invalidateThumbnails', () => {
    test('removes cached thumbnails for all widths', () => {
      const existsSyncSpy = jest.spyOn(fs, 'existsSync').mockReturnValue(true);
      const unlinkSyncSpy = jest.spyOn(fs, 'unlinkSync').mockImplementation(() => {});

      invalidateThumbnails(42);

      expect(unlinkSyncSpy).toHaveBeenCalledTimes(ALLOWED_WIDTHS.length);
      for (const w of ALLOWED_WIDTHS) {
        expect(unlinkSyncSpy).toHaveBeenCalledWith(getThumbnailPath(42, w));
      }

      existsSyncSpy.mockRestore();
      unlinkSyncSpy.mockRestore();
    });

    test('skips non-existent thumbnails without error', () => {
      const existsSyncSpy = jest.spyOn(fs, 'existsSync').mockReturnValue(false);
      const unlinkSyncSpy = jest.spyOn(fs, 'unlinkSync').mockImplementation(() => {});

      expect(() => invalidateThumbnails(42)).not.toThrow();
      expect(unlinkSyncSpy).not.toHaveBeenCalled();

      existsSyncSpy.mockRestore();
      unlinkSyncSpy.mockRestore();
    });

    test('logs error but does not throw when unlink fails', () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      jest.spyOn(fs, 'existsSync').mockReturnValue(true);
      jest.spyOn(fs, 'unlinkSync').mockImplementation(() => {
        throw new Error('permission denied');
      });

      expect(() => invalidateThumbnails(42)).not.toThrow();
      expect(consoleSpy).toHaveBeenCalled();

      consoleSpy.mockRestore();
      fs.existsSync.mockRestore();
      fs.unlinkSync.mockRestore();
    });
  });

  describe('clearAllThumbnails', () => {
    test('removes entire thumbnails directory', () => {
      jest.spyOn(fs, 'existsSync').mockReturnValue(true);
      const rmSyncSpy = jest.spyOn(fs, 'rmSync').mockImplementation(() => {});
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

      clearAllThumbnails();

      expect(rmSyncSpy).toHaveBeenCalledWith(THUMBNAILS_DIR, { recursive: true, force: true });
      expect(consoleSpy).toHaveBeenCalledWith('Cleared all cached thumbnails');

      fs.existsSync.mockRestore();
      rmSyncSpy.mockRestore();
      consoleSpy.mockRestore();
    });

    test('does nothing when thumbnails directory does not exist', () => {
      jest.spyOn(fs, 'existsSync').mockReturnValue(false);
      const rmSyncSpy = jest.spyOn(fs, 'rmSync').mockImplementation(() => {});

      clearAllThumbnails();

      expect(rmSyncSpy).not.toHaveBeenCalled();

      fs.existsSync.mockRestore();
      rmSyncSpy.mockRestore();
    });

    test('logs error but does not throw on failure', () => {
      jest.spyOn(fs, 'existsSync').mockReturnValue(true);
      jest.spyOn(fs, 'rmSync').mockImplementation(() => {
        throw new Error('rm failed');
      });
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      expect(() => clearAllThumbnails()).not.toThrow();
      expect(consoleSpy).toHaveBeenCalled();

      fs.existsSync.mockRestore();
      fs.rmSync.mockRestore();
      consoleSpy.mockRestore();
    });
  });
});
