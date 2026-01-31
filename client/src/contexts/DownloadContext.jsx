import { createContext, useContext, useCallback, useState, useEffect, useRef } from 'react';
import {
  openDatabase,
  getAllDownloads,
  saveDownload,
  deleteDownload as deleteDownloadFromDB,
  createDownloadRecord,
  isIndexedDBSupported,
  getUnsyncedProgress,
  markProgressSynced,
  deleteOfflineProgress
} from '../services/downloadStore';
import { updateProgress } from '../api';

const DownloadContext = createContext(null);

// Cache name for offline audio files
const AUDIO_CACHE_NAME = 'sappho-audio-v1';

/**
 * Check if Cache API is supported (for offline downloads)
 */
function isCacheAPISupported() {
  try {
    return typeof window !== 'undefined' && 'caches' in window && typeof caches !== 'undefined';
  } catch (e) {
    console.error('Cache API check failed:', e);
    return false;
  }
}

/**
 * Check if downloads are supported in this browser
 */
function checkDownloadSupport() {
  const issues = [];

  // Log browser info for debugging
  console.log('Checking download support...');
  console.log('- window.caches:', typeof window !== 'undefined' ? typeof window.caches : 'no window');
  console.log('- indexedDB:', typeof indexedDB);
  console.log('- isSecureContext:', typeof window !== 'undefined' ? window.isSecureContext : 'no window');

  if (!isIndexedDBSupported()) {
    issues.push('IndexedDB not supported');
  }

  if (!isCacheAPISupported()) {
    // Check if it's a secure context issue
    if (typeof window !== 'undefined' && !window.isSecureContext) {
      issues.push('Requires HTTPS (secure context)');
    } else {
      issues.push('Cache API not supported');
    }
  }

  console.log('Download support issues:', issues.length === 0 ? 'none' : issues.join(', '));

  return {
    supported: issues.length === 0,
    issues
  };
}

/**
 * Delete an audio file from the cache
 */
async function deleteAudioFromCache(audiobookId) {
  if (!isCacheAPISupported()) return false;
  try {
    const cache = await caches.open(AUDIO_CACHE_NAME);
    const url = `/api/audiobooks/${audiobookId}/stream`;
    return await cache.delete(url);
  } catch (error) {
    console.error('Failed to delete from cache:', error);
    return false;
  }
}

/**
 * Download Provider - Manages offline downloads for audiobooks
 * Uses Cache API for broad browser compatibility (including iOS Safari)
 */
