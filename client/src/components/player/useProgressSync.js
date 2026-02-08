import { useEffect, useRef, useCallback } from 'react';
import { updateProgress } from '../../api';
import { queueProgressUpdate, replayQueue } from '../../utils/offlineQueue';

/**
 * Determine whether a caught error is a network-level failure
 * (no response received, DNS failure, timeout, etc.).
 */
function isNetworkError(error) {
  // Axios wraps network failures with error.code or missing response
  if (error.code === 'ERR_NETWORK' || error.code === 'ECONNABORTED') return true;
  if (!error.response && error.message === 'Network Error') return true;
  // TypeError from fetch-based clients when offline
  if (error instanceof TypeError && error.message === 'Failed to fetch') return true;
  return false;
}

/**
 * Hook that syncs playback progress to the server every 5 seconds while playing.
 * Uses AbortController to cancel in-flight requests before starting new ones,
 * preventing wasted bandwidth and out-of-order updates on slow networks.
 * Also exposes updateProgressSafe for manual progress updates (pause, stop, close).
 *
 * Offline support: when a progress update fails due to a network error (or the
 * browser reports navigator.onLine === false), the update is queued in IndexedDB.
 * When connectivity is restored the queue is replayed so no progress is lost.
 */
export function useProgressSync(audiobookId, playing, audioRef) {
  const abortControllerRef = useRef(null);
  const replayingRef = useRef(false);

  /**
   * Send a progress update directly to the server (no offline fallback).
   * Used both for live updates and for replaying queued entries.
   */
  const sendProgress = useCallback(async (bookId, position, completed, state, signal) => {
    await updateProgress(bookId, position, completed, state, {}, { signal });
  }, []);

  /**
   * Replay any queued offline updates. Guarded so only one replay runs at a time.
   */
  const replayOfflineQueue = useCallback(async () => {
    if (replayingRef.current) return;
    replayingRef.current = true;
    try {
      const count = await replayQueue((bookId, position, completed, state) =>
        sendProgress(bookId, position, completed, state)
      );
      if (count > 0) {
        console.log(`Replayed ${count} offline progress update(s)`);
      }
    } catch (err) {
      console.error('Error replaying offline queue:', err);
    } finally {
      replayingRef.current = false;
    }
  }, [sendProgress]);

  /**
   * Update progress with AbortController-based debouncing.
   * Cancels any in-flight request before starting a new one.
   * Falls back to IndexedDB queue when offline or on network error.
   */
  const updateProgressSafe = useCallback(async (bookId, position, completed, state) => {
    // If the browser is known-offline, queue immediately without attempting a request.
    if (!navigator.onLine) {
      try {
        await queueProgressUpdate(bookId, position, completed, state);
      } catch (queueErr) {
        console.error('Failed to queue offline progress update:', queueErr);
      }
      return;
    }

    // Cancel any in-flight request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      await sendProgress(bookId, position, completed, state, controller.signal);
    } catch (error) {
      if (error.name === 'AbortError' || error.name === 'CanceledError') {
        // Expected when a newer request supersedes this one, ignore
        return;
      }

      // Network failure -- queue for later replay
      if (isNetworkError(error)) {
        try {
          await queueProgressUpdate(bookId, position, completed, state);
        } catch (queueErr) {
          console.error('Failed to queue offline progress update:', queueErr);
        }
        return;
      }

      console.error('Error updating progress:', error);
    } finally {
      // Only clear the ref if this controller is still the current one
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null;
      }
    }
  }, [sendProgress]);

  // Listen for the browser coming back online and replay queued updates.
  useEffect(() => {
    const handleOnline = () => {
      replayOfflineQueue();
    };

    window.addEventListener('online', handleOnline);

    // Also attempt a replay on mount in case the page was reloaded while online
    // but there are leftover queued updates from a previous session.
    replayOfflineQueue();

    return () => {
      window.removeEventListener('online', handleOnline);
    };
  }, [replayOfflineQueue]);

  useEffect(() => {
    const interval = setInterval(() => {
      if (audioRef.current && playing) {
        const currentTime = Math.floor(audioRef.current.currentTime);
        const duration = audioRef.current.duration;
        const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0;
        const isFinished = progressPercent >= 98;
        updateProgressSafe(audiobookId, currentTime, isFinished ? 1 : 0, 'playing');
      }
    }, 5000);

    return () => {
      clearInterval(interval);
      // Abort any in-flight request on cleanup
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [audiobookId, playing, audioRef, updateProgressSafe]);

  return { updateProgressSafe };
}
