/**
 * Download Web Worker
 *
 * Handles background downloading of audiobook audio files to OPFS.
 * Supports pause/resume via Range headers and reports progress to main thread.
 *
 * Message Protocol:
 * TO WORKER:
 *   { type: 'start', audiobookId: '123', token: 'jwt-token', totalBytes: 123456 }
 *   { type: 'pause', audiobookId: '123' }
 *   { type: 'resume', audiobookId: '123', token: 'jwt-token', bytesDownloaded: 52428800 }
 *   { type: 'cancel', audiobookId: '123' }
 *
 * FROM WORKER:
 *   { type: 'progress', audiobookId: '123', bytesDownloaded: 1234567 }
 *   { type: 'complete', audiobookId: '123', bytesDownloaded: 123456789 }
 *   { type: 'paused', audiobookId: '123', bytesDownloaded: 52428800 }
 *   { type: 'cancelled', audiobookId: '123' }
 *   { type: 'error', audiobookId: '123', error: 'Network error' }
 */

// ============================================================================
// OPFS Functions (copied from offlineStorage.js for worker compatibility)
// Web Workers can access OPFS directly but can't import ES modules easily
// ============================================================================

const AUDIO_DIR = 'audiobooks';

/**
 * Get the OPFS root directory
 * @returns {Promise<FileSystemDirectoryHandle>}
 */
async function getRoot() {
  return await navigator.storage.getDirectory();
}

/**
 * Get or create a subdirectory
 * @param {string} name - Directory name
 * @returns {Promise<FileSystemDirectoryHandle>}
 */
async function getOrCreateDir(name) {
  const root = await getRoot();
  return await root.getDirectoryHandle(name, { create: true });
}

/**
 * Stream data from reader to writable file
 * @param {FileSystemWritableFileStream} writable - Writable file stream
 * @param {ReadableStreamDefaultReader} reader - Stream reader
 * @param {number} initialOffset - Starting byte position (for progress tracking)
 * @param {function} onProgress - Progress callback (totalBytesWritten)
 * @param {AbortSignal} signal - AbortSignal for cancellation
 * @returns {Promise<{bytesWritten: number}>}
 */
async function streamToFile(writable, reader, initialOffset, onProgress, signal) {
  let totalBytes = initialOffset;

  try {
    while (true) {
      // Check for abort signal
      if (signal?.aborted) {
        await writable.abort();
        throw new DOMException('Download aborted', 'AbortError');
      }

      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      await writable.write(value);
      totalBytes += value.byteLength;

      if (onProgress) {
        onProgress(totalBytes);
      }
    }

    await writable.close();
    return { bytesWritten: totalBytes };
  } catch (error) {
    // Try to abort the writable stream on error
    try {
      await writable.abort();
    } catch {
      // Ignore abort errors
    }
    throw error;
  } finally {
    reader.releaseLock();
  }
}

/**
 * Save an audio file to OPFS by streaming (new download)
 * @param {string} audiobookId - Audiobook ID
 * @param {ReadableStream} stream - Audio data stream
 * @param {function} onProgress - Progress callback (bytesWritten)
 * @param {AbortSignal} signal - AbortSignal for cancellation
 * @returns {Promise<{bytesWritten: number}>}
 */
async function saveAudioFile(audiobookId, stream, onProgress = null, signal = null) {
  const dir = await getOrCreateDir(AUDIO_DIR);
  const fileName = `${audiobookId}.audio`;

  const fileHandle = await dir.getFileHandle(fileName, { create: true });
  const writable = await fileHandle.createWritable();
  const reader = stream.getReader();

  return streamToFile(writable, reader, 0, onProgress, signal);
}

/**
 * Resume a partial audio file download
 * @param {string} audiobookId - Audiobook ID
 * @param {ReadableStream} stream - Audio data stream (starting from startOffset)
 * @param {number} startOffset - Byte offset where the stream starts
 * @param {function} onProgress - Progress callback (bytesWritten)
 * @param {AbortSignal} signal - AbortSignal for cancellation
 * @returns {Promise<{bytesWritten: number}>}
 */
