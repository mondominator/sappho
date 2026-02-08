/**
 * Fullscreen player view with cover art, controls, progress, and bottom bar.
 */
import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { getCoverUrl } from '../../api';
import PlaybackControls from './PlaybackControls';

export default function FullscreenPlayer({
  audiobook, audioRef, playing, currentTime, duration,
  chapters, currentChapter, isBuffering, bufferedPercent,
  playbackSpeed, sleepTimer, chapterProgress,
  progress, showFullscreen,
  onTogglePlay, onSkipBackward, onSkipForward,
  onSkipToPreviousChapter, onSkipToNextChapter,
  onShowSpeedMenu, onShowSleepMenu, onShowChapterModal,
  onClose, onSeek, formatTime, formatSleepTimer,
  fullscreenPlayerRef,
}) {
  const navigate = useNavigate();
  const fullscreenProgressRef = useRef(null);
  const fullscreenTitleRef = useRef(null);
  const chapterLabelRef = useRef(null);
  const [fullscreenTitleOverflows, setFullscreenTitleOverflows] = useState(false);
  const [chapterLabelOverflows, setChapterLabelOverflows] = useState(false);
  const [isDraggingProgress, setIsDraggingProgress] = useState(false);
  const [seekPreviewTime, setSeekPreviewTime] = useState(null);
  const [seekPreviewPercent, setSeekPreviewPercent] = useState(0);
  const seekPreviewTimeRef = useRef(null);

  // Title overflow detection
  useEffect(() => {
    const checkOverflow = () => {
      if (fullscreenTitleRef.current) {
        const container = fullscreenTitleRef.current;
        const content = container.querySelector('.fullscreen-title-content');
        if (content) {
          const hasMarquee = fullscreenTitleOverflows;
          const singleTitleWidth = hasMarquee ? content.scrollWidth / 2.1 : content.scrollWidth;
          setFullscreenTitleOverflows(singleTitleWidth > container.clientWidth);
        }
      }
      if (chapterLabelRef.current) {
        const container = chapterLabelRef.current;
        const content = container.querySelector('.chapter-label-content');
        if (content) {
          const hasMarquee = chapterLabelOverflows;
          const singleWidth = hasMarquee ? content.scrollWidth / 2.1 : content.scrollWidth;
          setChapterLabelOverflows(singleWidth > container.clientWidth);
        }
      }
    };

    const timeout = setTimeout(checkOverflow, 100);
    const fullscreenTimeout = setTimeout(checkOverflow, 300);
    window.addEventListener('resize', checkOverflow);

    return () => {
      clearTimeout(timeout);
      clearTimeout(fullscreenTimeout);
      window.removeEventListener('resize', checkOverflow);
    };
  }, [audiobook?.title, fullscreenTitleOverflows, chapterLabelOverflows, currentChapter, chapters]);

  // Native touch handlers for progress bar seeking
  useEffect(() => {
    const fullBar = fullscreenProgressRef.current;
    if (!fullBar || !showFullscreen) return;

    let isSeeking = false;

    const getSeekPosition = (clientX) => {
      if (!fullBar || !duration) return null;
      const rect = fullBar.getBoundingClientRect();
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
      }
    };

    const handleTouchEnd = () => {
      if (!isSeeking) return;
      isSeeking = false;
      const previewTime = seekPreviewTimeRef.current;
      if (previewTime !== null) {
        onSeek(previewTime);
      }
      setIsDraggingProgress(false);
      setSeekPreviewTime(null);
      seekPreviewTimeRef.current = null;
    };

    fullBar.addEventListener('touchstart', handleTouchStart, { passive: false });
    fullBar.addEventListener('touchmove', handleTouchMove, { passive: false });
    fullBar.addEventListener('touchend', handleTouchEnd);

    return () => {
      fullBar.removeEventListener('touchstart', handleTouchStart);
      fullBar.removeEventListener('touchmove', handleTouchMove);
      fullBar.removeEventListener('touchend', handleTouchEnd);
    };
  }, [duration, showFullscreen, onSeek]);

  // Mouse drag for progress bar
  useEffect(() => {
    if (!isDraggingProgress) return;

    const handleMouseMove = (e) => {
      const fullBar = fullscreenProgressRef.current;
      if (!fullBar || !duration) return;
      const rect = fullBar.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const percentage = Math.max(0, Math.min(1, x / rect.width));
      const newTime = percentage * duration;
      seekPreviewTimeRef.current = newTime;
      setSeekPreviewTime(newTime);
      setSeekPreviewPercent(percentage * 100);
    };

    const handleEnd = () => {
      const previewTime = seekPreviewTimeRef.current;
      if (previewTime !== null) {
        onSeek(previewTime);
      }
      setIsDraggingProgress(false);
      setSeekPreviewTime(null);
      seekPreviewTimeRef.current = null;
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleEnd);
    document.addEventListener('touchmove', (e) => { e.preventDefault(); handleMouseMove(e.touches?.[0] || e); }, { passive: false });
    document.addEventListener('touchend', handleEnd);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleEnd);
    };
  }, [isDraggingProgress, duration, onSeek]);

  const handleProgressMouseDown = (e) => {
    e.stopPropagation();
    const fullBar = fullscreenProgressRef.current;
    if (!fullBar || !duration) return;
    const rect = fullBar.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const percentage = Math.max(0, Math.min(1, x / rect.width));
    seekPreviewTimeRef.current = percentage * duration;
    setSeekPreviewTime(percentage * duration);
    setSeekPreviewPercent(percentage * 100);
    setIsDraggingProgress(true);
  };

  const progressPercent = chapterProgress
    ? chapterProgress.percent
    : (duration > 0 ? (currentTime / duration) * 100 : 0);

  return (
    <div ref={fullscreenPlayerRef} className="fullscreen-player">
      <div className="fullscreen-player-top">
        <div className="fullscreen-content" onClick={(e) => e.stopPropagation()}>
          <button className="fullscreen-close" onClick={onClose} aria-label="Close fullscreen player">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <polyline points="6 9 12 15 18 9"></polyline>
            </svg>
          </button>

          <div className="fullscreen-cover">
            {audiobook.cover_image ? (
              <img src={getCoverUrl(audiobook.id)} alt={`${audiobook.title} by ${audiobook.author || 'Unknown Author'}`} />
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
            <h2
              ref={fullscreenTitleRef}
              className={`fullscreen-title ${fullscreenTitleOverflows ? 'marquee' : ''}`}
              onClick={() => navigate(`/audiobook/${audiobook.id}`)}
              style={{ cursor: 'pointer' }}
            >
              <span className="fullscreen-title-content">
                {audiobook.title}
                {fullscreenTitleOverflows && (
                  <>
                    <span className="marquee-spacer"> &bull; </span>
                    {audiobook.title}
                  </>
                )}
              </span>
            </h2>
            {audiobook.series && (
              <p className="series-info" onClick={() => navigate(`/series/${encodeURIComponent(audiobook.series)}`)} style={{ cursor: 'pointer', color: '#9ca3af', fontSize: '0.9rem', marginBottom: '0.25rem' }}>
                {audiobook.series}{(audiobook.series_index || audiobook.series_position) ? ` \u2022 Book ${audiobook.series_index || audiobook.series_position}` : ''}
              </p>
            )}
            <p onClick={() => navigate(`/author/${encodeURIComponent(audiobook.author || 'Unknown Author')}`)} style={{ cursor: 'pointer' }}>{audiobook.author || 'Unknown Author'}</p>
          </div>

          <div className="fullscreen-controls-wrapper">
            <PlaybackControls
              variant="fullscreen"
              playing={playing}
              isBuffering={isBuffering}
              chapters={chapters}
              currentChapter={currentChapter}
              onTogglePlay={onTogglePlay}
              onSkipBackward={onSkipBackward}
              onSkipForward={onSkipForward}
              onSkipToPreviousChapter={onSkipToPreviousChapter}
              onSkipToNextChapter={onSkipToNextChapter}
            />
          </div>

          <div
            ref={fullscreenProgressRef}
            className={`fullscreen-progress ${isDraggingProgress ? 'dragging' : ''}`}
            onMouseDown={handleProgressMouseDown}
            role="slider"
            aria-label="Playback position"
            aria-valuemin={0}
            aria-valuemax={Math.floor(duration) || 0}
            aria-valuenow={Math.floor(currentTime)}
            aria-valuetext={`${formatTime(currentTime)} of ${formatTime(duration)}`}
            tabIndex={0}
          >
            <div className="fullscreen-time" aria-live="polite" aria-atomic="true">
              <span>
                {isDraggingProgress && seekPreviewTime !== null
                  ? formatTime(seekPreviewTime)
                  : chapterProgress
                    ? formatTime(chapterProgress.position)
                    : formatTime(currentTime)
                }
              </span>
              <span>{chapterProgress ? formatTime(chapterProgress.duration) : formatTime(duration)}</span>
            </div>
            <div className="fullscreen-progress-track">
              <div
                className="fullscreen-progress-buffered"
                style={{ width: `${bufferedPercent}%` }}
              />
              <div
                className="fullscreen-progress-fill"
                style={{ width: `${progressPercent}%` }}
              />
              {isDraggingProgress && seekPreviewTime !== null && (
                <div
                  className="fullscreen-progress-preview"
                  style={{ width: `${seekPreviewPercent}%` }}
                />
              )}
              <div
                className="fullscreen-progress-thumb"
                style={{ left: isDraggingProgress && seekPreviewTime !== null ? `${seekPreviewPercent}%` : `${progressPercent}%` }}
              />
              {isDraggingProgress && seekPreviewTime !== null && (
                <div
                  className="fullscreen-seek-tooltip"
                  style={{ left: `${seekPreviewPercent}%` }}
                >
                  {formatTime(seekPreviewTime)}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Bottom control bar */}
      <div className="fullscreen-bottom-bar">
        <button
          className={`fullscreen-bottom-btn ${!chapters.length ? 'disabled' : ''}`}
          onClick={() => chapters.length > 0 && onShowChapterModal()}
          disabled={!chapters.length}
          aria-label="Chapters"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="8" y1="6" x2="21" y2="6"></line>
            <line x1="8" y1="12" x2="21" y2="12"></line>
            <line x1="8" y1="18" x2="21" y2="18"></line>
            <line x1="3" y1="6" x2="3.01" y2="6"></line>
            <line x1="3" y1="12" x2="3.01" y2="12"></line>
            <line x1="3" y1="18" x2="3.01" y2="18"></line>
          </svg>
          <span
            ref={chapterLabelRef}
            className={`chapter-label ${chapterLabelOverflows ? 'marquee' : ''}`}
          >
            <span className="chapter-label-content">
              {chapters.length > 0 ? (chapters[currentChapter]?.title || 'Chapters') : 'No chapters'}
              {chapterLabelOverflows && (
                <>
                  <span className="marquee-spacer"> &bull; </span>
                  {chapters[currentChapter]?.title || 'Chapters'}
                </>
              )}
            </span>
          </span>
        </button>

        <button className="fullscreen-bottom-btn" onClick={onShowSpeedMenu} aria-label={`Playback speed: ${playbackSpeed}x`}>
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10"></circle>
            <polyline points="12 6 12 12 16 14"></polyline>
          </svg>
          <span>{playbackSpeed === 1 ? '1x' : `${playbackSpeed}x`}</span>
        </button>

        <button
          className={`fullscreen-bottom-btn ${sleepTimer !== null ? 'active' : ''}`}
          onClick={onShowSleepMenu}
          aria-label={sleepTimer !== null ? `Sleep timer: ${formatSleepTimer()}` : 'Sleep timer'}
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>
          </svg>
          <span>{formatSleepTimer() || 'Sleep'}</span>
        </button>
      </div>
    </div>
  );
}
