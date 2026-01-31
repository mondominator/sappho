/**
 * IndexedDB Store for Download Metadata
 *
 * Provides persistent storage for download status, progress, and offline progress sync.
 * Uses IndexedDB for reliability across browser sessions.
 *
 * Database: sappho-downloads
 * Stores:
 *   - downloads: Download metadata and status (keyed by audiobook ID)
 *   - offlineProgress: Progress records pending sync to server
 */

const DB_NAME = 'sappho-downloads';
const DB_VERSION = 1;
const DOWNLOADS_STORE = 'downloads';
const OFFLINE_PROGRESS_STORE = 'offlineProgress';

/** @type {IDBDatabase|null} */
let dbInstance = null;

/**
 * Check if IndexedDB is supported
 * @returns {boolean}
 */
export function isIndexedDBSupported() {
  return typeof indexedDB !== 'undefined';
}

/**
 * Open or create the IndexedDB database
 * @returns {Promise<IDBDatabase>}
 */
export function openDatabase() {
  return new Promise((resolve, reject) => {
    if (!isIndexedDBSupported()) {
      reject(new Error('IndexedDB is not supported in this browser'));
      return;
    }

    // Return cached instance if available
    if (dbInstance) {
      resolve(dbInstance);
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      reject(request.error);
    };

    request.onsuccess = () => {
      dbInstance = request.result;

      // Handle connection closing unexpectedly
      dbInstance.onclose = () => {
        dbInstance = null;
      };

      // Handle version change from another tab
      dbInstance.onversionchange = () => {
        dbInstance.close();
        dbInstance = null;
      };

      resolve(dbInstance);
    };

    request.onupgradeneeded = (event) => {
      const db = event.target.result;

      // Create downloads store
      if (!db.objectStoreNames.contains(DOWNLOADS_STORE)) {
        const downloadsStore = db.createObjectStore(DOWNLOADS_STORE, { keyPath: 'id' });
        // Index for querying by status (e.g., get all queued downloads)
        downloadsStore.createIndex('status', 'status', { unique: false });
        // Index for ordering by start time
        downloadsStore.createIndex('startedAt', 'startedAt', { unique: false });
      }

      // Create offline progress store
      if (!db.objectStoreNames.contains(OFFLINE_PROGRESS_STORE)) {
        const progressStore = db.createObjectStore(OFFLINE_PROGRESS_STORE, { keyPath: 'id' });
        // Index for querying by audiobook
        progressStore.createIndex('audiobookId', 'audiobookId', { unique: false });
        // Index for querying unsynced records
        progressStore.createIndex('synced', 'synced', { unique: false });
      }
    };
  });
}

/**
 * Get the database instance, opening it if necessary
 * @returns {Promise<IDBDatabase>}
 */
async function getDB() {
  if (!dbInstance) {
    return openDatabase();
  }
  return dbInstance;
}

/**
 * Execute a transaction and return a promise
 * @param {string} storeName - Store to operate on
 * @param {IDBTransactionMode} mode - 'readonly' or 'readwrite'
 * @param {function(IDBObjectStore): IDBRequest} operation - Function that performs the operation
 * @returns {Promise<any>}
 */
async function withTransaction(storeName, mode, operation) {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    let settled = false;

    const settle = (fn, value) => {
      if (!settled) {
        settled = true;
        fn(value);
      }
    };

    let transaction;
    let request;

    try {
      transaction = db.transaction(storeName, mode);
      const store = transaction.objectStore(storeName);
      request = operation(store);
    } catch (error) {
      settle(reject, error);
      return;
    }

    request.onsuccess = () => {
      settle(resolve, request.result);
    };

    request.onerror = () => {
      settle(reject, request.error);
    };

    transaction.onerror = () => {
      settle(reject, transaction.error);
    };

    transaction.onabort = () => {
      settle(reject, transaction.error || new Error('Transaction aborted'));
    };
  });
}

