const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const websocketManager = require('./websocketManager');
const { createDbHelpers } = require('../utils/db');

/**
 * Conversion Service - Manages async audio conversion jobs with progress tracking
 */
class ConversionService {
  constructor() {
    // Active jobs: Map<jobId, jobInfo>
    this.jobs = new Map();

    // Directories with active conversions (to prevent scanner interference)
    this.activeConversions = new Set();

    // Concurrency limiter for ffmpeg processes
    this.MAX_CONCURRENT = 2;
    this.runningConversions = 0;
    this.conversionQueue = [];

    // Clean up stale jobs every 5 minutes
    this.cleanupInterval = setInterval(() => this.cleanupStaleJobs(), 5 * 60 * 1000).unref();
  }

  /**
   * Acquire a concurrency slot. Resolves immediately if a slot is available,
   * otherwise queues the request until a slot opens up.
   */
  acquireSlot() {
    return new Promise(resolve => {
      if (this.runningConversions < this.MAX_CONCURRENT) {
        this.runningConversions++;
        resolve();
      } else {
        this.conversionQueue.push(resolve);
      }
    });
  }

  /**
   * Release a concurrency slot. If there are queued conversions waiting,
   * the next one is started immediately.
   */
  releaseSlot() {
    this.runningConversions--;
    if (this.conversionQueue.length > 0) {
      this.runningConversions++;
      const next = this.conversionQueue.shift();
      next();
    }
  }

