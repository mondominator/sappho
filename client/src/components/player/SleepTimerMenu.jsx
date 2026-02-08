/**
 * Sleep timer selection menu.
 */
const DURATIONS = [5, 10, 15, 30, 45, 60, 90, 120];

export default function SleepTimerMenu({ sleepTimer, hasChapters, onSelect, onClose }) {
  return (
    <div className="sleep-menu-overlay" onClick={onClose}>
      <div className="sleep-menu-content" onClick={(e) => e.stopPropagation()}>
        <div className="sleep-menu-header">
          <h3>Sleep Timer</h3>
          <button className="sleep-menu-close" onClick={onClose}>
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>
        <div className="sleep-menu-options">
          {sleepTimer !== null && (
            <button
              className="sleep-option cancel"
              onClick={() => onSelect(null)}
            >
              Cancel Timer
            </button>
          )}
          {hasChapters && (
            <button
              className={`sleep-option ${sleepTimer === 'chapter' ? 'active' : ''}`}
              onClick={() => onSelect('chapter')}
            >
              End of chapter
            </button>
          )}
          {DURATIONS.map((mins) => (
            <button
              key={mins}
              className={`sleep-option ${sleepTimer === mins ? 'active' : ''}`}
              onClick={() => onSelect(mins)}
            >
              {mins >= 60 ? `${mins / 60} hour${mins > 60 ? 's' : ''}` : `${mins} minutes`}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