async function resumeAudioFile(audiobookId, stream, startOffset, onProgress = null, signal = null) {
  const dir = await getOrCreateDir(AUDIO_DIR);
  const fileName = `${audiobookId}.audio`;

  const fileHandle = await dir.getFileHandle(fileName, { create: true });
  const writable = await fileHandle.createWritable({ keepExistingData: true });
  await writable.seek(startOffset);
  const reader = stream.getReader();

  return streamToFile(writable, reader, startOffset, onProgress, signal);
}

/**
 * Delete an audio file from OPFS
 * @param {string} audiobookId - Audiobook ID
 * @returns {Promise<boolean>} True if deleted, false if not found
 */
async function deleteAudioFile(audiobookId) {
  try {
    const dir = await getOrCreateDir(AUDIO_DIR);
    const fileName = `${audiobookId}.audio`;
    await dir.removeEntry(fileName);
    return true;
  } catch (error) {
    if (error.name === 'NotFoundError') {
      return false;
    }
    throw error;
  }
}

// ============================================================================
// Download Worker Logic
// ============================================================================

// Map of audiobookId -> { controller: AbortController, bytesDownloaded: number }
const activeDownloads = new Map();

// Progress throttling - post updates every 100KB or 500ms, whichever comes first
const PROGRESS_BYTE_THRESHOLD = 100 * 1024; // 100KB
const PROGRESS_TIME_THRESHOLD = 500; // 500ms

/**
 * Create progress callback with throttling
 * @param {string} audiobookId - Audiobook ID
 * @returns {function} Throttled progress callback
 */
function createProgressCallback(audiobookId) {
  let lastReportedBytes = 0;
  let lastReportedTime = Date.now();

  return (bytesDownloaded) => {
    const now = Date.now();
    const bytesDelta = bytesDownloaded - lastReportedBytes;
    const timeDelta = now - lastReportedTime;

    // Report if we've downloaded 100KB or 500ms has passed
    if (bytesDelta >= PROGRESS_BYTE_THRESHOLD || timeDelta >= PROGRESS_TIME_THRESHOLD) {
      self.postMessage({
        type: 'progress',
        audiobookId,
        bytesDownloaded
      });
      lastReportedBytes = bytesDownloaded;
      lastReportedTime = now;
    }

    // Update the activeDownloads map with current progress
    const download = activeDownloads.get(audiobookId);
    if (download) {
      download.bytesDownloaded = bytesDownloaded;
    }
  };
}

/**
 * Start a new download
 * @param {string} audiobookId - Audiobook ID
 * @param {string} token - JWT auth token
 * @param {number} totalBytes - Expected total file size (for reference)
 */