  /**
   * Start a new conversion job
   * Returns job ID immediately, conversion runs in background
   */
  async startConversion(audiobook, db) {
    const jobId = crypto.randomUUID();
    const dir = path.dirname(audiobook.file_path);
    const supportedFormats = ['.m4a', '.mp3', '.mp4', '.ogg', '.flac', '.opus', '.aac', '.wav', '.wma'];

    // Check if multifile audiobook
    let sourceFiles = [];
    let isMultiFile = !!audiobook.is_multi_file;
    console.log(`Conversion: audiobook ${audiobook.id}, is_multi_file=${audiobook.is_multi_file}, isMultiFile=${isMultiFile}`);

    if (isMultiFile) {
      // Fetch chapter files from database
      const chapters = await new Promise((resolve, reject) => {
        db.all(
          'SELECT file_path, duration, title FROM audiobook_chapters WHERE audiobook_id = ? ORDER BY chapter_number',
          [audiobook.id],
          (err, rows) => {
            if (err) reject(err);
            else resolve(rows || []);
          }
        );
      });
      console.log(`Conversion: found ${chapters.length} chapters in database`);

      if (chapters.length > 0) {
        sourceFiles = chapters.map(ch => ({
          path: ch.file_path,
          duration: ch.duration,
          title: ch.title
        }));
        console.log(`Conversion: multifile with ${sourceFiles.length} source files`);
      } else {
        // No chapters found, treat as single file
        isMultiFile = false;
        console.log('Conversion: no chapters found, treating as single file');
      }
    }

    // For single file, use main file_path
    if (!isMultiFile) {
      sourceFiles = [{
        path: audiobook.file_path,
        duration: audiobook.duration,
        title: audiobook.title
      }];
    }

    // Validate all source files
    for (const file of sourceFiles) {
      const ext = path.extname(file.path).toLowerCase();
      // Only reject single-file M4B (already in target format).
      // Multi-file M4B collections should be merged into a single M4B.
      if (ext === '.m4b' && !isMultiFile) {
        return { error: 'File is already M4B format' };
      }
      if (ext !== '.m4b' && !supportedFormats.includes(ext)) {
        return { error: `Unsupported format: ${ext}. Supported: ${supportedFormats.join(', ')}` };
      }
      if (!fs.existsSync(file.path)) {
        return { error: `Audio file not found: ${path.basename(file.path)}` };
      }
    }

    // Use audiobook title for output filename (sanitized)
    const sanitizedTitle = (audiobook.title || 'audiobook')
      .replace(/[<>:"/\\|?*]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .substring(0, 100);
    const tempDir = process.env.UPLOAD_DIR || path.join(__dirname, '../../data/uploads');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    const tempPath = path.join(tempDir, `${sanitizedTitle}_converting.m4b`);
    const finalPath = path.join(dir, `${sanitizedTitle}.m4b`);
    const tempCoverPath = path.join(tempDir, `${sanitizedTitle}_temp_cover.jpg`);
    const concatListPath = path.join(tempDir, `${sanitizedTitle}_concat.txt`);
    const chapterMetadataPath = path.join(tempDir, `${sanitizedTitle}_chapters.txt`);

    // Create job info
    const job = {
      id: jobId,
      audiobookId: audiobook.id,
      audiobookTitle: audiobook.title,
      status: 'starting',
      progress: 0,
      message: isMultiFile ? `Starting conversion of ${sourceFiles.length} files...` : 'Starting conversion...',
      sourcePath: audiobook.file_path, // Primary file for cover extraction
      sourceFiles,
      isMultiFile,
      tempPath,
      finalPath,
      tempCoverPath,
      concatListPath,
      chapterMetadataPath,
      dir,
      ext: path.extname(sourceFiles[0].path).toLowerCase(),
      startedAt: new Date().toISOString(),
      error: null,
      process: null,
    };

    this.jobs.set(jobId, job);
    this.activeConversions.add(dir);

    // Broadcast job started
    this.broadcastJobStatus(job);

    // Start conversion in background with concurrency limiting
    this.runConversionWithLimit(job, audiobook, db);

    return { jobId, status: 'started' };
  }

  /**
   * Acquire a concurrency slot, then run the conversion.
   * Ensures the slot is always released when the conversion finishes.
   */
  async runConversionWithLimit(job, audiobook, db) {
    // Update status while waiting in queue
    if (this.runningConversions >= this.MAX_CONCURRENT) {
      job.status = 'queued';
      job.message = `Waiting for available slot (${this.runningConversions}/${this.MAX_CONCURRENT} running)...`;
      this.broadcastJobStatus(job);
      console.log(`Conversion queued for "${audiobook.title}" (${this.runningConversions}/${this.MAX_CONCURRENT} active, ${this.conversionQueue.length + 1} waiting)`);
    }

    await this.acquireSlot();

    // Check if job was cancelled while waiting in queue
    if (job.status === 'cancelled') {
      this.releaseSlot();
      return;
    }

    try {
      await this.runConversion(job, audiobook, db);
    } finally {
      this.releaseSlot();
    }
  }

  /**
   * Run the actual conversion process
   */
  async runConversion(job, audiobook, db) {
    try {
      job.status = 'converting';
      job.message = 'Extracting cover art...';
      job.progress = 5;
      this.broadcastJobStatus(job);

      // Try to extract cover art from first file (works for any format with embedded art)
      const hasCover = await this.extractCoverArt(job);

      job.message = job.isMultiFile
        ? `Converting ${job.sourceFiles.length} files...`
        : 'Converting audio...';
      job.progress = 10;
      this.broadcastJobStatus(job);

      // Build ffmpeg arguments (handles both single and multifile)
      const args = await this.buildFFmpegArgs(job);

      // Run ffmpeg with progress parsing
      await this.runFFmpegWithProgress(job, args);

      // Verify output
      if (!fs.existsSync(job.tempPath)) {
        throw new Error('Conversion completed but output file not found');
      }

      job.message = 'Finalizing...';
      job.progress = 90;
      this.broadcastJobStatus(job);

      // Re-embed cover art if extracted
      if (hasCover && fs.existsSync(job.tempCoverPath)) {
        await this.embedCoverArt(job);
      }

      // Get new file size
      const newStats = fs.statSync(job.tempPath);

      // Commit: rename temp to final
      fs.renameSync(job.tempPath, job.finalPath);

      // Update database BEFORE deleting source files (if DB fails, sources are intact)
      const { dbTransaction } = createDbHelpers(db);
      await dbTransaction(async ({ dbRun }) => {
        await dbRun(
          'UPDATE audiobooks SET file_path = ?, file_size = ?, is_multi_file = 0 WHERE id = ?',
          [job.finalPath, newStats.size, audiobook.id]
        );
        if (job.isMultiFile) {
          await dbRun(
            'DELETE FROM audiobook_chapters WHERE audiobook_id = ?',
            [audiobook.id]
          );
        }
      });

      // Delete original source files (safe: DB already updated)
      for (const file of job.sourceFiles) {
        if (fs.existsSync(file.path) && file.path !== job.finalPath) {
          try {
            fs.unlinkSync(file.path);
          } catch (e) {
            console.warn(`Failed to delete source file: ${file.path}`, e.message);
          }
        }
      }

      // Clean up temp list files
      if (job.concatListPath && fs.existsSync(job.concatListPath)) {
        try { fs.unlinkSync(job.concatListPath); } catch (_e) { /* ignore */ }
      }
      if (job.chapterMetadataPath && fs.existsSync(job.chapterMetadataPath)) {
        try { fs.unlinkSync(job.chapterMetadataPath); } catch (_e) { /* ignore */ }
      }

      // Success!
      job.status = 'completed';
      job.progress = 100;
      job.message = job.isMultiFile
        ? `Conversion completed - merged ${job.sourceFiles.length} files`
        : 'Conversion completed successfully';
      job.completedAt = new Date().toISOString();
      this.broadcastJobStatus(job);

      console.log(`Successfully converted to M4B: ${job.finalPath}${job.isMultiFile ? ` (merged ${job.sourceFiles.length} files)` : ''}`);

      // Broadcast library update
      websocketManager.broadcastLibraryUpdate('library.update', {
        id: audiobook.id,
        title: audiobook.title,
        author: audiobook.author,
      });

    } catch (error) {
      console.error('Conversion error:', error);
      job.status = 'failed';
      job.error = error.message;
      job.message = `Conversion failed: ${error.message}`;
      this.broadcastJobStatus(job);

      // Cleanup temp files
      this.cleanupJobFiles(job);
    } finally {
      // Unlock directory
      this.activeConversions.delete(job.dir);
    }
  }

  /**
   * Build ffmpeg arguments based on source format
   * For multifile, creates a concat list file and uses concat demuxer
   */
  async buildFFmpegArgs(job) {
    console.log(`buildFFmpegArgs: isMultiFile=${job.isMultiFile}, sourceFiles.length=${job.sourceFiles.length}, ext=${job.ext}`);
    if (job.isMultiFile && job.sourceFiles.length > 1) {
      // Create concat list file for ffmpeg
      // Format: file 'path/to/file.mp3'
      const concatContent = job.sourceFiles
        .map(f => `file '${f.path.replace(/'/g, "'\\''")}'`)
        .join('\n');
      fs.writeFileSync(job.concatListPath, concatContent);
      console.log(`buildFFmpegArgs: using concat demuxer with ${job.sourceFiles.length} files`);

      // Generate FFMETADATA chapter markers from source file durations
      let metadataContent = ';FFMETADATA1\n';
      let cumulativeMs = 0;
      for (let i = 0; i < job.sourceFiles.length; i++) {
        const file = job.sourceFiles[i];
        const durationMs = Math.round((file.duration || 0) * 1000);
        const startMs = cumulativeMs;
        const endMs = cumulativeMs + durationMs;
        const title = file.title || `Chapter ${i + 1}`;
        metadataContent += `[CHAPTER]\nTIMEBASE=1/1000\nSTART=${startMs}\nEND=${endMs}\ntitle=${title.replace(/[=;\n\\]/g, '\\$&')}\n`;
        cumulativeMs = endMs;
      }
      fs.writeFileSync(job.chapterMetadataPath, metadataContent);
      console.log(`buildFFmpegArgs: generated chapter metadata for ${job.sourceFiles.length} chapters`);

      // Multifile - concatenate with chapter markers and re-encode
      return [
        '-f', 'concat',
        '-safe', '0',
        '-i', job.concatListPath,
        '-i', job.chapterMetadataPath,
        '-map_metadata', '1',
        '-map_chapters', '1',
        '-vn',
        '-c:a', 'aac',
        '-b:a', '128k',
        '-ar', '44100',
        '-ac', '1',
        '-f', 'ipod',
        '-progress', 'pipe:1',
        '-y', job.tempPath
      ];
    } else if (job.ext === '.m4a' || job.ext === '.mp4' || job.ext === '.aac') {
      // Single M4A/MP4/AAC - already AAC codec, just copy streams into M4B container
      return [
        '-i', job.sourceFiles[0].path,
        '-c', 'copy',
        '-f', 'ipod',
        '-progress', 'pipe:1',
        '-y', job.tempPath
      ];
    } else {
      // Single MP3, OGG, FLAC, OPUS, WAV, WMA - re-encode to AAC
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

  /**
   * Run ffmpeg with progress tracking
   */
  runFFmpegWithProgress(job, args) {
    return new Promise((resolve, reject) => {
      const ffmpeg = spawn('ffmpeg', args);
      job.process = ffmpeg;

      let duration = null;
      let lastProgress = 10;

      // Parse stderr for duration
      ffmpeg.stderr.on('data', (data) => {
        const output = data.toString();

        // Extract duration
        const durationMatch = output.match(/Duration: (\d{2}):(\d{2}):(\d{2})/);
        if (durationMatch && !duration) {
          const hours = parseInt(durationMatch[1]);
          const minutes = parseInt(durationMatch[2]);
          const seconds = parseInt(durationMatch[3]);
          duration = hours * 3600 + minutes * 60 + seconds;
          console.log(`Conversion duration: ${duration}s`);
        }
      });

      // Parse stdout for progress (when -progress pipe:1 is used)
      ffmpeg.stdout.on('data', (data) => {
        const output = data.toString();

        // Parse out_time for progress
        const timeMatch = output.match(/out_time=(\d{2}):(\d{2}):(\d{2})/);
        if (timeMatch && duration) {
          const hours = parseInt(timeMatch[1]);
          const minutes = parseInt(timeMatch[2]);
          const seconds = parseInt(timeMatch[3]);
          const currentTime = hours * 3600 + minutes * 60 + seconds;

          // Calculate progress (10-90% range for conversion phase)
          const rawProgress = Math.min((currentTime / duration) * 100, 100);
          const progress = Math.round(10 + (rawProgress * 0.8)); // 10% to 90%

          if (progress > lastProgress) {
            lastProgress = progress;
            job.progress = progress;
            job.message = `Converting: ${Math.round(rawProgress)}%`;
            this.broadcastJobStatus(job);
          }
        }
      });

      ffmpeg.on('close', (code) => {
        job.process = null;
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`FFmpeg exited with code ${code}`));
        }
      });

      ffmpeg.on('error', (err) => {
        job.process = null;
        reject(err);
      });
    });
  }

  /**
   * Extract cover art from MP3
   */
  async extractCoverArt(job) {
    return new Promise((resolve) => {
      const ffmpeg = spawn('ffmpeg', [
        '-i', job.sourcePath,
        '-an',
        '-vcodec', 'copy',
        '-y', job.tempCoverPath
      ]);

      let completed = false;
      const timeout = setTimeout(() => {
        if (!completed) {
          ffmpeg.kill();
          resolve(false);
        }
      }, 30000);

      ffmpeg.on('close', (code) => {
        completed = true;
        clearTimeout(timeout);
        const hasCover = code === 0 &&
          fs.existsSync(job.tempCoverPath) &&
          fs.statSync(job.tempCoverPath).size > 0;
        if (hasCover) {
          console.log(`Extracted cover art from ${job.ext} file`);
        }
        resolve(hasCover);
      });

      ffmpeg.on('error', () => {
        completed = true;
        clearTimeout(timeout);
        resolve(false);
      });
    });
  }

  /**
   * Embed cover art using tone
   */
  async embedCoverArt(job) {
    return new Promise((resolve) => {
      const tone = spawn('tone', [
        'tag', job.tempPath,
        `--meta-cover-file=${job.tempCoverPath}`
      ]);

      let completed = false;
      const timeout = setTimeout(() => {
        if (!completed) {
          tone.kill();
          resolve(false);
        }
      }, 60000);

      tone.on('close', (code) => {
        completed = true;
        clearTimeout(timeout);

        // Clean up temp cover
        if (fs.existsSync(job.tempCoverPath)) {
          try { fs.unlinkSync(job.tempCoverPath); } catch (_e) { /* ignore cleanup errors */ }
        }

        if (code === 0) {
          console.log('Cover art embedded successfully');
        }
        resolve(code === 0);
      });

      tone.on('error', () => {
        completed = true;
        clearTimeout(timeout);
        resolve(false);
      });
    });
  }

  /**
   * Clean up temp files for a job
   */
  cleanupJobFiles(job) {
    if (job.tempPath && fs.existsSync(job.tempPath)) {
      try {
        fs.unlinkSync(job.tempPath);
        console.log('Cleaned up temp M4B file');
      } catch (e) {
        console.error('Failed to clean up temp M4B:', e.message);
      }
    }
    if (job.tempCoverPath && fs.existsSync(job.tempCoverPath)) {
      try { fs.unlinkSync(job.tempCoverPath); } catch (_e) { /* ignore cleanup errors */ }
    }
    if (job.concatListPath && fs.existsSync(job.concatListPath)) {
      try { fs.unlinkSync(job.concatListPath); } catch (_e) { /* ignore cleanup errors */ }
    }
    if (job.chapterMetadataPath && fs.existsSync(job.chapterMetadataPath)) {
      try { fs.unlinkSync(job.chapterMetadataPath); } catch (_e) { /* ignore cleanup errors */ }
    }
  }

  /**
   * Broadcast job status via WebSocket
   */
  broadcastJobStatus(job) {
    websocketManager.broadcastJobUpdate('conversion', job.status, {
      jobId: job.id,
      audiobookId: job.audiobookId,
      audiobookTitle: job.audiobookTitle,
      progress: job.progress,
      message: job.message,
      error: job.error,
    });
  }

  /**
   * Get job status
   */
  getJobStatus(jobId) {
    const job = this.jobs.get(jobId);
    if (!job) {
      return null;
    }
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

  /**
   * Get all active jobs (including queued)
   */
  getActiveJobs() {
    const active = [];
    for (const job of this.jobs.values()) {
      if (job.status === 'starting' || job.status === 'converting' || job.status === 'queued') {
        active.push(this.getJobStatus(job.id));
      }
    }
    return active;
  }

  /**
   * Get active job for a specific audiobook (including queued)
   */
  getActiveJobForAudiobook(audiobookId) {
    for (const job of this.jobs.values()) {
      if (job.audiobookId === audiobookId &&
          (job.status === 'starting' || job.status === 'converting' || job.status === 'queued')) {
        return this.getJobStatus(job.id);
      }
    }
    return null;
  }

  /**
   * Cancel a job
   */
  cancelJob(jobId) {
    const job = this.jobs.get(jobId);
    if (!job) {
      return { error: 'Job not found' };
    }

    if (job.status === 'completed' || job.status === 'failed') {
      return { error: 'Job already finished' };
    }

    // Kill the ffmpeg process if actively running
    if (job.process) {
      job.process.kill('SIGTERM');
    }

    job.status = 'cancelled';
    job.message = 'Conversion cancelled';
    this.broadcastJobStatus(job);
    this.cleanupJobFiles(job);
    this.activeConversions.delete(job.dir);

    // Note: if the job was queued, the acquireSlot promise will resolve eventually
    // and runConversionWithLimit checks for cancellation before proceeding.

    return { success: true };
  }

  /**
   * Check if directory has active conversion
   */
  isDirectoryLocked(dir) {
    return this.activeConversions.has(dir);
  }

  /**
   * Clean up stale jobs (older than 1 hour)
   */
  cleanupStaleJobs() {
    const oneHourAgo = Date.now() - 60 * 60 * 1000;

    for (const [jobId, job] of this.jobs.entries()) {
      const startTime = new Date(job.startedAt).getTime();

      // Remove completed/failed jobs older than 1 hour
      if ((job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled')
          && startTime < oneHourAgo) {
        this.jobs.delete(jobId);
        continue;
      }

      // Check for stuck jobs (running or queued for more than 2 hours)
      if ((job.status === 'starting' || job.status === 'converting' || job.status === 'queued')
          && startTime < Date.now() - 2 * 60 * 60 * 1000) {
        console.log(`Cleaning up stuck conversion job: ${jobId}`);
        if (job.process) {
          job.process.kill('SIGTERM');
        }
        job.status = 'failed';
        job.error = 'Conversion timed out';
        job.message = 'Conversion timed out after 2 hours';
        this.broadcastJobStatus(job);
        this.cleanupJobFiles(job);
        this.activeConversions.delete(job.dir);
      }
    }
  }

  /**
   * Clean up on shutdown
   */
  shutdown() {
    clearInterval(this.cleanupInterval);

    // Kill all active conversions
    for (const job of this.jobs.values()) {
      if (job.process) {
        job.process.kill('SIGTERM');
      }
      this.cleanupJobFiles(job);
    }
  }
}

// Export singleton
const conversionService = new ConversionService();
module.exports = conversionService;
