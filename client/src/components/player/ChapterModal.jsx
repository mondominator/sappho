/**
 * Chapter list modal with scrolling to active chapter.
 */
import { useEffect, useRef } from 'react';

export default function ChapterModal({ chapters, currentTime, duration, onSeek, onClose, formatTime }) {
  const activeChapterRef = useRef(null);

  useEffect(() => {
    if (activeChapterRef.current) {
      setTimeout(() => {
        activeChapterRef.current?.scrollIntoView({
          behavior: 'smooth',
          block: 'center'
        });
      }, 100);
    }
  }, []);

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
    <div className="chapter-modal-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-label="Chapters">
      <div className="chapter-modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="chapter-modal-header">
          <h3>Chapters</h3>
          <button className="chapter-modal-close" onClick={onClose} aria-label="Close chapters">
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
                  onSeek(chapter.start_time);
                  onClose();
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSeek(chapter.start_time);
                    onClose();
                  }
                }}
                role="button"
                tabIndex={0}
                aria-current={isActive ? 'true' : undefined}
              >
                <span className="chapter-modal-title">{chapter.title}</span>
                <span className="chapter-modal-time">{formatTime(chapter.start_time)}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
