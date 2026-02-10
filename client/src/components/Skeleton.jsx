import './Skeleton.css';

/** Reusable skeleton building blocks */
export function Skeleton({ width, height, style, className = '' }) {
  return (
    <div
      className={`skeleton ${className}`}
      style={{ width, height, ...style }}
    />
  );
}

/** Home page skeleton — shows 2 section blocks with card grids */
export function HomeSkeleton() {
  return (
    <div className="home-page">
      {[1, 2].map(section => (
        <div key={section} className="skeleton-section">
          <div className="skeleton skeleton-section-title" />
          <div className="skeleton-scroll">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="skeleton skeleton-card" />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Library page skeleton — stats bar + category cards */
export function LibrarySkeleton() {
  return (
    <div className="library-page">
      <div className="skeleton-stats-bar">
        {[1, 2, 3, 4].map(i => (
          <div key={i} className="skeleton-stat">
            <div className="skeleton skeleton-stat-value" />
            <div className="skeleton skeleton-stat-label" />
          </div>
        ))}
      </div>
      <div className="skeleton-categories">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="skeleton skeleton-category-card" />
        ))}
      </div>
    </div>
  );
}

/** AudiobookDetail skeleton — cover + metadata + description */
export function AudiobookDetailSkeleton() {
  return (
    <div className="skeleton-detail">
      <div>
        <div className="skeleton skeleton-detail-cover" />
      </div>
      <div className="skeleton-detail-info">
        <div className="skeleton skeleton-detail-title" />
        <div className="skeleton-detail-meta">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="skeleton-meta-item">
              <div className="skeleton skeleton-meta-label" />
              <div className="skeleton skeleton-meta-value" />
            </div>
          ))}
        </div>
        <div className="skeleton-description">
          <div className="skeleton skeleton-text" style={{ width: '100%' }} />
          <div className="skeleton skeleton-text" style={{ width: '95%' }} />
          <div className="skeleton skeleton-text" style={{ width: '80%' }} />
          <div className="skeleton skeleton-text" style={{ width: '60%' }} />
        </div>
      </div>
    </div>
  );
}

/** Offline indicator banner */
export function OfflineBanner() {
  return (
    <div className="offline-banner" role="alert" aria-live="assertive">
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <line x1="1" y1="1" x2="23" y2="23" />
        <path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55" />
        <path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39" />
        <path d="M10.71 5.05A16 16 0 0 1 22.56 9" />
        <path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88" />
        <path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
        <line x1="12" y1="20" x2="12.01" y2="20" />
      </svg>
      You are offline
    </div>
  );
}
