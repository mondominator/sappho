# Offline Downloads Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enable offline audiobook downloads with queue management, OPFS storage, and progress sync.

**Architecture:** OPFS stores audio files, IndexedDB stores metadata/queue state, Web Worker handles background downloads, Service Worker intercepts playback requests to serve from OPFS when offline.

**Tech Stack:** React Context, OPFS (File System API), IndexedDB (via idb-keyval), Web Workers, Service Worker

---

## Task 1: Create offlineStorage.js - OPFS Wrapper

**Files:**
- Create: `client/src/services/offlineStorage.js`

**Step 1: Create the services directory and OPFS wrapper**

```javascript
// client/src/services/offlineStorage.js

/**
 * OPFS (Origin Private File System) wrapper for offline audiobook storage
 */

const AUDIOBOOKS_DIR = 'audiobooks';
const COVERS_DIR = 'covers';

/**
 * Check if OPFS is supported
 */
export function isOPFSSupported() {
  return 'storage' in navigator && 'getDirectory' in navigator.storage;
}

/**
 * Get the root OPFS directory
 */
async function getRoot() {
  return navigator.storage.getDirectory();
}

/**
 * Get or create a directory handle
 */
async function getDirectoryHandle(name) {
  const root = await getRoot();
  return root.getDirectoryHandle(name, { create: true });
}

/**
 * Save an audio file to OPFS
 * @param {string} audiobookId
 * @param {ReadableStream} stream - The audio stream to save
 * @param {function} onProgress - Progress callback (bytesWritten, totalBytes)
 * @param {AbortSignal} signal - For cancellation
 * @returns {Promise<void>}
 */
export async function saveAudioFile(audiobookId, stream, onProgress, signal) {
  const dir = await getDirectoryHandle(AUDIOBOOKS_DIR);
  const fileHandle = await dir.getFileHandle(`${audiobookId}.audio`, { create: true });
  const writable = await fileHandle.createWritable();

  const reader = stream.getReader();
  let bytesWritten = 0;

  try {
    while (true) {
      if (signal?.aborted) {
        throw new DOMException('Download aborted', 'AbortError');
      }

      const { done, value } = await reader.read();
      if (done) break;

      await writable.write(value);
      bytesWritten += value.byteLength;

      if (onProgress) {
        onProgress(bytesWritten);
      }
    }
    await writable.close();
  } catch (error) {
    await writable.abort();
    throw error;
  }
}

/**
 * Resume saving an audio file from a specific byte offset
 */
export async function resumeAudioFile(audiobookId, stream, startOffset, onProgress, signal) {
  const dir = await getDirectoryHandle(AUDIOBOOKS_DIR);
  const fileHandle = await dir.getFileHandle(`${audiobookId}.audio`, { create: false });
  const writable = await fileHandle.createWritable({ keepExistingData: true });

  // Seek to the resume position
  await writable.seek(startOffset);

  const reader = stream.getReader();
  let bytesWritten = startOffset;

  try {
    while (true) {
      if (signal?.aborted) {
        throw new DOMException('Download aborted', 'AbortError');
      }

      const { done, value } = await reader.read();
      if (done) break;

      await writable.write(value);
      bytesWritten += value.byteLength;

      if (onProgress) {
        onProgress(bytesWritten);
      }
    }
    await writable.close();
  } catch (error) {
    await writable.abort();
    throw error;
  }
}

/**
 * Get an audio file from OPFS as a File object
 */
export async function getAudioFile(audiobookId) {
  try {
    const dir = await getDirectoryHandle(AUDIOBOOKS_DIR);
    const fileHandle = await dir.getFileHandle(`${audiobookId}.audio`, { create: false });
    return fileHandle.getFile();
  } catch (error) {
    if (error.name === 'NotFoundError') {
      return null;
    }
    throw error;
  }
}

/**
 * Check if an audio file exists in OPFS
 */
export async function hasAudioFile(audiobookId) {
  try {
    const dir = await getDirectoryHandle(AUDIOBOOKS_DIR);
    await dir.getFileHandle(`${audiobookId}.audio`, { create: false });
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
 */
export async function deleteAudioFile(audiobookId) {
  try {
    const dir = await getDirectoryHandle(AUDIOBOOKS_DIR);
    await dir.removeEntry(`${audiobookId}.audio`);
  } catch (error) {
    if (error.name !== 'NotFoundError') {
      throw error;
    }
  }
}

/**
 * Save a cover image to OPFS
 */
export async function saveCoverFile(audiobookId, blob) {
  const dir = await getDirectoryHandle(COVERS_DIR);
  const fileHandle = await dir.getFileHandle(`${audiobookId}.cover`, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(blob);
  await writable.close();
}

/**
 * Get a cover image from OPFS
 */
export async function getCoverFile(audiobookId) {
  try {
    const dir = await getDirectoryHandle(COVERS_DIR);
    const fileHandle = await dir.getFileHandle(`${audiobookId}.cover`, { create: false });
    return fileHandle.getFile();
  } catch (error) {
    if (error.name === 'NotFoundError') {
      return null;
    }
    throw error;
  }
}

/**
 * Delete a cover file from OPFS
 */
export async function deleteCoverFile(audiobookId) {
  try {
    const dir = await getDirectoryHandle(COVERS_DIR);
    await dir.removeEntry(`${audiobookId}.cover`);
  } catch (error) {
    if (error.name !== 'NotFoundError') {
      throw error;
    }
  }
}

/**
 * Get storage estimate
 */
export async function getStorageEstimate() {
  const estimate = await navigator.storage.estimate();
  return {
    used: estimate.usage || 0,
    available: estimate.quota || 0,
    usedFormatted: formatBytes(estimate.usage || 0),
    availableFormatted: formatBytes(estimate.quota || 0),
  };
}

/**
 * List all downloaded audiobook IDs
 */
export async function listDownloadedIds() {
  const ids = [];
  try {
    const dir = await getDirectoryHandle(AUDIOBOOKS_DIR);
    for await (const [name] of dir.entries()) {
      if (name.endsWith('.audio')) {
        ids.push(name.replace('.audio', ''));
      }
    }
  } catch (error) {
    // Directory doesn't exist yet
    if (error.name !== 'NotFoundError') {
      throw error;
    }
  }
  return ids;
}

/**
 * Format bytes to human readable string
 */
function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}
```

