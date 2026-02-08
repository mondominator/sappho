import { useEffect } from 'react';
import { updateProgress } from '../../api';

/**
 * Update progress with error handling (offline-safe)
 */
async function updateProgressSafe(audiobookId, position, completed, state) {
  try {
    await updateProgress(audiobookId, position, completed, state);
  } catch (error) {
    console.error('Error updating progress:', error);
  }
}

/**
 * Hook that syncs playback progress to the server every 5 seconds while playing.
 * Also exposes updateProgressSafe for manual progress updates (pause, stop, close).
 */
export function useProgressSync(audiobookId, playing, audioRef) {
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

    return () => clearInterval(interval);
  }, [audiobookId, playing, audioRef]);

  return { updateProgressSafe };
}
