/**
 * OPFS (Origin Private File System) Storage Service
 *
 * Provides offline storage for audiobook audio files and cover images
 * using the browser's Origin Private File System API.
 *
 * Directory structure:
 * - audiobooks/{id}.audio - Audio files
 * - covers/{id}.cover - Cover images
 */

const AUDIO_DIR = 'audiobooks';
const COVER_DIR = 'covers';

/**
 * Format bytes to human-readable string
 * @param {number} bytes - Number of bytes
 * @param {number} decimals - Decimal places (default: 2)
 * @returns {string} Formatted string (e.g., "1.5 GB")
 */
export function formatBytes(bytes, decimals = 2) {
  if (bytes === 0) return '0 Bytes';
  if (bytes === undefined || bytes === null || isNaN(bytes)) return 'Unknown';

  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];

  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const index = Math.min(i, sizes.length - 1);

  return parseFloat((bytes / Math.pow(k, index)).toFixed(dm)) + ' ' + sizes[index];
}

/**
 * Check if OPFS is supported in the current browser
 * @returns {boolean} True if OPFS is available
 */
export function isOPFSSupported() {
  return (
    typeof navigator !== 'undefined' &&
    navigator.storage &&
    typeof navigator.storage.getDirectory === 'function'
  );
}

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
 * Save an audio file to OPFS by streaming
 * @param {string} audiobookId - Audiobook ID
 * @param {ReadableStream} stream - Audio data stream
 * @param {function} onProgress - Progress callback (bytesWritten, totalBytes)
 * @param {AbortSignal} signal - AbortSignal for cancellation
 * @returns {Promise<{bytesWritten: number}>}
 */
export async function saveAudioFile(audiobookId, stream, onProgress = null, signal = null) {
  const dir = await getOrCreateDir(AUDIO_DIR);
  const fileName = `${audiobookId}.audio`;

  // Create or overwrite the file
  const fileHandle = await dir.getFileHandle(fileName, { create: true });
  const writable = await fileHandle.createWritable();

  const reader = stream.getReader();
  let bytesWritten = 0;

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
      bytesWritten += value.byteLength;

      if (onProgress) {
        onProgress(bytesWritten);
      }
    }

    await writable.close();
    return { bytesWritten };
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
 * Resume a partial audio file download
 * @param {string} audiobookId - Audiobook ID
 * @param {ReadableStream} stream - Audio data stream (starting from startOffset)
 * @param {number} startOffset - Byte offset where the stream starts
 * @param {function} onProgress - Progress callback (bytesWritten, totalBytes)
 * @param {AbortSignal} signal - AbortSignal for cancellation
 * @returns {Promise<{bytesWritten: number}>}
 */
export async function resumeAudioFile(audiobookId, stream, startOffset, onProgress = null, signal = null) {
  const dir = await getOrCreateDir(AUDIO_DIR);
  const fileName = `${audiobookId}.audio`;

  // Get existing file handle (should exist for resume)
  const fileHandle = await dir.getFileHandle(fileName, { create: true });

  // Create writable starting at the offset
  const writable = await fileHandle.createWritable({ keepExistingData: true });

  // Seek to the resume position
  await writable.seek(startOffset);

  const reader = stream.getReader();
  let bytesWritten = startOffset;

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
      bytesWritten += value.byteLength;

      if (onProgress) {
        onProgress(bytesWritten);
      }
    }

    await writable.close();
    return { bytesWritten };
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
 * Get an audio file from OPFS
 * @param {string} audiobookId - Audiobook ID
 * @returns {Promise<File|null>} File object or null if not found
 */
export async function getAudioFile(audiobookId) {
  try {
    const dir = await getOrCreateDir(AUDIO_DIR);
    const fileName = `${audiobookId}.audio`;
    const fileHandle = await dir.getFileHandle(fileName);
    return await fileHandle.getFile();
  } catch (error) {
    if (error.name === 'NotFoundError') {
      return null;
    }
    throw error;
  }
}

/**
 * Check if an audio file exists in OPFS
 * @param {string} audiobookId - Audiobook ID
 * @returns {Promise<boolean>} True if file exists
 */
export async function hasAudioFile(audiobookId) {
  try {
    const dir = await getOrCreateDir(AUDIO_DIR);
    const fileName = `${audiobookId}.audio`;
    await dir.getFileHandle(fileName);
    return true;
  } catch (error) {
    if (error.name === 'NotFoundError') {
      return false;
    }
    throw error;
  }
}

/**
 * Delete an audio file from OPFS
 * @param {string} audiobookId - Audiobook ID
 * @returns {Promise<boolean>} True if deleted, false if not found
 */
