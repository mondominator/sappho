import { useState } from 'react';
import { getDuplicates, mergeDuplicates, getCoverUrl } from '../../api';
import './DuplicatesSettings.css';

export default function DuplicatesSettings() {
  const [loading, setLoading] = useState(false);
  const [duplicateGroups, setDuplicateGroups] = useState([]);
  const [totalDuplicates, setTotalDuplicates] = useState(0);
  const [scanned, setScanned] = useState(false);
  const [selectedKeep, setSelectedKeep] = useState({});
  const [merging, setMerging] = useState({});
  const [deleteFiles, setDeleteFiles] = useState(false);

  const scanForDuplicates = async () => {
    setLoading(true);
    try {
      const response = await getDuplicates();
      setDuplicateGroups(response.data.duplicateGroups);
      setTotalDuplicates(response.data.totalDuplicates);
      setScanned(true);

      // Initialize selectedKeep with suggested values
      const initialSelection = {};
      response.data.duplicateGroups.forEach(group => {
        initialSelection[group.id] = group.suggestedKeep;
      });
      setSelectedKeep(initialSelection);
    } catch (error) {
      console.error('Error scanning for duplicates:', error);
      alert(error.response?.data?.error || 'Failed to scan for duplicates');
    } finally {
      setLoading(false);
    }
  };

  const handleMerge = async (group) => {
    const keepId = selectedKeep[group.id];
    const deleteIds = group.books.filter(b => b.id !== keepId).map(b => b.id);

    if (!confirm(`Merge ${group.books.length} duplicates? This will keep 1 book and remove ${deleteIds.length}.${deleteFiles ? ' Files will also be deleted!' : ''}`)) {
      return;
    }

    setMerging(prev => ({ ...prev, [group.id]: true }));
    try {
      const result = await mergeDuplicates(keepId, deleteIds, deleteFiles);
      alert(`Merged successfully! Progress from ${result.data.progressTransferred} users transferred.${result.data.filesDeleted > 0 ? ` ${result.data.filesDeleted} files deleted.` : ''}`);

      // Remove this group from the list
      setDuplicateGroups(prev => prev.filter(g => g.id !== group.id));
      setTotalDuplicates(prev => prev - deleteIds.length);
    } catch (error) {
      console.error('Error merging duplicates:', error);
      alert(error.response?.data?.error || 'Failed to merge duplicates');
    } finally {
      setMerging(prev => ({ ...prev, [group.id]: false }));
    }
  };

  const handleMergeAll = async () => {
    if (!confirm(`Merge all ${duplicateGroups.length} duplicate groups? This will remove ${totalDuplicates} audiobooks.${deleteFiles ? ' Files will also be deleted!' : ''}`)) {
      return;
    }

    for (const group of duplicateGroups) {
      await handleMerge(group);
    }
  };

  const formatDuration = (seconds) => {
    if (!seconds) return '-';
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
  };

  const formatSize = (bytes) => {
    if (!bytes) return '-';
    const mb = bytes / (1024 * 1024);
    if (mb > 1024) {
      return `${(mb / 1024).toFixed(1)} GB`;
    }
    return `${mb.toFixed(0)} MB`;
  };

  const formatPath = (filePath) => {
    if (!filePath) return '-';
    // Show just the last 2-3 parts of the path
    const parts = filePath.split('/');
    return parts.slice(-3).join('/');
  };

  return (
    <div className="tab-content duplicates-settings">
      <div className="section-header">
        <div>
          <h2>Duplicate Detection</h2>
          <p className="section-description">
            Find and merge duplicate audiobooks in your library. Duplicates are detected by matching title + author, ISBN/ASIN, or similar duration and file size.
          </p>
        </div>
      </div>

      <div className="scan-controls">
        <button
          className="btn btn-primary"
          onClick={scanForDuplicates}
          disabled={loading}
        >
          {loading ? 'Scanning...' : scanned ? 'Rescan' : 'Scan for Duplicates'}
        </button>

        {scanned && duplicateGroups.length > 0 && (
          <>
            <label className="checkbox-inline">
              <input
                type="checkbox"
                checked={deleteFiles}
                onChange={(e) => setDeleteFiles(e.target.checked)}
              />
              <span>Delete files (not just database entries)</span>
            </label>
            <button
              className="btn btn-danger"
              onClick={handleMergeAll}
              disabled={loading}
            >
              Merge All ({duplicateGroups.length} groups)
            </button>
          </>
        )}
      </div>

      {scanned && (
        <div className="scan-results">
          {duplicateGroups.length === 0 ? (
            <div className="no-duplicates">
              <p>No duplicates found in your library.</p>
            </div>
          ) : (
            <>
              <div className="results-summary">
                Found <strong>{duplicateGroups.length}</strong> duplicate groups with <strong>{totalDuplicates}</strong> extra copies
              </div>

              <div className="duplicate-groups">
                {duplicateGroups.map(group => (
                  <div key={group.id} className="duplicate-group">
                    <div className="group-header">
                      <div className="group-info">
                        <span className="group-title">{group.books[0].title}</span>
                        <span className="group-author">by {group.books[0].author || 'Unknown'}</span>
                        <span className="match-reason">{group.matchReason}</span>
                      </div>
                      <button
                        className="btn btn-primary btn-small"
                        onClick={() => handleMerge(group)}
                        disabled={merging[group.id]}
                      >
                        {merging[group.id] ? 'Merging...' : `Merge (keep 1, remove ${group.books.length - 1})`}
                      </button>
                    </div>

                    <div className="books-comparison">
                      {group.books.map(book => (
                        <div
                          key={book.id}
                          className={`book-card ${selectedKeep[group.id] === book.id ? 'selected' : ''}`}
                          onClick={() => setSelectedKeep(prev => ({ ...prev, [group.id]: book.id }))}
                        >
                          <div className="book-cover">
                            {book.hasCover ? (
                              <img
                                src={getCoverUrl(book.id)}
                                alt={book.title}
                                onError={(e) => {
                                  e.target.style.display = 'none';
                                  e.target.nextSibling.style.display = 'flex';
                                }}
                              />
                            ) : null}
                            <div className="cover-placeholder" style={{ display: book.hasCover ? 'none' : 'flex' }}>
                              No Cover
                            </div>
                          </div>

                          <div className="book-details">
                            <div className="book-badges">
                              {selectedKeep[group.id] === book.id && (
                                <span className="badge badge-keep">Will Keep</span>
                              )}
                              {book.hasUserCover && (
                                <span className="badge badge-cover">Custom Cover</span>
                              )}
                              {book.progress.userCount > 0 && (
                                <span className="badge badge-progress">
                                  {book.progress.userCount} user{book.progress.userCount > 1 ? 's' : ''} with progress
                                </span>
                              )}
                            </div>

                            <div className="book-meta">
                              <div className="meta-row">
                                <span className="meta-label">Duration:</span>
                                <span className="meta-value">{formatDuration(book.duration)}</span>
                              </div>
                              <div className="meta-row">
                                <span className="meta-label">Size:</span>
                                <span className="meta-value">{formatSize(book.file_size)}</span>
                              </div>
                              {book.narrator && (
                                <div className="meta-row">
                                  <span className="meta-label">Narrator:</span>
                                  <span className="meta-value">{book.narrator}</span>
                                </div>
                              )}
                              {(book.isbn || book.asin) && (
                                <div className="meta-row">
                                  <span className="meta-label">ID:</span>
                                  <span className="meta-value">{book.isbn || book.asin}</span>
                                </div>
                              )}
                            </div>

                            <div className="book-path" title={book.file_path}>
                              {formatPath(book.file_path)}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
