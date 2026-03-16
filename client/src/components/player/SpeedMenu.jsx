/**
 * Playback speed selection with presets and fine-tune controls.
 */
import { useState, useEffect } from 'react';

const PRESETS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3];

function formatSpeed(speed) {
  if (speed === Math.floor(speed)) return `${speed}x`;
  // Show at most 2 decimal places, trim trailing zeros
  return `${parseFloat(speed.toFixed(2))}x`;
}

export default function SpeedMenu({ currentSpeed, onSelect, onClose }) {
  const [speed, setSpeed] = useState(currentSpeed);

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const adjust = (delta) => {
    const newSpeed = Math.max(0.25, Math.min(3, speed + delta));
    const snapped = Math.round(newSpeed * 20) / 20; // Snap to 0.05
    setSpeed(snapped);
    onSelect(snapped);
  };

  const selectPreset = (preset) => {
    setSpeed(preset);
    onSelect(preset);
  };

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

        {/* Fine-tune controls */}
        <div className="speed-fine-tune">
          <button className="speed-adjust-btn" onClick={() => adjust(-0.05)} aria-label="Decrease speed">
            <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm5 11H7v-2h10v2z"/>
            </svg>
          </button>
          <span className="speed-current-value">{formatSpeed(speed)}</span>
          <button className="speed-adjust-btn" onClick={() => adjust(0.05)} aria-label="Increase speed">
            <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm5 11h-4v4h-2v-4H7v-2h4V7h2v4h4v2z"/>
            </svg>
          </button>
        </div>

        {/* Preset buttons */}
        <div className="speed-menu-options">
          {PRESETS.map((preset) => (
            <button
              key={preset}
              className={`speed-option ${speed === preset ? 'active' : ''}`}
              onClick={() => selectPreset(preset)}
              aria-pressed={speed === preset}
              aria-label={`${preset}x speed`}
            >
              {preset}x
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
