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
    // Check if this is a page refresh by seeing if the audiobook was already loaded
    // If the audiobook ID matches what's in localStorage, this is a page refresh
    try {
      const savedAudiobookId = localStorage.getItem('currentAudiobookId');
      if (!audiobook || !audiobook.id) return true;
      const isPageRefresh = savedAudiobookId && parseInt(savedAudiobookId) === audiobook.id;
      // New load = NOT a page refresh
      return !isPageRefresh;
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
  const [isDraggingProgress, setIsDraggingProgress] = useState(false);

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

    // Load chapters if multi-file audiobook
    if (audiobook.is_multi_file) {
      getChapters(audiobook.id)
        .then(response => setChapters(response.data || []))
        .catch(err => console.error('Error loading chapters:', err));
    }
  }, [audiobook.id, audiobook.is_multi_file, audiobook._playRequested]);

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
        // - If this is a new load (user clicked to play a different book), always auto-play
        // - If this is a page refresh of the same book, only resume if it was playing before
        const savedPlaying = localStorage.getItem('playerPlaying');
        const shouldAutoPlay = isNewLoad || (savedPlaying === 'true');

        console.log('Playback restore:', { isNewLoad, savedPlaying, shouldAutoPlay });

        // On page refresh (not new load), try to resume playback if it was playing
        // But only if this is not a mobile browser or PWA, since they block auto-play on page load
        const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
        const isPWA = window.matchMedia('(display-mode: standalone)').matches ||
                      window.navigator.standalone === true;
        const canAutoPlayOnRefresh = !isMobile && !isPWA && !isNewLoad && savedPlaying === 'true';

        if (isNewLoad) {
          // New book load - always auto-play (user just clicked play button)
          setTimeout(() => {
            if (audioRef.current) {
              audioRef.current.play().then(() => {
                console.log('Playback started successfully (new book)');
                setPlaying(true);
                setIsNewLoad(false);
                // Mark as playing after successful start
                localStorage.setItem('playerPlaying', 'true');
              }).catch(err => {
                console.warn('Auto-play prevented or failed:', err);
                setPlaying(false);
                setIsNewLoad(false);
              });
            }
          }, 100);
        } else if (canAutoPlayOnRefresh) {
          // Desktop page refresh with audio playing - try to resume
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
        } else {
          // Mobile or paused state - don't auto-play, just restore position
          console.log('Staying paused on refresh (mobile or was paused)');
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
        updateProgress(audiobook.id, Math.floor(audioRef.current.currentTime), 0, 'playing');
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
        if (audiobook.is_multi_file && chapters.length > 0) {
          skipToPreviousChapter();
        }
      });

      navigator.mediaSession.setActionHandler('nexttrack', () => {
        if (audiobook.is_multi_file && chapters.length > 0) {
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

  const togglePlay = () => {
    if (!audioRef.current) return;

    if (playing) {
      audioRef.current.pause();
      setPlaying(false);
      // Send pause state immediately
      updateProgress(audiobook.id, Math.floor(audioRef.current.currentTime), 0, 'paused');
    } else {
      // Better error handling for play
      const playPromise = audioRef.current.play();
      if (playPromise !== undefined) {
        playPromise
          .then(() => {
            setPlaying(true);
            updateProgress(audiobook.id, Math.floor(audioRef.current.currentTime), 0, 'playing');
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
    if (!audiobook.is_multi_file || chapters.length === 0) return;

    const prevChapter = Math.max(0, currentChapter - 1);
    const newTime = chapters[prevChapter].start_time;
    audioRef.current.currentTime = newTime;
    setCurrentTime(newTime);
  };

  const skipToNextChapter = () => {
    if (!audiobook.is_multi_file || chapters.length === 0) return;

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
      audioRef.current.pause();
      setPlaying(false);
      updateProgress(audiobook.id, currentPosition, 0, 'stopped');
    }
    onClose();
  };

  // Drag handlers for fullscreen
  const handleTouchStart = (e) => {
    // Only handle touches on the drag handle
    const target = e.target;
    const isDragHandle = target.closest('.drag-handle');
    if (!isDragHandle && !showFullscreen) return;

    setDragStartY(e.touches[0].clientY);
    setDragCurrentY(e.touches[0].clientY);
    setIsDragging(true);

    // Prevent pull-to-refresh when in fullscreen
    if (showFullscreen) {
      e.preventDefault();
    }
  };

  const handleTouchMove = (e) => {
    if (!isDragging) return;
    const currentY = e.touches[0].clientY;
    setDragCurrentY(currentY);

    // Calculate drag offset for smooth visual feedback
    const offset = currentY - dragStartY;
    setDragOffset(offset);

    // Prevent default scrolling and pull-to-refresh when in fullscreen
    if (showFullscreen) {
      e.preventDefault();
    }
  };

  const handleTouchEnd = () => {
    if (!isDragging) return;
    const dragDistance = dragStartY - dragCurrentY;

    // If dragged up more than 80px, open fullscreen
    if (!showFullscreen && dragDistance > 80) {
      setShowFullscreen(true);
    }
    // If dragged down more than 100px in fullscreen, close it
    else if (showFullscreen && dragDistance < -100) {
      setShowFullscreen(false);
    }

    setIsDragging(false);
    setDragStartY(0);
    setDragCurrentY(0);
    setDragOffset(0);
  };

  // Progress bar drag handlers
  const handleProgressMouseDown = (e) => {
    setIsDraggingProgress(true);
    handleProgressDrag(e);
  };

  const handleProgressTouchStart = (e) => {
    setIsDraggingProgress(true);
    handleProgressDrag(e.touches[0]);
  };

  const handleProgressDrag = (e) => {
    if (!progressBarRef.current || !duration) return;

    const rect = progressBarRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const percentage = Math.max(0, Math.min(1, x / rect.width));
    const newTime = percentage * duration;

    audioRef.current.currentTime = newTime;
    setCurrentTime(newTime);
  };

  const handleProgressMouseMove = (e) => {
    if (!isDraggingProgress) return;
    handleProgressDrag(e);
  };

  const handleProgressTouchMove = (e) => {
    if (!isDraggingProgress) return;
    e.preventDefault();
    handleProgressDrag(e.touches[0]);
  };

  const handleProgressMouseUp = () => {
    setIsDraggingProgress(false);
  };

  const handleProgressTouchEnd = () => {
    setIsDraggingProgress(false);
  };

  // Add global event listeners for progress dragging
  useEffect(() => {
    if (isDraggingProgress) {
      document.addEventListener('mousemove', handleProgressMouseMove);
      document.addEventListener('mouseup', handleProgressMouseUp);
      document.addEventListener('touchmove', handleProgressTouchMove, { passive: false });
      document.addEventListener('touchend', handleProgressTouchEnd);

      return () => {
        document.removeEventListener('mousemove', handleProgressMouseMove);
        document.removeEventListener('mouseup', handleProgressMouseUp);
        document.removeEventListener('touchmove', handleProgressTouchMove);
        document.removeEventListener('touchend', handleProgressTouchEnd);
      };
    }
  }, [isDraggingProgress, duration]);

  // Prevent pull-to-refresh when fullscreen player is open
  useEffect(() => {
    if (showFullscreen) {
      let touchStartY = 0;

      const handleTouchStartPrevent = (e) => {
        touchStartY = e.touches[0].clientY;
      };

      const handleTouchMovePrevent = (e) => {
        const touchY = e.touches[0].clientY;
        const touchDelta = touchY - touchStartY;

        // Only prevent if swiping down at the top of the scroll container
        const fullscreenPlayer = document.querySelector('.fullscreen-player');
        if (fullscreenPlayer && fullscreenPlayer.scrollTop === 0 && touchDelta > 0) {
          e.preventDefault();
        }
      };

      document.addEventListener('touchstart', handleTouchStartPrevent, { passive: false });
      document.addEventListener('touchmove', handleTouchMovePrevent, { passive: false });

      return () => {
        document.removeEventListener('touchstart', handleTouchStartPrevent);
        document.removeEventListener('touchmove', handleTouchMovePrevent);
      };
    }
  }, [showFullscreen]);

  // Update current chapter based on playback time
  useEffect(() => {
    if (!audiobook.is_multi_file || chapters.length === 0) return;

    const currentChapterIndex = chapters.findIndex((chapter, index) => {
      const nextChapter = chapters[index + 1];
      return currentTime >= chapter.start_time &&
             (!nextChapter || currentTime < nextChapter.start_time);
    });

    if (currentChapterIndex !== -1) {
      setCurrentChapter(currentChapterIndex);
    }
  }, [currentTime, chapters, audiobook.is_multi_file]);

  // Scroll active chapter into view in fullscreen
  useEffect(() => {
    if (showFullscreen && activeChapterRef.current) {
      activeChapterRef.current.scrollIntoView({
        behavior: 'smooth',
        block: 'start'
      });
    }
  }, [currentChapter, showFullscreen]);

  return (
    <div
      className="audio-player"
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      style={{
        transform: !showFullscreen && isDragging ? `translateY(${Math.min(0, dragOffset)}px)` : 'none',
        transition: isDragging ? 'none' : 'transform 0.3s ease-out',
        position: 'fixed',
        bottom: 0
      }}
    >
      <audio
        ref={audioRef}
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={handleLoadedMetadata}
        onEnded={() => setPlaying(false)}
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
          {audiobook.is_multi_file && chapters.length > 0 && (
            <div className="desktop-chapter-indicator">
              {chapters[currentChapter]?.title || ''}
            </div>
          )}
          <div className={`mobile-time-display ${playing ? 'playing' : ''}`}>
            <div>{formatTimeShort(currentTime)} / {formatTimeShort(duration)}</div>
          </div>
          {audiobook.is_multi_file && chapters.length > 0 && (
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
        {audiobook.is_multi_file && chapters.length > 0 && (
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
        {audiobook.is_multi_file && chapters.length > 0 && (
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
        className="player-progress"
        style={{ '--progress-percent': `${duration ? (currentTime / duration) * 100 : 0}%` }}
        onMouseDown={handleProgressMouseDown}
        onTouchStart={handleProgressTouchStart}
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

      {showChapterList && audiobook.is_multi_file && chapters.length > 0 && (
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

      {showFullscreen && (
        <div className="fullscreen-player">
          <div
            className="fullscreen-player-top"
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
          >
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
                <h2 onClick={() => navigate(`/audiobook/${audiobook.id}`)} style={{ cursor: 'pointer' }}>{audiobook.title}</h2>
                {audiobook.series && (
                  <p className="series-info" onClick={() => navigate(`/series/${encodeURIComponent(audiobook.series)}`)} style={{ cursor: 'pointer', color: '#9ca3af', fontSize: '0.9rem', marginBottom: '0.25rem' }}>
                    {audiobook.series}{(audiobook.series_index || audiobook.series_position) ? ` • Book ${audiobook.series_index || audiobook.series_position}` : ''}
                  </p>
                )}
                <p onClick={() => navigate(`/author/${encodeURIComponent(audiobook.author || 'Unknown Author')}`)} style={{ cursor: 'pointer' }}>{audiobook.author || 'Unknown Author'}</p>
              </div>

              <div className="fullscreen-controls-wrapper">
                <div className="fullscreen-controls">
                {audiobook.is_multi_file && chapters.length > 0 && (
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
                {audiobook.is_multi_file && chapters.length > 0 && (
                  <button className="fullscreen-control-btn fullscreen-chapter-skip" onClick={skipToNextChapter} disabled={currentChapter === chapters.length - 1}>
                    <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polygon points="5 4 15 12 5 20 5 4"></polygon>
                      <line x1="19" y1="5" x2="19" y2="19"></line>
                    </svg>
                  </button>
                )}
                </div>
              </div>

              <div className="fullscreen-progress">
                <div className="fullscreen-time">
                  <span>{formatTime(currentTime)}</span>
                  <span>{formatTime(duration)}</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max={duration || 0}
                  value={currentTime}
                  onChange={handleSeek}
                  className="fullscreen-slider"
                  style={{ '--progress': `${duration > 0 ? (currentTime / duration) * 100 : 0}%` }}
                />
              </div>

              {audiobook.is_multi_file && chapters.length > 0 && (
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

          {showChapterModal && audiobook.is_multi_file && chapters.length > 0 && (
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
                        <span className="chapter-modal-number">{index + 1}</span>
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
      )}
    </div>
  );
});

AudioPlayer.displayName = 'AudioPlayer';

export default AudioPlayer;
