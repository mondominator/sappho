/**
 * Playback speed selection menu.
 */
const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3];

export default function SpeedMenu({ currentSpeed, onSelect, onClose }) {
  return (
    <div className="speed-menu-overlay" onClick={onClose}>
      <div className="speed-menu-content" onClick={(e) => e.stopPropagation()}>
        <div className="speed-menu-header">
          <h3>Playback Speed</h3>
          <button className="speed-menu-close" onClick={onClose}>
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
            >
              {speed}x
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
