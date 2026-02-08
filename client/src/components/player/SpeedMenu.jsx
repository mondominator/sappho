/**
 * Playback speed selection menu.
 */
import { useEffect } from 'react';

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3];

export default function SpeedMenu({ currentSpeed, onSelect, onClose }) {
  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <div className="speed-menu-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-label="Playback speed">
      <div className="speed-menu-content" onClick={(e) => e.stopPropagation()}>
        <div className="speed-menu-header">
          <h3>Playback Speed</h3>
          <button className="speed-menu-close" onClick={onClose} aria-label="Close speed menu">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>
        <div className="speed-menu-options">
          {SPEEDS.map((speed) => (
            <button
              key={speed}
              className={`speed-option ${currentSpeed === speed ? 'active' : ''}`}
              onClick={() => onSelect(speed)}
              aria-pressed={currentSpeed === speed}
              aria-label={`${speed}x speed`}
            >
              {speed}x
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