**Step 2: Verify file was created**

Run: `ls -la client/src/services/`
Expected: `offlineStorage.js` exists

**Step 3: Commit**

```bash
git add client/src/services/offlineStorage.js
git commit -m "feat(offline): add OPFS storage wrapper for offline audiobooks"
```

---

## Task 2: Create IndexedDB Store for Download Metadata

**Files:**
- Create: `client/src/services/downloadDb.js`

**Step 1: Create the IndexedDB wrapper**

```javascript
// client/src/services/downloadDb.js

/**
 * IndexedDB wrapper for download metadata and offline progress queue
 */

const DB_NAME = 'sappho-offline';
const DB_VERSION = 1;
const DOWNLOADS_STORE = 'downloads';
const OFFLINE_PROGRESS_STORE = 'offlineProgress';

let dbPromise = null;

/**
 * Open the database (cached promise)
 */
function openDb() {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;

      // Downloads store
      if (!db.objectStoreNames.contains(DOWNLOADS_STORE)) {
        db.createObjectStore(DOWNLOADS_STORE, { keyPath: 'id' });
      }

      // Offline progress store
      if (!db.objectStoreNames.contains(OFFLINE_PROGRESS_STORE)) {
        const progressStore = db.createObjectStore(OFFLINE_PROGRESS_STORE, { keyPath: 'id' });
        progressStore.createIndex('synced', 'synced', { unique: false });
      }
    };
  });

  return dbPromise;
}

/**
 * Get a download record by audiobook ID
 */
export async function getDownload(audiobookId) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DOWNLOADS_STORE, 'readonly');
    const request = tx.objectStore(DOWNLOADS_STORE).get(audiobookId);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result || null);
  });
}

/**
 * Get all download records
 */
export async function getAllDownloads() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DOWNLOADS_STORE, 'readonly');
    const request = tx.objectStore(DOWNLOADS_STORE).getAll();
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result || []);
  });
}

/**
 * Save or update a download record
 */
export async function saveDownload(download) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DOWNLOADS_STORE, 'readwrite');
    const request = tx.objectStore(DOWNLOADS_STORE).put(download);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve();
  });
}

/**
 * Delete a download record
 */
export async function deleteDownloadRecord(audiobookId) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DOWNLOADS_STORE, 'readwrite');
    const request = tx.objectStore(DOWNLOADS_STORE).delete(audiobookId);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve();
  });
}

/**
 * Queue an offline progress update
 */
export async function queueProgressUpdate(audiobookId, position) {
  const db = await openDb();
  const record = {
    id: `${audiobookId}-${Date.now()}`,
    audiobookId,
    position,
    timestamp: new Date().toISOString(),
    synced: false,
  };
  return new Promise((resolve, reject) => {
    const tx = db.transaction(OFFLINE_PROGRESS_STORE, 'readwrite');
    const request = tx.objectStore(OFFLINE_PROGRESS_STORE).put(record);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve();
  });
}

/**
 * Get all unsynced progress updates
 */
export async function getUnsyncedProgress() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(OFFLINE_PROGRESS_STORE, 'readonly');
    const index = tx.objectStore(OFFLINE_PROGRESS_STORE).index('synced');
    const request = index.getAll(IDBKeyRange.only(false));
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result || []);
  });
}

/**
 * Delete a progress record (after successful sync)
 */
export async function deleteProgressRecord(id) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(OFFLINE_PROGRESS_STORE, 'readwrite');
    const request = tx.objectStore(OFFLINE_PROGRESS_STORE).delete(id);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve();
  });
}
```

**Step 2: Commit**

```bash
git add client/src/services/downloadDb.js
git commit -m "feat(offline): add IndexedDB wrapper for download metadata"
```

---

## Task 3: Create Download Web Worker

**Files:**
- Create: `client/src/workers/download.worker.js`

**Step 1: Create the download worker**

```javascript
// client/src/workers/download.worker.js

/**
 * Web Worker for background audiobook downloads
 * Handles fetching and streaming to OPFS
 */

// Import OPFS functions (workers can use ES modules in modern browsers)
// Note: We'll inline the necessary OPFS code since workers have limitations

const AUDIOBOOKS_DIR = 'audiobooks';

async function getDirectoryHandle(name) {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle(name, { create: true });
}

let currentController = null;

self.onmessage = async (event) => {
  const { type, payload } = event.data;

  switch (type) {
    case 'START_DOWNLOAD':
      await startDownload(payload);
      break;
    case 'PAUSE_DOWNLOAD':
      pauseDownload();
      break;
    case 'CANCEL_DOWNLOAD':
      cancelDownload();
      break;
  }
};

async function startDownload({ audiobookId, url, token, resumeFrom = 0, totalBytes = 0 }) {
  currentController = new AbortController();

  try {
    const headers = {
      'Authorization': `Bearer ${token}`,
    };

    // Add Range header for resume
    if (resumeFrom > 0) {
      headers['Range'] = `bytes=${resumeFrom}-`;
    }

    const response = await fetch(url, {
      headers,
      signal: currentController.signal,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    // Get total size from Content-Length or Content-Range
    let fileSize = totalBytes;
    if (!fileSize) {
      const contentLength = response.headers.get('Content-Length');
      const contentRange = response.headers.get('Content-Range');
      if (contentRange) {
        // Format: bytes 0-1234/5678
        const match = contentRange.match(/\/(\d+)/);
        if (match) fileSize = parseInt(match[1], 10);
      } else if (contentLength) {
        fileSize = parseInt(contentLength, 10) + resumeFrom;
      }
    }

    // Report total size
    self.postMessage({
      type: 'TOTAL_SIZE',
      payload: { audiobookId, totalBytes: fileSize },
    });

    // Get OPFS directory and file handle
    const dir = await getDirectoryHandle(AUDIOBOOKS_DIR);
    const fileHandle = await dir.getFileHandle(`${audiobookId}.audio`, { create: true });
    const writable = await fileHandle.createWritable({ keepExistingData: resumeFrom > 0 });

    if (resumeFrom > 0) {
      await writable.seek(resumeFrom);
    }

    const reader = response.body.getReader();
    let bytesWritten = resumeFrom;
    let lastProgressReport = Date.now();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      await writable.write(value);
      bytesWritten += value.byteLength;

      // Report progress every 100ms to avoid flooding
      const now = Date.now();
      if (now - lastProgressReport > 100) {
        self.postMessage({
          type: 'PROGRESS',
          payload: {
            audiobookId,
            bytesDownloaded: bytesWritten,
            totalBytes: fileSize,
            progress: fileSize > 0 ? bytesWritten / fileSize : 0,
          },
        });
        lastProgressReport = now;
      }
    }

    await writable.close();

    // Final progress report
    self.postMessage({
      type: 'COMPLETE',
      payload: { audiobookId, bytesDownloaded: bytesWritten },
    });

  } catch (error) {
    if (error.name === 'AbortError') {
      self.postMessage({
        type: 'PAUSED',
        payload: { audiobookId },
      });
    } else {
      self.postMessage({
        type: 'ERROR',
        payload: { audiobookId, error: error.message },
      });
    }
  } finally {
    currentController = null;
  }
}

function pauseDownload() {
  if (currentController) {
    currentController.abort();
  }
}

function cancelDownload() {
  if (currentController) {
    currentController.abort();
  }
  // Caller should delete the partial file
}
```

