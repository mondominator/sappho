import { useState, useRef, useEffect } from 'react';
import { getStreamUrl, updateProgress, getCoverUrl } from '../api';
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

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.src = getStreamUrl(audiobook.id);
      audioRef.current.load();
      setIsNewLoad(true); // Mark as a new load
      setHasRestoredPosition(false); // Reset restoration flag
    }
  }, [audiobook.id]);

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

  const handleStop = () => {
    if (audioRef.current) {
      const currentPosition = Math.floor(audioRef.current.currentTime);
      audioRef.current.pause();
      setPlaying(false);
      // Send stopped state with current position (don't reset progress)
      updateProgress(audiobook.id, currentPosition, 0, 'stopped');
    }
  };

  const handleClose = () => {
    // Send stopped state when closing the player
    if (audioRef.current) {
      updateProgress(audiobook.id, Math.floor(audioRef.current.currentTime), 0, 'stopped');
    }
    onClose();
  };

  return (
    <div className="audio-player">
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
            onError={(e) => e.target.style.display = 'none'}
          />
        )}
        <div className="player-text">
          <div className="player-title">{audiobook.title}</div>
          <div className="player-author">{audiobook.author || 'Unknown Author'}</div>
        </div>
        <button className="btn btn-secondary btn-small" onClick={handleClose}>
          Close
        </button>
      </div>

      <div className="player-controls">
        <button className="control-btn" onClick={skipBackward} title="Skip back 15 seconds">
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path>
            <path d="M3 3v5h5"></path>
            <text x="12" y="16" fontSize="8" textAnchor="middle" fill="currentColor" fontWeight="bold">15</text>
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
            <text x="12" y="16" fontSize="8" textAnchor="middle" fill="currentColor" fontWeight="bold">30</text>
          </svg>
        </button>
        <button className="control-btn stop-btn" onClick={handleStop} title="Stop">
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="5" y="5" width="14" height="14" rx="2" ry="2"></rect>
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

      <div className="player-volume">
        <span>Volume:</span>
        <input
          type="range"
          min="0"
          max="1"
          step="0.01"
          value={volume}
          onChange={handleVolumeChange}
          className="volume-slider"
        />
      </div>
    </div>
  );
}
