const DB_NAME = 'sappho-offline';
const DB_VERSION = 1;
const STORE_NAME = 'progress-queue';

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function queueProgressUpdate(audiobookId, position, completed, state) {
  const db = await openDB();
  const tx = db.transaction(STORE_NAME, 'readwrite');
  tx.objectStore(STORE_NAME).add({
    audiobookId, position, completed, state,
    timestamp: Date.now()
  });
  return new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

export async function getQueuedUpdates() {
  const db = await openDB();
  const tx = db.transaction(STORE_NAME, 'readonly');
  const store = tx.objectStore(STORE_NAME);
  return new Promise((resolve, reject) => {
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function clearQueue() {
  const db = await openDB();
  const tx = db.transaction(STORE_NAME, 'readwrite');
  tx.objectStore(STORE_NAME).clear();
  return new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

export async function replayQueue(updateFn) {
  const updates = await getQueuedUpdates();
  if (updates.length === 0) return 0;

  // Sort by timestamp, keep only the latest per audiobook
  const latestByBook = new Map();
  for (const update of updates) {
    const existing = latestByBook.get(update.audiobookId);
    if (!existing || update.timestamp > existing.timestamp) {
      latestByBook.set(update.audiobookId, update);
    }
  }

  let replayed = 0;
  for (const [, update] of latestByBook) {
    try {
      await updateFn(update.audiobookId, update.position, update.completed, update.state);
      replayed++;
    } catch (err) {
      console.error('Failed to replay progress update:', err);
    }
  }

  await clearQueue();
  return replayed;
}
