/**
 * Reusable playback controls (play/pause, skip, chapter skip).
 * Supports "mini" and "fullscreen" variants via the variant prop.
 */

function BufferingSpinner({ size }) {
  return (
    <svg className="buffering-spinner" xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
    </svg>
  );
}

function PauseIcon({ size }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="currentColor" stroke="none">
      <rect x="6" y="4" width="4" height="16"></rect>
      <rect x="14" y="4" width="4" height="16"></rect>
    </svg>
  );
}

function PlayIcon({ size }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="currentColor" stroke="none">
      <polygon points="6 3 20 12 6 21 6 3"></polygon>
    </svg>
  );
}

function PrevChapterIcon({ size }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="19 20 9 12 19 4 19 20"></polygon>
      <line x1="5" y1="19" x2="5" y2="5"></line>
    </svg>
  );
}

function NextChapterIcon({ size }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="5 4 15 12 5 20 5 4"></polygon>
      <line x1="19" y1="5" x2="19" y2="19"></line>
    </svg>
  );
}

function RewindIcon({ size, strokeWidth = 2 }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
      <path d="M3 3v5h5"/>
      {size >= 40 && (
        <text x="12" y="15.5" fontSize="6" fill="currentColor" textAnchor="middle" fontWeight="100" fontFamily="system-ui, -apple-system, sans-serif">15</text>
      )}
    </svg>
  );
}

function ForwardIcon({ size, strokeWidth = 2 }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/>
      <path d="M21 3v5h-5"/>
      {size >= 40 && (
        <text x="12" y="15.5" fontSize="6" fill="currentColor" textAnchor="middle" fontWeight="100" fontFamily="system-ui, -apple-system, sans-serif">15</text>
      )}
    </svg>
  );
}

export default function PlaybackControls({
  variant = 'desktop',
  playing, isBuffering,
  chapters, currentChapter,
  onTogglePlay, onSkipBackward, onSkipForward,
  onSkipToPreviousChapter, onSkipToNextChapter,
}) {
  if (variant === 'fullscreen') {
    return (
      <div className="fullscreen-controls" role="group" aria-label="Playback controls">
        {chapters.length > 0 && (
          <button className="fullscreen-control-btn fullscreen-chapter-skip" onClick={onSkipToPreviousChapter} disabled={currentChapter === 0} aria-label="Previous chapter">
            <PrevChapterIcon size={32} />
          </button>
        )}
        <button className="fullscreen-control-btn" onClick={onSkipBackward} aria-label="Rewind 15 seconds">
          <RewindIcon size={40} />
          <span style={{ position: 'absolute', fontSize: '11px', fontWeight: 'bold', pointerEvents: 'none', color: '#e5e7eb' }} aria-hidden="true">15</span>
        </button>
        <button className={`fullscreen-control-btn fullscreen-play-btn ${playing ? 'playing' : ''} ${isBuffering ? 'buffering' : ''}`} onClick={onTogglePlay} aria-label={playing ? 'Pause' : 'Play'}>
          {isBuffering ? <BufferingSpinner size={48} /> : playing ? <PauseIcon size={48} /> : <PlayIcon size={48} />}
        </button>
        <button className="fullscreen-control-btn" onClick={onSkipForward} aria-label="Forward 15 seconds">
          <ForwardIcon size={40} />
          <span style={{ position: 'absolute', fontSize: '11px', fontWeight: 'bold', pointerEvents: 'none', color: '#e5e7eb' }} aria-hidden="true">15</span>
        </button>
        {chapters.length > 0 && (
          <button className="fullscreen-control-btn fullscreen-chapter-skip" onClick={onSkipToNextChapter} disabled={currentChapter === chapters.length - 1} aria-label="Next chapter">
            <NextChapterIcon size={32} />
          </button>
        )}
      </div>
    );
  }

  // Desktop variant (used in mini player's player-controls section)
  return (
    <div className="player-controls" role="group" aria-label="Playback controls">
      {chapters.length > 0 && (
        <button className="control-btn chapter-skip-desktop" onClick={onSkipToPreviousChapter} disabled={currentChapter === 0} title="Previous Chapter" aria-label="Previous chapter">
          <PrevChapterIcon size={20} />
        </button>
      )}
      <button className="control-btn" onClick={onSkipBackward} title="Skip back 15 seconds" aria-label="Rewind 15 seconds">
        <RewindIcon size={24} />
        <text style={{ position: 'absolute', fontSize: '10px', fontWeight: 'bold', pointerEvents: 'none' }} aria-hidden="true">15</text>
      </button>
      <button className={`control-btn play-btn ${playing ? 'playing' : ''} ${isBuffering ? 'buffering' : ''}`} onClick={onTogglePlay} title={playing ? 'Pause' : 'Play'} aria-label={playing ? 'Pause' : 'Play'}>
        {isBuffering ? <BufferingSpinner size={24} /> : playing ? <PauseIcon size={24} /> : <PlayIcon size={24} />}
      </button>
      <button className="control-btn" onClick={onSkipForward} title="Skip forward 15 seconds" aria-label="Forward 15 seconds">
        <ForwardIcon size={24} />
        <text style={{ position: 'absolute', fontSize: '10px', fontWeight: 'bold', pointerEvents: 'none' }} aria-hidden="true">15</text>
      </button>
      {chapters.length > 0 && (
        <button className="control-btn chapter-skip-desktop" onClick={onSkipToNextChapter} disabled={currentChapter === chapters.length - 1} title="Next Chapter" aria-label="Next chapter">
          <NextChapterIcon size={20} />
        </button>
      )}
    </div>
  );
}