/**
 * Execute a cursor-based query
 * @param {string} storeName - Store to query
 * @param {function(IDBObjectStore): IDBRequest} cursorOperation - Function that opens a cursor
 * @returns {Promise<any[]>}
 */
async function withCursor(storeName, cursorOperation) {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    let settled = false;
    const results = [];

    const settle = (fn, value) => {
      if (!settled) {
        settled = true;
        fn(value);
      }
    };

    let transaction;
    let request;

    try {
      transaction = db.transaction(storeName, 'readonly');
      const store = transaction.objectStore(storeName);
      request = cursorOperation(store);
    } catch (error) {
      settle(reject, error);
      return;
    }

    request.onsuccess = (event) => {
      const cursor = event.target.result;
      if (cursor) {
        results.push(cursor.value);
        cursor.continue();
      } else {
        settle(resolve, results);
      }
    };

    request.onerror = () => {
      settle(reject, request.error);
    };

    transaction.onerror = () => {
      settle(reject, transaction.error);
    };

    transaction.onabort = () => {
      settle(reject, transaction.error || new Error('Transaction aborted'));
    };
  });
}

// =============================================================================
// Downloads Store Operations
// =============================================================================

/**
 * Get all download records
 * @returns {Promise<Array>} Array of download records
 */
export async function getAllDownloads() {
  if (!isIndexedDBSupported()) {
    return [];
  }

  try {
    return await withTransaction(DOWNLOADS_STORE, 'readonly', (store) => store.getAll());
  } catch (error) {
    console.error('Failed to get all downloads:', error);
    return [];
  }
}

/**
 * Get a single download record by audiobook ID
 * @param {string|number} audiobookId - Audiobook ID
 * @returns {Promise<Object|null>} Download record or null if not found
 */
export async function getDownload(audiobookId) {
  if (!isIndexedDBSupported()) {
    return null;
  }

  try {
    // Ensure string ID for consistency
    const id = String(audiobookId);
    const result = await withTransaction(DOWNLOADS_STORE, 'readonly', (store) =>
      store.get(id)
    );
    return result || null;
  } catch (error) {
    console.error('Failed to get download:', error);
    return null;
  }
}

/**
 * Save (create or update) a download record
 * @param {Object} download - Download record with id property
 * @returns {Promise<boolean>} True if successful
 */
export async function saveDownload(download) {
  if (!isIndexedDBSupported()) {
    return false;
  }

  if (!download || download.id === undefined || download.id === null) {
    console.error('saveDownload: download must have an id property');
    return false;
  }

  try {
    // Normalize ID to string for consistent retrieval
    const normalizedDownload = {
      ...download,
      id: String(download.id)
    };
    await withTransaction(DOWNLOADS_STORE, 'readwrite', (store) => store.put(normalizedDownload));
    return true;
  } catch (error) {
    console.error('Failed to save download:', error);
    return false;
  }
}

/**
 * Delete a download record
 * @param {string|number} audiobookId - Audiobook ID
 * @returns {Promise<boolean>} True if successful
 */
export async function deleteDownload(audiobookId) {
  if (!isIndexedDBSupported()) {
    return false;
  }

  try {
    // Ensure string ID for consistency
    const id = String(audiobookId);
    await withTransaction(DOWNLOADS_STORE, 'readwrite', (store) => store.delete(id));
    return true;
  } catch (error) {
    console.error('Failed to delete download:', error);
    return false;
  }
}

/**
 * Get all downloads with status 'queued', ordered by startedAt
 * @returns {Promise<Array>} Array of queued download records
 */
export async function getQueuedDownloads() {
  if (!isIndexedDBSupported()) {
    return [];
  }

  try {
    const downloads = await withCursor(
      DOWNLOADS_STORE,
      (store) => store.index('status').openCursor(IDBKeyRange.only('queued'))
    );
    // Sort by startedAt (oldest first - FIFO queue)
    return downloads.sort((a, b) => {
      const dateA = a.startedAt ? new Date(a.startedAt).getTime() : 0;
      const dateB = b.startedAt ? new Date(b.startedAt).getTime() : 0;
      return dateA - dateB;
    });
  } catch (error) {
    console.error('Failed to get queued downloads:', error);
    return [];
  }
}