**Step 2: Commit**

```bash
git add client/src/workers/download.worker.js
git commit -m "feat(offline): add download web worker for background fetching"
```

---

## Task 4: Create DownloadContext

**Files:**
- Create: `client/src/contexts/DownloadContext.jsx`

**Step 1: Create the context**

```javascript
// client/src/contexts/DownloadContext.jsx

import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { getAudiobook, updateProgress } from '../api';
import {
  isOPFSSupported,
  deleteAudioFile,
  deleteCoverFile,
  saveCoverFile,
  getCoverFile,
  getStorageEstimate,
  listDownloadedIds,
  hasAudioFile,
} from '../services/offlineStorage';
import {
  getDownload,
  getAllDownloads,
  saveDownload,
  deleteDownloadRecord,
  queueProgressUpdate,
  getUnsyncedProgress,
  deleteProgressRecord,
} from '../services/downloadDb';

const DownloadContext = createContext(null);

export function DownloadProvider({ children }) {
  const [downloads, setDownloads] = useState(new Map());
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [storageInfo, setStorageInfo] = useState({ used: 0, available: 0 });
  const [isSupported, setIsSupported] = useState(false);
  const workerRef = useRef(null);
  const queueRef = useRef([]);
  const activeDownloadRef = useRef(null);

  // Initialize
  useEffect(() => {
    const supported = isOPFSSupported();
    setIsSupported(supported);

    if (supported) {
      loadDownloads();
      updateStorageInfo();
      initWorker();
    }

    // Online/offline listeners
    const handleOnline = () => {
      setIsOnline(true);
      syncOfflineProgress();
    };
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      if (workerRef.current) {
        workerRef.current.terminate();
      }
    };
  }, []);

  const initWorker = useCallback(() => {
    workerRef.current = new Worker(
      new URL('../workers/download.worker.js', import.meta.url),
      { type: 'module' }
    );

    workerRef.current.onmessage = (event) => {
      const { type, payload } = event.data;
      handleWorkerMessage(type, payload);
    };
  }, []);

  const handleWorkerMessage = useCallback(async (type, payload) => {
    const { audiobookId } = payload;

    switch (type) {
      case 'TOTAL_SIZE':
        await updateDownloadState(audiobookId, { totalBytes: payload.totalBytes });
        break;

      case 'PROGRESS':
        await updateDownloadState(audiobookId, {
          bytesDownloaded: payload.bytesDownloaded,
          totalBytes: payload.totalBytes,
          progress: payload.progress,
        });
        break;

      case 'COMPLETE':
        await updateDownloadState(audiobookId, {
          status: 'completed',
          completedAt: new Date().toISOString(),
          progress: 1,
          bytesDownloaded: payload.bytesDownloaded,
        });
        activeDownloadRef.current = null;
        updateStorageInfo();
        processQueue();
        break;

      case 'PAUSED':
        await updateDownloadState(audiobookId, { status: 'paused' });
        activeDownloadRef.current = null;
        break;

      case 'ERROR':
        await updateDownloadState(audiobookId, {
          status: 'error',
          error: payload.error,
        });
        activeDownloadRef.current = null;
        processQueue();
        break;
    }
  }, []);

  const loadDownloads = useCallback(async () => {
    const records = await getAllDownloads();
    const map = new Map();
    for (const record of records) {
      // Verify file still exists for completed downloads
      if (record.status === 'completed') {
        const exists = await hasAudioFile(record.id);
        if (!exists) {
          await deleteDownloadRecord(record.id);
          continue;
        }
      }
      map.set(record.id, record);
    }
    setDownloads(map);

    // Rebuild queue from records
    queueRef.current = records
      .filter(r => r.status === 'queued')
      .sort((a, b) => new Date(a.startedAt) - new Date(b.startedAt))
      .map(r => r.id);
  }, []);

  const updateDownloadState = useCallback(async (audiobookId, updates) => {
    setDownloads(prev => {
      const next = new Map(prev);
      const current = next.get(audiobookId) || {};
      const updated = { ...current, ...updates };
      next.set(audiobookId, updated);
      saveDownload(updated); // Persist to IndexedDB
      return next;
    });
  }, []);

  const updateStorageInfo = useCallback(async () => {
    const estimate = await getStorageEstimate();
    setStorageInfo(estimate);
  }, []);

  const downloadBook = useCallback(async (audiobookId) => {
    if (!isSupported) return;

    // Fetch audiobook metadata
    const response = await getAudiobook(audiobookId);
    const audiobook = response.data;

    // Create download record
    const record = {
      id: audiobookId,
      status: 'queued',
      progress: 0,
      bytesDownloaded: 0,
      totalBytes: audiobook.file_size || 0,
      startedAt: new Date().toISOString(),
      completedAt: null,
      error: null,
      title: audiobook.title,
      author: audiobook.author,
      narrator: audiobook.narrator,
      duration: audiobook.duration,
      coverUrl: `/api/audiobooks/${audiobookId}/cover`,
    };

    await saveDownload(record);
    setDownloads(prev => new Map(prev).set(audiobookId, record));

    // Download cover immediately
    try {
      const token = localStorage.getItem('token');
      const coverResponse = await fetch(`/api/audiobooks/${audiobookId}/cover?token=${encodeURIComponent(token)}`);
      if (coverResponse.ok) {
        const blob = await coverResponse.blob();
        await saveCoverFile(audiobookId, blob);
      }
    } catch (error) {
      console.warn('Failed to cache cover:', error);
    }

    // Add to queue
    queueRef.current.push(audiobookId);
    processQueue();
  }, [isSupported]);

  const processQueue = useCallback(() => {
    if (activeDownloadRef.current) return;
    if (queueRef.current.length === 0) return;

    const audiobookId = queueRef.current[0];
    activeDownloadRef.current = audiobookId;

    setDownloads(prev => {
      const next = new Map(prev);
      const record = next.get(audiobookId);
      if (record) {
        record.status = 'downloading';
        next.set(audiobookId, { ...record });
        saveDownload(record);
      }
      return next;
    });

    const token = localStorage.getItem('token');
    const download = downloads.get(audiobookId);

    workerRef.current?.postMessage({
      type: 'START_DOWNLOAD',
      payload: {
        audiobookId,
        url: `/api/audiobooks/${audiobookId}/stream`,
        token,
        resumeFrom: download?.bytesDownloaded || 0,
        totalBytes: download?.totalBytes || 0,
      },
    });

    // Remove from queue
    queueRef.current = queueRef.current.filter(id => id !== audiobookId);
  }, [downloads]);

  const pauseDownload = useCallback((audiobookId) => {
    if (activeDownloadRef.current === audiobookId) {
      workerRef.current?.postMessage({ type: 'PAUSE_DOWNLOAD' });
    }
  }, []);

  const resumeDownload = useCallback(async (audiobookId) => {
    const record = downloads.get(audiobookId);
    if (!record || record.status !== 'paused') return;

    await updateDownloadState(audiobookId, { status: 'queued' });
    queueRef.current.push(audiobookId);
    processQueue();
  }, [downloads, updateDownloadState, processQueue]);

  const cancelDownload = useCallback(async (audiobookId) => {
    if (activeDownloadRef.current === audiobookId) {
      workerRef.current?.postMessage({ type: 'CANCEL_DOWNLOAD' });
      activeDownloadRef.current = null;
    }

    queueRef.current = queueRef.current.filter(id => id !== audiobookId);
    await deleteAudioFile(audiobookId);
    await deleteCoverFile(audiobookId);
    await deleteDownloadRecord(audiobookId);

    setDownloads(prev => {
      const next = new Map(prev);
      next.delete(audiobookId);
      return next;
    });

    updateStorageInfo();
    processQueue();
  }, [updateStorageInfo, processQueue]);

  const deleteDownload = useCallback(async (audiobookId) => {
    await deleteAudioFile(audiobookId);
    await deleteCoverFile(audiobookId);
    await deleteDownloadRecord(audiobookId);

    setDownloads(prev => {
      const next = new Map(prev);
      next.delete(audiobookId);
      return next;
    });

    updateStorageInfo();
  }, [updateStorageInfo]);

  const syncOfflineProgress = useCallback(async () => {
    const unsyncedRecords = await getUnsyncedProgress();
    if (unsyncedRecords.length === 0) return;

    let syncedCount = 0;

    for (const record of unsyncedRecords) {
      try {
        await updateProgress(record.audiobookId, record.position);
        await deleteProgressRecord(record.id);
        syncedCount++;
      } catch (error) {
        console.warn('Failed to sync progress:', error);
      }
    }

    if (syncedCount > 0) {
      // Dispatch event for toast notification
      window.dispatchEvent(new CustomEvent('offlineProgressSynced', {
        detail: { count: syncedCount }
      }));
    }
  }, []);

  const getDownloadStatus = useCallback((audiobookId) => {
    return downloads.get(audiobookId) || null;
  }, [downloads]);

  const isDownloaded = useCallback((audiobookId) => {
    const record = downloads.get(audiobookId);
    return record?.status === 'completed';
  }, [downloads]);

  const getQueuePosition = useCallback((audiobookId) => {
    const index = queueRef.current.indexOf(audiobookId);
    return index >= 0 ? index + 1 : null;
  }, []);

  const value = {
    downloads,
    isOnline,
    isSupported,
    storageInfo,
    downloadBook,
    pauseDownload,
    resumeDownload,
    cancelDownload,
    deleteDownload,
    getDownloadStatus,
    isDownloaded,
    getQueuePosition,
    queueProgressUpdate,
  };

  return (
    <DownloadContext.Provider value={value}>
      {children}
    </DownloadContext.Provider>
  );
}

export function useDownloads() {
  const context = useContext(DownloadContext);
  if (!context) {
    throw new Error('useDownloads must be used within a DownloadProvider');
  }
  return context;
}

export default DownloadContext;
```

