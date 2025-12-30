const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const websocketManager = require('./websocketManager');

/**
 * Conversion Service - Manages async audio conversion jobs with progress tracking
 */
class ConversionService {
  constructor() {
    // Active jobs: Map<jobId, jobInfo>
    this.jobs = new Map();

    // Directories with active conversions (to prevent scanner interference)
    this.activeConversions = new Set();

    // Clean up stale jobs every 5 minutes
    this.cleanupInterval = setInterval(() => this.cleanupStaleJobs(), 5 * 60 * 1000);
  }

  /**
   * Start a new conversion job
   * Returns job ID immediately, conversion runs in background
   */
  async startConversion(audiobook, db) {
    const jobId = crypto.randomUUID();
    const ext = path.extname(audiobook.file_path).toLowerCase();
    const dir = path.dirname(audiobook.file_path);
    const basename = path.basename(audiobook.file_path, ext);
    const tempPath = path.join(dir, `${basename}_converting.m4b`);
    const finalPath = path.join(dir, `${basename}.m4b`);
    const tempCoverPath = path.join(dir, `${basename}_temp_cover.jpg`);

    // Supported formats
    const supportedFormats = ['.m4a', '.mp3', '.mp4', '.ogg', '.flac'];

    if (ext === '.m4b') {
      return { error: 'File is already M4B format' };
    }

    if (!supportedFormats.includes(ext)) {
      return { error: `Unsupported format: ${ext}. Supported: ${supportedFormats.join(', ')}` };
    }

    if (!fs.existsSync(audiobook.file_path)) {
      return { error: 'Audio file not found on disk' };
    }

    // Create job info
    const job = {
      id: jobId,
      audiobookId: audiobook.id,
      audiobookTitle: audiobook.title,
      status: 'starting',
      progress: 0,
      message: 'Starting conversion...',
      sourcePath: audiobook.file_path,
      tempPath,
      finalPath,
      tempCoverPath,
      dir,
      ext,
      startedAt: new Date().toISOString(),
      error: null,
      process: null,
    };

    this.jobs.set(jobId, job);
    this.activeConversions.add(dir);

    // Broadcast job started
    this.broadcastJobStatus(job);

    // Start conversion in background
    this.runConversion(job, audiobook, db);

    return { jobId, status: 'started' };
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

      // Try to extract cover art from MP3
      let hasCover = false;
      if (job.ext === '.mp3') {
        hasCover = await this.extractCoverArt(job);
      }

      job.message = 'Converting audio...';
      job.progress = 10;
      this.broadcastJobStatus(job);

      // Build ffmpeg arguments
      const args = this.buildFFmpegArgs(job);

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

      // Commit: rename temp to final, delete original
      fs.renameSync(job.tempPath, job.finalPath);
      fs.unlinkSync(audiobook.file_path);

      // Update database
      await new Promise((resolve, reject) => {
        db.run(
          'UPDATE audiobooks SET file_path = ?, file_size = ? WHERE id = ?',
          [job.finalPath, newStats.size, audiobook.id],
          (err) => {
            if (err) reject(err);
            else resolve();
          }
        );
      });

      // Success!
      job.status = 'completed';
      job.progress = 100;
      job.message = 'Conversion completed successfully';
      job.completedAt = new Date().toISOString();
      this.broadcastJobStatus(job);

      console.log(`Successfully converted to M4B: ${job.finalPath}`);

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
   */
  buildFFmpegArgs(job) {
    if (job.ext === '.m4a' || job.ext === '.mp4') {
      // M4A/MP4 - just copy streams
      return [
        '-i', job.sourcePath,
        '-c', 'copy',
        '-f', 'ipod',
        '-y', job.tempPath
      ];
    } else {
      // MP3, OGG, FLAC - re-encode to AAC
      return [
        '-i', job.sourcePath,
        '-vn',
        '-c:a', 'aac',
        '-b:a', '128k',
        '-ar', '44100',
        '-ac', '1',
        '-f', 'ipod',
        '-progress', 'pipe:1',  // Output progress to stdout
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
          console.log('Extracted cover art from MP3');
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
   * Get all active jobs
   */
  getActiveJobs() {
    const active = [];
    for (const job of this.jobs.values()) {
      if (job.status === 'starting' || job.status === 'converting') {
        active.push(this.getJobStatus(job.id));
      }
    }
    return active;
  }

  /**
   * Get active job for a specific audiobook
   */
  getActiveJobForAudiobook(audiobookId) {
    for (const job of this.jobs.values()) {
      if (job.audiobookId === audiobookId &&
          (job.status === 'starting' || job.status === 'converting')) {
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

    // Kill the ffmpeg process
    if (job.process) {
      job.process.kill('SIGTERM');
    }

    job.status = 'cancelled';
    job.message = 'Conversion cancelled';
    this.broadcastJobStatus(job);
    this.cleanupJobFiles(job);
    this.activeConversions.delete(job.dir);

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

      // Check for stuck jobs (running for more than 2 hours)
      if ((job.status === 'starting' || job.status === 'converting')
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
