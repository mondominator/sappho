import { useState, useEffect, useRef } from 'react';

/**
 * Restores saved playback position when audio metadata loads,
 * and handles auto-play logic for desktop vs mobile/PWA.
 */
export function usePositionRestoration({
  audioRef,
  audiobook,
  progress,
  setPlaying,
  setCurrentTime
}) {
  const [hasRestoredPosition, setHasRestoredPosition] = useState(false);
  const initialProgressRef = useRef(progress?.position ?? null);
  const [isNewLoad, setIsNewLoad] = useState(() => {
    // Check if this is a page refresh by checking session storage
    // sessionStorage persists during the same tab session but clears on refresh
    try {
      const isSessionActive = sessionStorage.getItem('audioPlayerActive');
      if (isSessionActive === 'true') {
        // Session was active, this is NOT a new load (navigating within app)
        return false;
      } else {
        // No active session marker = page refresh or new load
        // Mark session as active for future navigation
        sessionStorage.setItem('audioPlayerActive', 'true');
        return true;
      }
    } catch (err) {
      console.error('Error checking page refresh state:', err);
      return true; // Default to new load on error
    }
  });

  // Reset state when audiobook changes
  useEffect(() => {
    if (!audiobook || !audiobook.id) return;

    // Check if this is a different audiobook than what was saved
    const savedAudiobookId = localStorage.getItem('currentAudiobookId');
    const isDifferentBook = !savedAudiobookId || parseInt(savedAudiobookId) !== audiobook.id;

    // If _playRequested exists, treat this as a new play request
    const isPlayRequest = audiobook._playRequested !== undefined;

    setIsNewLoad(isDifferentBook || isPlayRequest);
    setHasRestoredPosition(false);

    // Save current audiobook ID
    localStorage.setItem('currentAudiobookId', audiobook.id.toString());
  }, [audiobook.id, audiobook._playRequested]);

  // Restore saved position when metadata loads and auto-play
  useEffect(() => {
    const handleLoadedMetadata = () => {
      if (!hasRestoredPosition && audioRef.current && audiobook && audiobook.id) {
        const audioDuration = audioRef.current.duration;

        // Restore position if available and not finished
        // If position is within 30 seconds of the end, consider it finished and start from beginning
        if (progress && progress.position > 0 && audioDuration) {
          const isFinished = (audioDuration - progress.position) < 30;
          if (!isFinished) {
            audioRef.current.currentTime = progress.position;
          } else {
            // Start from beginning if finished
            audioRef.current.currentTime = 0;
          }
        }
        setHasRestoredPosition(true);

        // Auto-play logic:
        // - On DESKTOP: If new book load, auto-play. If page refresh, only resume if was playing.
        // - On MOBILE/PWA: Never auto-play (even on new book), user must manually press play
        const savedPlaying = localStorage.getItem('playerPlaying');
        const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
        const isPWA = window.matchMedia('(display-mode: standalone)').matches ||
                      window.navigator.standalone === true;

        // Mobile/PWA: Only auto-play if _openFullscreen is true (explicit play from detail page)
        // AND it's a new load (not a page refresh)
        if (isMobile || isPWA) {
          const shouldAutoPlay = audiobook._openFullscreen === true && isNewLoad;
          if (shouldAutoPlay) {
            setTimeout(() => {
              if (audioRef.current) {
                audioRef.current.play().then(() => {
                  setPlaying(true);
                  setIsNewLoad(false);
                  localStorage.setItem('playerPlaying', 'true');
                }).catch(err => {
                  console.warn('Auto-play prevented or failed:', err);
                  setPlaying(false);
                  setIsNewLoad(false);
                });
              }
            }, 100);
          } else {
            setPlaying(false);
            setIsNewLoad(false);
            localStorage.setItem('playerPlaying', 'false');
            if (audioRef.current) {
              audioRef.current.pause();
            }
          }
        }
        // Desktop + New book load: Auto-play
        else if (isNewLoad) {
          setTimeout(() => {
            if (audioRef.current) {
              audioRef.current.play().then(() => {
                setPlaying(true);
                setIsNewLoad(false);
                localStorage.setItem('playerPlaying', 'true');
              }).catch(err => {
                console.warn('Auto-play prevented or failed:', err);
                setPlaying(false);
                setIsNewLoad(false);
              });
            }
          }, 100);
        }
        // Desktop + Page refresh + Was playing: Resume playback
        else if (savedPlaying === 'true') {
          setTimeout(() => {
            if (audioRef.current) {
              audioRef.current.play().then(() => {
                setPlaying(true);
                setIsNewLoad(false);
              }).catch(err => {
                console.warn('Auto-play on refresh prevented:', err);
                setPlaying(false);
                setIsNewLoad(false);
              });
            }
          }, 100);
        }
        // Desktop + Page refresh + Was paused: Stay paused
        else {
          setPlaying(false);
          setIsNewLoad(false);
        }
      }
    };

    const audio = audioRef.current;
    if (audio) {
      audio.addEventListener('loadedmetadata', handleLoadedMetadata);
      return () => audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
    }
  }, [progress, hasRestoredPosition, isNewLoad]);

  // When server progress arrives after initial restoration and differs
  // significantly from the initially restored position, re-seek to the
  // correct position. This handles the case where localStorage had a stale
  // position and the server has a more recent one.
  useEffect(() => {
    if (!hasRestoredPosition || !progress || !audioRef.current) return;
    if (!audioRef.current.duration) return;

    const serverPosition = progress.position;
    const initialPosition = initialProgressRef.current ?? 0;

    // Only re-seek if the server position differs significantly from what
    // was initially restored (meaning localStorage was stale)
    if (Math.abs(serverPosition - initialPosition) > 10) {
      const audioDuration = audioRef.current.duration;
      const isFinished = (audioDuration - serverPosition) < 30;
      if (!isFinished && serverPosition > 0) {
        audioRef.current.currentTime = serverPosition;
        setCurrentTime(serverPosition);
      }
      // Update the ref so we don't re-seek on subsequent renders
      initialProgressRef.current = serverPosition;
    }
  }, [progress, hasRestoredPosition]);

  return { hasRestoredPosition, isNewLoad };
}
