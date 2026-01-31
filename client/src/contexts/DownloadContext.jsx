import { createContext, useContext, useCallback, useState, useEffect, useRef } from 'react';
import {
  openDatabase,
  getAllDownloads,
  saveDownload,
  deleteDownload as deleteDownloadFromDB,
  getNextQueuedDownload,
  createDownloadRecord,
  isIndexedDBSupported
} from '../services/downloadStore';
import { deleteAudioFile } from '../services/offlineStorage';

const DownloadContext = createContext(null);

/**
 * Download Provider - Manages offline downloads for audiobooks
 *
 * Provides:
 * - downloads: Map of audiobookId -> download status
 * - downloadBook(audiobook): Start a download
 * - pauseDownload(audiobookId): Pause active download
 * - resumeDownload(audiobookId): Resume paused download
 * - cancelDownload(audiobookId): Cancel and remove download
 * - deleteDownload(audiobookId): Delete completed download
 * - getDownloadStatus(audiobookId): Get download status for a book
 * - isDownloaded(audiobookId): Check if book is downloaded
 * - isReady: True when IndexedDB + worker initialized
 */
export function DownloadProvider({ children }) {
  const [downloads, setDownloads] = useState({});
  const [isReady, setIsReady] = useState(false);
  const [activeDownloadId, setActiveDownloadId] = useState(null);
  const workerRef = useRef(null);
  const initializingRef = useRef(false);

  /**
   * Get auth token from localStorage
   */
  const getToken = useCallback(() => {
    return localStorage.getItem('token');
  }, []);

  /**
   * Update a single download in state and IndexedDB
   */
  const updateDownload = useCallback(async (audiobookId, updates) => {
    const id = String(audiobookId);

    setDownloads((prev) => {
      const existing = prev[id];
      if (!existing) return prev;

      const updated = { ...existing, ...updates };

      // Persist to IndexedDB (fire and forget for performance)
      saveDownload(updated).catch((err) => {
        console.error('Failed to persist download update:', err);
      });

      return { ...prev, [id]: updated };
    });
  }, []);

  /**
   * Start the next queued download if no download is active
   */
  const startNextDownload = useCallback(async () => {
    if (activeDownloadId) {
      // A download is already active
      return;
    }

    const nextQueued = await getNextQueuedDownload();
    if (!nextQueued) {
      // No queued downloads
      return;
    }

    const token = getToken();
    if (!token) {
      console.error('No auth token available for download');
      return;
    }

    const id = String(nextQueued.id);

    // Update status to downloading
    setActiveDownloadId(id);
    await updateDownload(id, { status: 'downloading' });

    // Post message to worker
    if (workerRef.current) {
      workerRef.current.postMessage({
        type: 'start',
        audiobookId: id,
        token,
        totalBytes: nextQueued.totalBytes || 0
      });
    }
  }, [activeDownloadId, getToken, updateDownload]);

  /**
   * Handle messages from the download worker
   */
  const handleWorkerMessage = useCallback(async (event) => {
    const { type, audiobookId, bytesDownloaded, error } = event.data;
    const id = String(audiobookId);

    switch (type) {
      case 'progress': {
        setDownloads((prev) => {
          const existing = prev[id];
          if (!existing) return prev;

          const progress = existing.totalBytes > 0
            ? bytesDownloaded / existing.totalBytes
            : 0;

          const updated = {
            ...existing,
            bytesDownloaded,
            progress: Math.min(progress, 1)
          };

          // Persist to IndexedDB (throttled by worker, so ok to persist each)
          saveDownload(updated).catch((err) => {
            console.error('Failed to persist progress:', err);
          });

          return { ...prev, [id]: updated };
        });
        break;
      }

      case 'complete': {
        await updateDownload(id, {
          status: 'completed',
          progress: 1,
          bytesDownloaded,
          completedAt: new Date().toISOString()
        });

        setActiveDownloadId(null);

        // Start next queued download (use setTimeout to avoid state sync issues)
        setTimeout(() => {
          startNextDownload();
        }, 100);
        break;
      }

      case 'paused': {
        await updateDownload(id, {
          status: 'paused',
          bytesDownloaded
        });

        setActiveDownloadId(null);
        break;
      }

      case 'cancelled': {
        // Remove from state and IndexedDB
        setDownloads((prev) => {
          const { [id]: removed, ...rest } = prev;
          return rest;
        });

        await deleteDownloadFromDB(id);
        setActiveDownloadId(null);

        // Start next queued download
        setTimeout(() => {
          startNextDownload();
        }, 100);
        break;
      }

      case 'error': {
        console.error(`Download error for ${id}:`, error);

        await updateDownload(id, {
          status: 'error',
          error: error || 'Download failed'
        });

        setActiveDownloadId(null);

        // Start next queued download despite error
        setTimeout(() => {
          startNextDownload();
        }, 100);
        break;
      }

      default:
        console.warn('Unknown worker message type:', type);
    }
  }, [updateDownload, startNextDownload]);

  /**
   * Initialize IndexedDB and Web Worker on mount
   */
  useEffect(() => {
    if (initializingRef.current || isReady) {
      return;
    }

    initializingRef.current = true;

    const initialize = async () => {
      try {
        // Check IndexedDB support
        if (!isIndexedDBSupported()) {
          console.warn('IndexedDB not supported - downloads disabled');
          setIsReady(true);
          return;
        }

        // Open database
        await openDatabase();

        // Load existing downloads
        const existingDownloads = await getAllDownloads();
        const downloadsMap = {};
        let hasActiveDownload = false;

        for (const download of existingDownloads) {
          const id = String(download.id);
          downloadsMap[id] = download;

          // Check if there was an interrupted download (mark as paused)
          if (download.status === 'downloading') {
            downloadsMap[id] = { ...download, status: 'paused' };
            await saveDownload(downloadsMap[id]);
          } else if (download.status === 'queued') {
            // Queue is preserved
          }
        }

        setDownloads(downloadsMap);

        // Create web worker
        try {
          workerRef.current = new Worker(
            new URL('../workers/download.worker.js', import.meta.url),
            { type: 'module' }
          );

          workerRef.current.onmessage = handleWorkerMessage;

          workerRef.current.onerror = (error) => {
            console.error('Download worker error:', error);
          };
        } catch (workerError) {
          console.error('Failed to create download worker:', workerError);
          // Continue without worker - downloads won't work but app will function
        }

        setIsReady(true);

        // Check if we should start a queued download
        // (setTimeout to let state settle)
        setTimeout(() => {
          if (!hasActiveDownload) {
            startNextDownload();
          }
        }, 500);

      } catch (error) {
        console.error('Failed to initialize download context:', error);
        setIsReady(true); // Set ready anyway so app doesn't hang
      }
    };

    initialize();

    // Cleanup
    return () => {
      if (workerRef.current) {
        workerRef.current.terminate();
        workerRef.current = null;
      }
    };
  }, [handleWorkerMessage, startNextDownload, isReady]);

  /**
   * Start downloading an audiobook
   * @param {Object} audiobook - Audiobook object with id, title, author, etc.
   */
  const downloadBook = useCallback(async (audiobook) => {
    if (!audiobook || !audiobook.id) {
      console.error('downloadBook: Invalid audiobook');
      return;
    }

    const id = String(audiobook.id);

    // Check if already downloading or completed
    const existing = downloads[id];
    if (existing) {
      if (existing.status === 'completed') {
        console.warn('Book already downloaded');
        return;
      }
      if (existing.status === 'downloading' || existing.status === 'queued') {
        console.warn('Book already in download queue');
        return;
      }
      // If paused or error, allow re-download (will be handled by resume or restart)
    }

    // Create download record
    const downloadRecord = createDownloadRecord(audiobook);

    // Save to state and IndexedDB
    setDownloads((prev) => ({ ...prev, [id]: downloadRecord }));
    await saveDownload(downloadRecord);

    // If no active download, start this one
    if (!activeDownloadId) {
      const token = getToken();
      if (!token) {
        console.error('No auth token available for download');
        return;
      }

      setActiveDownloadId(id);

      // Update status to downloading
      const downloadingRecord = { ...downloadRecord, status: 'downloading' };
      setDownloads((prev) => ({ ...prev, [id]: downloadingRecord }));
      await saveDownload(downloadingRecord);

      // Post message to worker
      if (workerRef.current) {
        workerRef.current.postMessage({
          type: 'start',
          audiobookId: id,
          token,
          totalBytes: downloadRecord.totalBytes || 0
        });
      }
    }
  }, [downloads, activeDownloadId, getToken]);

  /**
   * Pause an active download
   * @param {string|number} audiobookId - Audiobook ID
   */
  const pauseDownload = useCallback(async (audiobookId) => {
    const id = String(audiobookId);

    const download = downloads[id];
    if (!download || download.status !== 'downloading') {
      console.warn('Cannot pause - not downloading');
      return;
    }

    if (workerRef.current) {
      workerRef.current.postMessage({
        type: 'pause',
        audiobookId: id
      });
    }
  }, [downloads]);

  /**
   * Resume a paused download
   * @param {string|number} audiobookId - Audiobook ID
   */
  const resumeDownload = useCallback(async (audiobookId) => {
    const id = String(audiobookId);

    const download = downloads[id];
    if (!download || download.status !== 'paused') {
      console.warn('Cannot resume - not paused');
      return;
    }

    // If another download is active, queue this one
    if (activeDownloadId && activeDownloadId !== id) {
      await updateDownload(id, { status: 'queued' });
      return;
    }

    const token = getToken();
    if (!token) {
      console.error('No auth token available for resume');
      return;
    }

    setActiveDownloadId(id);
    await updateDownload(id, { status: 'downloading' });

    if (workerRef.current) {
      workerRef.current.postMessage({
        type: 'resume',
        audiobookId: id,
        token,
        bytesDownloaded: download.bytesDownloaded || 0
      });
    }
  }, [downloads, activeDownloadId, getToken, updateDownload]);

  /**
   * Cancel a download (removes from queue/active and deletes partial file)
   * @param {string|number} audiobookId - Audiobook ID
   */
  const cancelDownload = useCallback(async (audiobookId) => {
    const id = String(audiobookId);

    const download = downloads[id];
    if (!download) {
      console.warn('Cannot cancel - download not found');
      return;
    }

    if (download.status === 'downloading') {
      // Worker will handle abort and file deletion
      if (workerRef.current) {
        workerRef.current.postMessage({
          type: 'cancel',
          audiobookId: id
        });
      }
    } else {
      // Not actively downloading - just remove from state/DB
      setDownloads((prev) => {
        const { [id]: removed, ...rest } = prev;
        return rest;
      });

      await deleteDownloadFromDB(id);

      // Try to delete any partial file
      try {
        await deleteAudioFile(id);
      } catch {
        // Ignore errors
      }

      // If this was the active download, clear it and start next
      if (activeDownloadId === id) {
        setActiveDownloadId(null);
        setTimeout(() => {
          startNextDownload();
        }, 100);
      }
    }
  }, [downloads, activeDownloadId, startNextDownload]);

  /**
   * Delete a completed download (removes file and metadata)
   * @param {string|number} audiobookId - Audiobook ID
   */
  const deleteDownloadedBook = useCallback(async (audiobookId) => {
    const id = String(audiobookId);

    const download = downloads[id];
    if (!download) {
      console.warn('Cannot delete - download not found');
      return;
    }

    if (download.status === 'downloading') {
      // Cancel if actively downloading
      await cancelDownload(id);
      return;
    }

    // Remove from state
    setDownloads((prev) => {
      const { [id]: removed, ...rest } = prev;
      return rest;
    });

    // Remove from IndexedDB
    await deleteDownloadFromDB(id);

    // Delete file from OPFS
    try {
      await deleteAudioFile(id);
    } catch (error) {
      console.error('Failed to delete audio file:', error);
      // Continue anyway - metadata is already removed
    }
  }, [downloads, cancelDownload]);

  /**
   * Get download status for an audiobook
   * @param {string|number} audiobookId - Audiobook ID
   * @returns {Object|null} Download status or null if not found
   */
  const getDownloadStatus = useCallback((audiobookId) => {
    const id = String(audiobookId);
    return downloads[id] || null;
  }, [downloads]);

  /**
   * Check if an audiobook is downloaded (completed status)
   * @param {string|number} audiobookId - Audiobook ID
   * @returns {boolean}
   */
  const isDownloaded = useCallback((audiobookId) => {
    const id = String(audiobookId);
    const download = downloads[id];
    return download?.status === 'completed';
  }, [downloads]);

  /**
   * Get count of downloads by status
   */
  const getDownloadCounts = useCallback(() => {
    const counts = {
      queued: 0,
      downloading: 0,
      paused: 0,
      completed: 0,
      error: 0,
      total: 0
    };

    Object.values(downloads).forEach((download) => {
      counts[download.status] = (counts[download.status] || 0) + 1;
      counts.total++;
    });

    return counts;
  }, [downloads]);

  const value = {
    // State
    downloads,
    isReady,
    activeDownloadId,

    // Actions
    downloadBook,
    pauseDownload,
    resumeDownload,
    cancelDownload,
    deleteDownload: deleteDownloadedBook,

    // Queries
    getDownloadStatus,
    isDownloaded,
    getDownloadCounts
  };

  return (
    <DownloadContext.Provider value={value}>
      {children}
    </DownloadContext.Provider>
  );
}

/**
 * Hook to access Download context
 */
export function useDownload() {
  const context = useContext(DownloadContext);
  if (!context) {
    throw new Error('useDownload must be used within a DownloadProvider');
  }
  return context;
}

/**
 * Hook to get download status for a specific audiobook
 * @param {string|number} audiobookId - Audiobook ID
 * @returns {Object|null} Download status or null
 */
export function useDownloadStatus(audiobookId) {
  const { getDownloadStatus } = useDownload();
  return getDownloadStatus(audiobookId);
}

export default DownloadContext;
