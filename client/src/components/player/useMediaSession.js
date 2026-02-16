import { useEffect } from 'react';
import { getCoverUrl } from '../../api';

/**
 * Set up Media Session API for OS-level media controls
 * (lock screen, notification shade, bluetooth headset buttons, etc.)
 */
export function useMediaSession({
  audiobook,
  audioRef,
  chapters,
  setPlaying,
  setCurrentTime
}) {
  useEffect(() => {
    if ('mediaSession' in navigator && audiobook) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: audiobook.title || 'Unknown Title',
        artist: audiobook.author || 'Unknown Author',
        album: audiobook.series || 'Audiobook',
        artwork: audiobook.cover_image ? [
          { src: getCoverUrl(audiobook.id, null, 600), sizes: '512x512', type: 'image/jpeg' }
        ] : []
      });

      navigator.mediaSession.setActionHandler('play', () => {
        if (audioRef.current) {
          audioRef.current.play();
          setPlaying(true);
        }
      });

      navigator.mediaSession.setActionHandler('pause', () => {
        if (audioRef.current) {
          audioRef.current.pause();
          setPlaying(false);
        }
      });

      // Use inline handlers with audioRef to avoid stale state from rapid taps
      navigator.mediaSession.setActionHandler('seekbackward', () => {
        if (!audioRef.current) return;
        const actualTime = audioRef.current.currentTime;
        const newTime = Math.max(0, actualTime - 15);
        audioRef.current.currentTime = newTime;
        setCurrentTime(newTime);
      });

      navigator.mediaSession.setActionHandler('seekforward', () => {
        if (!audioRef.current) return;
        const actualTime = audioRef.current.currentTime;
        const audioDuration = audioRef.current.duration || 0;
        const newTime = Math.min(audioDuration, actualTime + 15);
        audioRef.current.currentTime = newTime;
        setCurrentTime(newTime);
      });

      navigator.mediaSession.setActionHandler('previoustrack', () => {
        if (!audioRef.current) return;
        const actualTime = audioRef.current.currentTime;

        // If near the beginning (< 5 seconds), just skip back 15s instead of restarting
        if (actualTime < 5) {
          const newTime = Math.max(0, actualTime - 15);
          audioRef.current.currentTime = newTime;
          setCurrentTime(newTime);
          return;
        }

        if (chapters.length > 0) {
          // Find current chapter based on actual time
          const currentChapterIndex = chapters.findIndex((chapter, index) => {
            const nextChapter = chapters[index + 1];
            return actualTime >= chapter.start_time &&
                   (!nextChapter || actualTime < nextChapter.start_time);
          });

          // If at the beginning of current chapter (< 3 seconds in), go to previous chapter
          // Otherwise, go to start of current chapter
          const chapter = chapters[currentChapterIndex];
          const timeIntoChapter = actualTime - (chapter?.start_time || 0);

          if (timeIntoChapter < 3 && currentChapterIndex > 0) {
            // Go to previous chapter
            const prevChapter = chapters[currentChapterIndex - 1];
            audioRef.current.currentTime = prevChapter.start_time;
            setCurrentTime(prevChapter.start_time);
          } else if (chapter) {
            // Go to start of current chapter
            audioRef.current.currentTime = chapter.start_time;
            setCurrentTime(chapter.start_time);
          }
        } else {
          // No chapters - skip back 15 seconds
          const newTime = Math.max(0, actualTime - 15);
          audioRef.current.currentTime = newTime;
          setCurrentTime(newTime);
        }
      });

      navigator.mediaSession.setActionHandler('nexttrack', () => {
        if (!audioRef.current) return;

        if (chapters.length > 0) {
          const actualTime = audioRef.current.currentTime;

          // Find current chapter based on actual time
          const currentChapterIndex = chapters.findIndex((chapter, index) => {
            const nextChapter = chapters[index + 1];
            return actualTime >= chapter.start_time &&
                   (!nextChapter || actualTime < nextChapter.start_time);
          });

          if (currentChapterIndex !== -1 && currentChapterIndex < chapters.length - 1) {
            const nextChapter = chapters[currentChapterIndex + 1];
            audioRef.current.currentTime = nextChapter.start_time;
            setCurrentTime(nextChapter.start_time);
          }
        } else {
          // No chapters - skip forward 15 seconds
          const actualTime = audioRef.current.currentTime;
          const audioDuration = audioRef.current.duration || 0;
          const newTime = Math.min(audioDuration, actualTime + 15);
          audioRef.current.currentTime = newTime;
          setCurrentTime(newTime);
        }
      });
    }

    return () => {
      if ('mediaSession' in navigator) {
        navigator.mediaSession.metadata = null;
        navigator.mediaSession.setActionHandler('play', null);
        navigator.mediaSession.setActionHandler('pause', null);
        navigator.mediaSession.setActionHandler('seekbackward', null);
        navigator.mediaSession.setActionHandler('seekforward', null);
        navigator.mediaSession.setActionHandler('previoustrack', null);
        navigator.mediaSession.setActionHandler('nexttrack', null);
      }
    };
  }, [audiobook, chapters]);
}
