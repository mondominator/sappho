/**
 * Unit tests for Conversion Service
 * Tests conversion logic, job management, and status tracking
 */

// Mock dependencies before requiring the module
jest.mock('child_process', () => ({
  spawn: jest.fn(),
  execFile: jest.fn()
}));

jest.mock('fs', () => ({
  existsSync: jest.fn(),
  writeFileSync: jest.fn(),
  statSync: jest.fn(),
  renameSync: jest.fn(),
  copyFileSync: jest.fn(),
  unlinkSync: jest.fn(),
  readdirSync: jest.fn().mockReturnValue([]),
  mkdirSync: jest.fn()
}));

jest.mock('../../server/services/websocketManager', () => ({
  broadcastJobUpdate: jest.fn(),
  broadcastLibraryUpdate: jest.fn()
}));

jest.mock('../../server/services/pathCache', () => ({
  updatePathCacheEntry: jest.fn()
}));

jest.mock('../../server/utils/contentHash', () => ({
  generateBestHash: jest.fn().mockReturnValue('abcdef1234567890')
}));

jest.mock('../../server/services/fileSystemUtils', () => ({
  extractM4BChapters: jest.fn().mockResolvedValue(null)
}));

const { spawn } = require('child_process');
const fs = require('fs');
const websocketManager = require('../../server/services/websocketManager');
const conversionService = require('../../server/services/conversionService');

