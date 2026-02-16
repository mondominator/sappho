import { useState, useRef, useEffect, forwardRef, useImperativeHandle, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { getStreamUrl, getCoverUrl, getChapters } from '../api';
import { formatTime } from '../utils/formatting';
import { useProgressSync } from './player/useProgressSync';
import { useMediaSession } from './player/useMediaSession';
import { useSleepTimer } from './player/useSleepTimer';
import { usePlayerKeyboard } from './player/usePlayerKeyboard';
import { usePositionRestoration } from './player/usePositionRestoration';
import PlaybackControls from './player/PlaybackControls';
import FullscreenPlayer from './player/FullscreenPlayer';
import ChapterModal from './player/ChapterModal';
import SpeedMenu from './player/SpeedMenu';
import SleepTimerMenu from './player/SleepTimerMenu';
import './AudioPlayer.css';


const AudioPlayer = forwardRef(({ audiobook, progress, onClose }, ref) => {
  const navigate = useNavigate();
  const audioRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(() => {
    const saved = localStorage.getItem('playerVolume')
    return saved ? parseFloat(saved) : 1
  });
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [showSpeedMenu, setShowSpeedMenu] = useState(false);
  const [progressDisplayMode, setProgressDisplayMode] = useState(() => {
    return localStorage.getItem('progressDisplayMode') || 'book';
  });
  const [showFullscreen, setShowFullscreen] = useState(false);
  const [chapters, setChapters] = useState([]);
  const [dragStartY, setDragStartY] = useState(0);
  const [dragCurrentY, setDragCurrentY] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState(0);
  const [showChapterModal, setShowChapterModal] = useState(false);
  const [currentChapter, setCurrentChapter] = useState(0);
  const [isBuffering, setIsBuffering] = useState(false);
  const [bufferedPercent, setBufferedPercent] = useState(0);
  const retryCountRef = useRef(0);
  const MAX_RETRIES = 3;
  const [mediaError, setMediaError] = useState(null); // { message, type: 'error'|'warning' }
  const mediaErrorTimerRef = useRef(null);
  const progressBarRef = useRef(null);
  const fullscreenPlayerRef = useRef(null);
  const miniPlayerRef = useRef(null);
  const [isDraggingProgress, setIsDraggingProgress] = useState(false);
  const [seekPreviewTime, setSeekPreviewTime] = useState(null);
  const [seekPreviewPercent, setSeekPreviewPercent] = useState(0);
  const [tooltipPosition, setTooltipPosition] = useState({ x: 0, y: 0 });
  const seekPreviewTimeRef = useRef(null); // Ref to track preview time for event handlers
  const dragStateRef = useRef({ startY: 0, isDragging: false }); // Ref for native event handlers
  const miniTitleRef = useRef(null);

  // Progress sync hook - sends progress every 5s while playing
  const { updateProgressSafe } = useProgressSync(audiobook.id, playing, audioRef);
  const [miniTitleOverflows, setMiniTitleOverflows] = useState(false);

  // Expose closeFullscreen method to parent
  useImperativeHandle(ref, () => ({
    closeFullscreen: () => {
      setShowFullscreen(false);
    }
  }));

  // Define skip/toggle functions before hooks that need them
  const skipBackward = useCallback(() => {
    if (!audioRef.current) return;
    const actualTime = audioRef.current.currentTime;
    const newTime = Math.max(0, actualTime - 15);
    audioRef.current.currentTime = newTime;
    setCurrentTime(newTime);
  }, []);

  const skipForward = useCallback(() => {
    if (!audioRef.current) return;
    const actualTime = audioRef.current.currentTime;
    const audioDuration = audioRef.current.duration || duration;
    const newTime = Math.min(audioDuration, actualTime + 15);
    audioRef.current.currentTime = newTime;
    setCurrentTime(newTime);
  }, [duration]);

  const togglePlay = useCallback(() => {
    if (!audioRef.current) return;

    if (playing) {
      audioRef.current.pause();
      setPlaying(false);
      // Send pause state immediately
      const currentTime = Math.floor(audioRef.current.currentTime);
      const duration = audioRef.current.duration;
      const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0;
      const isFinished = progressPercent >= 98;
      updateProgressSafe(audiobook.id, currentTime, isFinished ? 1 : 0, 'paused');
    } else {
      const playPromise = audioRef.current.play();
      if (playPromise !== undefined) {
        playPromise
          .then(() => {
            setPlaying(true);
            const currentTime = Math.floor(audioRef.current.currentTime);
            const duration = audioRef.current.duration;
            const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0;
            const isFinished = progressPercent >= 98;
            updateProgressSafe(audiobook.id, currentTime, isFinished ? 1 : 0, 'playing');
          })
          .catch(err => {
            console.error('Playback failed:', err);
            setPlaying(false);
          });
      }
    }
  }, [playing, audiobook.id, updateProgressSafe]);

  // --- Extracted hooks ---

  // Media Session API (lock screen controls)
  useMediaSession({
    audiobook,
    audioRef,
    chapters,
    setPlaying,
    setCurrentTime
  });

  // Sleep timer
  const {
    sleepTimer,
    showSleepMenu,
    setShowSleepMenu,
    handleSleepTimer,
    formatSleepTimer
  } = useSleepTimer({
    audioRef,
    audiobook,
    chapters,
    currentChapter,
    currentTime,
    playing,
    setPlaying,
    updateProgressSafe
  });

  // Keyboard shortcuts
  usePlayerKeyboard({ togglePlay, skipBackward, skipForward });

  // Position restoration & auto-play
  usePositionRestoration({
    audioRef,
    audiobook,
    progress,
    setPlaying,
    setCurrentTime
  });

  useEffect(() => {
    if (!audiobook || !audiobook.id) {
      console.error('Invalid audiobook in useEffect');
      return;
    }

    if (audioRef.current) {
      try {
        audioRef.current.src = getStreamUrl(audiobook.id);
        audioRef.current.load();
      } catch (err) {
        console.error('Error initializing audio:', err);
      }
    }

    // Open fullscreen if requested
    if (audiobook._openFullscreen) {
      setShowFullscreen(true);
    }

    // Load chapters for all audiobooks (both embedded chapters in M4B and multi-file)
    getChapters(audiobook.id)
      .then(response => setChapters(response.data || []))
      .catch(err => console.error('Error loading chapters:', err));
  }, [audiobook.id, audiobook._playRequested, audiobook._openFullscreen]);

  // Save playing state to localStorage
  useEffect(() => {
    localStorage.setItem('playerPlaying', playing.toString());
  }, [playing]);

  // Pause audio before page unload/refresh to prevent crashes
  useEffect(() => {
    const handleBeforeUnload = () => {
      if (audioRef.current && playing) {
        audioRef.current.pause();
        // Save the playing state so we can resume after refresh
        localStorage.setItem('playerPlaying', 'true');
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [playing]);

  // Save volume to localStorage
  useEffect(() => {
    localStorage.setItem('playerVolume', volume.toString());
    if (audioRef.current) {
      audioRef.current.volume = volume;
    }
  }, [volume]);

  // 5s progress sync is handled by useProgressSync hook

  // Handle audio interruptions (bluetooth disconnect, phone calls, etc.)
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const handleAudioInterruption = () => {
      setPlaying(false);
      if (audioRef.current) {
        audioRef.current.pause();
        updateProgressSafe(audiobook.id, Math.floor(audioRef.current.currentTime), 0, 'paused');
      }
    };

    // Handle various interruption events
    audio.addEventListener('pause', handleAudioInterruption);
    audio.addEventListener('ended', handleAudioInterruption);

    // Cleanup
    return () => {
      audio.removeEventListener('pause', handleAudioInterruption);
      audio.removeEventListener('ended', handleAudioInterruption);
    };
  }, [audiobook.id]);

  const handleSeek = (e) => {
    const time = parseFloat(e.target.value);
    audioRef.current.currentTime = time;
    setCurrentTime(time);
  };

  const skipToPreviousChapter = () => {
    if (chapters.length === 0) return;

    const prevChapter = Math.max(0, currentChapter - 1);
    const newTime = chapters[prevChapter].start_time;
    audioRef.current.currentTime = newTime;
    setCurrentTime(newTime);
  };

  const skipToNextChapter = () => {
    if (chapters.length === 0) return;

    const nextChapter = Math.min(chapters.length - 1, currentChapter + 1);
    const newTime = chapters[nextChapter].start_time;
    audioRef.current.currentTime = newTime;
    setCurrentTime(newTime);
  };

  const handleSpeedChange = (speed) => {
    setPlaybackSpeed(speed);
    if (audioRef.current) {
      audioRef.current.playbackRate = speed;
    }
    // Save to localStorage for this book
    localStorage.setItem(`playbackSpeed_${audiobook.id}`, speed.toString());
    setShowSpeedMenu(false);
  };

  const handleTimeUpdate = () => {
    const newTime = audioRef.current.currentTime;
    // Only trigger re-render when the second changes (~1x/sec instead of ~4x/sec)
    setCurrentTime(prev => Math.floor(prev) === Math.floor(newTime) ? prev : newTime);
  };

  const handleLoadedMetadata = () => {
    setDuration(audioRef.current.duration);
  };

  const handleVolumeChange = (e) => {
    const vol = parseFloat(e.target.value);
    audioRef.current.volume = vol;
    setVolume(vol);
  };

  const showMediaError = (message, type = 'error') => {
    setMediaError({ message, type });
    if (mediaErrorTimerRef.current) {
      clearTimeout(mediaErrorTimerRef.current);
    }
    mediaErrorTimerRef.current = setTimeout(() => {
      setMediaError(null);
      mediaErrorTimerRef.current = null;
    }, 6000);
  };

  const handleAudioError = () => {
    const error = audioRef.current?.error;
    if (!error) return;

    switch (error.code) {
      case MediaError.MEDIA_ERR_NETWORK:
        if (retryCountRef.current < MAX_RETRIES) {
          retryCountRef.current++;
          console.error(`Network error, retrying (${retryCountRef.current}/${MAX_RETRIES})...`);
          showMediaError(`Network error. Retrying (${retryCountRef.current}/${MAX_RETRIES})...`, 'warning');
          setTimeout(() => {
            if (audioRef.current) {
              const savedTime = audioRef.current.currentTime;
              audioRef.current.load();
              audioRef.current.currentTime = savedTime;
              audioRef.current.play().catch(() => {});
            }
          }, 2000);
        } else {
          console.error('Network error: unable to load audio after retries');
          showMediaError('Network error: unable to load audio after multiple retries.', 'error');
          setPlaying(false);
        }
        break;
      case MediaError.MEDIA_ERR_DECODE:
        console.error('Decode error: audio file may be corrupted');
        showMediaError('Playback error: this audio file may be corrupted.', 'error');
        setPlaying(false);
        break;
      case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED:
        console.error('Format not supported');
        showMediaError('This audio format is not supported by your browser.', 'error');
        setPlaying(false);
        break;
      default:
        console.error('Unknown media error:', error.code);
        break;
    }
  };

  const handlePlayingEvent = () => {
    retryCountRef.current = 0;
    setIsBuffering(false);
  };

  const formatTimeShort = formatTime;


  // Calculate chapter progress for chapter display mode
  const getChapterProgress = () => {
    if (chapters.length === 0 || progressDisplayMode !== 'chapter') {
      return null;
    }

    const chapter = chapters[currentChapter];
    const nextChapter = chapters[currentChapter + 1];
    const chapterStart = chapter?.start_time || 0;
    const chapterEnd = nextChapter ? nextChapter.start_time : duration;
    const chapterDuration = chapterEnd - chapterStart;
    const chapterPosition = currentTime - chapterStart;

    return {
      position: Math.max(0, chapterPosition),
      duration: chapterDuration,
      percent: chapterDuration > 0 ? (chapterPosition / chapterDuration) * 100 : 0
    };
  };

  const chapterProgress = getChapterProgress();

  const handleClose = () => {
    // Stop playback and send stopped state when closing the player
    if (audioRef.current) {
      const currentPosition = Math.floor(audioRef.current.currentTime);
      const duration = audioRef.current.duration;
      const progressPercent = duration > 0 ? (currentPosition / duration) * 100 : 0;
      const isFinished = progressPercent >= 98;
      audioRef.current.pause();
      setPlaying(false);
      updateProgressSafe(audiobook.id, currentPosition, isFinished ? 1 : 0, 'stopped');
    }
    onClose();
  };

  // Drag handlers for mini player swipe-up gesture
  const handleMiniPlayerTouchStart = (e) => {
    const target = e.target;

    // Don't intercept touches on progress bar (it handles seeking) or buttons
    if (target.closest('.player-progress') ||
        target.closest('.player-mobile-controls') ||
        target.closest('button')) {
      return;
    }

    setDragStartY(e.touches[0].clientY);
    setDragCurrentY(e.touches[0].clientY);
    setIsDragging(true);
  };

  const handleMiniPlayerTouchMove = (e) => {
    if (!isDragging) return;
    const currentY = e.touches[0].clientY;
    setDragCurrentY(currentY);
    const offset = currentY - dragStartY;
    setDragOffset(offset);
  };

  const handleMiniPlayerTouchEnd = () => {
    if (!isDragging) return;
    const dragDistance = dragStartY - dragCurrentY;

    // If dragged up more than 80px, open fullscreen
    if (dragDistance > 80) {
      setShowFullscreen(true);
    }

    setIsDragging(false);
    setDragStartY(0);
    setDragCurrentY(0);
    setDragOffset(0);
  };

  // Drag handlers for fullscreen swipe-down gesture
  const handleFullscreenTouchStart = (e) => {
    const target = e.target;

    // Don't handle swipe if touching progress bar, controls, bottom bar, or buttons
    if (target.closest('.fullscreen-progress') ||
        target.closest('.fullscreen-controls') ||
        target.closest('.fullscreen-bottom-bar') ||
        target.closest('button')) {
      return;
    }

    e.preventDefault(); // Prevent pull-to-refresh
    setDragStartY(e.touches[0].clientY);
    setDragCurrentY(e.touches[0].clientY);
    setIsDragging(true);
  };

  const handleFullscreenTouchMove = (e) => {
    if (!isDragging) return;
    e.preventDefault(); // Prevent pull-to-refresh
    const currentY = e.touches[0].clientY;
    setDragCurrentY(currentY);
    const offset = currentY - dragStartY;
    setDragOffset(offset);
  };

  const handleFullscreenTouchEnd = () => {
    if (!isDragging) return;
    const dragDistance = dragStartY - dragCurrentY;

    // If dragged down more than 100px, close fullscreen
    if (dragDistance < -100) {
      setShowFullscreen(false);
    }

    setIsDragging(false);
    setDragStartY(0);
    setDragCurrentY(0);
    setDragOffset(0);
  };

  // Progress bar drag handlers - show preview during drag, seek on release
  const calculateSeekPosition = (clientX, barRef) => {
    if (!barRef?.current || !duration) return null;
    const rect = barRef.current.getBoundingClientRect();
    const x = clientX - rect.left;
    const percentage = Math.max(0, Math.min(1, x / rect.width));

    // In chapter mode, seek within the current chapter's time range
    if (progressDisplayMode === 'chapter' && chapters.length > 0) {
      const chapter = chapters[currentChapter];
      const nextChapter = chapters[currentChapter + 1];
      const chapterStart = chapter?.start_time || 0;
      const chapterEnd = nextChapter ? nextChapter.start_time : duration;
      const chapterDuration = chapterEnd - chapterStart;
      const seekTime = chapterStart + (percentage * chapterDuration);
      return { time: seekTime, percent: percentage * 100 };
    }

    // Default: seek within full book duration
    return { time: percentage * duration, percent: percentage * 100 };
  };

  const handleProgressMouseDown = (e) => {
    const pos = calculateSeekPosition(e.clientX, progressBarRef);
    if (pos && progressBarRef.current) {
      const rect = progressBarRef.current.getBoundingClientRect();
      const tooltipX = rect.left + (pos.percent / 100 * rect.width);
      const tooltipY = rect.top - 10;
      setTooltipPosition({ x: tooltipX, y: tooltipY });
      seekPreviewTimeRef.current = pos.time;
      setSeekPreviewTime(pos.time);
      setSeekPreviewPercent(pos.percent);
      setIsDraggingProgress(true);
    }
  };



  // Global event listeners for mini player progress bar dragging
  useEffect(() => {
    if (!isDraggingProgress || showFullscreen) return;

    const currentDuration = duration;
    const miniBar = progressBarRef.current;

    const updatePreview = (clientX) => {
      if (!miniBar || !currentDuration) return;
      const rect = miniBar.getBoundingClientRect();
      const x = clientX - rect.left;
      const percentage = Math.max(0, Math.min(1, x / rect.width));
      const newTime = percentage * currentDuration;

      seekPreviewTimeRef.current = newTime;
      setSeekPreviewTime(newTime);
      setSeekPreviewPercent(percentage * 100);

      const tooltipX = rect.left + (percentage * rect.width);
      const tooltipY = rect.top - 10;
      setTooltipPosition({ x: tooltipX, y: tooltipY });
    };

    const handleMouseMove = (e) => updatePreview(e.clientX);

    const handleTouchMove = (e) => {
      e.preventDefault();
      updatePreview(e.touches[0].clientX);
    };

    const handleEnd = () => {
      const previewTime = seekPreviewTimeRef.current;
      if (previewTime !== null && audioRef.current) {
        audioRef.current.currentTime = previewTime;
        setCurrentTime(previewTime);
      }
      setIsDraggingProgress(false);
      setSeekPreviewTime(null);
      seekPreviewTimeRef.current = null;
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleEnd);
    document.addEventListener('touchmove', handleTouchMove, { passive: false });
    document.addEventListener('touchend', handleEnd);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleEnd);
      document.removeEventListener('touchmove', handleTouchMove);
      document.removeEventListener('touchend', handleEnd);
    };
  }, [isDraggingProgress, duration, showFullscreen]);

  // Pull-to-refresh prevention is now handled via inline handlers on the fullscreen element
  // This avoids global document listeners that could interfere with page scrolling

  // Update current chapter based on playback time
  useEffect(() => {
    if (chapters.length === 0) return;

    const currentChapterIndex = chapters.findIndex((chapter, index) => {
      const nextChapter = chapters[index + 1];
      return currentTime >= chapter.start_time &&
             (!nextChapter || currentTime < nextChapter.start_time);
    });

    if (currentChapterIndex !== -1) {
      setCurrentChapter(currentChapterIndex);
    }
  }, [currentTime, chapters]);


  // Listen for player settings changes from Profile page
  useEffect(() => {
    const handleSettingsChange = () => {
      setProgressDisplayMode(localStorage.getItem('progressDisplayMode') || 'book');
    };

    window.addEventListener('playerSettingsChanged', handleSettingsChange);
    return () => window.removeEventListener('playerSettingsChanged', handleSettingsChange);
  }, []);

  // Load and save playback speed per audiobook
  useEffect(() => {
    if (!audiobook?.id) return;

    // Load saved speed for this book
    const savedSpeed = localStorage.getItem(`playbackSpeed_${audiobook.id}`);
    if (savedSpeed) {
      const speed = parseFloat(savedSpeed);
      setPlaybackSpeed(speed);
      if (audioRef.current) {
        audioRef.current.playbackRate = speed;
      }
    } else {
      // Reset to 1x for new books without saved speed
      setPlaybackSpeed(1);
      if (audioRef.current) {
        audioRef.current.playbackRate = 1;
      }
    }
  }, [audiobook?.id]);

  // Apply playback speed when audio element is ready
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.playbackRate = playbackSpeed;
    }
  }, [playbackSpeed]);

  // Detect mini player title overflow for marquee animation
  useEffect(() => {
    const checkOverflow = () => {
      if (miniTitleRef.current) {
        const container = miniTitleRef.current;
        const content = container.querySelector('.marquee-content');
        if (content) {
          const hasMarquee = miniTitleOverflows;
          const singleTitleWidth = hasMarquee ? content.scrollWidth / 2.1 : content.scrollWidth;
          setMiniTitleOverflows(singleTitleWidth > container.clientWidth);
        }
      }
    };

    const timeout = setTimeout(checkOverflow, 100);
    window.addEventListener('resize', checkOverflow);

    return () => {
      clearTimeout(timeout);
      window.removeEventListener('resize', checkOverflow);
    };
  }, [audiobook?.title, miniTitleOverflows]);

  // Native touch event listeners for mini player progress bar (with passive: false for iOS)
  useEffect(() => {
    const miniBar = progressBarRef.current;
    if (!miniBar || showFullscreen) return;

    let isSeeking = false;

    const getSeekPosition = (clientX) => {
      if (!miniBar || !duration) return null;
      const rect = miniBar.getBoundingClientRect();
      const x = clientX - rect.left;
      const percentage = Math.max(0, Math.min(1, x / rect.width));
      return { time: percentage * duration, percent: percentage * 100 };
    };

    const handleTouchStart = (e) => {
      e.stopPropagation();
      e.preventDefault();
      isSeeking = true;
      const pos = getSeekPosition(e.touches[0].clientX);
      if (pos) {
        seekPreviewTimeRef.current = pos.time;
        setSeekPreviewTime(pos.time);
        setSeekPreviewPercent(pos.percent);
        setIsDraggingProgress(true);
        const rect = miniBar.getBoundingClientRect();
        setTooltipPosition({
          x: rect.left + (pos.percent / 100 * rect.width),
          y: rect.top - 10
        });
      }
    };

    const handleTouchMove = (e) => {
      if (!isSeeking) return;
      e.preventDefault();
      const pos = getSeekPosition(e.touches[0].clientX);
      if (pos) {
        seekPreviewTimeRef.current = pos.time;
        setSeekPreviewTime(pos.time);
        setSeekPreviewPercent(pos.percent);
        const rect = miniBar.getBoundingClientRect();
        setTooltipPosition({
          x: rect.left + (pos.percent / 100 * rect.width),
          y: rect.top - 10
        });
      }
    };

    const handleTouchEnd = () => {
      if (!isSeeking) return;
      isSeeking = false;
      const previewTime = seekPreviewTimeRef.current;
      if (previewTime !== null && audioRef.current) {
        audioRef.current.currentTime = previewTime;
        setCurrentTime(previewTime);
      }
      setIsDraggingProgress(false);
      setSeekPreviewTime(null);
      seekPreviewTimeRef.current = null;
    };

    miniBar.addEventListener('touchstart', handleTouchStart, { passive: false });
    miniBar.addEventListener('touchmove', handleTouchMove, { passive: false });
    miniBar.addEventListener('touchend', handleTouchEnd);

    return () => {
      miniBar.removeEventListener('touchstart', handleTouchStart);
      miniBar.removeEventListener('touchmove', handleTouchMove);
      miniBar.removeEventListener('touchend', handleTouchEnd);
    };
  }, [duration, showFullscreen]);

  // Cleanup media error toast timer on unmount
  useEffect(() => {
    return () => {
      if (mediaErrorTimerRef.current) {
        clearTimeout(mediaErrorTimerRef.current);
      }
    };
  }, []);

  // Native event listeners for fullscreen swipe-down gesture (with passive: false for iOS)
  useEffect(() => {
    const element = fullscreenPlayerRef.current;
    if (!element || !showFullscreen) return;

    const handleTouchStart = (e) => {
      const target = e.target;
      // Don't handle swipe if touching progress bar, controls, bottom bar, or buttons
      if (target.closest('.fullscreen-progress') ||
          target.closest('.fullscreen-controls') ||
          target.closest('.fullscreen-bottom-bar') ||
          target.closest('button')) {
        return;
      }
      e.preventDefault();
      dragStateRef.current = { startY: e.touches[0].clientY, isDragging: true };
      setDragStartY(e.touches[0].clientY);
      setDragCurrentY(e.touches[0].clientY);
      setIsDragging(true);
    };

    const handleTouchMove = (e) => {
      if (!dragStateRef.current.isDragging) return;
      e.preventDefault();
      const currentY = e.touches[0].clientY;
      setDragCurrentY(currentY);
      setDragOffset(currentY - dragStateRef.current.startY);
    };

    const handleTouchEnd = () => {
      if (!dragStateRef.current.isDragging) return;
      const dragDistance = dragStateRef.current.startY - dragCurrentY;
      if (dragDistance < -100) {
        setShowFullscreen(false);
      }
      dragStateRef.current = { startY: 0, isDragging: false };
      setIsDragging(false);
      setDragStartY(0);
      setDragCurrentY(0);
      setDragOffset(0);
    };

    element.addEventListener('touchstart', handleTouchStart, { passive: false });
    element.addEventListener('touchmove', handleTouchMove, { passive: false });
    element.addEventListener('touchend', handleTouchEnd);

    return () => {
      element.removeEventListener('touchstart', handleTouchStart);
      element.removeEventListener('touchmove', handleTouchMove);
      element.removeEventListener('touchend', handleTouchEnd);
    };
  }, [showFullscreen, dragCurrentY]);

  return (
    <>
    {/* Media error toast notification */}
    {mediaError && (
      <div
        className={`media-error-toast ${mediaError.type}`}
        onClick={() => setMediaError(null)}
      >
        {mediaError.message}
      </div>
    )}

    <div
      ref={miniPlayerRef}
      className="audio-player"
      role="region"
      aria-label={`Now playing: ${audiobook.title}`}
      style={{
        transform: !showFullscreen && isDragging ? `translateY(${Math.min(0, dragOffset)}px)` : 'none',
        transition: isDragging ? 'none' : 'transform 0.3s ease-out',
        position: 'fixed',
        bottom: 0,
        display: showFullscreen ? 'none' : 'block'
      }}
    >
      <audio
        ref={audioRef}
        preload="auto"
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={handleLoadedMetadata}
        onEnded={() => {
          setPlaying(false);
          // Mark as finished (100% completion)
          updateProgressSafe(audiobook.id, Math.floor(audioRef.current.currentTime), 1, 'stopped');
          // Close fullscreen player if open
          if (showFullscreen) {
            setShowFullscreen(false);
          }
        }}
        onError={handleAudioError}
        onWaiting={() => setIsBuffering(true)}
        onCanPlay={() => setIsBuffering(false)}
        onPlaying={handlePlayingEvent}
        onProgress={() => {
          // Update buffered percentage
          if (audioRef.current && audioRef.current.buffered.length > 0 && audioRef.current.duration) {
            const bufferedEnd = audioRef.current.buffered.end(audioRef.current.buffered.length - 1);
            const percent = (bufferedEnd / audioRef.current.duration) * 100;
            setBufferedPercent(Math.min(100, percent));
          }
        }}
      />

      <div className="player-info">
        {audiobook.cover_image && (
          <img
            src={getCoverUrl(audiobook.id, null, 120)}
            alt={`${audiobook.title} by ${audiobook.author || 'Unknown Author'}`}
            className="player-cover"
            onClick={(e) => {
              if (window.innerWidth > 768) {
                navigate(`/audiobook/${audiobook.id}`);
              } else {
                setShowFullscreen(true);
              }
            }}
            onError={(e) => e.target.style.display = 'none'}
          />
        )}
        <div className="player-text">
          <div
            ref={miniTitleRef}
            className={`player-title ${miniTitleOverflows ? 'marquee' : ''}`}
            onClick={(e) => {
              if (window.innerWidth > 768) {
                navigate(`/audiobook/${audiobook.id}`);
              } else {
                setShowFullscreen(true);
              }
            }}
          >
            <span className="marquee-content">
              {audiobook.title}
              {miniTitleOverflows && (
                <>
                  <span className="marquee-spacer"> • </span>
                  {audiobook.title}
                </>
              )}
            </span>
          </div>
          {audiobook.series && (
            <div className="player-series" onClick={(e) => {
              if (window.innerWidth > 768) {
                e.stopPropagation();
                navigate(`/series/${encodeURIComponent(audiobook.series)}`);
              } else {
                setShowFullscreen(true);
              }
            }}>
              {audiobook.series}{(audiobook.series_index || audiobook.series_position) ? ` • Book ${audiobook.series_index || audiobook.series_position}` : ''}
            </div>
          )}
          <div className="player-author" onClick={(e) => {
            if (window.innerWidth > 768) {
              e.stopPropagation();
              navigate(`/author/${encodeURIComponent(audiobook.author || 'Unknown Author')}`);
            } else {
              setShowFullscreen(true);
            }
          }}>
            {audiobook.author || 'Unknown Author'}
          </div>
          <div className="player-metadata">
            <div className={`metadata-time ${playing ? 'playing' : ''}`} aria-live="polite" aria-atomic="true">
              {chapterProgress
                ? `${formatTimeShort(chapterProgress.position)} / ${formatTimeShort(chapterProgress.duration)}`
                : `${formatTimeShort(currentTime)} / ${formatTimeShort(duration)}`
              }
            </div>
          </div>
        </div>
        <div className="player-mobile-controls" onClick={(e) => e.stopPropagation()}>
          {chapters.length > 0 && (
            <button
              className="desktop-chapter-indicator"
              onClick={(e) => {
                e.stopPropagation();
                setShowChapterModal(true);
              }}
            >
              {chapters[currentChapter]?.title || ''}
            </button>
          )}
          <div className={`mobile-time-display ${playing ? 'playing' : ''}`}>
            <div>
              {chapterProgress
                ? `${formatTimeShort(chapterProgress.position)} / ${formatTimeShort(chapterProgress.duration)}`
                : `${formatTimeShort(currentTime)} / ${formatTimeShort(duration)}`
              }
            </div>
          </div>
          {chapters.length > 0 && (
            <>
              <button className="control-btn chapter-skip-btn" onClick={skipToPreviousChapter} disabled={currentChapter === 0} title="Previous Chapter" aria-label="Previous chapter">
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="19 20 9 12 19 4 19 20"></polygon>
                  <line x1="5" y1="19" x2="5" y2="5"></line>
                </svg>
              </button>
              <button className="control-btn chapter-skip-btn" onClick={skipToNextChapter} disabled={currentChapter === chapters.length - 1} title="Next Chapter" aria-label="Next chapter">
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="5 4 15 12 5 20 5 4"></polygon>
                  <line x1="19" y1="5" x2="19" y2="19"></line>
                </svg>
              </button>
            </>
          )}
          <button className="control-btn mobile-seek-btn" onClick={skipBackward} title="Rewind 15s" aria-label="Rewind 15 seconds">
            <svg xmlns="http://www.w3.org/2000/svg" width="42" height="42" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="0.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path>
              <path d="M3 3v5h5"></path>
              <text x="12" y="15.5" fontSize="6" fill="currentColor" textAnchor="middle" fontWeight="100" fontFamily="system-ui, -apple-system, sans-serif">15</text>
            </svg>
          </button>
          <button className={`control-btn play-btn mobile-play-btn ${playing ? 'playing' : ''} ${isBuffering ? 'buffering' : ''}`} onClick={togglePlay} title={playing ? 'Pause' : 'Play'} aria-label={playing ? 'Pause' : 'Play'}>
            {isBuffering ? (
              <svg className="buffering-spinner" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
              </svg>
            ) : playing ? (
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor" stroke="none">
                <rect x="6" y="4" width="4" height="16"></rect>
                <rect x="14" y="4" width="4" height="16"></rect>
              </svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor" stroke="none">
                <polygon points="6 3 20 12 6 21 6 3"></polygon>
              </svg>
            )}
          </button>
          <button className="control-btn mobile-seek-btn" onClick={skipForward} title="Forward 15s" aria-label="Forward 15 seconds">
            <svg xmlns="http://www.w3.org/2000/svg" width="42" height="42" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="0.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"></path>
              <path d="M21 3v5h-5"></path>
              <text x="12" y="15.5" fontSize="6" fill="currentColor" textAnchor="middle" fontWeight="100" fontFamily="system-ui, -apple-system, sans-serif">15</text>
            </svg>
          </button>
        </div>
      </div>

      <PlaybackControls
        variant="desktop"
        playing={playing}
        isBuffering={isBuffering}
        chapters={chapters}
        currentChapter={currentChapter}
        onTogglePlay={togglePlay}
        onSkipBackward={skipBackward}
        onSkipForward={skipForward}
        onSkipToPreviousChapter={skipToPreviousChapter}
        onSkipToNextChapter={skipToNextChapter}
      />

      <div className="player-actions">
        <button className="btn-close" onClick={handleClose} title="Close Player" aria-label="Close player">
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      </div>

      <div
        ref={progressBarRef}
        className={`player-progress ${isDraggingProgress && !showFullscreen ? 'dragging' : ''}`}
        style={{
          '--progress-percent': `${chapterProgress ? chapterProgress.percent : (duration ? (currentTime / duration) * 100 : 0)}%`,
          '--preview-percent': `${seekPreviewPercent}%`,
          '--buffered-percent': `${bufferedPercent}%`
        }}
        onMouseDown={handleProgressMouseDown}
      >
        <div className="progress-buffered"></div>
        <div className="progress-thumb"></div>
        <span className="time-display">
          {chapterProgress
            ? `${formatTime(chapterProgress.position)} / ${formatTime(chapterProgress.duration)}`
            : `${formatTime(currentTime)} / ${formatTime(duration)}`
          }
        </span>
        <input
          type="range"
          min="0"
          max={duration || 0}
          value={currentTime}
          onChange={handleSeek}
          className="progress-slider"
          aria-label="Playback position"
          aria-valuemin={0}
          aria-valuemax={duration || 0}
          aria-valuenow={Math.floor(currentTime)}
          aria-valuetext={`${formatTime(currentTime)} of ${formatTime(duration)}`}
        />
      </div>

      {/* Seek preview tooltip - rendered outside progress bar to avoid clipping */}
      {isDraggingProgress && !showFullscreen && seekPreviewTime !== null && (
        <div
          className="seek-preview-tooltip-fixed"
          style={{
            position: 'fixed',
            left: `${tooltipPosition.x}px`,
            top: `${tooltipPosition.y}px`,
            transform: 'translate(-50%, -100%)',
            zIndex: 9999
          }}
        >
          {formatTime(seekPreviewTime)}
        </div>
      )}

    </div>

      {/* Chapter Modal */}
      {showChapterModal && chapters.length > 0 && (
        <ChapterModal
          chapters={chapters}
          currentTime={currentTime}
          duration={duration}
          onSeek={(time) => {
            audioRef.current.currentTime = time;
            setCurrentTime(time);
          }}
          onClose={() => setShowChapterModal(false)}
          formatTime={formatTime}
        />
      )}

      {/* Fullscreen Player */}
      {showFullscreen && (
        <FullscreenPlayer
          audiobook={audiobook}
          audioRef={audioRef}
          playing={playing}
          currentTime={currentTime}
          duration={duration}
          chapters={chapters}
          currentChapter={currentChapter}
          isBuffering={isBuffering}
          bufferedPercent={bufferedPercent}
          playbackSpeed={playbackSpeed}
          sleepTimer={sleepTimer}
          chapterProgress={chapterProgress}
          progress={progress}
          showFullscreen={showFullscreen}
          onTogglePlay={togglePlay}
          onSkipBackward={skipBackward}
          onSkipForward={skipForward}
          onSkipToPreviousChapter={skipToPreviousChapter}
          onSkipToNextChapter={skipToNextChapter}
          onShowSpeedMenu={() => setShowSpeedMenu(true)}
          onShowSleepMenu={() => setShowSleepMenu(true)}
          onShowChapterModal={() => setShowChapterModal(true)}
          onClose={() => setShowFullscreen(false)}
          onSeek={(time) => {
            if (audioRef.current) {
              audioRef.current.currentTime = time;
              setCurrentTime(time);
            }
          }}
          formatTime={formatTime}
          formatSleepTimer={formatSleepTimer}
          fullscreenPlayerRef={fullscreenPlayerRef}
        />
      )}

      {/* Speed selection menu */}
      {showSpeedMenu && (
        <SpeedMenu
          currentSpeed={playbackSpeed}
          onSelect={handleSpeedChange}
          onClose={() => setShowSpeedMenu(false)}
        />
      )}

      {/* Sleep timer menu */}
      {showSleepMenu && (
        <SleepTimerMenu
          sleepTimer={sleepTimer}
          hasChapters={chapters.length > 0}
          onSelect={handleSleepTimer}
          onClose={() => setShowSleepMenu(false)}
        />
      )}
    </>
  );
});

AudioPlayer.displayName = 'AudioPlayer';

export default AudioPlayer;