**Step 2: Commit**

```bash
git add client/src/contexts/DownloadContext.jsx
git commit -m "feat(offline): add DownloadContext for state management"
```

---

## Task 5: Create DownloadButton Component

**Files:**
- Create: `client/src/components/DownloadButton.jsx`
- Create: `client/src/components/DownloadButton.css`

**Step 1: Create the component**

```javascript
// client/src/components/DownloadButton.jsx

import { useDownloads } from '../contexts/DownloadContext';
import './DownloadButton.css';

export default function DownloadButton({ audiobookId }) {
  const {
    isSupported,
    downloadBook,
    pauseDownload,
    resumeDownload,
    cancelDownload,
    deleteDownload,
    getDownloadStatus,
    getQueuePosition,
  } = useDownloads();

  if (!isSupported) {
    return null;
  }

  const status = getDownloadStatus(audiobookId);
  const queuePosition = getQueuePosition(audiobookId);

  const handleDownload = () => {
    downloadBook(audiobookId);
  };

  const handlePause = (e) => {
    e.stopPropagation();
    pauseDownload(audiobookId);
  };

  const handleResume = (e) => {
    e.stopPropagation();
    resumeDownload(audiobookId);
  };

  const handleCancel = (e) => {
    e.stopPropagation();
    cancelDownload(audiobookId);
  };

  const handleDelete = (e) => {
    e.stopPropagation();
    if (confirm('Remove this download? You can re-download it later.')) {
      deleteDownload(audiobookId);
    }
  };

  // Not downloaded
  if (!status) {
    return (
      <button className="download-button" onClick={handleDownload}>
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
          <polyline points="7 10 12 15 17 10"/>
          <line x1="12" y1="15" x2="12" y2="3"/>
        </svg>
        Download
      </button>
    );
  }

  // Queued
  if (status.status === 'queued') {
    return (
      <div className="download-button download-button--queued">
        <span className="download-status">
          Queued{queuePosition ? ` (#${queuePosition})` : ''}
        </span>
        <button className="download-cancel" onClick={handleCancel} title="Cancel">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="18" y1="6" x2="6" y2="18"/>
            <line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>
    );
  }

  // Downloading
  if (status.status === 'downloading') {
    const percent = Math.round((status.progress || 0) * 100);
    return (
      <div className="download-button download-button--downloading">
        <div className="download-progress-bar">
          <div className="download-progress-fill" style={{ width: `${percent}%` }} />
        </div>
        <span className="download-percent">{percent}%</span>
        <button className="download-pause" onClick={handlePause} title="Pause">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <rect x="6" y="4" width="4" height="16"/>
            <rect x="14" y="4" width="4" height="16"/>
          </svg>
        </button>
      </div>
    );
  }

  // Paused
  if (status.status === 'paused') {
    const percent = Math.round((status.progress || 0) * 100);
    return (
      <div className="download-button download-button--paused">
        <span className="download-status">Paused ({percent}%)</span>
        <button className="download-resume" onClick={handleResume} title="Resume">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <polygon points="5 3 19 12 5 21 5 3"/>
          </svg>
        </button>
        <button className="download-cancel" onClick={handleCancel} title="Cancel">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="18" y1="6" x2="6" y2="18"/>
            <line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>
    );
  }

  // Completed
  if (status.status === 'completed') {
    return (
      <div className="download-button download-button--completed">
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
          <polyline points="22 4 12 14.01 9 11.01"/>
        </svg>
        <span>Downloaded</span>
        <button className="download-delete" onClick={handleDelete} title="Remove download">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="3 6 5 6 21 6"/>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
          </svg>
        </button>
      </div>
    );
  }

  // Error
  if (status.status === 'error') {
    return (
      <div className="download-button download-button--error">
        <span className="download-error">Failed</span>
        <button className="download-retry" onClick={handleDownload} title="Retry">
          Retry
        </button>
      </div>
    );
  }

  return null;
}
```

**Step 2: Create the CSS**

```css
/* client/src/components/DownloadButton.css */