/**
 * Get the next queued download (first in queue by startedAt)
 * @returns {Promise<Object|null>} Next queued download or null if none
 */
export async function getNextQueuedDownload() {
  const queued = await getQueuedDownloads();
  return queued.length > 0 ? queued[0] : null;
}

/**
 * Get downloads by status
 * @param {string} status - Status to filter by
 * @returns {Promise<Array>} Array of download records matching status
 */
export async function getDownloadsByStatus(status) {
  if (!isIndexedDBSupported()) {
    return [];
  }

  try {
    return await withCursor(
      DOWNLOADS_STORE,
      (store) => store.index('status').openCursor(IDBKeyRange.only(status))
    );
  } catch (error) {
    console.error('Failed to get downloads by status:', error);
    return [];
  }
}

// =============================================================================
// Offline Progress Store Operations
// =============================================================================

/**
 * Add an offline progress record
 * @param {Object} progress - Progress record with audiobookId, position, timestamp
 * @returns {Promise<boolean>} True if successful
 */
export async function addOfflineProgress(progress) {
  if (!isIndexedDBSupported()) {
    return false;
  }

  if (!progress || !progress.audiobookId) {
    console.error('addOfflineProgress: progress must have an audiobookId property');
    return false;
  }

  try {
    // Generate compound ID if not provided
    const record = {
      ...progress,
      id: progress.id || `progress-${progress.audiobookId}-${Date.now()}`,
      synced: false,
      timestamp: progress.timestamp || new Date().toISOString()
    };

    await withTransaction(OFFLINE_PROGRESS_STORE, 'readwrite', (store) => store.put(record));
    return true;
  } catch (error) {
    console.error('Failed to add offline progress:', error);
    return false;
  }
}

/**
 * Get all unsynced progress records
 * @returns {Promise<Array>} Array of unsynced progress records
 */
export async function getUnsyncedProgress() {
  if (!isIndexedDBSupported()) {
    return [];
  }

  try {
    return await withCursor(
      OFFLINE_PROGRESS_STORE,
      (store) => store.index('synced').openCursor(IDBKeyRange.only(false))
    );
  } catch (error) {
    console.error('Failed to get unsynced progress:', error);
    return [];
  }
}

/**
 * Mark a progress record as synced
 * @param {string} id - Progress record ID
 * @returns {Promise<boolean>} True if successful
 */
export async function markProgressSynced(id) {
  if (!isIndexedDBSupported()) {
    return false;
  }

  try {
    const db = await getDB();

    return new Promise((resolve, reject) => {
      let settled = false;

      const settle = (fn, value) => {
        if (!settled) {
          settled = true;
          fn(value);
        }
      };

      const transaction = db.transaction(OFFLINE_PROGRESS_STORE, 'readwrite');
      const store = transaction.objectStore(OFFLINE_PROGRESS_STORE);

      const getRequest = store.get(id);

      getRequest.onsuccess = () => {
        const record = getRequest.result;
        if (record) {
          record.synced = true;
          const putRequest = store.put(record);
          putRequest.onsuccess = () => settle(resolve, true);
          putRequest.onerror = () => settle(reject, putRequest.error);
        } else {
          // Record not found, consider it already synced/deleted
          settle(resolve, true);
        }
      };

      getRequest.onerror = () => settle(reject, getRequest.error);
      transaction.onerror = () => settle(reject, transaction.error);
      transaction.onabort = () => settle(reject, transaction.error || new Error('Transaction aborted'));
    });
  } catch (error) {
    console.error('Failed to mark progress synced:', error);
    return false;
  }
}

/**
 * Delete an offline progress record
 * @param {string} id - Progress record ID
 * @returns {Promise<boolean>} True if successful
 */
