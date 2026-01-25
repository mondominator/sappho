/**
 * Unit tests for Backup Service
 * Tests backup filename generation, path validation, and formatBytes helper
 */

describe('Backup Service - Utility Functions', () => {
  describe('formatBytes helper', () => {
    // Test the formatBytes logic directly
    function formatBytes(bytes) {
      if (bytes === 0) return '0 B';
      const k = 1024;
      const sizes = ['B', 'KB', 'MB', 'GB'];
      const i = Math.floor(Math.log(bytes) / Math.log(k));
      return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    it('formats 0 bytes', () => {
      expect(formatBytes(0)).toBe('0 B');
    });

    it('formats bytes', () => {
      expect(formatBytes(512)).toBe('512 B');
    });

    it('formats kilobytes', () => {
      expect(formatBytes(1024)).toBe('1 KB');
      expect(formatBytes(1536)).toBe('1.5 KB');
    });

    it('formats megabytes', () => {
      expect(formatBytes(1048576)).toBe('1 MB');
      expect(formatBytes(5242880)).toBe('5 MB');
    });

    it('formats gigabytes', () => {
      expect(formatBytes(1073741824)).toBe('1 GB');
    });
  });

  describe('generateBackupFilename logic', () => {
    function generateBackupFilename() {
      const now = new Date();
      const timestamp = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
      return `sappho-backup-${timestamp}.zip`;
    }

    it('generates filename with sappho-backup prefix', () => {
      const filename = generateBackupFilename();
      expect(filename).toMatch(/^sappho-backup-/);
    });

    it('generates filename with .zip extension', () => {
      const filename = generateBackupFilename();
      expect(filename).toMatch(/\.zip$/);
    });

    it('generates filename with ISO timestamp format', () => {
      const filename = generateBackupFilename();
      // Should match pattern: sappho-backup-YYYY-MM-DDTHH-MM-SS.zip
      expect(filename).toMatch(/^sappho-backup-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.zip$/);
    });
  });

  describe('getBackupPath validation logic', () => {
    const path = require('path');

    function validateBackupFilename(filename) {
      const sanitized = path.basename(filename);
      if (!sanitized.endsWith('.zip') || !sanitized.startsWith('sappho-backup-')) {
        throw new Error('Invalid backup filename');
      }
      return sanitized;
    }

    it('accepts valid backup filename', () => {
      const result = validateBackupFilename('sappho-backup-2024-01-15T10-00-00.zip');
      expect(result).toBe('sappho-backup-2024-01-15T10-00-00.zip');
    });

    it('rejects filename without sappho-backup- prefix', () => {
      expect(() => validateBackupFilename('malicious.zip')).toThrow('Invalid backup filename');
    });

    it('rejects filename without .zip extension', () => {
      expect(() => validateBackupFilename('sappho-backup-2024-01-15T10-00-00.tar')).toThrow('Invalid backup filename');
    });

    it('prevents directory traversal by using basename', () => {
      const result = validateBackupFilename('../../../etc/sappho-backup-2024-01-15T10-00-00.zip');
      expect(result).toBe('sappho-backup-2024-01-15T10-00-00.zip');
      expect(result).not.toContain('..');
    });

    it('strips subdirectory paths', () => {
      const result = validateBackupFilename('subdir/sappho-backup-2024-01-15T10-00-00.zip');
      expect(result).not.toContain('subdir');
    });
  });

  describe('retention policy logic', () => {
    function getBackupsToDelete(backupCount, retentionCount = 7) {
      if (backupCount <= retentionCount) {
        return 0;
      }
      return backupCount - retentionCount;
    }

    it('deletes nothing when below retention limit', () => {
      expect(getBackupsToDelete(5, 7)).toBe(0);
    });

    it('deletes nothing when at retention limit', () => {
      expect(getBackupsToDelete(7, 7)).toBe(0);
    });

    it('deletes excess backups over retention limit', () => {
      expect(getBackupsToDelete(10, 7)).toBe(3);
    });

    it('uses default retention of 7', () => {
      expect(getBackupsToDelete(10)).toBe(3);
    });
  });

  describe('backup manifest structure', () => {
    function createManifest(includesDatabase, includesCovers, coverCount = 0) {
      const manifest = {
        version: '1.0',
        created: new Date().toISOString(),
        includes: ['database'],
      };

      if (includesCovers && coverCount > 0) {
        manifest.includes.push('covers');
        manifest.coverCount = coverCount;
      }

      return manifest;
    }

    it('includes version field', () => {
      const manifest = createManifest(true, false);
      expect(manifest.version).toBe('1.0');
    });

    it('includes created timestamp', () => {
      const manifest = createManifest(true, false);
      expect(manifest.created).toBeDefined();
      expect(new Date(manifest.created)).toBeInstanceOf(Date);
    });

    it('includes database by default', () => {
      const manifest = createManifest(true, false);
      expect(manifest.includes).toContain('database');
    });

    it('includes covers when present', () => {
      const manifest = createManifest(true, true, 5);
      expect(manifest.includes).toContain('covers');
      expect(manifest.coverCount).toBe(5);
    });

    it('omits covers when none present', () => {
      const manifest = createManifest(true, true, 0);
      expect(manifest.includes).not.toContain('covers');
    });
  });
});
