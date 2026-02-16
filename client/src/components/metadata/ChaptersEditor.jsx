/**
 * Chapter list editor with collapsible display,
 * per-chapter title editing, and re-extract/fetch actions.
 */
export default function ChaptersEditor({
  chapters,
  showChapters,
  setShowChapters,
  chaptersModified,
  onChapterChange,
  onRefresh,
  refreshing,
  saving
}) {
  if (chapters.length === 0) return null;

  return (
    <div className="chapters-section">
      <div
        className="chapters-header"
        onClick={() => setShowChapters(!showChapters)}
      >
        <span>
          Chapters ({chapters.length})
          {chaptersModified && <span className="modified-indicator"> *</span>}
        </span>
        <svg
          className={`chevron ${showChapters ? 'open' : ''}`}
          xmlns="http://www.w3.org/2000/svg"
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <polyline points="6 9 12 15 18 9"></polyline>
        </svg>
      </div>
      {showChapters && (
        <div className="chapters-content">
          <div className="chapters-actions">
            <button
              type="button"
              className="btn btn-small btn-secondary"
              onClick={onRefresh}
              disabled={refreshing || saving}
            >
              {refreshing ? 'Extracting...' : 'Re-extract from File'}
            </button>
          </div>
          <div className="chapters-list-edit">
            {chapters.map((chapter, index) => (
              <div key={chapter.id || index} className="chapter-edit-row">
                <span className="chapter-number">{index + 1}.</span>
                <input
                  type="text"
                  value={chapter.title || ''}
                  onChange={(e) => onChapterChange(index, e.target.value)}
                  disabled={saving}
                  placeholder={`Chapter ${index + 1}`}
                />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
