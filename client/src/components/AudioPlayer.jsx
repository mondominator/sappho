import { useState, useRef, useEffect } from 'react';
import { getStreamUrl, updateProgress, getCoverUrl, getChapters } from '../api';
import './AudioPlayer.css';

export default function AudioPlayer({ audiobook, progress, onClose }) {
  const audioRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(() => {
    const saved = localStorage.getItem('playerVolume')
    return saved ? parseFloat(saved) : 1
  });
  const [hasRestoredPosition, setHasRestoredPosition] = useState(false);
  const [isNewLoad, setIsNewLoad] = useState(true);
  const [showFullscreen, setShowFullscreen] = useState(false);
  const [chapters, setChapters] = useState([]);
  const [dragStartY, setDragStartY] = useState(0);
  const [dragCurrentY, setDragCurrentY] = useState(0);
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.src = getStreamUrl(audiobook.id);
      audioRef.current.load();
      setIsNewLoad(true); // Mark as a new load
      setHasRestoredPosition(false); // Reset restoration flag
    }

    // Load chapters if multi-file audiobook
    if (audiobook.is_multi_file) {
      getChapters(audiobook.id)
        .then(response => setChapters(response.data || []))
        .catch(err => console.error('Error loading chapters:', err));
    }
  }, [audiobook.id, audiobook.is_multi_file]);

  // Save playing state to localStorage
  useEffect(() => {
    localStorage.setItem('playerPlaying', playing.toString());
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
      if (!hasRestoredPosition && audioRef.current) {
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
        // - If this is a new load (user clicked to play a book), always auto-play
        // - If this is a page refresh, resume if it was playing before
        const savedPlaying = localStorage.getItem('playerPlaying');
        if (isNewLoad || savedPlaying === 'true') {
          audioRef.current.play().then(() => {
            setPlaying(true);
            setIsNewLoad(false); // Clear the new load flag after first play
          }).catch(err => {
            console.log('Auto-play prevented:', err);
            setPlaying(false);
            setIsNewLoad(false);
          });
        } else {
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

  const togglePlay = () => {
    if (playing) {
      audioRef.current.pause();
      // Send pause state immediately
      if (audioRef.current) {
        updateProgress(audiobook.id, Math.floor(audioRef.current.currentTime), 0, 'paused');
      }
    } else {
      audioRef.current.play();
      // Send playing state immediately
      if (audioRef.current) {
        updateProgress(audiobook.id, Math.floor(audioRef.current.currentTime), 0, 'playing');
      }
    }
    setPlaying(!playing);
  };

  const handleTimeUpdate = () => {
    setCurrentTime(audioRef.current.currentTime);
  };

  const handleLoadedMetadata = () => {
    setDuration(audioRef.current.duration);
  };

  const handleSeek = (e) => {
    const time = parseFloat(e.target.value);
    audioRef.current.currentTime = time;
    setCurrentTime(time);
  };

  const handleVolumeChange = (e) => {
    const vol = parseFloat(e.target.value);
    audioRef.current.volume = vol;
    setVolume(vol);
  };

  const formatTime = (seconds) => {
    if (isNaN(seconds)) return '0:00';
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);

    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
  };

  const skipBackward = () => {
    audioRef.current.currentTime = Math.max(0, audioRef.current.currentTime - 15);
  };

  const skipForward = () => {
    audioRef.current.currentTime = Math.min(duration, audioRef.current.currentTime + 30);
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
    // Only handle touches on the drag handle or player info area
    const target = e.target;
    const isDragHandle = target.closest('.drag-handle') || target.closest('.player-info');
    if (!isDragHandle && !showFullscreen) return;

    setDragStartY(e.touches[0].clientY);
    setDragCurrentY(e.touches[0].clientY);
    setIsDragging(true);
  };

  const handleTouchMove = (e) => {
    if (!isDragging) return;
    const currentY = e.touches[0].clientY;
    setDragCurrentY(currentY);

    // Prevent default scrolling when in fullscreen
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
  };

  return (
    <div
      className="audio-player"
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      <audio
        ref={audioRef}
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={handleLoadedMetadata}
        onEnded={() => setPlaying(false)}
      />

      <div className="drag-handle">
        <div className="drag-handle-bar"></div>
      </div>

      <div className="player-info">
        {audiobook.cover_image && (
          <img
            src={getCoverUrl(audiobook.id)}
            alt={audiobook.title}
            className="player-cover"
            onError={(e) => e.target.style.display = 'none'}
          />
        )}
        <div className="player-text">
          <div className="player-title">{audiobook.title}</div>
          <div className="player-author">{audiobook.author || 'Unknown Author'}</div>
        </div>
        <button className="btn-close" onClick={handleClose} title="Stop and Close">
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      </div>

      <div className="player-controls">
        <button className="control-btn" onClick={skipBackward} title="Skip back 15 seconds">
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path>
            <path d="M3 3v5h5"></path>
            <path d="M10 9l-3 3 3 3" strokeWidth="2"></path>
            <path d="M17 9l-3 3 3 3" strokeWidth="2"></path>
          </svg>
        </button>
        <button className="control-btn play-btn" onClick={togglePlay} title={playing ? 'Pause' : 'Play'}>
          {playing ? (
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="6" y="4" width="4" height="16"></rect>
              <rect x="14" y="4" width="4" height="16"></rect>
            </svg>
          ) : (
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="5 3 19 12 5 21 5 3"></polygon>
            </svg>
          )}
        </button>
        <button className="control-btn" onClick={skipForward} title="Skip forward 30 seconds">
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"></path>
            <path d="M21 3v5h-5"></path>
            <path d="M7 9l3 3-3 3" strokeWidth="2"></path>
            <path d="M14 9l3 3-3 3" strokeWidth="2"></path>
          </svg>
        </button>
      </div>

      <div className="player-progress">
        <span className="time-display">{formatTime(currentTime)}</span>
        <input
          type="range"
          min="0"
          max={duration || 0}
          value={currentTime}
          onChange={handleSeek}
          className="progress-slider"
        />
        <span className="time-display">{formatTime(duration)}</span>
      </div>

      {showFullscreen && (
        <div
          className="fullscreen-player"
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        >
          <div className="fullscreen-content" onClick={(e) => e.stopPropagation()}>
            <div className="drag-handle fullscreen-drag-handle">
              <div className="drag-handle-bar"></div>
            </div>

            <button className="fullscreen-close" onClick={() => setShowFullscreen(false)}>
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>

            <div className="fullscreen-cover">
              {audiobook.cover_image ? (
                <img src={getCoverUrl(audiobook.id)} alt={audiobook.title} />
              ) : (
                <div className="fullscreen-cover-placeholder">{audiobook.title}</div>
              )}
            </div>

            <div className="fullscreen-info">
              <h2>{audiobook.title}</h2>
              <p>{audiobook.author || 'Unknown Author'}</p>
            </div>

            <div className="fullscreen-controls">
              <button className="fullscreen-control-btn" onClick={skipBackward}>
                <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path>
                  <path d="M3 3v5h5"></path>
                  <path d="M10 9l-3 3 3 3" strokeWidth="2"></path>
                  <path d="M17 9l-3 3 3 3" strokeWidth="2"></path>
                </svg>
              </button>
              <button className="fullscreen-control-btn fullscreen-play-btn" onClick={togglePlay}>
                {playing ? (
                  <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="6" y="4" width="4" height="16"></rect>
                    <rect x="14" y="4" width="4" height="16"></rect>
                  </svg>
                ) : (
                  <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polygon points="5 3 19 12 5 21 5 3"></polygon>
                  </svg>
                )}
              </button>
              <button className="fullscreen-control-btn" onClick={skipForward}>
                <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"></path>
                  <path d="M21 3v5h-5"></path>
                  <path d="M7 9l3 3-3 3" strokeWidth="2"></path>
                  <path d="M14 9l3 3-3 3" strokeWidth="2"></path>
                </svg>
              </button>
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
              />
            </div>

            {audiobook.is_multi_file && chapters.length > 0 && (
              <div className="fullscreen-chapters">
                <h3>Chapters</h3>
                <div className="chapters-list">
                  {chapters.map((chapter, index) => (
                    <div
                      key={index}
                      className={`chapter-item ${currentTime >= chapter.start_time && currentTime < (chapters[index + 1]?.start_time || duration) ? 'active' : ''}`}
                      onClick={() => {
                        audioRef.current.currentTime = chapter.start_time;
                        setCurrentTime(chapter.start_time);
                      }}
                    >
                      <span className="chapter-number">{index + 1}</span>
                      <span className="chapter-title">{chapter.title}</span>
                      <span className="chapter-time">{formatTime(chapter.start_time)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