export async function deleteOfflineProgress(id) {
  if (!isIndexedDBSupported()) {
    return false;
  }

  try {
    await withTransaction(OFFLINE_PROGRESS_STORE, 'readwrite', (store) => store.delete(id));
    return true;
  } catch (error) {
    console.error('Failed to delete offline progress:', error);
    return false;
  }
}

/**
 * Delete all synced progress records (cleanup after sync)
 * @returns {Promise<number>} Number of records deleted
 */
export async function cleanupSyncedProgress() {
  if (!isIndexedDBSupported()) {
    return 0;
  }

  try {
    const db = await getDB();

    return new Promise((resolve, reject) => {
      let settled = false;
      let deleted = 0;

      const settle = (fn, value) => {
        if (!settled) {
          settled = true;
          fn(value);
        }
      };

      const transaction = db.transaction(OFFLINE_PROGRESS_STORE, 'readwrite');
      const store = transaction.objectStore(OFFLINE_PROGRESS_STORE);
      const index = store.index('synced');

      const request = index.openCursor(IDBKeyRange.only(true));

      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          cursor.delete();
          deleted++;
          cursor.continue();
        } else {
          settle(resolve, deleted);
        }
      };

      request.onerror = () => settle(reject, request.error);
      transaction.onerror = () => settle(reject, transaction.error);
      transaction.onabort = () => settle(reject, transaction.error || new Error('Transaction aborted'));
    });
  } catch (error) {
    console.error('Failed to cleanup synced progress:', error);
    return 0;
  }
}

/**
 * Get all progress records for a specific audiobook
 * @param {string|number} audiobookId - Audiobook ID
 * @returns {Promise<Array>} Array of progress records
 */
export async function getProgressForAudiobook(audiobookId) {
  if (!isIndexedDBSupported()) {
    return [];
  }

  try {
    // Ensure string ID for consistency
    const id = String(audiobookId);
    return await withCursor(
      OFFLINE_PROGRESS_STORE,
      (store) => store.index('audiobookId').openCursor(IDBKeyRange.only(id))
    );
  } catch (error) {
    console.error('Failed to get progress for audiobook:', error);
    return [];
  }
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Close the database connection
 * Useful for cleanup or forcing a fresh connection
 */
export function closeDatabase() {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}

/**
 * Delete the entire database
 * Use with caution - this removes all download metadata
 * @returns {Promise<boolean>} True if successful
 */
export async function deleteDatabase() {
  if (!isIndexedDBSupported()) {
    return false;
  }

  // Close existing connection first
  closeDatabase();

  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DB_NAME);

    request.onsuccess = () => {
      resolve(true);
    };

    request.onerror = () => {
      reject(request.error);
    };

    request.onblocked = () => {
      // Database is being used by another tab
      console.warn('Database deletion blocked - close other tabs using this app');
      reject(new Error('Database deletion blocked'));
    };
  });
}

/**
 * Create a new download record with default values
 * @param {Object} audiobook - Audiobook metadata
 * @returns {Object} Download record ready to save
 * @throws {TypeError} If audiobook is null/undefined or missing id
 */
export function createDownloadRecord(audiobook) {
  if (!audiobook || typeof audiobook !== 'object') {
    throw new TypeError('createDownloadRecord: audiobook must be a non-null object');
  }

  if (audiobook.id === undefined || audiobook.id === null) {
    throw new Error('createDownloadRecord: audiobook.id is required');
  }

  const id = String(audiobook.id);

  return {
    id,
    status: 'queued',
    progress: 0,
    bytesDownloaded: 0,
    totalBytes: Number(audiobook.file_size) || 0,
    startedAt: new Date().toISOString(),
    completedAt: null,
    error: null,
    // Cached metadata for offline display
    title: audiobook.title || 'Unknown Title',
    author: audiobook.author || 'Unknown Author',
    narrator: audiobook.narrator || null,
    duration: Number(audiobook.duration) || 0,
    coverUrl: `/api/audiobooks/${id}/cover`
  };
}
