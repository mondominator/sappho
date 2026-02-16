/**
 * Preview panel showing metadata changes before applying from search results.
 * Includes field selection checkboxes and select all/none controls.
 */
export default function MetadataPreview({
  pendingResult,
  changes,
  selectedFields,
  onFieldToggle,
  onSelectAll,
  onApply,
  onCancel,
  error
}) {
  return (
    <div className="metadata-preview">
      <div className="preview-header">
        <h3>Apply Metadata{pendingResult.source ? ` from ${pendingResult.source === 'google' ? 'Google Books' : pendingResult.source === 'openlibrary' ? 'Open Library' : 'Audible'}` : ''}?</h3>
        <p className="preview-subtitle">Review changes before applying</p>
      </div>

      <div className="preview-book-info">
        {pendingResult.image && (
          <img src={pendingResult.image} alt={pendingResult.title} className="preview-cover" loading="lazy" />
        )}
        <div className="preview-book-details">
          <div className="preview-book-title">{pendingResult.title}</div>
          {pendingResult.author && <div className="preview-book-author">by {pendingResult.author}</div>}
          {pendingResult.narrator && <div className="preview-book-narrator">Narrated by {pendingResult.narrator}</div>}
        </div>
      </div>

      <div className="preview-changes">
        <div className="preview-changes-header">
          <h4>Select fields to update:</h4>
          {changes.length > 0 && (
            <div className="select-all-controls">
              <button
                type="button"
                className="select-link"
                onClick={() => onSelectAll(true)}
              >
                Select All
              </button>
              <span className="select-divider">|</span>
              <button
                type="button"
                className="select-link"
                onClick={() => onSelectAll(false)}
              >
                Select None
              </button>
            </div>
          )}
        </div>
        {changes.length === 0 ? (
          <p className="no-changes">No changes to apply (all fields match)</p>
        ) : (
          <div className="changes-list">
            {changes.map((change, idx) => (
              <label
                key={idx}
                className={`change-item ${change.isNew ? 'is-new' : 'is-update'} ${!selectedFields[change.key] ? 'is-unchecked' : ''}`}
              >
                <input
                  type="checkbox"
                  checked={selectedFields[change.key] || false}
                  onChange={() => onFieldToggle(change.key)}
                  className="change-checkbox"
                />
                <span className="change-label">{change.label}</span>
                {change.isNew ? (
                  <span className="change-value new-value">{change.newValue}</span>
                ) : (
                  <>
                    <span className="change-value old-value">{change.oldValue}</span>
                    <span className="change-arrow">→</span>
                    <span className="change-value new-value">{change.newValue}</span>
                  </>
                )}
              </label>
            ))}
          </div>
        )}
        {pendingResult.hasChapters && pendingResult.asin && (
          <p className="chapters-note">Chapters will also be fetched from Audible.</p>
        )}
      </div>

      <div className="preview-actions">
        <button
          type="button"
          className="btn btn-secondary"
          onClick={onCancel}
        >
          Cancel
        </button>
        <button
          type="button"
          className="btn btn-success"
          onClick={onApply}
        >
          Apply Changes
        </button>
      </div>
    </div>
  );
}