describe('Conversion Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    // Suppress console output during tests
    jest.spyOn(console, 'log').mockImplementation();
    jest.spyOn(console, 'error').mockImplementation();
    jest.spyOn(console, 'warn').mockImplementation();
    // Clear internal state
    conversionService.jobs.clear();
    conversionService.activeConversions.clear();
    conversionService.runningConversions = 0;
    conversionService.conversionQueue = [];
    // Default mock behavior
    fs.existsSync.mockReturnValue(true);
    fs.statSync.mockReturnValue({ size: 1024 });
  });

  afterEach(() => {
    jest.useRealTimers();
    console.log.mockRestore();
    console.error.mockRestore();
    console.warn.mockRestore();
  });

  describe('getJobStatus', () => {
    test('returns null for non-existent job', () => {
      const result = conversionService.getJobStatus('non-existent-id');
      expect(result).toBeNull();
    });

    test('returns job status for existing job', () => {
      // Create a mock job
      conversionService.jobs.set('test-job-id', {
        id: 'test-job-id',
        audiobookId: 1,
        audiobookTitle: 'Test Book',
        status: 'converting',
        progress: 50,
        message: 'Converting...',
        error: null,
        startedAt: '2024-01-15T10:00:00Z',
        completedAt: null
      });

      const result = conversionService.getJobStatus('test-job-id');

      expect(result).toEqual({
        jobId: 'test-job-id',
        audiobookId: 1,
        audiobookTitle: 'Test Book',
        status: 'converting',
        progress: 50,
        message: 'Converting...',
        error: null,
        startedAt: '2024-01-15T10:00:00Z',
        completedAt: null
      });
    });
  });

  describe('getActiveJobs', () => {
    test('returns empty array when no jobs', () => {
      const result = conversionService.getActiveJobs();
      expect(result).toEqual([]);
    });

    test('returns only active jobs', () => {
      conversionService.jobs.set('job-1', {
        id: 'job-1',
        audiobookId: 1,
        status: 'converting',
        progress: 50,
        message: 'Converting...'
      });
      conversionService.jobs.set('job-2', {
        id: 'job-2',
        audiobookId: 2,
        status: 'completed',
        progress: 100,
        message: 'Done'
      });
      conversionService.jobs.set('job-3', {
        id: 'job-3',
        audiobookId: 3,
        status: 'starting',
        progress: 0,
        message: 'Starting...'
      });

      const result = conversionService.getActiveJobs();

      expect(result.length).toBe(2);
      expect(result.map(j => j.jobId)).toContain('job-1');
      expect(result.map(j => j.jobId)).toContain('job-3');
      expect(result.map(j => j.jobId)).not.toContain('job-2');
    });

    test('includes queued jobs', () => {
      conversionService.jobs.set('job-1', {
        id: 'job-1',
        audiobookId: 1,
        status: 'converting',
        progress: 50,
        message: 'Converting...'
      });
      conversionService.jobs.set('job-2', {
        id: 'job-2',
        audiobookId: 2,
        status: 'queued',
        progress: 0,
        message: 'Waiting...'
      });

      const result = conversionService.getActiveJobs();

      expect(result.length).toBe(2);
      expect(result.map(j => j.jobId)).toContain('job-1');
      expect(result.map(j => j.jobId)).toContain('job-2');
    });
  });

  describe('concurrency limiter', () => {
    test('acquireSlot resolves immediately when under limit', async () => {
      expect(conversionService.runningConversions).toBe(0);

      await conversionService.acquireSlot();

      expect(conversionService.runningConversions).toBe(1);
    });

    test('acquireSlot queues when at limit', () => {
      conversionService.runningConversions = 2;

      let resolved = false;
      conversionService.acquireSlot().then(() => { resolved = true; });

      expect(resolved).toBe(false);
      expect(conversionService.conversionQueue.length).toBe(1);
    });

    test('releaseSlot decrements running count', () => {
      conversionService.runningConversions = 2;

      conversionService.releaseSlot();

      expect(conversionService.runningConversions).toBe(1);
    });

    test('releaseSlot starts next queued conversion', async () => {
      conversionService.runningConversions = 2;

      let resolved = false;
      conversionService.acquireSlot().then(() => { resolved = true; });

      expect(conversionService.conversionQueue.length).toBe(1);

      conversionService.releaseSlot();

      // Allow the microtask (promise resolution) to execute
      await Promise.resolve();

      expect(resolved).toBe(true);
      expect(conversionService.runningConversions).toBe(2);
      expect(conversionService.conversionQueue.length).toBe(0);
    });

    test('MAX_CONCURRENT defaults to 2', () => {
      expect(conversionService.MAX_CONCURRENT).toBe(2);
    });

    test('getActiveJobForAudiobook includes queued jobs', () => {
      conversionService.jobs.set('job-1', {
        id: 'job-1',
        audiobookId: 5,
        status: 'queued',
        progress: 0,
        message: 'Waiting...'
      });

      const result = conversionService.getActiveJobForAudiobook(5);

      expect(result).not.toBeNull();
      expect(result.jobId).toBe('job-1');
      expect(result.status).toBe('queued');
    });

    test('cancelJob works on queued jobs', () => {
      conversionService.jobs.set('job-1', {
        id: 'job-1',
        audiobookId: 1,
        status: 'queued',
        process: null,
        dir: '/test/dir'
      });
      conversionService.activeConversions.add('/test/dir');

      const result = conversionService.cancelJob('job-1');

      expect(result.success).toBe(true);
      const job = conversionService.jobs.get('job-1');
      expect(job.status).toBe('cancelled');
    });

    test('cleanupStaleJobs handles stuck queued jobs', () => {
      const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
      conversionService.jobs.set('stuck-queued', {
        id: 'stuck-queued',
        audiobookId: 1,
        status: 'queued',
        process: null,
        dir: '/test/dir',
        startedAt: threeHoursAgo
      });
      conversionService.activeConversions.add('/test/dir');

      conversionService.cleanupStaleJobs();

      const job = conversionService.jobs.get('stuck-queued');
      expect(job.status).toBe('failed');
      expect(job.error).toBe('Conversion timed out');
    });
  });

  describe('getActiveJobForAudiobook', () => {
    test('returns null when no active job for audiobook', () => {
      const result = conversionService.getActiveJobForAudiobook(999);
      expect(result).toBeNull();
    });

    test('returns active job for audiobook', () => {
      conversionService.jobs.set('job-1', {
        id: 'job-1',
        audiobookId: 5,
        status: 'converting',
        progress: 30,
        message: 'Converting...'
      });

      const result = conversionService.getActiveJobForAudiobook(5);

      expect(result).not.toBeNull();
      expect(result.jobId).toBe('job-1');
      expect(result.audiobookId).toBe(5);
    });

    test('ignores completed jobs', () => {
      conversionService.jobs.set('job-1', {
        id: 'job-1',
        audiobookId: 5,
        status: 'completed',
        progress: 100,
        message: 'Done'
      });

      const result = conversionService.getActiveJobForAudiobook(5);

      expect(result).toBeNull();
    });
  });

  describe('cancelJob', () => {
    test('returns error for non-existent job', () => {
      const result = conversionService.cancelJob('non-existent');
      expect(result.error).toBe('Job not found');
    });

    test('returns error for completed job', () => {
      conversionService.jobs.set('job-1', {
        id: 'job-1',
        status: 'completed'
      });

      const result = conversionService.cancelJob('job-1');
      expect(result.error).toBe('Job already finished');
    });

    test('returns error for failed job', () => {
      conversionService.jobs.set('job-1', {
        id: 'job-1',
        status: 'failed'
      });

      const result = conversionService.cancelJob('job-1');
      expect(result.error).toBe('Job already finished');
    });

    test('cancels active job successfully', () => {
      const mockProcess = { kill: jest.fn() };
      conversionService.jobs.set('job-1', {
        id: 'job-1',
        audiobookId: 1,
        status: 'converting',
        process: mockProcess,
        dir: '/test/dir',
        tempPath: '/test/temp.m4b',
        tempCoverPath: '/test/cover.jpg',
        concatListPath: '/test/concat.txt'
      });
      conversionService.activeConversions.add('/test/dir');

      const result = conversionService.cancelJob('job-1');

      expect(result.success).toBe(true);
      expect(mockProcess.kill).toHaveBeenCalledWith('SIGTERM');
      expect(websocketManager.broadcastJobUpdate).toHaveBeenCalled();
    });

    test('cancels job without process', () => {
      conversionService.jobs.set('job-1', {
        id: 'job-1',
        audiobookId: 1,
        status: 'starting',
        process: null,
        dir: '/test/dir'
      });
      conversionService.activeConversions.add('/test/dir');

      const result = conversionService.cancelJob('job-1');

      expect(result.success).toBe(true);
      expect(conversionService.activeConversions.has('/test/dir')).toBe(false);
    });
  });

  describe('isDirectoryLocked', () => {
    test('returns false for unlocked directory', () => {
      expect(conversionService.isDirectoryLocked('/unlocked/dir')).toBe(false);
    });

    test('returns true for locked directory', () => {
      conversionService.activeConversions.add('/locked/dir');
      expect(conversionService.isDirectoryLocked('/locked/dir')).toBe(true);
    });
  });

  describe('cleanupStaleJobs', () => {
    test('removes old completed jobs', () => {
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
      conversionService.jobs.set('old-job', {
        id: 'old-job',
        status: 'completed',
        startedAt: twoHoursAgo
      });

      conversionService.cleanupStaleJobs();

      expect(conversionService.jobs.has('old-job')).toBe(false);
    });

    test('removes old failed jobs', () => {
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
      conversionService.jobs.set('old-job', {
        id: 'old-job',
        status: 'failed',
        startedAt: twoHoursAgo
      });

      conversionService.cleanupStaleJobs();

      expect(conversionService.jobs.has('old-job')).toBe(false);
    });

    test('keeps recent completed jobs', () => {
      const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
      conversionService.jobs.set('recent-job', {
        id: 'recent-job',
        status: 'completed',
        startedAt: tenMinutesAgo
      });

      conversionService.cleanupStaleJobs();

      expect(conversionService.jobs.has('recent-job')).toBe(true);
    });

    test('fails stuck jobs', () => {
      const mockProcess = { kill: jest.fn() };
      const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
      conversionService.jobs.set('stuck-job', {
        id: 'stuck-job',
        audiobookId: 1,
        status: 'converting',
        process: mockProcess,
        dir: '/test/dir',
        startedAt: threeHoursAgo
      });
      conversionService.activeConversions.add('/test/dir');

      conversionService.cleanupStaleJobs();

      const job = conversionService.jobs.get('stuck-job');
      expect(job.status).toBe('failed');
      expect(job.error).toBe('Conversion timed out');
      expect(mockProcess.kill).toHaveBeenCalledWith('SIGTERM');
    });
  });

  describe('cleanupJobFiles', () => {
    test('cleans up temp files when they exist', () => {
      fs.existsSync.mockReturnValue(true);
      const job = {
        tempPath: '/test/temp.m4b',
        tempCoverPath: '/test/cover.jpg',
        concatListPath: '/test/concat.txt'
      };

      conversionService.cleanupJobFiles(job);

      expect(fs.unlinkSync).toHaveBeenCalledWith('/test/temp.m4b');
    });

    test('handles cleanup errors gracefully', () => {
      fs.existsSync.mockReturnValue(true);
      fs.unlinkSync.mockImplementation(() => {
        throw new Error('Permission denied');
      });
      const job = {
        tempPath: '/test/temp.m4b'
      };

      // Should not throw
      expect(() => conversionService.cleanupJobFiles(job)).not.toThrow();
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to clean up'),
        expect.any(String)
      );
    });

    test('skips non-existent files', () => {
      fs.existsSync.mockReturnValue(false);
      const job = {
        tempPath: '/test/temp.m4b',
        tempCoverPath: '/test/cover.jpg'
      };

      conversionService.cleanupJobFiles(job);

      expect(fs.unlinkSync).not.toHaveBeenCalled();
    });
  });

  describe('broadcastJobStatus', () => {
    test('broadcasts job status via websocket', () => {
      const job = {
        id: 'job-1',
        audiobookId: 1,
        audiobookTitle: 'Test Book',
        status: 'converting',
        progress: 50,
        message: 'Converting...',
        error: null
      };

      conversionService.broadcastJobStatus(job);

      expect(websocketManager.broadcastJobUpdate).toHaveBeenCalledWith(
        'conversion',
        'converting',
        {
          jobId: 'job-1',
          audiobookId: 1,
          audiobookTitle: 'Test Book',
          progress: 50,
          message: 'Converting...',
          error: null
        }
      );
    });
  });

  describe('startConversion', () => {
    test('returns error for M4B file', async () => {
      const audiobook = {
        id: 1,
        title: 'Test Book',
        file_path: '/test/book.m4b',
        is_multi_file: false
      };
      const mockDb = {};

      const result = await conversionService.startConversion(audiobook, mockDb);

      expect(result.error).toBe('File is already M4B format');
    });

    test('allows M4B for multi-file merge', async () => {
      fs.existsSync.mockReturnValue(true);
      spawn.mockReturnValue({
        stdout: { on: jest.fn() },
        stderr: { on: jest.fn() },
        on: jest.fn()
      });

      const audiobook = {
        id: 1,
        title: 'Test Book',
        file_path: '/test/chapter1.m4b',
        duration: 3600,
        is_multi_file: 1
      };
      const mockDb = {
        all: jest.fn((query, params, cb) => cb(null, [
          { file_path: '/test/chapter1.m4b', duration: 1800, title: 'Chapter 1' },
          { file_path: '/test/chapter2.m4b', duration: 1800, title: 'Chapter 2' }
        ])),
        run: jest.fn((query, params, cb) => cb && cb(null))
      };

      const result = await conversionService.startConversion(audiobook, mockDb);

      expect(result.error).toBeUndefined();
      expect(result.jobId).toBeDefined();
      expect(result.status).toBe('started');
    });

    test('returns error for unsupported format', async () => {
      const audiobook = {
        id: 1,
        title: 'Test Book',
        file_path: '/test/book.mid',
        is_multi_file: false
      };
      const mockDb = {};

      const result = await conversionService.startConversion(audiobook, mockDb);

      expect(result.error).toContain('Unsupported format');
    });

    test('returns error when file not found', async () => {
      fs.existsSync.mockReturnValue(false);
      const audiobook = {
        id: 1,
        title: 'Test Book',
        file_path: '/test/book.mp3',
        is_multi_file: false
      };
      const mockDb = {};

      const result = await conversionService.startConversion(audiobook, mockDb);

      expect(result.error).toContain('Audio file not found');
    });

    test('starts conversion for valid single file', async () => {
      fs.existsSync.mockReturnValue(true);
      spawn.mockReturnValue({
        stdout: { on: jest.fn() },
        stderr: { on: jest.fn() },
        on: jest.fn((event, cb) => {
          if (event === 'close') setTimeout(() => cb(0), 10);
        })
      });

      const audiobook = {
        id: 1,
        title: 'Test Book',
        file_path: '/test/book.mp3',
        duration: 3600,
        is_multi_file: false
      };
      const mockDb = {
        run: jest.fn((query, params, cb) => cb && cb(null))
      };

      const result = await conversionService.startConversion(audiobook, mockDb);

      expect(result.jobId).toBeDefined();
      expect(result.status).toBe('started');
      expect(conversionService.jobs.has(result.jobId)).toBe(true);
    });

    test('handles multifile audiobook with chapters', async () => {
      fs.existsSync.mockReturnValue(true);
      spawn.mockReturnValue({
        stdout: { on: jest.fn() },
        stderr: { on: jest.fn() },
        on: jest.fn()
      });

      const audiobook = {
        id: 1,
        title: 'Test Book',
        file_path: '/test/chapter1.mp3',
        duration: 3600,
        is_multi_file: 1
      };
      const mockDb = {
        all: jest.fn((query, params, cb) => cb(null, [
          { file_path: '/test/chapter1.mp3', duration: 1800, title: 'Chapter 1' },
          { file_path: '/test/chapter2.mp3', duration: 1800, title: 'Chapter 2' }
        ])),
        run: jest.fn((query, params, cb) => cb && cb(null))
      };

      const result = await conversionService.startConversion(audiobook, mockDb);

      expect(result.jobId).toBeDefined();
      expect(result.status).toBe('started');
    });

    test('treats multifile as single when no chapters found', async () => {
      fs.existsSync.mockReturnValue(true);
      spawn.mockReturnValue({
        stdout: { on: jest.fn() },
        stderr: { on: jest.fn() },
        on: jest.fn()
      });

      const audiobook = {
        id: 1,
        title: 'Test Book',
        file_path: '/test/book.mp3',
        duration: 3600,
        is_multi_file: 1
      };
      const mockDb = {
        all: jest.fn((query, params, cb) => cb(null, [])), // No chapters
        run: jest.fn((query, params, cb) => cb && cb(null))
      };

      const result = await conversionService.startConversion(audiobook, mockDb);

      expect(result.jobId).toBeDefined();
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('will check filesystem')
      );
    });
  });

  describe('buildFFmpegArgs', () => {
    test('builds concat filter args for multifile with chapter metadata', async () => {
      const job = {
        isMultiFile: true,
        sourceFiles: [
          { path: '/test/ch1.mp3', duration: 1800, title: 'Chapter 1' },
          { path: '/test/ch2.mp3', duration: 1200, title: 'Chapter 2' }
        ],
        tempPath: '/test/output.m4b',
        concatListPath: '/test/concat.txt',
        chapterMetadataPath: '/test/chapters.txt',
        ext: '.mp3'
      };

      const args = await conversionService.buildFFmpegArgs(job);

      // Should use concat filter, not concat demuxer
      expect(args).toContain('-filter_complex');
      const filterIdx = args.indexOf('-filter_complex');
      expect(args[filterIdx + 1]).toContain('concat=n=2:v=0:a=1');
      expect(args[filterIdx + 1]).toContain('[0:a][1:a]');
      expect(args).toContain('-map');
      expect(args).toContain('[out]');

      // Metadata file is input index 2 (after 2 source files)
      expect(args).toContain('-map_chapters');
      const chapIdx = args.indexOf('-map_chapters');
      expect(args[chapIdx + 1]).toBe('2');

      // Each source file should be a separate -i input
      expect(args).toContain('/test/ch1.mp3');
      expect(args).toContain('/test/ch2.mp3');

      // Should NOT write a concat list file
      expect(fs.writeFileSync).not.toHaveBeenCalledWith(
        '/test/concat.txt',
        expect.anything()
      );

      // Verify chapter metadata file was written
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        '/test/chapters.txt',
        expect.stringContaining(';FFMETADATA1')
      );
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        '/test/chapters.txt',
        expect.stringContaining('title=Chapter 1')
      );
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        '/test/chapters.txt',
        expect.stringContaining('START=0')
      );
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        '/test/chapters.txt',
        expect.stringContaining('START=1800000')
      );
    });

    test('builds single-file args when all chapters reference same file', async () => {
      const job = {
        isMultiFile: true,
        sourceFiles: [
          { path: '/test/book.m4a', duration: 600, title: 'Chapter 1' },
          { path: '/test/book.m4a', duration: 900, title: 'Chapter 2' },
          { path: '/test/book.m4a', duration: 750, title: 'Chapter 3' }
        ],
        tempPath: '/test/output.m4b',
        chapterMetadataPath: '/test/chapters.txt',
        ext: '.m4a'
      };

      const args = await conversionService.buildFFmpegArgs(job);

      // Should NOT use concat filter (single file, not multiple)
      expect(args).not.toContain('-filter_complex');

      // Should have single -i for audio + -i for chapter metadata
      const iCount = args.filter(a => a === '-i').length;
      expect(iCount).toBe(2);

      // Should have -vn to strip video streams
      expect(args).toContain('-vn');

      // Should map audio from first input and metadata from second
      expect(args).toContain('-map');
      expect(args).toContain('0:a');
      expect(args).toContain('-map_metadata');
      expect(args).toContain('1');
      expect(args).toContain('-map_chapters');

      // Should write chapter metadata
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        '/test/chapters.txt',
        expect.stringContaining(';FFMETADATA1')
      );
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        '/test/chapters.txt',
        expect.stringContaining('title=Chapter 1')
      );
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        '/test/chapters.txt',
        expect.stringContaining('title=Chapter 3')
      );
      // Chapter 2 starts at 600000ms (after Chapter 1's 600s)
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        '/test/chapters.txt',
        expect.stringContaining('START=600000')
      );
    });

    test('builds re-encode args for single M4A with -vn', async () => {
      const job = {
        isMultiFile: false,
        sourceFiles: [{ path: '/test/book.m4a' }],
        tempPath: '/test/output.m4b',
        ext: '.m4a'
      };

      const args = await conversionService.buildFFmpegArgs(job);

      expect(args).toContain('-vn');
      expect(args).toContain('-c:a');
      expect(args).toContain('aac');
      expect(args).not.toContain('-c');
      expect(args).not.toContain('copy');
      expect(args).toContain('-progress');
    });

    test('builds re-encode args for MP3', async () => {
      const job = {
        isMultiFile: false,
        sourceFiles: [{ path: '/test/book.mp3' }],
        tempPath: '/test/output.m4b',
        ext: '.mp3'
      };

      const args = await conversionService.buildFFmpegArgs(job);

      expect(args).toContain('-c:a');
      expect(args).toContain('aac');
    });
  });

  describe('shutdown', () => {
    test('kills active processes and cleans up', () => {
      const mockProcess = { kill: jest.fn() };
      conversionService.jobs.set('job-1', {
        id: 'job-1',
        process: mockProcess,
        tempPath: '/test/temp.m4b'
      });

      conversionService.shutdown();

      expect(mockProcess.kill).toHaveBeenCalledWith('SIGTERM');
    });

    test('handles jobs without process', () => {
      conversionService.jobs.set('job-1', {
        id: 'job-1',
        process: null,
        tempPath: '/test/temp.m4b'
      });
      fs.existsSync.mockReturnValue(true);

      // Should not throw
      expect(() => conversionService.shutdown()).not.toThrow();
    });
  });

  describe('runFFmpegWithProgress', () => {
    test('resolves on successful conversion', async () => {
      const mockStdout = { on: jest.fn() };
      const mockStderr = { on: jest.fn() };
      let closeCallback;

      spawn.mockReturnValue({
        stdout: mockStdout,
        stderr: mockStderr,
        on: jest.fn((event, cb) => {
          if (event === 'close') closeCallback = cb;
        })
      });

      const job = {
        id: 'job-1',
        process: null,
        progress: 10,
        message: ''
      };

      const promise = conversionService.runFFmpegWithProgress(job, ['-i', 'input.mp3']);

      // Simulate successful close
      closeCallback(0);

      await expect(promise).resolves.toBeUndefined();
    });

    test('rejects on ffmpeg error', async () => {
      const mockStdout = { on: jest.fn() };
      const mockStderr = { on: jest.fn() };
      let closeCallback;

      spawn.mockReturnValue({
        stdout: mockStdout,
        stderr: mockStderr,
        on: jest.fn((event, cb) => {
          if (event === 'close') closeCallback = cb;
        })
      });

      const job = {
        id: 'job-1',
        process: null,
        progress: 10,
        message: ''
      };

      const promise = conversionService.runFFmpegWithProgress(job, ['-i', 'input.mp3']);

      // Simulate failure
      closeCallback(1);

      await expect(promise).rejects.toThrow('FFmpeg exited with code 1');
    });

    test('rejects on spawn error', async () => {
      const mockStdout = { on: jest.fn() };
      const mockStderr = { on: jest.fn() };
      let errorCallback;

      spawn.mockReturnValue({
        stdout: mockStdout,
        stderr: mockStderr,
        on: jest.fn((event, cb) => {
          if (event === 'error') errorCallback = cb;
        })
      });

      const job = {
        id: 'job-1',
        process: null,
        progress: 10,
        message: ''
      };

      const promise = conversionService.runFFmpegWithProgress(job, ['-i', 'input.mp3']);

      // Simulate spawn error
      errorCallback(new Error('Spawn failed'));

      await expect(promise).rejects.toThrow('Spawn failed');
    });

    test('parses duration from stderr', async () => {
      const mockStdout = { on: jest.fn() };
      let stderrCallback;
      let closeCallback;

      spawn.mockReturnValue({
        stdout: mockStdout,
        stderr: {
          on: jest.fn((event, cb) => {
            if (event === 'data') stderrCallback = cb;
          })
        },
        on: jest.fn((event, cb) => {
          if (event === 'close') closeCallback = cb;
        })
      });

      const job = {
        id: 'job-1',
        process: null,
        progress: 10,
        message: ''
      };

      const promise = conversionService.runFFmpegWithProgress(job, ['-i', 'input.mp3']);

      // Simulate duration output
      stderrCallback(Buffer.from('Duration: 01:30:00.00, start: 0.000000'));

      closeCallback(0);

      await promise;
      expect(console.log).toHaveBeenCalledWith('Conversion duration: 5400s');
    });

    test('parses progress from stdout', async () => {
      let stdoutCallback;
      let stderrCallback;
      let closeCallback;

      spawn.mockReturnValue({
        stdout: {
          on: jest.fn((event, cb) => {
            if (event === 'data') stdoutCallback = cb;
          })
        },
        stderr: {
          on: jest.fn((event, cb) => {
            if (event === 'data') stderrCallback = cb;
          })
        },
        on: jest.fn((event, cb) => {
          if (event === 'close') closeCallback = cb;
        })
      });

      const job = {
        id: 'job-1',
        audiobookId: 1,
        audiobookTitle: 'Test',
        process: null,
        progress: 10,
        message: '',
        error: null
      };

      const promise = conversionService.runFFmpegWithProgress(job, ['-i', 'input.mp3']);

      // Set duration first
      stderrCallback(Buffer.from('Duration: 01:00:00.00'));

      // Then progress
      stdoutCallback(Buffer.from('out_time=00:30:00.00'));

      closeCallback(0);

      await promise;
      // Progress should be updated (50% raw = 10 + 40 = 50%)
      expect(job.progress).toBe(50);
    });
  });

  describe('extractCoverArt', () => {
    test('resolves true when cover extracted', async () => {
      let closeCallback;

      spawn.mockReturnValue({
        on: jest.fn((event, cb) => {
          if (event === 'close') closeCallback = cb;
        })
      });

      fs.existsSync.mockReturnValue(true);
      fs.statSync.mockReturnValue({ size: 1024 });

      const job = {
        sourcePath: '/test/book.mp3',
        tempCoverPath: '/test/cover.jpg'
      };

      const promise = conversionService.extractCoverArt(job);

      closeCallback(0);

      const result = await promise;
      expect(result).toBe(true);
    });

    test('resolves false when no cover', async () => {
      let closeCallback;

      spawn.mockReturnValue({
        on: jest.fn((event, cb) => {
          if (event === 'close') closeCallback = cb;
        })
      });

      fs.existsSync.mockReturnValue(false);

      const job = {
        sourcePath: '/test/book.mp3',
        tempCoverPath: '/test/cover.jpg'
      };

      const promise = conversionService.extractCoverArt(job);

      closeCallback(0);

      const result = await promise;
      expect(result).toBe(false);
    });

    test('resolves false on error', async () => {
      let errorCallback;

      spawn.mockReturnValue({
        on: jest.fn((event, cb) => {
          if (event === 'error') errorCallback = cb;
        })
      });

      const job = {
        sourcePath: '/test/book.mp3',
        tempCoverPath: '/test/cover.jpg'
      };

      const promise = conversionService.extractCoverArt(job);

      errorCallback(new Error('FFmpeg error'));

      const result = await promise;
      expect(result).toBe(false);
    });

    test('resolves false on timeout', async () => {
      spawn.mockReturnValue({
        kill: jest.fn(),
        on: jest.fn() // Never calls callbacks
      });

      const job = {
        sourcePath: '/test/book.mp3',
        tempCoverPath: '/test/cover.jpg'
      };

      const promise = conversionService.extractCoverArt(job);

      // Advance timers past the 30 second timeout
      jest.advanceTimersByTime(31000);

      const result = await promise;
      expect(result).toBe(false);
    });
  });

  describe('embedCoverArt', () => {
    test('resolves true when cover embedded', async () => {
      let closeCallback;

      spawn.mockReturnValue({
        on: jest.fn((event, cb) => {
          if (event === 'close') closeCallback = cb;
        })
      });

      fs.existsSync.mockReturnValue(true);

      const job = {
        tempPath: '/test/output.m4b',
        tempCoverPath: '/test/cover.jpg'
      };

      const promise = conversionService.embedCoverArt(job);

      closeCallback(0);

      const result = await promise;
      expect(result).toBe(true);
      expect(fs.unlinkSync).toHaveBeenCalledWith('/test/cover.jpg');
    });

    test('resolves false on tone error', async () => {
      let closeCallback;

      spawn.mockReturnValue({
        on: jest.fn((event, cb) => {
          if (event === 'close') closeCallback = cb;
        })
      });

      fs.existsSync.mockReturnValue(true);

      const job = {
        tempPath: '/test/output.m4b',
        tempCoverPath: '/test/cover.jpg'
      };

      const promise = conversionService.embedCoverArt(job);

      closeCallback(1); // Non-zero exit

      const result = await promise;
      expect(result).toBe(false);
    });

    test('resolves false on spawn error', async () => {
      let errorCallback;

      spawn.mockReturnValue({
        on: jest.fn((event, cb) => {
          if (event === 'error') errorCallback = cb;
        })
      });

      const job = {
        tempPath: '/test/output.m4b',
        tempCoverPath: '/test/cover.jpg'
      };

      const promise = conversionService.embedCoverArt(job);

      errorCallback(new Error('Tone error'));

      const result = await promise;
      expect(result).toBe(false);
    });

    test('resolves false on timeout', async () => {
      spawn.mockReturnValue({
        kill: jest.fn(),
        on: jest.fn()
      });

      const job = {
        tempPath: '/test/output.m4b',
        tempCoverPath: '/test/cover.jpg'
      };

      const promise = conversionService.embedCoverArt(job);

      // Advance past 60 second timeout
      jest.advanceTimersByTime(61000);

      const result = await promise;
      expect(result).toBe(false);
    });
  });
});