.download-button {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 10px 16px;
  background: var(--primary-color, #6366f1);
  color: white;
  border: none;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.2s;
}

.download-button:hover {
  background: var(--primary-hover, #4f46e5);
}

.download-button--queued,
.download-button--downloading,
.download-button--paused,
.download-button--completed,
.download-button--error {
  background: var(--surface-color, #1f2937);
  cursor: default;
}

.download-button--completed {
  color: var(--success-color, #10b981);
}

.download-button--error {
  color: var(--error-color, #ef4444);
}

.download-status {
  flex: 1;
}

.download-progress-bar {
  flex: 1;
  height: 4px;
  background: var(--border-color, #374151);
  border-radius: 2px;
  overflow: hidden;
}

.download-progress-fill {
  height: 100%;
  background: var(--primary-color, #6366f1);
  transition: width 0.2s;
}

.download-percent {
  font-size: 12px;
  min-width: 36px;
  text-align: right;
}

.download-pause,
.download-resume,
.download-cancel,
.download-delete,
.download-retry {
  background: transparent;
  border: none;
  color: inherit;
  cursor: pointer;
  padding: 4px;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.2s;
}

.download-pause:hover,
.download-resume:hover,
.download-cancel:hover,
.download-delete:hover {
  background: rgba(255, 255, 255, 0.1);
}

.download-retry {
  padding: 4px 8px;
  font-size: 12px;
  font-weight: 500;
}

.download-error {
  flex: 1;
}
```

**Step 3: Commit**

```bash
git add client/src/components/DownloadButton.jsx client/src/components/DownloadButton.css
git commit -m "feat(offline): add DownloadButton component"
```

---

## Task 6: Create Downloads Page

**Files:**
- Create: `client/src/pages/Downloads.jsx`
- Create: `client/src/pages/Downloads.css`

**Step 1: Create the Downloads page**

```javascript
// client/src/pages/Downloads.jsx

import { useDownloads } from '../contexts/DownloadContext';
import { useNavigate } from 'react-router-dom';
import './Downloads.css';

export default function Downloads() {
  const navigate = useNavigate();
  const {
    downloads,
    isSupported,
    storageInfo,
    pauseDownload,
    resumeDownload,
    cancelDownload,
    deleteDownload,
  } = useDownloads();

  if (!isSupported) {
    return (
      <div className="downloads-page">
        <h1>Downloads</h1>
        <div className="downloads-unsupported">
          <p>Offline downloads are not supported in your browser.</p>
          <p>Please use a modern browser like Chrome, Firefox, or Safari.</p>
        </div>
      </div>
    );
  }

  const downloadList = Array.from(downloads.values());
  const activeDownloads = downloadList.filter(d =>
    d.status === 'downloading' || d.status === 'queued' || d.status === 'paused'
  );
  const completedDownloads = downloadList.filter(d => d.status === 'completed');

  const formatBytes = (bytes) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  const formatDuration = (seconds) => {
    if (!seconds) return '';
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    }
    return `${minutes}m`;
  };

  const usagePercent = storageInfo.available > 0
    ? Math.round((storageInfo.used / storageInfo.available) * 100)
    : 0;

  return (
    <div className="downloads-page">
      <h1>Downloads</h1>

      <div className="storage-info">
        <div className="storage-text">
          <span>Storage: {storageInfo.usedFormatted} used</span>
          <span className="storage-available">of {storageInfo.availableFormatted} available</span>
        </div>
        <div className="storage-bar">
          <div className="storage-bar-fill" style={{ width: `${usagePercent}%` }} />
        </div>
      </div>

      {activeDownloads.length > 0 && (
        <section className="downloads-section">
          <h2>Downloading</h2>
          <div className="downloads-list">
            {activeDownloads.map(download => (
              <DownloadItem
                key={download.id}
                download={download}
                onPause={pauseDownload}
                onResume={resumeDownload}
                onCancel={cancelDownload}
                onNavigate={() => navigate(`/audiobook/${download.id}`)}
              />
            ))}
          </div>
        </section>
      )}

      {completedDownloads.length > 0 && (
        <section className="downloads-section">
          <h2>Downloaded</h2>
          <div className="downloads-list">
            {completedDownloads.map(download => (
              <DownloadItem
                key={download.id}
                download={download}
                onDelete={deleteDownload}
                onNavigate={() => navigate(`/audiobook/${download.id}`)}
                formatBytes={formatBytes}
                formatDuration={formatDuration}
              />
            ))}
          </div>
        </section>
      )}

      {downloadList.length === 0 && (
        <div className="downloads-empty">
          <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="7 10 12 15 17 10"/>
            <line x1="12" y1="15" x2="12" y2="3"/>
          </svg>
          <p>No downloads yet</p>
          <p className="downloads-empty-hint">
            Download audiobooks to listen offline
          </p>
        </div>
      )}
    </div>
  );
}

function DownloadItem({ download, onPause, onResume, onCancel, onDelete, onNavigate, formatBytes, formatDuration }) {
  const percent = Math.round((download.progress || 0) * 100);
  const token = localStorage.getItem('token');
  const coverUrl = download.coverUrl ? `${download.coverUrl}?token=${encodeURIComponent(token)}` : null;

  return (
    <div className="download-item" onClick={onNavigate}>
      <div className="download-item-cover">
        {coverUrl ? (
          <img src={coverUrl} alt={download.title} />
        ) : (
          <div className="download-item-cover-placeholder">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/>
              <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
            </svg>
          </div>
        )}
      </div>

      <div className="download-item-info">
        <div className="download-item-title">{download.title}</div>
        <div className="download-item-author">{download.author}</div>

        {download.status === 'downloading' && (
          <div className="download-item-progress">
            <div className="download-item-progress-bar">
              <div className="download-item-progress-fill" style={{ width: `${percent}%` }} />
            </div>
            <span className="download-item-percent">{percent}%</span>
          </div>
        )}

        {download.status === 'queued' && (
          <div className="download-item-status">Queued</div>
        )}

        {download.status === 'paused' && (
          <div className="download-item-status">Paused ({percent}%)</div>
        )}

        {download.status === 'completed' && formatBytes && (
          <div className="download-item-meta">
            {formatBytes(download.totalBytes)}
            {download.duration && ` • ${formatDuration(download.duration)}`}
          </div>
        )}
      </div>

      <div className="download-item-actions" onClick={(e) => e.stopPropagation()}>
        {download.status === 'downloading' && onPause && (
          <button onClick={() => onPause(download.id)} title="Pause">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <rect x="6" y="4" width="4" height="16"/>
              <rect x="14" y="4" width="4" height="16"/>
            </svg>
          </button>
        )}

        {download.status === 'paused' && onResume && (
          <button onClick={() => onResume(download.id)} title="Resume">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <polygon points="5 3 19 12 5 21 5 3"/>
            </svg>
          </button>
        )}

        {(download.status === 'downloading' || download.status === 'queued' || download.status === 'paused') && onCancel && (
          <button onClick={() => onCancel(download.id)} title="Cancel">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18"/>
              <line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        )}

        {download.status === 'completed' && onDelete && (
          <button onClick={() => {
            if (confirm('Remove this download?')) {
              onDelete(download.id);
            }
          }} title="Delete">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}
```

**Step 2: Create the CSS**

```css
/* client/src/pages/Downloads.css */

.downloads-page {
  max-width: 800px;
  margin: 0 auto;
  padding: 20px;
}

.downloads-page h1 {
  margin-bottom: 24px;
}

.storage-info {
  background: var(--surface-color, #1f2937);
  border-radius: 12px;
  padding: 16px;
  margin-bottom: 24px;
}

.storage-text {
  display: flex;
  justify-content: space-between;
  margin-bottom: 8px;
  font-size: 14px;
}

.storage-available {
  color: var(--text-secondary, #9ca3af);
}

.storage-bar {
  height: 8px;
  background: var(--border-color, #374151);
  border-radius: 4px;
  overflow: hidden;
}

.storage-bar-fill {
  height: 100%;
  background: var(--primary-color, #6366f1);
  transition: width 0.3s;
}

.downloads-section {
  margin-bottom: 32px;
}

.downloads-section h2 {
  font-size: 16px;
  font-weight: 600;
  margin-bottom: 12px;
  color: var(--text-secondary, #9ca3af);
}

.downloads-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.download-item {
  display: flex;
  align-items: center;
  gap: 12px;
  background: var(--surface-color, #1f2937);
  border-radius: 12px;
  padding: 12px;
  cursor: pointer;
  transition: background 0.2s;
}

.download-item:hover {
  background: var(--surface-hover, #374151);
}

.download-item-cover {
  width: 60px;
  height: 60px;
  border-radius: 8px;
  overflow: hidden;
  flex-shrink: 0;
}

.download-item-cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.download-item-cover-placeholder {
  width: 100%;
  height: 100%;
  background: var(--border-color, #374151);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-secondary, #9ca3af);
}

.download-item-info {
  flex: 1;
  min-width: 0;
}

.download-item-title {
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.download-item-author {
  font-size: 13px;
  color: var(--text-secondary, #9ca3af);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.download-item-progress {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
}

.download-item-progress-bar {
  flex: 1;
  height: 4px;
  background: var(--border-color, #374151);
  border-radius: 2px;
  overflow: hidden;
}

.download-item-progress-fill {
  height: 100%;
  background: var(--primary-color, #6366f1);
  transition: width 0.2s;
}

.download-item-percent {
  font-size: 12px;
  color: var(--text-secondary, #9ca3af);
  min-width: 32px;
  text-align: right;
}

.download-item-status {
  font-size: 13px;
  color: var(--text-secondary, #9ca3af);
  margin-top: 4px;
}

.download-item-meta {
  font-size: 13px;
  color: var(--text-secondary, #9ca3af);
  margin-top: 4px;
}

.download-item-actions {
  display: flex;
  gap: 4px;
}

.download-item-actions button {
  background: transparent;
  border: none;
  color: var(--text-secondary, #9ca3af);
  cursor: pointer;
  padding: 8px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.2s, color 0.2s;
}

.download-item-actions button:hover {
  background: rgba(255, 255, 255, 0.1);
  color: white;
}

.downloads-empty {
  text-align: center;
  padding: 48px 20px;
  color: var(--text-secondary, #9ca3af);
}

.downloads-empty svg {
  margin-bottom: 16px;
  opacity: 0.5;
}

.downloads-empty p {
  margin: 0;
}

.downloads-empty-hint {
  font-size: 14px;
  margin-top: 8px !important;
}

.downloads-unsupported {
  text-align: center;
  padding: 48px 20px;
  background: var(--surface-color, #1f2937);
  border-radius: 12px;
}

.downloads-unsupported p {
  margin: 8px 0;
}
```

**Step 3: Commit**

```bash
git add client/src/pages/Downloads.jsx client/src/pages/Downloads.css
git commit -m "feat(offline): add Downloads page for managing offline books"
```

---

## Task 7: Wire Up App Routes and Navigation

**Files:**
- Modify: `client/src/App.jsx`
- Modify: `client/src/components/Navigation.jsx`
- Modify: `client/src/main.jsx`

**Step 1: Add DownloadProvider to main.jsx**

In `client/src/main.jsx`, wrap the app with DownloadProvider (after WebSocketProvider):

```javascript
// Add import at top
import { DownloadProvider } from './contexts/DownloadContext'

// Wrap App in providers (inside WebSocketProvider)
<WebSocketProvider>
  <DownloadProvider>
    <App />
  </DownloadProvider>
</WebSocketProvider>
```

**Step 2: Add route in App.jsx**

Add import at top:
```javascript
import Downloads from './pages/Downloads'
```

Add route inside Routes (around line 64):
```javascript
<Route path="/downloads" element={<Downloads />} />
```

**Step 3: Add link in Navigation.jsx**

In the desktop user dropdown (around line 303, after Settings button):
```javascript
<button onClick={() => { navigate('/downloads'); setShowUserMenu(false); }}>
  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
    <polyline points="7 10 12 15 17 10"/>
    <line x1="12" y1="15" x2="12" y2="3"/>
  </svg>
  Downloads
</button>
```

In the mobile menu dropdown (around line 370, after Settings button):
```javascript
<button onClick={() => { navigate('/downloads'); setShowMobileMenu(false); }}>
  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
    <polyline points="7 10 12 15 17 10"/>
    <line x1="12" y1="15" x2="12" y2="3"/>
  </svg>
  <span>Downloads</span>
</button>
```

**Step 4: Commit**

```bash
git add client/src/main.jsx client/src/App.jsx client/src/components/Navigation.jsx
git commit -m "feat(offline): wire up Downloads route and navigation"
```

---

## Task 8: Add DownloadButton to AudiobookDetail

**Files:**
- Modify: `client/src/pages/AudiobookDetail.jsx`

**Step 1: Add import and component**

Add import at top:
```javascript
import DownloadButton from '../components/DownloadButton';
```

Find the action buttons section (search for "Play" button or action area) and add DownloadButton nearby:
```javascript
<DownloadButton audiobookId={id} />
```

**Step 2: Commit**

```bash
git add client/src/pages/AudiobookDetail.jsx
git commit -m "feat(offline): add DownloadButton to audiobook detail page"
```

---

## Task 9: Update Service Worker for Offline Playback

**Files:**
- Modify: `client/public/sw.js`

**Step 1: Add OPFS intercept for stream requests**

Replace the existing fetch handler with:

```javascript
// Fetch event - network first, falling back to cache
self.addEventListener('fetch', (event) => {
  // Skip chrome extension requests
  if (event.request.url.startsWith('chrome-extension://')) {
    return;
  }

  // Skip cross-origin requests
  if (!event.request.url.startsWith(self.location.origin)) {
    return;
  }

  const url = new URL(event.request.url);

  // Check if it's an audiobook stream request - serve from OPFS if available
  const streamMatch = url.pathname.match(/^\/api\/audiobooks\/(\d+)\/stream$/);
  if (streamMatch) {
    event.respondWith(serveStreamFromOPFS(streamMatch[1], event.request));
    return;
  }

  // Check if it's a cover request - serve from OPFS if available
  const coverMatch = url.pathname.match(/^\/api\/audiobooks\/(\d+)\/cover$/);
  if (coverMatch) {
    event.respondWith(serveCoverFromOPFS(coverMatch[1], event.request));
    return;
  }

  // IMPORTANT: Never cache other API requests - they contain auth tokens and dynamic data
  if (event.request.url.includes('/api/')) {
    event.respondWith(fetch(event.request));
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // Don't cache non-successful responses
        if (!response || response.status !== 200 || response.type !== 'basic') {
          return response;
        }

        // Clone the response
        const responseToCache = response.clone();

        caches.open(CACHE_NAME)
          .then((cache) => {
            cache.put(event.request, responseToCache);
          });

        return response;
      })
      .catch(() => {
        // Network failed, try cache
        return caches.match(event.request)
          .then((response) => {
            if (response) {
              return response;
            }
            // If not in cache and network failed, return offline page
            return caches.match('/index.html');
          });
      })
  );
});

/**
 * Serve audiobook stream from OPFS, falling back to network
 */
async function serveStreamFromOPFS(audiobookId, request) {
  try {
    const root = await navigator.storage.getDirectory();
    const dir = await root.getDirectoryHandle('audiobooks', { create: false });
    const fileHandle = await dir.getFileHandle(`${audiobookId}.audio`, { create: false });
    const file = await fileHandle.getFile();

    // Handle Range requests for seeking
    const rangeHeader = request.headers.get('Range');
    if (rangeHeader) {
      const match = rangeHeader.match(/bytes=(\d+)-(\d*)/);
      if (match) {
        const start = parseInt(match[1], 10);
        const end = match[2] ? parseInt(match[2], 10) : file.size - 1;
        const slice = file.slice(start, end + 1);

        return new Response(slice, {
          status: 206,
          headers: {
            'Content-Type': file.type || 'audio/mp4',
            'Content-Length': slice.size,
            'Content-Range': `bytes ${start}-${end}/${file.size}`,
            'Accept-Ranges': 'bytes',
          },
        });
      }
    }

    return new Response(file, {
      headers: {
        'Content-Type': file.type || 'audio/mp4',
        'Content-Length': file.size,
        'Accept-Ranges': 'bytes',
      },
    });
  } catch (error) {
    // File not in OPFS, fetch from network
    return fetch(request);
  }
}

/**
 * Serve cover from OPFS, falling back to network
 */
async function serveCoverFromOPFS(audiobookId, request) {
  try {
    const root = await navigator.storage.getDirectory();
    const dir = await root.getDirectoryHandle('covers', { create: false });
    const fileHandle = await dir.getFileHandle(`${audiobookId}.cover`, { create: false });
    const file = await fileHandle.getFile();

    return new Response(file, {
      headers: {
        'Content-Type': file.type || 'image/jpeg',
      },
    });
  } catch (error) {
    // File not in OPFS, fetch from network
    return fetch(request);
  }
}
```

**Step 2: Update cache version**

Update the CACHE_NAME version number to force service worker update.

**Step 3: Commit**

```bash
git add client/public/sw.js
git commit -m "feat(offline): add service worker intercept for offline playback"
```

---

## Task 10: Add OfflineBadge to Book Cards

**Files:**
- Create: `client/src/components/OfflineBadge.jsx`
- Create: `client/src/components/OfflineBadge.css`

**Step 1: Create the badge component**

```javascript
// client/src/components/OfflineBadge.jsx

import { useDownloads } from '../contexts/DownloadContext';
import './OfflineBadge.css';

export default function OfflineBadge({ audiobookId }) {
  const { isDownloaded } = useDownloads();

  if (!isDownloaded(audiobookId)) {
    return null;
  }

  return (
    <div className="offline-badge" title="Available offline">
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
        <polyline points="22 4 12 14.01 9 11.01"/>
      </svg>
    </div>
  );
}
```

**Step 2: Create the CSS**

```css
/* client/src/components/OfflineBadge.css */

.offline-badge {
  position: absolute;
  top: 8px;
  right: 8px;
  width: 24px;
  height: 24px;
  background: var(--success-color, #10b981);
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
}
```

**Step 3: Add to book cards throughout the app**

Find the book card components and add OfflineBadge inside the cover image container.

**Step 4: Commit**

```bash
git add client/src/components/OfflineBadge.jsx client/src/components/OfflineBadge.css
git commit -m "feat(offline): add OfflineBadge component for downloaded books"
```

---

## Task 11: Add Progress Sync Toast Notification

**Files:**
- Modify: `client/src/App.jsx` or create a toast component

**Step 1: Add event listener for sync notifications**

In App.jsx or a dedicated toast component, add:

```javascript
useEffect(() => {
  const handleSyncComplete = (event) => {
    const { count } = event.detail;
    // Show toast notification
    // You can use your existing toast/notification system
    alert(`Synced progress for ${count} book${count > 1 ? 's' : ''}`);
  };

  window.addEventListener('offlineProgressSynced', handleSyncComplete);
  return () => window.removeEventListener('offlineProgressSynced', handleSyncComplete);
}, []);
```

**Step 2: Commit**

```bash
git add client/src/App.jsx
git commit -m "feat(offline): add toast notification for progress sync"
```

---

## Final: Test and Create PR

**Step 1: Build and test**

```bash
cd client && npm run build
cd ..
docker-compose build --no-cache && docker-compose up -d
```

**Step 2: Manual testing checklist**
- [ ] Download button appears on audiobook detail
- [ ] Download starts and shows progress
- [ ] Pause/resume works
- [ ] Cancel removes partial download
- [ ] Downloads page shows all downloads
- [ ] Storage bar updates
- [ ] Offline playback works (disable network in devtools)
- [ ] Progress syncs when back online

**Step 3: Create PR**

```bash
git push -u origin feature/offline-downloads
gh pr create --title "feat: Add offline download support for PWA (#47)" --body "..."
```