export function DownloadProvider({ children }) {
  const [downloads, setDownloads] = useState({});
  const [isReady, setIsReady] = useState(false);
  const [activeDownloadId, setActiveDownloadId] = useState(null);
  const [toast, setToast] = useState(null);
  const abortControllerRef = useRef(null);
  const initializingRef = useRef(false);
  const syncingRef = useRef(false);
  const downloadQueueRef = useRef([]);

  /**
   * Get auth token from localStorage
   */
  const getToken = useCallback(() => {
    return localStorage.getItem('token');
  }, []);

  /**
   * Show toast notification
   */
  const showToast = useCallback((type, message) => {
    setToast({ type, message });
  }, []);

  /**
   * Update a single download in state and IndexedDB
   */
  const updateDownloadState = useCallback(async (audiobookId, updates) => {
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
   * Process the download queue - start next download if nothing active
   */
  const processQueue = useCallback(async () => {
    // If already downloading, wait
    if (activeDownloadId) {
      return;
    }

    // Get next queued download from state
    setDownloads((prev) => {
      const queued = Object.values(prev)
        .filter(d => d.status === 'queued')
        .sort((a, b) => new Date(a.startedAt) - new Date(b.startedAt));

      if (queued.length > 0) {
        downloadQueueRef.current = queued.map(d => d.id);
      }
      return prev;
    });

    // Small delay to let state settle
    await new Promise(resolve => setTimeout(resolve, 50));

    if (downloadQueueRef.current.length > 0) {
      const nextId = downloadQueueRef.current[0];
      // Start download will be triggered by the effect
      setActiveDownloadId(nextId);
    }
  }, [activeDownloadId]);

  /**
   * Perform the actual download using Cache API
   */
  const performDownload = useCallback(async (audiobookId, audiobook) => {
    const id = String(audiobookId);
    const token = getToken();

    if (!token) {
      await updateDownloadState(id, { status: 'error', error: 'Not authenticated' });
      setActiveDownloadId(null);
      return;
    }

    // Create abort controller for this download
    abortControllerRef.current = new AbortController();

    try {
      await updateDownloadState(id, { status: 'downloading', progress: 0 });

      const url = `/api/audiobooks/${id}/stream?token=${encodeURIComponent(token)}`;

      console.log('Starting download:', audiobook?.title || id);

      const response = await fetch(url, {
        signal: abortControllerRef.current.signal
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      // Get total size for progress
      const contentLength = response.headers.get('content-length');
      const totalBytes = contentLength ? parseInt(contentLength, 10) : 0;

      if (totalBytes > 0) {
        await updateDownloadState(id, { totalBytes });
      }

      // Read the response as a stream to track progress
      const reader = response.body.getReader();
      const chunks = [];
      let bytesDownloaded = 0;
      let lastProgressUpdate = 0;

      while (true) {
        const { done, value } = await reader.read();

        if (done) break;

        chunks.push(value);
        bytesDownloaded += value.length;

        // Update progress every 100KB or 500ms
        const now = Date.now();
        if (bytesDownloaded - lastProgressUpdate > 100 * 1024 || now - lastProgressUpdate > 500) {
          const progress = totalBytes > 0 ? bytesDownloaded / totalBytes : 0;
          await updateDownloadState(id, {
            bytesDownloaded,
            progress: Math.min(progress, 0.99) // Keep at 99% until fully cached
          });
          lastProgressUpdate = bytesDownloaded;
        }
      }

      // Combine chunks into a single blob
      const blob = new Blob(chunks, { type: response.headers.get('content-type') || 'audio/mpeg' });

      // Store in Cache API
      const cache = await caches.open(AUDIO_CACHE_NAME);
      const cacheUrl = `/api/audiobooks/${id}/stream`;
      const cacheResponse = new Response(blob, {
        headers: {
          'Content-Type': blob.type,
          'Content-Length': String(blob.size),
          'X-Cached-At': new Date().toISOString()
        }
      });
      await cache.put(cacheUrl, cacheResponse);

      console.log('Download complete:', audiobook?.title || id, 'Size:', blob.size);

      // Mark as completed
      await updateDownloadState(id, {
        status: 'completed',
        progress: 1,
        bytesDownloaded: blob.size,
        completedAt: new Date().toISOString()
      });

      showToast('success', `Downloaded "${audiobook?.title || 'audiobook'}"`);

    } catch (error) {
      if (error.name === 'AbortError') {
        console.log('Download aborted:', id);
        // Don't update state - it was handled by pause/cancel
        return;
      }

      console.error('Download failed:', error);
      await updateDownloadState(id, {
        status: 'error',
        error: error.message || 'Download failed'
      });
      showToast('error', `Download failed: ${error.message}`);

    } finally {
      abortControllerRef.current = null;
      setActiveDownloadId(null);

      // Process next in queue
      setTimeout(() => processQueue(), 100);
    }
  }, [getToken, updateDownloadState, showToast, processQueue]);

  /**
   * Effect to start download when activeDownloadId changes
   */
  useEffect(() => {
    if (activeDownloadId && !abortControllerRef.current) {
      setDownloads((prev) => {
        const download = prev[activeDownloadId];
        if (download && (download.status === 'queued' || download.status === 'downloading')) {
          performDownload(activeDownloadId, download);
        }
        return prev;
      });
    }
  }, [activeDownloadId, performDownload]);

  /**
   * Initialize on mount
   */
  useEffect(() => {
    if (initializingRef.current || isReady) {
      return;
    }

    initializingRef.current = true;

    const initialize = async () => {
      try {
        // Check browser support
        const support = checkDownloadSupport();
        if (!support.supported) {
          console.warn('Downloads not supported:', support.issues.join(', '));
          setIsReady(true);
          return;
        }

        // Open database
        await openDatabase();
        console.log('IndexedDB opened successfully');

        // Load existing downloads
        const existingDownloads = await getAllDownloads();
        const downloadsMap = {};

        for (const download of existingDownloads) {
          const id = String(download.id);

          // Mark interrupted downloads as paused
          if (download.status === 'downloading') {
            downloadsMap[id] = { ...download, status: 'paused' };
            await saveDownload(downloadsMap[id]);
          } else {
            downloadsMap[id] = download;
          }
        }

        setDownloads(downloadsMap);
        console.log('Loaded', Object.keys(downloadsMap).length, 'existing downloads');

        setIsReady(true);

        // Start processing queue after a delay
        setTimeout(() => processQueue(), 500);

      } catch (error) {
        console.error('Failed to initialize download context:', error);
        setIsReady(true);
      }
    };

    initialize();

    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [isReady, processQueue]);

  /**
   * Sync offline progress to server when coming back online
   */
  const syncOfflineProgress = useCallback(async () => {
    if (syncingRef.current) return;
    syncingRef.current = true;

    try {
      const unsyncedRecords = await getUnsyncedProgress();
      if (unsyncedRecords.length === 0) {
        syncingRef.current = false;
        return;
      }

      // Group by audiobook ID and keep only the most recent position per book
      const latestByBook = {};
      for (const record of unsyncedRecords) {
        const bookId = String(record.audiobookId);
        if (!latestByBook[bookId] || record.timestamp > latestByBook[bookId].timestamp) {
          latestByBook[bookId] = record;
        }
      }

      let syncedCount = 0;
      const syncedRecordIds = [];

      for (const record of Object.values(latestByBook)) {
        try {
          await updateProgress(
            record.audiobookId,
            record.position,
            record.completed || 0,
            record.state || 'stopped',
            record.clientInfo || {}
          );
          syncedCount++;

          // Mark all records for this audiobook as synced
          for (const r of unsyncedRecords) {
            if (String(r.audiobookId) === String(record.audiobookId)) {
              syncedRecordIds.push(r.id);
            }
          }
        } catch (error) {
          console.error(`Failed to sync progress for audiobook ${record.audiobookId}:`, error);
        }
      }

      // Clean up synced records
      for (const id of syncedRecordIds) {
        await markProgressSynced(id);
        await deleteOfflineProgress(id);
      }

      if (syncedCount > 0) {
        showToast('success', syncedCount === 1
          ? 'Synced progress for 1 book'
          : `Synced progress for ${syncedCount} books`);
      }
    } catch (error) {
      console.error('Failed to sync offline progress:', error);
    } finally {
      syncingRef.current = false;
    }
  }, [showToast]);

  /**
   * Listen for online event
   */
  useEffect(() => {
    const handleOnline = () => {
      setTimeout(() => syncOfflineProgress(), 1000);
    };

    window.addEventListener('online', handleOnline);

    if (isReady && navigator.onLine) {
      syncOfflineProgress();
    }

    return () => window.removeEventListener('online', handleOnline);
  }, [isReady, syncOfflineProgress]);

  /**
   * Auto-dismiss toast
   */
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 4000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  /**
   * Start downloading an audiobook
   */
  const downloadBook = useCallback(async (audiobook) => {
    if (!audiobook || !audiobook.id) {
      console.error('downloadBook: Invalid audiobook');
      return;
    }

    // Check support
    const support = checkDownloadSupport();
    if (!support.supported) {
      showToast('error', `Downloads not supported: ${support.issues[0]}`);
      return;
    }

    const id = String(audiobook.id);

    // Check if already exists
    const existing = downloads[id];
    if (existing) {
      if (existing.status === 'completed') {
        showToast('info', 'Book already downloaded');
        return;
      }
      if (existing.status === 'downloading' || existing.status === 'queued') {
        showToast('info', 'Book already in download queue');
        return;
      }
    }

    // Create download record
    const downloadRecord = createDownloadRecord(audiobook);

    // Save to state and IndexedDB
    setDownloads((prev) => ({ ...prev, [id]: downloadRecord }));
    await saveDownload(downloadRecord);

    console.log('Download queued:', audiobook.title);

    // If no active download, start this one immediately
    if (!activeDownloadId) {
      setActiveDownloadId(id);
    } else {
      showToast('success', `"${audiobook.title}" added to download queue`);
    }
  }, [downloads, activeDownloadId, showToast]);

  /**
   * Pause an active download
   */
  const pauseDownload = useCallback(async (audiobookId) => {
    const id = String(audiobookId);
    const download = downloads[id];

    if (!download || download.status !== 'downloading') {
      return;
    }

    // Abort the current download
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }

    await updateDownloadState(id, { status: 'paused' });
    setActiveDownloadId(null);

    // Process next in queue
    setTimeout(() => processQueue(), 100);
  }, [downloads, updateDownloadState, processQueue]);

  /**
   * Resume a paused download
   */
  const resumeDownload = useCallback(async (audiobookId) => {
    const id = String(audiobookId);
    const download = downloads[id];

    if (!download || download.status !== 'paused') {
      return;
    }

    // If another download is active, queue this one
    if (activeDownloadId && activeDownloadId !== id) {
      await updateDownloadState(id, { status: 'queued' });
      return;
    }

    // Reset progress and start fresh (Cache API doesn't support partial)
    await updateDownloadState(id, { status: 'queued', progress: 0, bytesDownloaded: 0 });
    setActiveDownloadId(id);
  }, [downloads, activeDownloadId, updateDownloadState]);

  /**
   * Cancel a download
   */
  const cancelDownload = useCallback(async (audiobookId) => {
    const id = String(audiobookId);
    const download = downloads[id];

    if (!download) return;

    // Abort if active
    if (download.status === 'downloading' && abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }

    // Remove from state
    setDownloads((prev) => {
      const { [id]: removed, ...rest } = prev;
      return rest;
    });

    await deleteDownloadFromDB(id);
    await deleteAudioFromCache(id);

    if (activeDownloadId === id) {
      setActiveDownloadId(null);
      setTimeout(() => processQueue(), 100);
    }
  }, [downloads, activeDownloadId, processQueue]);

  /**
   * Delete a completed download
   */
  const deleteDownloadedBook = useCallback(async (audiobookId) => {
    const id = String(audiobookId);
    const download = downloads[id];

    if (!download) return;

    if (download.status === 'downloading') {
      await cancelDownload(id);
      return;
    }

    // Remove from state
    setDownloads((prev) => {
      const { [id]: removed, ...rest } = prev;
      return rest;
    });

    await deleteDownloadFromDB(id);
    await deleteAudioFromCache(id);
  }, [downloads, cancelDownload]);

  /**
   * Get download status
   */
  const getDownloadStatus = useCallback((audiobookId) => {
    return downloads[String(audiobookId)] || null;
  }, [downloads]);

  /**
   * Check if audiobook is downloaded
   */
  const isDownloaded = useCallback((audiobookId) => {
    const download = downloads[String(audiobookId)];
    return download?.status === 'completed';
  }, [downloads]);

  /**
   * Get download counts by status
   */
  const getDownloadCounts = useCallback(() => {
    const counts = { queued: 0, downloading: 0, paused: 0, completed: 0, error: 0, total: 0 };
    Object.values(downloads).forEach((d) => {
      counts[d.status] = (counts[d.status] || 0) + 1;
      counts.total++;
    });
    return counts;
  }, [downloads]);

  const value = {
    downloads,
    isReady,
    activeDownloadId,
    downloadBook,
    pauseDownload,
    resumeDownload,
    cancelDownload,
    deleteDownload: deleteDownloadedBook,
    getDownloadStatus,
    isDownloaded,
    getDownloadCounts
  };

  return (
    <DownloadContext.Provider value={value}>
      {children}
      {toast && (
        <div
          className="download-sync-toast"
          onClick={() => setToast(null)}
          style={{
            position: 'fixed',
            bottom: 'calc(5rem + env(safe-area-inset-bottom, 0))',
            left: '50%',
            transform: 'translateX(-50%)',
            padding: '0.75rem 1.25rem',
            borderRadius: '8px',
            fontSize: '0.875rem',
            fontWeight: 500,
            zIndex: 1000,
            cursor: 'pointer',
            animation: 'slideUp 0.3s ease-out',
            background: toast.type === 'success' ? 'rgba(34, 197, 94, 0.95)'
              : toast.type === 'info' ? 'rgba(59, 130, 246, 0.95)'
              : 'rgba(239, 68, 68, 0.95)',
            color: '#fff',
            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)'
          }}
        >
          {toast.message}
        </div>
      )}
      <style>{`
        @keyframes slideUp {
          from { opacity: 0; transform: translateX(-50%) translateY(1rem); }
          to { opacity: 1; transform: translateX(-50%) translateY(0); }
        }
      `}</style>
    </DownloadContext.Provider>
  );
}

export function useDownload() {
  const context = useContext(DownloadContext);
  if (!context) {
    throw new Error('useDownload must be used within a DownloadProvider');
  }
  return context;
}

export function useDownloadStatus(audiobookId) {
  const { getDownloadStatus } = useDownload();
  return getDownloadStatus(audiobookId);
}

export default DownloadContext;