export async function deleteAudioFile(audiobookId) {
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

/**
 * Save a cover image to OPFS
 * @param {string} audiobookId - Audiobook ID
 * @param {Blob} blob - Cover image blob
 * @returns {Promise<void>}
 */
export async function saveCoverFile(audiobookId, blob) {
  const dir = await getOrCreateDir(COVER_DIR);
  const fileName = `${audiobookId}.cover`;

  const fileHandle = await dir.getFileHandle(fileName, { create: true });
  const writable = await fileHandle.createWritable();

  try {
    await writable.write(blob);
    await writable.close();
  } catch (error) {
    try {
      await writable.abort();
    } catch {
      // Ignore abort errors
    }
    throw error;
  }
}

/**
 * Get a cover image from OPFS
 * @param {string} audiobookId - Audiobook ID
 * @returns {Promise<File|null>} File object or null if not found
 */
export async function getCoverFile(audiobookId) {
  try {
    const dir = await getOrCreateDir(COVER_DIR);
    const fileName = `${audiobookId}.cover`;
    const fileHandle = await dir.getFileHandle(fileName);
    return await fileHandle.getFile();
  } catch (error) {
    if (error.name === 'NotFoundError') {
      return null;
    }
    throw error;
  }
}

/**
 * Delete a cover image from OPFS
 * @param {string} audiobookId - Audiobook ID
 * @returns {Promise<boolean>} True if deleted, false if not found
 */
export async function deleteCoverFile(audiobookId) {
  try {
    const dir = await getOrCreateDir(COVER_DIR);
    const fileName = `${audiobookId}.cover`;
    await dir.removeEntry(fileName);
    return true;
  } catch (error) {
    if (error.name === 'NotFoundError') {
      return false;
    }
    throw error;
  }
}

/**
 * Get storage usage estimate
 * @returns {Promise<{usage: number, quota: number, usageFormatted: string, quotaFormatted: string, percentUsed: number}>}
 */
export async function getStorageEstimate() {
  if (!navigator.storage || !navigator.storage.estimate) {
    return {
      usage: 0,
      quota: 0,
      usageFormatted: 'Unknown',
      quotaFormatted: 'Unknown',
      percentUsed: 0
    };
  }

  const estimate = await navigator.storage.estimate();
  const usage = estimate.usage || 0;
  const quota = estimate.quota || 0;

  return {
    usage,
    quota,
    usageFormatted: formatBytes(usage),
    quotaFormatted: formatBytes(quota),
    percentUsed: quota > 0 ? Math.round((usage / quota) * 100) : 0
  };
}

/**
 * List all downloaded audiobook IDs
 * @returns {Promise<string[]>} Array of audiobook IDs
 */
export async function listDownloadedIds() {
  try {
    const dir = await getOrCreateDir(AUDIO_DIR);
    const ids = [];

    for await (const [name] of dir.entries()) {
      if (name.endsWith('.audio')) {
        // Extract ID from filename (remove .audio extension)
        const id = name.slice(0, -6);
        ids.push(id);
      }
    }

    return ids;
  } catch (error) {
    // If directory doesn't exist or other error, return empty array
    if (error.name === 'NotFoundError') {
      return [];
    }
    throw error;
  }
}

/**
 * Get the size of a downloaded audio file
 * @param {string} audiobookId - Audiobook ID
 * @returns {Promise<number|null>} File size in bytes or null if not found
 */
export async function getAudioFileSize(audiobookId) {
  const file = await getAudioFile(audiobookId);
  return file ? file.size : null;
}

/**
 * Clear all offline storage (audio files and covers)
 * @returns {Promise<{audioDeleted: number, coversDeleted: number}>}
 */
export async function clearAllStorage() {
  const root = await getRoot();
  let audioDeleted = 0;
  let coversDeleted = 0;

  // Delete audio files
  try {
    const audioDir = await root.getDirectoryHandle(AUDIO_DIR);
    for await (const [name] of audioDir.entries()) {
      await audioDir.removeEntry(name);
      audioDeleted++;
    }
  } catch (error) {
    if (error.name !== 'NotFoundError') {
      throw error;
    }
  }

  // Delete cover files
  try {
    const coverDir = await root.getDirectoryHandle(COVER_DIR);
    for await (const [name] of coverDir.entries()) {
      await coverDir.removeEntry(name);
      coversDeleted++;
    }
  } catch (error) {
    if (error.name !== 'NotFoundError') {
      throw error;
    }
  }

  return { audioDeleted, coversDeleted };
}
