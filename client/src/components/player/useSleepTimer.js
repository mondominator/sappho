import { useState, useRef, useEffect } from 'react';

/**
 * Manages sleep timer state and countdown logic.
 * Supports timed sleep (in minutes) and "end of chapter" mode.
 */
export function useSleepTimer({
  audioRef,
  audiobook,
  chapters,
  currentChapter,
  currentTime,
  playing,
  setPlaying,
  updateProgressSafe
}) {
  const [sleepTimer, setSleepTimer] = useState(null); // minutes remaining or 'chapter'
  const [sleepTimerEnd, setSleepTimerEnd] = useState(null); // timestamp when timer ends
  const [showSleepMenu, setShowSleepMenu] = useState(false);
  const sleepTimerIntervalRef = useRef(null);

  const handleSleepTimer = (minutes) => {
    if (minutes === null) {
      // Cancel timer
      setSleepTimer(null);
      setSleepTimerEnd(null);
    } else if (minutes === 'chapter') {
      setSleepTimer('chapter');
      setSleepTimerEnd(null);
    } else {
      setSleepTimer(minutes);
      setSleepTimerEnd(Date.now() + minutes * 60000);
    }
    setShowSleepMenu(false);
  };

  const formatSleepTimer = () => {
    if (sleepTimer === 'chapter') return 'End of chapter';
    if (sleepTimer === null) return null;
    if (sleepTimer >= 60) {
      const hours = Math.floor(sleepTimer / 60);
      const mins = sleepTimer % 60;
      return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
    }
    return `${sleepTimer}m`;
  };

  // Sleep timer countdown
  useEffect(() => {
    // Clear any existing interval
    if (sleepTimerIntervalRef.current) {
      clearInterval(sleepTimerIntervalRef.current);
      sleepTimerIntervalRef.current = null;
    }

    if (sleepTimer === null || sleepTimer === 'chapter') {
      return;
    }

    // Update timer every second
    sleepTimerIntervalRef.current = setInterval(() => {
      if (!sleepTimerEnd) return;

      const remaining = Math.max(0, Math.ceil((sleepTimerEnd - Date.now()) / 60000));

      if (remaining <= 0) {
        // Timer expired - pause playback
        if (audioRef.current && playing) {
          audioRef.current.pause();
          setPlaying(false);
          updateProgressSafe(audiobook.id, Math.floor(audioRef.current.currentTime), 0, 'paused');
        }
        setSleepTimer(null);
        setSleepTimerEnd(null);
        clearInterval(sleepTimerIntervalRef.current);
        sleepTimerIntervalRef.current = null;
      } else if (remaining !== sleepTimer) {
        setSleepTimer(remaining);
      }
    }, 1000);

    return () => {
      if (sleepTimerIntervalRef.current) {
        clearInterval(sleepTimerIntervalRef.current);
        sleepTimerIntervalRef.current = null;
      }
    };
  }, [sleepTimer, sleepTimerEnd, playing, audiobook?.id]);

  // Handle "end of chapter" sleep timer
  useEffect(() => {
    if (sleepTimer !== 'chapter' || !chapters.length) return;

    const nextChapter = chapters[currentChapter + 1];

    if (nextChapter && currentTime >= nextChapter.start_time - 0.5) {
      // We've reached the next chapter - pause
      if (audioRef.current && playing) {
        audioRef.current.pause();
        setPlaying(false);
        updateProgressSafe(audiobook.id, Math.floor(audioRef.current.currentTime), 0, 'paused');
      }
      setSleepTimer(null);
    }
  }, [currentTime, currentChapter, chapters, sleepTimer, playing, audiobook?.id]);

  return {
    sleepTimer,
    showSleepMenu,
    setShowSleepMenu,
    handleSleepTimer,
    formatSleepTimer
  };
}
