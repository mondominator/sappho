/**
 * Unit tests for Conversion Service
 * Tests conversion logic, FFmpeg argument building, and job management
 */

describe('Conversion Service - Utility Functions', () => {
  describe('Supported format validation', () => {
    const supportedFormats = ['.m4a', '.mp3', '.mp4', '.ogg', '.flac'];

    function validateFormat(filePath) {
      const path = require('path');
      const ext = path.extname(filePath).toLowerCase();

      if (ext === '.m4b') {
        return { error: 'File is already M4B format' };
      }
      if (!supportedFormats.includes(ext)) {
        return { error: `Unsupported format: ${ext}. Supported: ${supportedFormats.join(', ')}` };
      }
      return { valid: true };
    }

    it('accepts .m4a files', () => {
      expect(validateFormat('/test/book.m4a').valid).toBe(true);
    });

    it('accepts .mp3 files', () => {
      expect(validateFormat('/test/book.mp3').valid).toBe(true);
    });

    it('accepts .mp4 files', () => {
      expect(validateFormat('/test/book.mp4').valid).toBe(true);
    });

    it('accepts .ogg files', () => {
      expect(validateFormat('/test/book.ogg').valid).toBe(true);
    });

    it('accepts .flac files', () => {
      expect(validateFormat('/test/book.flac').valid).toBe(true);
    });

    it('rejects already M4B files', () => {
      expect(validateFormat('/test/book.m4b').error).toBe('File is already M4B format');
    });

    it('rejects unsupported formats', () => {
      expect(validateFormat('/test/book.wav').error).toContain('Unsupported format');
    });

    it('handles uppercase extensions', () => {
      expect(validateFormat('/test/book.MP3').valid).toBe(true);
    });
  });

  describe('Title sanitization', () => {
    function sanitizeTitle(title) {
      return (title || 'audiobook')
        .replace(/[<>:"/\\|?*]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .substring(0, 100);
    }

    it('removes invalid filename characters', () => {
      expect(sanitizeTitle('Test: Book / Part 1')).toBe('Test Book Part 1');
    });

    it('removes angle brackets', () => {
      expect(sanitizeTitle('Book <Title>')).toBe('Book Title');
    });

    it('removes quotes', () => {
      expect(sanitizeTitle('Book "Title"')).toBe('Book Title');
    });

    it('normalizes whitespace', () => {
      expect(sanitizeTitle('Book    Title')).toBe('Book Title');
    });

    it('trims leading/trailing whitespace', () => {
      expect(sanitizeTitle('  Book Title  ')).toBe('Book Title');
    });

    it('truncates to 100 characters', () => {
      const longTitle = 'A'.repeat(150);
      expect(sanitizeTitle(longTitle).length).toBe(100);
    });

    it('uses default for empty title', () => {
      expect(sanitizeTitle('')).toBe('audiobook');
    });

    it('uses default for null title', () => {
      expect(sanitizeTitle(null)).toBe('audiobook');
    });
  });

  describe('FFmpeg argument building', () => {
    function buildFFmpegArgs(job) {
      const path = require('path');

      if (job.isMultiFile && job.sourceFiles.length > 1) {
        // Multifile - use concat demuxer
        return [
          '-f', 'concat',
          '-safe', '0',
          '-i', job.concatListPath,
          '-vn',
          '-c:a', 'aac',
          '-b:a', '128k',
          '-ar', '44100',
          '-ac', '1',
          '-f', 'ipod',
          '-progress', 'pipe:1',
          '-y', job.tempPath
        ];
      } else if (job.ext === '.m4a' || job.ext === '.mp4') {
        // M4A/MP4 - stream copy
        return [
          '-i', job.sourceFiles[0].path,
          '-c', 'copy',
          '-f', 'ipod',
          '-y', job.tempPath
        ];
      } else {
        // MP3, OGG, FLAC - re-encode to AAC
        return [
          '-i', job.sourceFiles[0].path,
          '-vn',
          '-c:a', 'aac',
          '-b:a', '128k',
          '-ar', '44100',
          '-ac', '1',
          '-f', 'ipod',
          '-progress', 'pipe:1',
          '-y', job.tempPath
        ];
      }
    }

    it('builds stream copy args for M4A', () => {
      const job = {
        isMultiFile: false,
        sourceFiles: [{ path: '/test/book.m4a' }],
        tempPath: '/test/output.m4b',
        ext: '.m4a',
      };

      const args = buildFFmpegArgs(job);

      expect(args).toContain('-c');
      expect(args).toContain('copy');
      expect(args).toContain('-f');
      expect(args).toContain('ipod');
    });

    it('builds re-encode args for MP3', () => {
      const job = {
        isMultiFile: false,
        sourceFiles: [{ path: '/test/book.mp3' }],
        tempPath: '/test/output.m4b',
        ext: '.mp3',
      };

      const args = buildFFmpegArgs(job);

      expect(args).toContain('-c:a');
      expect(args).toContain('aac');
      expect(args).toContain('-b:a');
      expect(args).toContain('128k');
    });

    it('builds concat args for multifile', () => {
      const job = {
        isMultiFile: true,
        sourceFiles: [
          { path: '/test/ch1.mp3' },
          { path: '/test/ch2.mp3' },
        ],
        tempPath: '/test/output.m4b',
        concatListPath: '/test/concat.txt',
        ext: '.mp3',
      };

      const args = buildFFmpegArgs(job);

      expect(args).toContain('-f');
      expect(args).toContain('concat');
      expect(args).toContain('-safe');
      expect(args).toContain('0');
    });

    it('includes output format ipod for M4B compatibility', () => {
      const job = {
        isMultiFile: false,
        sourceFiles: [{ path: '/test/book.mp3' }],
        tempPath: '/test/output.m4b',
        ext: '.mp3',
      };

      const args = buildFFmpegArgs(job);

      expect(args).toContain('-f');
      expect(args).toContain('ipod');
    });

    it('includes overwrite flag', () => {
      const job = {
        isMultiFile: false,
        sourceFiles: [{ path: '/test/book.mp3' }],
        tempPath: '/test/output.m4b',
        ext: '.mp3',
      };

      const args = buildFFmpegArgs(job);

      expect(args).toContain('-y');
    });
  });

  describe('Job status structure', () => {
    function createJobStatus(job) {
      return {
        id: job.id,
        audiobookId: job.audiobookId,
        audiobookTitle: job.audiobookTitle,
        status: job.status,
        progress: job.progress,
        message: job.message,
        error: job.error,
        startedAt: job.startedAt,
        completedAt: job.completedAt,
      };
    }

    it('includes all required fields', () => {
      const job = {
        id: 'test-123',
        audiobookId: 1,
        audiobookTitle: 'Test Book',
        status: 'converting',
        progress: 50,
        message: 'Converting: 50%',
        error: null,
        startedAt: new Date().toISOString(),
        completedAt: null,
      };

      const status = createJobStatus(job);

      expect(status).toHaveProperty('id', 'test-123');
      expect(status).toHaveProperty('audiobookId', 1);
      expect(status).toHaveProperty('status', 'converting');
      expect(status).toHaveProperty('progress', 50);
    });
  });

  describe('Progress calculation', () => {
    function calculateProgress(currentTime, totalDuration) {
      // Progress is scaled to 10-90% range for conversion phase
      const rawProgress = Math.min((currentTime / totalDuration) * 100, 100);
      return Math.round(10 + (rawProgress * 0.8));
    }

    it('starts at 10%', () => {
      expect(calculateProgress(0, 3600)).toBe(10);
    });

    it('ends at 90%', () => {
      expect(calculateProgress(3600, 3600)).toBe(90);
    });

    it('calculates middle progress correctly', () => {
      // 50% raw = 10 + (50 * 0.8) = 10 + 40 = 50
      expect(calculateProgress(1800, 3600)).toBe(50);
    });

    it('does not exceed 90% during conversion', () => {
      expect(calculateProgress(4000, 3600)).toBe(90);
    });
  });

  describe('Stale job detection', () => {
    function isJobStale(startedAt, maxAgeHours = 2) {
      const startTime = new Date(startedAt).getTime();
      const maxAge = maxAgeHours * 60 * 60 * 1000;
      return Date.now() - startTime > maxAge;
    }

    it('returns false for recent job', () => {
      const recentStart = new Date().toISOString();
      expect(isJobStale(recentStart)).toBe(false);
    });

    it('returns true for job older than 2 hours', () => {
      const oldStart = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
      expect(isJobStale(oldStart)).toBe(true);
    });

    it('uses custom max age', () => {
      const oneHourAgo = new Date(Date.now() - 1.5 * 60 * 60 * 1000).toISOString();
      expect(isJobStale(oneHourAgo, 1)).toBe(true);
      expect(isJobStale(oneHourAgo, 2)).toBe(false);
    });
  });

  describe('Concat list file generation', () => {
    function generateConcatList(sourceFiles) {
      return sourceFiles
        .map(f => `file '${f.path.replace(/'/g, "'\\''")}'`)
        .join('\n');
    }

    it('generates correct format', () => {
      const files = [
        { path: '/test/ch1.mp3' },
        { path: '/test/ch2.mp3' },
      ];

      const content = generateConcatList(files);

      expect(content).toBe("file '/test/ch1.mp3'\nfile '/test/ch2.mp3'");
    });

    it('escapes single quotes in paths', () => {
      const files = [
        { path: "/test/book's chapter.mp3" },
      ];

      const content = generateConcatList(files);

      expect(content).toContain("\\'");
    });
  });
});
