/**
 * Playback speed selection with slider and preset shortcuts.
 */
import { useState, useEffect } from 'react';

const PRESETS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3];

function formatSpeed(speed) {
  if (speed === Math.floor(speed)) return `${speed}.0x`;
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

  const handleSliderChange = (e) => {
    const raw = parseFloat(e.target.value);
    const snapped = Math.round(raw * 20) / 20; // Snap to 0.05
    setSpeed(snapped);
    onSelect(snapped);
  };

  const selectPreset = (preset) => {
    setSpeed(preset);
    onSelect(preset);
  };

  // Calculate slider fill percentage for the gradient track
  const fillPercent = ((speed - 0.5) / (3.0 - 0.5)) * 100;

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

        {/* Current speed display */}
        <div className="speed-slider-section">
          <span className="speed-current-value">{formatSpeed(speed)}</span>

          {/* Range slider */}
          <div className="speed-slider-container">
            <span className="speed-slider-label">0.5x</span>
            <input
              type="range"
              className="speed-slider"
              min="0.5"
              max="3.0"
              step="0.05"
              value={speed}
              onChange={handleSliderChange}
              aria-label="Playback speed slider"
              style={{
                background: `linear-gradient(to right, #3b82f6 0%, #3b82f6 ${fillPercent}%, #374151 ${fillPercent}%, #374151 100%)`
              }}
            />
            <span className="speed-slider-label">3.0x</span>
          </div>
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