async function startDownload(audiobookId, token, totalBytes) {
  // If there's already an active download for this audiobook, cancel it first
  if (activeDownloads.has(audiobookId)) {
    const existing = activeDownloads.get(audiobookId);
    existing.controller.abort();
    activeDownloads.delete(audiobookId);
  }

  const controller = new AbortController();
  activeDownloads.set(audiobookId, {
    controller,
    bytesDownloaded: 0,
    totalBytes
  });

  try {
    const response = await fetch(`/api/audiobooks/${audiobookId}/stream?token=${encodeURIComponent(token)}`, {
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    if (!response.body) {
      throw new Error('Response body is not readable');
    }

    const progressCallback = createProgressCallback(audiobookId);
    const result = await saveAudioFile(audiobookId, response.body, progressCallback, controller.signal);

    // Download complete - send final progress update
    activeDownloads.delete(audiobookId);
    self.postMessage({
      type: 'progress',
      audiobookId,
      bytesDownloaded: result.bytesWritten
    });
    self.postMessage({
      type: 'complete',
      audiobookId,
      bytesDownloaded: result.bytesWritten
    });

  } catch (error) {
    activeDownloads.delete(audiobookId);

    if (error.name === 'AbortError') {
      // This was a pause or cancel - don't report as error
      // The pause/cancel handlers will send the appropriate message
      return;
    }

    self.postMessage({
      type: 'error',
      audiobookId,
      error: error.message || 'Download failed'
    });
  }
}

/**
 * Pause an active download
 * @param {string} audiobookId - Audiobook ID
 */
function pauseDownload(audiobookId) {
  const download = activeDownloads.get(audiobookId);
  if (!download) {
    // No active download to pause
    self.postMessage({
      type: 'error',
      audiobookId,
      error: 'No active download to pause'
    });
    return;
  }

  const bytesDownloaded = download.bytesDownloaded;
  download.controller.abort();
  activeDownloads.delete(audiobookId);

  self.postMessage({
    type: 'paused',
    audiobookId,
    bytesDownloaded
  });
}

/**
 * Resume a paused download
 * @param {string} audiobookId - Audiobook ID
 * @param {string} token - JWT auth token
 * @param {number} bytesDownloaded - Bytes already downloaded
 */
async function resumeDownload(audiobookId, token, bytesDownloaded) {
  // If there's already an active download for this audiobook, cancel it first
  if (activeDownloads.has(audiobookId)) {
    const existing = activeDownloads.get(audiobookId);
    existing.controller.abort();
    activeDownloads.delete(audiobookId);
  }

  const controller = new AbortController();
  activeDownloads.set(audiobookId, {
    controller,
    bytesDownloaded,
    totalBytes: null // We don't know total from resume
  });

  try {
    // Use Range header to request bytes from where we left off
    const response = await fetch(`/api/audiobooks/${audiobookId}/stream?token=${encodeURIComponent(token)}`, {
      signal: controller.signal,
      headers: {
        'Range': `bytes=${bytesDownloaded}-`
      }
    });

    // Server should respond with 206 Partial Content for range requests
    if (response.status !== 206 && response.status !== 200) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    if (!response.body) {
      throw new Error('Response body is not readable');
    }

    // If server returned 200 (full content), we need to start over
    // This can happen if server doesn't support Range or file changed
    const startOffset = response.status === 206 ? bytesDownloaded : 0;

    // If starting over, reset the progress tracker
    if (startOffset === 0) {
      const download = activeDownloads.get(audiobookId);
      if (download) {
        download.bytesDownloaded = 0;
      }
    }

    const progressCallback = createProgressCallback(audiobookId);

    let result;
    if (startOffset === 0) {
      // Full download - server didn't support range
      result = await saveAudioFile(audiobookId, response.body, progressCallback, controller.signal);
    } else {
      // Resume from offset
      result = await resumeAudioFile(audiobookId, response.body, startOffset, progressCallback, controller.signal);
    }

    // Download complete - send final progress update
    activeDownloads.delete(audiobookId);
    self.postMessage({
      type: 'progress',
      audiobookId,
      bytesDownloaded: result.bytesWritten
    });
    self.postMessage({
      type: 'complete',
      audiobookId,
      bytesDownloaded: result.bytesWritten
    });

  } catch (error) {
    activeDownloads.delete(audiobookId);

    if (error.name === 'AbortError') {
      // This was a pause or cancel - don't report as error
      return;
    }

    self.postMessage({
      type: 'error',
      audiobookId,
      error: error.message || 'Resume failed'
    });
  }
}

/**
 * Cancel a download and delete any partial file
 * @param {string} audiobookId - Audiobook ID
 */
async function cancelDownload(audiobookId) {
  const download = activeDownloads.get(audiobookId);
  if (download) {
    download.controller.abort();
    activeDownloads.delete(audiobookId);
  }

  // Delete any partial file
  try {
    await deleteAudioFile(audiobookId);
  } catch {
    // Ignore errors when deleting - file may not exist
  }

  self.postMessage({
    type: 'cancelled',
    audiobookId
  });
}

// ============================================================================
// Message Handler
// ============================================================================

self.onmessage = async (event) => {
  const { type, audiobookId, token, totalBytes, bytesDownloaded } = event.data;

  if (!audiobookId) {
    self.postMessage({
      type: 'error',
      audiobookId: null,
      error: 'audiobookId is required'
    });
    return;
  }

  switch (type) {
    case 'start':
      if (!token) {
        self.postMessage({
          type: 'error',
          audiobookId,
          error: 'token is required for start'
        });
        return;
      }
      await startDownload(audiobookId, token, totalBytes || 0);
      break;

    case 'pause':
      pauseDownload(audiobookId);
      break;

    case 'resume':
      if (!token) {
        self.postMessage({
          type: 'error',
          audiobookId,
          error: 'token is required for resume'
        });
        return;
      }
      await resumeDownload(audiobookId, token, bytesDownloaded || 0);
      break;

    case 'cancel':
      await cancelDownload(audiobookId);
      break;

    default:
      self.postMessage({
        type: 'error',
        audiobookId,
        error: `Unknown message type: ${type}`
      });
  }
};
