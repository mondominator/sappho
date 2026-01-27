import { useState, useRef, useEffect, forwardRef, useImperativeHandle } from 'react';
import { useNavigate } from 'react-router-dom';
import { getStreamUrl, updateProgress, getCoverUrl, getChapters } from '../api';
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
  const [hasRestoredPosition, setHasRestoredPosition] = useState(false);
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
  const [showFullscreen, setShowFullscreen] = useState(false);
  const [chapters, setChapters] = useState([]);
  const [dragStartY, setDragStartY] = useState(0);
  const [dragCurrentY, setDragCurrentY] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState(0);
  const [showChapterList, setShowChapterList] = useState(false);
  const [showChapterModal, setShowChapterModal] = useState(false);
  const [currentChapter, setCurrentChapter] = useState(0);
  const activeChapterRef = useRef(null);
  const progressBarRef = useRef(null);
  const fullscreenProgressRef = useRef(null);
  const fullscreenPlayerRef = useRef(null);
  const miniPlayerRef = useRef(null);
  const [isDraggingProgress, setIsDraggingProgress] = useState(false);
  const [seekPreviewTime, setSeekPreviewTime] = useState(null);
  const [seekPreviewPercent, setSeekPreviewPercent] = useState(0);
  const [tooltipPosition, setTooltipPosition] = useState({ x: 0, y: 0 });
  const seekPreviewTimeRef = useRef(null); // Ref to track preview time for event handlers
  const dragStateRef = useRef({ startY: 0, isDragging: false }); // Ref for native event handlers

  // Expose closeFullscreen method to parent
  useImperativeHandle(ref, () => ({
    closeFullscreen: () => {
      setShowFullscreen(false);
    }
  }));

  useEffect(() => {
    if (!audiobook || !audiobook.id) {
      console.error('Invalid audiobook in useEffect');
      return;
    }

    if (audioRef.current) {
      try {
        audioRef.current.src = getStreamUrl(audiobook.id);
        audioRef.current.load();

        // Check if this is a different audiobook than what was saved
        const savedAudiobookId = localStorage.getItem('currentAudiobookId');
        const isDifferentBook = !savedAudiobookId || parseInt(savedAudiobookId) !== audiobook.id;

        // If _playRequested exists, treat this as a new play request
        const isPlayRequest = audiobook._playRequested !== undefined;

        setIsNewLoad(isDifferentBook || isPlayRequest); // Mark as new load if different book or play requested
        setHasRestoredPosition(false); // Reset restoration flag

        // Save current audiobook ID
        localStorage.setItem('currentAudiobookId', audiobook.id.toString());
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
    const handleBeforeUnload = (e) => {
      if (audioRef.current && playing) {
        console.log('Pausing audio before page unload');
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

        console.log('Playback restore:', {
          isNewLoad,
          savedPlaying,
          isMobile,
          isPWA,
          isDesktop: !isMobile && !isPWA
        });

        // Mobile/PWA: Only auto-play if _openFullscreen is true (explicit play from detail page)
        // AND it's a new load (not a page refresh)
        if (isMobile || isPWA) {
          const shouldAutoPlay = audiobook._openFullscreen === true && isNewLoad;
          if (shouldAutoPlay) {
            console.log('Mobile/PWA - fullscreen play requested on new load, auto-playing');
            setTimeout(() => {
              if (audioRef.current) {
                audioRef.current.play().then(() => {
                  console.log('Playback started successfully (fullscreen request on mobile)');
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
            console.log('Mobile/PWA detected - no auto-play (page refresh or no explicit request), waiting for user interaction');
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
          console.log('Desktop + New book load - auto-playing');
          setTimeout(() => {
            if (audioRef.current) {
              audioRef.current.play().then(() => {
                console.log('Playback started successfully (new book on desktop)');
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
          console.log('Desktop + Page refresh + Was playing - resuming playback');
          setTimeout(() => {
            if (audioRef.current) {
              audioRef.current.play().then(() => {
                console.log('Playback resumed successfully on desktop');
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
          console.log('Desktop + Page refresh + Was paused - staying paused');
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

  useEffect(() => {
    const interval = setInterval(() => {
      // Only send updates when actively playing
      // Don't send periodic updates when paused to allow OpsDec to timeout the session
      if (audioRef.current && playing) {
        const currentTime = Math.floor(audioRef.current.currentTime);
        const duration = audioRef.current.duration;

        // Calculate progress percentage and mark as finished if >= 98%
        const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0;
        const isFinished = progressPercent >= 98;

        updateProgress(audiobook.id, currentTime, isFinished ? 1 : 0, 'playing');
      }
    }, 5000);

    return () => clearInterval(interval);
  }, [audiobook.id, playing]);

  // Set up Media Session API for OS-level media controls
  useEffect(() => {
    if ('mediaSession' in navigator && audiobook) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: audiobook.title || 'Unknown Title',
        artist: audiobook.author || 'Unknown Author',
        album: audiobook.series || 'Audiobook',
        artwork: audiobook.cover_image ? [
          { src: getCoverUrl(audiobook.id), sizes: '512x512', type: 'image/jpeg' }
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

      navigator.mediaSession.setActionHandler('seekbackward', () => {
        skipBackward();
      });

      navigator.mediaSession.setActionHandler('seekforward', () => {
        skipForward();
      });

      navigator.mediaSession.setActionHandler('previoustrack', () => {
        if (chapters.length > 0) {
          skipToPreviousChapter();
        }
      });

      navigator.mediaSession.setActionHandler('nexttrack', () => {
        if (chapters.length > 0) {
          skipToNextChapter();
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

  // Handle audio interruptions (bluetooth disconnect, phone calls, etc.)
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const handleAudioInterruption = () => {
      console.log('Audio interrupted - pausing playback');
      setPlaying(false);
      if (audioRef.current) {
        audioRef.current.pause();
        updateProgress(audiobook.id, Math.floor(audioRef.current.currentTime), 0, 'paused');
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

  const togglePlay = () => {
    if (!audioRef.current) return;

    if (playing) {
      audioRef.current.pause();
      setPlaying(false);
      // Send pause state immediately
      const currentTime = Math.floor(audioRef.current.currentTime);
      const duration = audioRef.current.duration;
      const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0;
      const isFinished = progressPercent >= 98;
      updateProgress(audiobook.id, currentTime, isFinished ? 1 : 0, 'paused');
    } else {
      // Better error handling for play
      const playPromise = audioRef.current.play();
      if (playPromise !== undefined) {
        playPromise
          .then(() => {
            setPlaying(true);
            const currentTime = Math.floor(audioRef.current.currentTime);
            const duration = audioRef.current.duration;
            const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0;
            const isFinished = progressPercent >= 98;
            updateProgress(audiobook.id, currentTime, isFinished ? 1 : 0, 'playing');
          })
          .catch(err => {
            console.error('Playback failed:', err);
            setPlaying(false);
          });
      }
    }
  };

  const handleSeek = (e) => {
    const time = parseFloat(e.target.value);
    audioRef.current.currentTime = time;
    setCurrentTime(time);
  };

  const skipBackward = () => {
    const newTime = Math.max(0, currentTime - 15);
    audioRef.current.currentTime = newTime;
  };

  const skipForward = () => {
    const newTime = Math.min(duration, currentTime + 15);
    audioRef.current.currentTime = newTime;
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

  const handleTimeUpdate = () => {
    setCurrentTime(audioRef.current.currentTime);
  };

  const handleLoadedMetadata = () => {
    setDuration(audioRef.current.duration);
  };

  const handleVolumeChange = (e) => {
    const vol = parseFloat(e.target.value);
    audioRef.current.volume = vol;
    setVolume(vol);
  };

  const formatTime = (seconds) => {
    if (isNaN(seconds)) return '0m 0s';
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);

    if (hours > 0) {
      return `${hours}h ${minutes}m ${secs}s`;
    }
    return `${minutes}m ${secs}s`;
  };

  const formatTimeShort = (seconds) => {
    if (isNaN(seconds)) return '0m 0s';
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);

    if (hours > 0) {
      return `${hours}h ${minutes}m ${secs}s`;
    }
    return `${minutes}m ${secs}s`;
  };

  const formatTimeWithLabels = (seconds) => {
    if (isNaN(seconds)) return '0 min';
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);

    if (hours > 0) {
      return `${hours}h ${minutes} min`;
    }
    return `${minutes} min`;
  };

  const handleClose = () => {
    // Stop playback and send stopped state when closing the player
    if (audioRef.current) {
      const currentPosition = Math.floor(audioRef.current.currentTime);
      const duration = audioRef.current.duration;
      const progressPercent = duration > 0 ? (currentPosition / duration) * 100 : 0;
      const isFinished = progressPercent >= 98;
      audioRef.current.pause();
      setPlaying(false);
      updateProgress(audiobook.id, currentPosition, isFinished ? 1 : 0, 'stopped');
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

    // Don't handle swipe if touching progress bar, controls, or buttons
    if (target.closest('.fullscreen-progress') ||
        target.closest('.fullscreen-controls') ||
        target.closest('.fullscreen-chapter-btn') ||
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

  const handleProgressTouchStart = (e) => {
    const pos = calculateSeekPosition(e.touches[0].clientX, progressBarRef);
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

  const handleFullscreenProgressMouseDown = (e) => {
    e.stopPropagation();
    const pos = calculateSeekPosition(e.clientX, fullscreenProgressRef);
    if (pos) {
      seekPreviewTimeRef.current = pos.time;
      setSeekPreviewTime(pos.time);
      setSeekPreviewPercent(pos.percent);
      setIsDraggingProgress(true);
    }
  };

  const handleFullscreenProgressTouchStart = (e) => {
    e.stopPropagation();
    const pos = calculateSeekPosition(e.touches[0].clientX, fullscreenProgressRef);
    if (pos) {
      seekPreviewTimeRef.current = pos.time;
      setSeekPreviewTime(pos.time);
      setSeekPreviewPercent(pos.percent);
      setIsDraggingProgress(true);
    }
  };

  // Add global event listeners for progress dragging
  // Handlers defined inside useEffect to ensure consistent references for cleanup
  useEffect(() => {
    if (!isDraggingProgress) return;

    // Capture current values to avoid stale closures
    const currentDuration = duration;
    const isFullscreen = showFullscreen;

    const updatePreview = (clientX) => {
      // Try both progress bar refs
      const miniBar = progressBarRef.current;
      const fullBar = fullscreenProgressRef.current;
      const barRef = isFullscreen && fullBar ? fullBar : miniBar;

      if (!barRef || !currentDuration) return;
      const rect = barRef.getBoundingClientRect();
      const x = clientX - rect.left;
      const percentage = Math.max(0, Math.min(1, x / rect.width));
      const newTime = percentage * currentDuration;

      // Update both state and ref
      seekPreviewTimeRef.current = newTime;
      setSeekPreviewTime(newTime);
      setSeekPreviewPercent(percentage * 100);

      // Calculate fixed tooltip position for mini player
      if (!isFullscreen) {
        const tooltipX = rect.left + (percentage * rect.width);
        const tooltipY = rect.top - 10; // 10px above the progress bar
        setTooltipPosition({ x: tooltipX, y: tooltipY });
      }
    };

    const handleMouseMove = (e) => {
      updatePreview(e.clientX);
    };

    const handleTouchMove = (e) => {
      e.preventDefault();
      updatePreview(e.touches[0].clientX);
    };

    const handleEnd = () => {
      // Apply the seek on release using the ref (always has current value)
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

  // Scroll active chapter into view in fullscreen or chapter modal
  useEffect(() => {
    if ((showFullscreen || showChapterModal) && activeChapterRef.current) {
      // Small delay to allow modal to render
      setTimeout(() => {
        activeChapterRef.current?.scrollIntoView({
          behavior: 'smooth',
          block: 'center'
        });
      }, 100);
    }
  }, [currentChapter, showFullscreen, showChapterModal]);

  // Native event listeners for progress bar seeking (with passive: false for iOS)
  useEffect(() => {
    const miniBar = progressBarRef.current;
    const fullBar = fullscreenProgressRef.current;

    const createSeekHandlers = (barRef, isFullscreen) => {
      let isSeeking = false;

      const getSeekPosition = (clientX) => {
        if (!barRef || !duration) return null;
        const rect = barRef.getBoundingClientRect();
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
          if (!isFullscreen) {
            const rect = barRef.getBoundingClientRect();
            setTooltipPosition({
              x: rect.left + (pos.percent / 100 * rect.width),
              y: rect.top - 10
            });
          }
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
          if (!isFullscreen) {
            const rect = barRef.getBoundingClientRect();
            setTooltipPosition({
              x: rect.left + (pos.percent / 100 * rect.width),
              y: rect.top - 10
            });
          }
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

      return { handleTouchStart, handleTouchMove, handleTouchEnd };
    };

    // Mini player progress bar
    let miniHandlers = null;
    if (miniBar && !showFullscreen) {
      miniHandlers = createSeekHandlers(miniBar, false);
      miniBar.addEventListener('touchstart', miniHandlers.handleTouchStart, { passive: false });
      miniBar.addEventListener('touchmove', miniHandlers.handleTouchMove, { passive: false });
      miniBar.addEventListener('touchend', miniHandlers.handleTouchEnd);
    }

    // Fullscreen progress bar
    let fullHandlers = null;
    if (fullBar && showFullscreen) {
      fullHandlers = createSeekHandlers(fullBar, true);
      fullBar.addEventListener('touchstart', fullHandlers.handleTouchStart, { passive: false });
      fullBar.addEventListener('touchmove', fullHandlers.handleTouchMove, { passive: false });
      fullBar.addEventListener('touchend', fullHandlers.handleTouchEnd);
    }

    return () => {
      if (miniBar && miniHandlers) {
        miniBar.removeEventListener('touchstart', miniHandlers.handleTouchStart);
        miniBar.removeEventListener('touchmove', miniHandlers.handleTouchMove);
        miniBar.removeEventListener('touchend', miniHandlers.handleTouchEnd);
      }
      if (fullBar && fullHandlers) {
        fullBar.removeEventListener('touchstart', fullHandlers.handleTouchStart);
        fullBar.removeEventListener('touchmove', fullHandlers.handleTouchMove);
        fullBar.removeEventListener('touchend', fullHandlers.handleTouchEnd);
      }
    };
  }, [duration, showFullscreen]);

  // Native event listeners for fullscreen swipe-down gesture (with passive: false for iOS)
  useEffect(() => {
    const element = fullscreenPlayerRef.current;
    if (!element || !showFullscreen) return;

    const handleTouchStart = (e) => {
      const target = e.target;
      // Don't handle swipe if touching progress bar, controls, or buttons
      if (target.closest('.fullscreen-progress') ||
          target.closest('.fullscreen-controls') ||
          target.closest('.fullscreen-chapter-btn') ||
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
    <div
      ref={miniPlayerRef}
      className="audio-player"
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
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={handleLoadedMetadata}
        onEnded={() => {
          setPlaying(false);
          // Mark as finished (100% completion)
          updateProgress(audiobook.id, Math.floor(audioRef.current.currentTime), 1, 'stopped');
          // Close fullscreen player if open
          if (showFullscreen) {
            setShowFullscreen(false);
          }
        }}
      />

      <div className="player-info">
        {audiobook.cover_image && (
          <img
            src={getCoverUrl(audiobook.id)}
            alt={audiobook.title}
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
          <div className="player-title" onClick={(e) => {
            if (window.innerWidth > 768) {
              navigate(`/audiobook/${audiobook.id}`);
            } else {
              setShowFullscreen(true);
            }
          }}>
            <span className="marquee-content">
              {audiobook.title}
              <span className="marquee-spacer"> • </span>
              {audiobook.title}
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
            <div className={`metadata-time ${playing ? 'playing' : ''}`}>
              {formatTimeShort(currentTime)} / {formatTimeShort(duration)}
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
            <div>{formatTimeShort(currentTime)} / {formatTimeShort(duration)}</div>
          </div>
          {chapters.length > 0 && (
            <>
              <button className="control-btn chapter-skip-btn" onClick={skipToPreviousChapter} disabled={currentChapter === 0} title="Previous Chapter">
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="19 20 9 12 19 4 19 20"></polygon>
                  <line x1="5" y1="19" x2="5" y2="5"></line>
                </svg>
              </button>
              <button className="control-btn chapter-skip-btn" onClick={skipToNextChapter} disabled={currentChapter === chapters.length - 1} title="Next Chapter">
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="5 4 15 12 5 20 5 4"></polygon>
                  <line x1="19" y1="5" x2="19" y2="19"></line>
                </svg>
              </button>
            </>
          )}
          <button className="control-btn mobile-seek-btn" onClick={skipBackward} title="Rewind 15s">
            <svg xmlns="http://www.w3.org/2000/svg" width="42" height="42" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="0.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path>
              <path d="M3 3v5h5"></path>
              <text x="12" y="15.5" fontSize="6" fill="currentColor" textAnchor="middle" fontWeight="100" fontFamily="system-ui, -apple-system, sans-serif">15</text>
            </svg>
          </button>
          <button className={`control-btn play-btn mobile-play-btn ${playing ? 'playing' : ''}`} onClick={togglePlay} title={playing ? 'Pause' : 'Play'}>
            {playing ? (
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
          <button className="control-btn mobile-seek-btn" onClick={skipForward} title="Forward 15s">
            <svg xmlns="http://www.w3.org/2000/svg" width="42" height="42" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="0.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"></path>
              <path d="M21 3v5h-5"></path>
              <text x="12" y="15.5" fontSize="6" fill="currentColor" textAnchor="middle" fontWeight="100" fontFamily="system-ui, -apple-system, sans-serif">15</text>
            </svg>
          </button>
        </div>
      </div>

      <div className="player-controls">
        {chapters.length > 0 && (
          <button className="control-btn chapter-skip-desktop" onClick={skipToPreviousChapter} disabled={currentChapter === 0} title="Previous Chapter">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="19 20 9 12 19 4 19 20"></polygon>
              <line x1="5" y1="19" x2="5" y2="5"></line>
            </svg>
          </button>
        )}
        <button className="control-btn" onClick={skipBackward} title="Skip back 15 seconds">
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
            <path d="M3 3v5h5"/>
          </svg>
          <text style={{ position: 'absolute', fontSize: '10px', fontWeight: 'bold', pointerEvents: 'none' }}>15</text>
        </button>
        <button className={`control-btn play-btn ${playing ? 'playing' : ''}`} onClick={togglePlay} title={playing ? 'Pause' : 'Play'}>
          {playing ? (
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="currentColor" stroke="none">
              <rect x="6" y="4" width="4" height="16"></rect>
              <rect x="14" y="4" width="4" height="16"></rect>
            </svg>
          ) : (
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="currentColor" stroke="none">
              <polygon points="6 3 20 12 6 21 6 3"></polygon>
            </svg>
          )}
        </button>
        <button className="control-btn" onClick={skipForward} title="Skip forward 15 seconds">
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/>
            <path d="M21 3v5h-5"/>
          </svg>
          <text style={{ position: 'absolute', fontSize: '10px', fontWeight: 'bold', pointerEvents: 'none' }}>15</text>
        </button>
        {chapters.length > 0 && (
          <button className="control-btn chapter-skip-desktop" onClick={skipToNextChapter} disabled={currentChapter === chapters.length - 1} title="Next Chapter">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="5 4 15 12 5 20 5 4"></polygon>
              <line x1="19" y1="5" x2="19" y2="19"></line>
            </svg>
          </button>
        )}
      </div>

      <div className="player-actions">
        <button className="btn-close" onClick={handleClose} title="Close Player">
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
          '--progress-percent': `${duration ? (currentTime / duration) * 100 : 0}%`,
          '--preview-percent': `${seekPreviewPercent}%`
        }}
        onMouseDown={handleProgressMouseDown}
      >
        <div className="progress-thumb"></div>
        <span className="time-display">{formatTime(currentTime)} / {formatTime(duration)}</span>
        <input
          type="range"
          min="0"
          max={duration || 0}
          value={currentTime}
          onChange={handleSeek}
          className="progress-slider"
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

      {showChapterList && chapters.length > 0 && (
        <div className="chapter-list-popup" onClick={() => setShowChapterList(false)}>
          <div className="chapter-list-content" onClick={(e) => e.stopPropagation()}>
            <h3>Chapters</h3>
            <div className="chapters-list">
              {chapters.map((chapter, index) => (
                <div
                  key={index}
                  className={`chapter-item ${index === currentChapter ? 'active' : ''}`}
                  onClick={() => {
                    audioRef.current.currentTime = chapter.start_time;
                    setCurrentTime(chapter.start_time);
                    setShowChapterList(false);
                  }}
                >
                  <span className="chapter-number">Chapter {index + 1}</span>
                  <span className="chapter-title">{chapter.title}</span>
                  <span className="chapter-time">{formatTime(chapter.start_time)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Chapter Modal - available on both desktop and fullscreen */}
      {showChapterModal && chapters.length > 0 && (
        <div className="chapter-modal-overlay" onClick={() => setShowChapterModal(false)}>
          <div className="chapter-modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="chapter-modal-header">
              <h3>Chapters</h3>
              <button className="chapter-modal-close" onClick={() => setShowChapterModal(false)}>
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
              </button>
            </div>
            <div className="chapter-modal-list">
              {chapters.map((chapter, index) => {
                const isActive = currentTime >= chapter.start_time && currentTime < (chapters[index + 1]?.start_time || duration);
                return (
                  <div
                    key={index}
                    ref={isActive ? activeChapterRef : null}
                    className={`chapter-modal-item ${isActive ? 'active' : ''}`}
                    onClick={() => {
                      audioRef.current.currentTime = chapter.start_time;
                      setCurrentTime(chapter.start_time);
                      setShowChapterModal(false);
                    }}
                  >
                    <span className="chapter-modal-title">{chapter.title}</span>
                    <span className="chapter-modal-time">{formatTime(chapter.start_time)}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

    </div>

      {showFullscreen && (
        <div
          ref={fullscreenPlayerRef}
          className="fullscreen-player"
        >
          <div className="fullscreen-player-top">
            <div className="fullscreen-content" onClick={(e) => e.stopPropagation()}>
              <button className="fullscreen-close" onClick={() => setShowFullscreen(false)}>
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="6 9 12 15 18 9"></polyline>
                </svg>
              </button>

              <div className="fullscreen-cover">
                {audiobook.cover_image ? (
                  <img src={getCoverUrl(audiobook.id)} alt={audiobook.title} />
                ) : (
                  <div className="fullscreen-cover-placeholder">{audiobook.title}</div>
                )}
                {progress && progress.position > 0 && duration > 0 && (
                  <div className="fullscreen-cover-progress-overlay">
                    <div
                      className="fullscreen-cover-progress-fill"
                      style={{ width: `${(currentTime / duration) * 100}%` }}
                    ></div>
                  </div>
                )}
              </div>

              <div className="fullscreen-info">
                <h2 className="fullscreen-title" onClick={() => navigate(`/audiobook/${audiobook.id}`)} style={{ cursor: 'pointer' }}>
                  <span className="fullscreen-title-content">
                    {audiobook.title}
                    <span className="marquee-spacer"> • </span>
                    {audiobook.title}
                  </span>
                </h2>
                {audiobook.series && (
                  <p className="series-info" onClick={() => navigate(`/series/${encodeURIComponent(audiobook.series)}`)} style={{ cursor: 'pointer', color: '#9ca3af', fontSize: '0.9rem', marginBottom: '0.25rem' }}>
                    {audiobook.series}{(audiobook.series_index || audiobook.series_position) ? ` • Book ${audiobook.series_index || audiobook.series_position}` : ''}
                  </p>
                )}
                <p onClick={() => navigate(`/author/${encodeURIComponent(audiobook.author || 'Unknown Author')}`)} style={{ cursor: 'pointer' }}>{audiobook.author || 'Unknown Author'}</p>
              </div>

              <div className="fullscreen-controls-wrapper">
                <div className="fullscreen-controls">
                {chapters.length > 0 && (
                  <button className="fullscreen-control-btn fullscreen-chapter-skip" onClick={skipToPreviousChapter} disabled={currentChapter === 0}>
                    <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polygon points="19 20 9 12 19 4 19 20"></polygon>
                      <line x1="5" y1="19" x2="5" y2="5"></line>
                    </svg>
                  </button>
                )}
                <button className="fullscreen-control-btn" onClick={skipBackward}>
                  <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
                    <path d="M3 3v5h5"/>
                  </svg>
                  <span style={{ position: 'absolute', fontSize: '11px', fontWeight: 'bold', pointerEvents: 'none', color: '#e5e7eb' }}>15</span>
                </button>
                <button className={`fullscreen-control-btn fullscreen-play-btn ${playing ? 'playing' : ''}`} onClick={togglePlay}>
                  {playing ? (
                    <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="currentColor" stroke="none">
                      <rect x="6" y="4" width="4" height="16"></rect>
                      <rect x="14" y="4" width="4" height="16"></rect>
                    </svg>
                  ) : (
                    <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="currentColor" stroke="none">
                      <polygon points="6 3 20 12 6 21 6 3"></polygon>
                    </svg>
                  )}
                </button>
                <button className="fullscreen-control-btn" onClick={skipForward}>
                  <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/>
                    <path d="M21 3v5h-5"/>
                  </svg>
                  <span style={{ position: 'absolute', fontSize: '11px', fontWeight: 'bold', pointerEvents: 'none', color: '#e5e7eb' }}>15</span>
                </button>
                {chapters.length > 0 && (
                  <button className="fullscreen-control-btn fullscreen-chapter-skip" onClick={skipToNextChapter} disabled={currentChapter === chapters.length - 1}>
                    <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polygon points="5 4 15 12 5 20 5 4"></polygon>
                      <line x1="19" y1="5" x2="19" y2="19"></line>
                    </svg>
                  </button>
                )}
                </div>
              </div>

              <div
                ref={fullscreenProgressRef}
                className={`fullscreen-progress ${isDraggingProgress && showFullscreen ? 'dragging' : ''}`}
                onMouseDown={handleFullscreenProgressMouseDown}
              >
                <div className="fullscreen-time">
                  <span>{isDraggingProgress && seekPreviewTime !== null ? formatTime(seekPreviewTime) : formatTime(currentTime)}</span>
                  <span>{formatTime(duration)}</span>
                </div>
                <div className="fullscreen-progress-track">
                  <div
                    className="fullscreen-progress-fill"
                    style={{ width: `${duration > 0 ? (currentTime / duration) * 100 : 0}%` }}
                  />
                  {isDraggingProgress && showFullscreen && seekPreviewTime !== null && (
                    <div
                      className="fullscreen-progress-preview"
                      style={{ width: `${seekPreviewPercent}%` }}
                    />
                  )}
                  <div
                    className="fullscreen-progress-thumb"
                    style={{ left: isDraggingProgress && seekPreviewTime !== null ? `${seekPreviewPercent}%` : `${duration > 0 ? (currentTime / duration) * 100 : 0}%` }}
                  />
                  {isDraggingProgress && showFullscreen && seekPreviewTime !== null && (
                    <div
                      className="fullscreen-seek-tooltip"
                      style={{ left: `${seekPreviewPercent}%` }}
                    >
                      {formatTime(seekPreviewTime)}
                    </div>
                  )}
                </div>
              </div>

              {chapters.length > 0 && (
                <button className="fullscreen-chapter-btn" onClick={() => setShowChapterModal(true)}>
                  {playing ? (
                    <div className="equalizer">
                      <span className="eq-bar"></span>
                      <span className="eq-bar"></span>
                      <span className="eq-bar"></span>
                    </div>
                  ) : (
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="8" y1="6" x2="21" y2="6"></line>
                      <line x1="8" y1="12" x2="21" y2="12"></line>
                      <line x1="8" y1="18" x2="21" y2="18"></line>
                      <line x1="3" y1="6" x2="3.01" y2="6"></line>
                      <line x1="3" y1="12" x2="3.01" y2="12"></line>
                      <line x1="3" y1="18" x2="3.01" y2="18"></line>
                    </svg>
                  )}
                  <span>{chapters[currentChapter]?.title || ''}</span>
                </button>
              )}
            </div>
          </div>

        </div>
      )}
    </>
  );
});

AudioPlayer.displayName = 'AudioPlayer';

export default AudioPlayer;
