import { useState } from 'react';
import { getOrphanDirectories, deleteOrphanDirectories } from '../../api';
import './DuplicatesSettings.css';

export default function OrphanDirectoriesSettings() {
  const [loading, setLoading] = useState(false);
  const [orphanDirs, setOrphanDirs] = useState([]);
  const [scanned, setScanned] = useState(false);
  const [selectedDirs, setSelectedDirs] = useState(new Set());
  const [deleting, setDeleting] = useState(false);

  const scanForOrphans = async () => {
    setLoading(true);
    try {
      const response = await getOrphanDirectories();
      setOrphanDirs(response.data.orphanDirectories || []);
      setScanned(true);
      setSelectedDirs(new Set());
    } catch (error) {
      console.error('Error scanning for orphan directories:', error);
      alert(error.response?.data?.error || 'Failed to scan for orphan directories');
    } finally {
      setLoading(false);
    }
  };

  const toggleDirectory = (path) => {
    const newSelected = new Set(selectedDirs);
    if (newSelected.has(path)) {
      newSelected.delete(path);
    } else {
      newSelected.add(path);
    }
    setSelectedDirs(newSelected);
  };

  const selectAll = () => {
    if (selectedDirs.size === orphanDirs.length) {
      setSelectedDirs(new Set());
    } else {
      setSelectedDirs(new Set(orphanDirs.map(d => d.path)));
    }
  };

  const handleDelete = async () => {
    if (selectedDirs.size === 0) {
      alert('Please select directories to delete');
      return;
    }

    const paths = Array.from(selectedDirs);
    if (!confirm(`Delete ${paths.length} orphan director${paths.length === 1 ? 'y' : 'ies'}? This will permanently delete these directories and all files within them.`)) {
      return;
    }

    setDeleting(true);
    try {
      const result = await deleteOrphanDirectories(paths);
      alert(`Deleted ${result.data.deleted} director${result.data.deleted === 1 ? 'y' : 'ies'}.${result.data.errors?.length > 0 ? ` ${result.data.errors.length} failed.` : ''}`);

      // Remove deleted directories from the list
      setOrphanDirs(prev => prev.filter(d => !selectedDirs.has(d.path)));
      setSelectedDirs(new Set());
    } catch (error) {
      console.error('Error deleting orphan directories:', error);
      alert(error.response?.data?.error || 'Failed to delete orphan directories');
    } finally {
      setDeleting(false);
    }
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
    const parts = filePath.split('/');
    // Show the last 4 parts of the path for better context
    return parts.slice(-4).join('/');
  };

  return (
    <div className="tab-content duplicates-settings">
      <div className="section-header">
        <div>
          <h2>Orphan Directories</h2>
          <p className="section-description">
            Find directories containing audio files that are not tracked in your library.
            These may be leftover from deleted books, failed imports, or files that were never imported.
          </p>
        </div>
      </div>

      <div className="scan-controls">
        <button
          className="btn btn-primary"
          onClick={scanForOrphans}
          disabled={loading}
        >
          {loading ? 'Scanning...' : scanned ? 'Rescan' : 'Scan for Orphans'}
        </button>

        {scanned && orphanDirs.length > 0 && (
          <>
            <button
              className="btn btn-secondary"
              onClick={selectAll}
            >
              {selectedDirs.size === orphanDirs.length ? 'Deselect All' : 'Select All'}
            </button>
            <button
              className="btn btn-danger"
              onClick={handleDelete}
              disabled={deleting || selectedDirs.size === 0}
            >
              {deleting ? 'Deleting...' : `Delete Selected (${selectedDirs.size})`}
            </button>
          </>
        )}
      </div>

      {scanned && (
        <div className="scan-results">
          {orphanDirs.length === 0 ? (
            <div className="no-duplicates">
              <p>No orphan directories found. All audio files are tracked in your library.</p>
            </div>
          ) : (
            <>
              <div className="results-summary">
                Found <strong>{orphanDirs.length}</strong> orphan director{orphanDirs.length === 1 ? 'y' : 'ies'} with <strong>{orphanDirs.reduce((sum, d) => sum + d.fileCount, 0)}</strong> untracked audio files
              </div>

              <div className="duplicate-groups">
                {orphanDirs.map(dir => (
                  <div
                    key={dir.path}
                    className={`duplicate-group ${selectedDirs.has(dir.path) ? 'selected' : ''}`}
                    onClick={() => toggleDirectory(dir.path)}
                    style={{ cursor: 'pointer' }}
                  >
                    <div className="group-header">
                      <div className="group-info">
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                          <input
                            type="checkbox"
                            checked={selectedDirs.has(dir.path)}
                            onChange={() => toggleDirectory(dir.path)}
                            onClick={(e) => e.stopPropagation()}
                            style={{ width: '1.25rem', height: '1.25rem' }}
                          />
                          <span className="group-title">{formatPath(dir.path)}</span>
                        </div>
                        <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.5rem', marginLeft: '2rem' }}>
                          <span className="match-reason">{dir.fileCount} audio file{dir.fileCount === 1 ? '' : 's'}</span>
                          <span className="match-reason">{formatSize(dir.totalSize)}</span>
                        </div>
                      </div>
                    </div>

                    {dir.files && dir.files.length > 0 && (
                      <div style={{ marginTop: '0.75rem', marginLeft: '2rem' }}>
                        <div style={{ fontSize: '0.75rem', color: '#6b7280', marginBottom: '0.5rem' }}>Files:</div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                          {dir.files.slice(0, 5).map((file, idx) => (
                            <div
                              key={idx}
                              style={{
                                fontSize: '0.75rem',
                                color: '#9ca3af',
                                fontFamily: 'monospace',
                                padding: '0.25rem 0.5rem',
                                background: '#111827',
                                borderRadius: '4px'
                              }}
                            >
                              {file}
                            </div>
                          ))}
                          {dir.files.length > 5 && (
                            <div style={{ fontSize: '0.75rem', color: '#6b7280', fontStyle: 'italic' }}>
                              ...and {dir.files.length - 5} more
                            </div>
                          )}
                        </div>
                      </div>
                    )}
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
