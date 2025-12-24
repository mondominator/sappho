import { useState, useEffect } from 'react';
import {
  getBackgroundJobs,
  scanLibrary,
  forceRescan,
  getOrganizationPreview,
  organizeLibrary as apiOrganizeLibrary,
  getDuplicates,
  mergeDuplicates,
  getCoverUrl,
  getOrphanDirectories,
  deleteOrphanDirectories
} from '../../api';
import './JobsSettings.css';
import './DuplicatesSettings.css';

export default function JobsSettings() {
  const [activeSection, setActiveSection] = useState('jobs');

  // Jobs state
  const [jobs, setJobs] = useState(null);
  const [loading, setLoading] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [runningJob, setRunningJob] = useState(null);

  // Library Management state
  const [scanning, setScanning] = useState(false);
  const [rescanning, setRescanning] = useState(false);
  const [organizing, setOrganizing] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [previewData, setPreviewData] = useState([]);

  // Duplicates state
  const [duplicatesLoading, setDuplicatesLoading] = useState(false);
  const [duplicateGroups, setDuplicateGroups] = useState([]);
  const [totalDuplicates, setTotalDuplicates] = useState(0);
  const [duplicatesScanned, setDuplicatesScanned] = useState(false);
  const [selectedKeep, setSelectedKeep] = useState({});
  const [merging, setMerging] = useState({});
  const [deleteFiles, setDeleteFiles] = useState(false);

  // Orphans state
  const [orphansLoading, setOrphansLoading] = useState(false);
  const [orphanDirs, setOrphanDirs] = useState([]);
  const [orphansScanned, setOrphansScanned] = useState(false);
  const [selectedDirs, setSelectedDirs] = useState(new Set());
  const [deleting, setDeleting] = useState(false);

  // Jobs functions
  const loadJobs = async () => {
    try {
      const result = await getBackgroundJobs();
      setJobs(result.data.jobs);
    } catch (error) {
      console.error('Error loading jobs:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleRunNow = async (jobKey) => {
    if (runningJob) return;

    try {
      setRunningJob(jobKey);

      if (jobKey === 'libraryScanner') {
        await scanLibrary(false);
      }

      await loadJobs();
    } catch (error) {
      console.error('Error running job:', error);
      alert('Failed to trigger job: ' + (error.response?.data?.error || error.message));
    } finally {
      setRunningJob(null);
    }
  };

  useEffect(() => {
    loadJobs();
  }, []);

  useEffect(() => {
    let interval = null;
    if (autoRefresh && activeSection === 'jobs') {
      interval = setInterval(loadJobs, 5000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [autoRefresh, activeSection]);

  // Library Management functions
  const handleScanLibrary = async () => {
    if (!confirm('Scan library and refresh all metadata? This will import new audiobooks and update metadata for existing ones. For large libraries, this process runs in the background.')) {
      return;
    }

    setScanning(true);
    try {
      const result = await scanLibrary(true);
      const stats = result.data.stats;

      if (stats.scanning) {
        alert(result.data.message || 'Metadata refresh started in background. This may take several minutes for large libraries. Check the Logs tab for progress.');
      } else {
        const messages = [
          `Library scan complete!`,
          `New imports: ${stats.imported}`,
          `Skipped: ${stats.skipped}`,
          `Errors: ${stats.errors}`
        ];

        if (stats.metadataRefreshed !== undefined) {
          messages.push(`\nMetadata refreshed: ${stats.metadataRefreshed}`);
          if (stats.metadataErrors > 0) {
            messages.push(`Metadata errors: ${stats.metadataErrors}`);
          }
        }

        alert(messages.join('\n'));

        if (stats.imported > 0 || stats.metadataRefreshed > 0) {
          window.location.reload();
        }
      }
    } catch (error) {
      console.error('Error scanning library:', error);
      alert(error.response?.data?.error || 'Failed to scan library');
    } finally {
      setScanning(false);
    }
  };

  const handleForceRefresh = async () => {
    if (!confirm('Library refresh will CLEAR the entire library database and reimport all audiobooks. User playback progress will be preserved. Are you sure?')) {
      return;
    }

    if (!confirm('This action cannot be undone. Are you absolutely sure you want to refresh the library?')) {
      return;
    }

    setRescanning(true);
    try {
      const result = await forceRescan();

      if (result.data.stats?.scanning) {
        alert('Library refresh started in background. Check the Logs tab for progress.');
      } else {
        const stats = result.data.stats;
        alert(`Library refresh complete!\nImported: ${stats.imported}\nTotal files: ${stats.totalFiles}`);
        window.location.reload();
      }
    } catch (error) {
      console.error('Error in library refresh:', error);
      alert(error.response?.data?.error || 'Failed to refresh library');
    } finally {
      setRescanning(false);
    }
  };

  const handleOrganizeLibrary = async () => {
    setOrganizing(true);
    try {
      const preview = await getOrganizationPreview();
      const needsMove = preview.data.books || [];

      if (needsMove.length === 0) {
        alert('All audiobooks are already in their correct locations. Nothing to reorganize.');
        setOrganizing(false);
        return;
      }

      setPreviewData(needsMove);
      setShowPreview(true);
    } catch (error) {
      console.error('Error organizing library:', error);
      alert(error.response?.data?.error || 'Failed to organize library');
      setOrganizing(false);
    }
  };

  const handleConfirmReorganize = async () => {
    setShowPreview(false);
    try {
      const result = await apiOrganizeLibrary();
      const stats = result.data.stats;
      alert(`Reorganization complete!\nMoved: ${stats.moved}\nSkipped: ${stats.skipped}\nErrors: ${stats.errors}`);

      if (stats.moved > 0) {
        window.location.reload();
      }
    } catch (error) {
      console.error('Error organizing library:', error);
      alert(error.response?.data?.error || 'Failed to organize library');
    } finally {
      setOrganizing(false);
    }
  };

  const handleCancelReorganize = () => {
    setShowPreview(false);
    setPreviewData([]);
    setOrganizing(false);
  };

  // Duplicates functions
  const scanForDuplicates = async () => {
    setDuplicatesLoading(true);
    try {
      const response = await getDuplicates();
      setDuplicateGroups(response.data.duplicateGroups);
      setTotalDuplicates(response.data.totalDuplicates);
      setDuplicatesScanned(true);

      const initialSelection = {};
      response.data.duplicateGroups.forEach(group => {
        initialSelection[group.id] = group.suggestedKeep;
      });
      setSelectedKeep(initialSelection);
    } catch (error) {
      console.error('Error scanning for duplicates:', error);
      alert(error.response?.data?.error || 'Failed to scan for duplicates');
    } finally {
      setDuplicatesLoading(false);
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

  // Orphans functions
  const scanForOrphans = async () => {
    setOrphansLoading(true);
    try {
      const response = await getOrphanDirectories();
      setOrphanDirs(response.data.orphanDirectories || []);
      setOrphansScanned(true);
      setSelectedDirs(new Set());
    } catch (error) {
      console.error('Error scanning for orphan directories:', error);
      alert(error.response?.data?.error || 'Failed to scan for orphan directories');
    } finally {
      setOrphansLoading(false);
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

  const handleDeleteOrphans = async () => {
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

      setOrphanDirs(prev => prev.filter(d => !selectedDirs.has(d.path)));
      setSelectedDirs(new Set());
    } catch (error) {
      console.error('Error deleting orphan directories:', error);
      alert(error.response?.data?.error || 'Failed to delete orphan directories');
    } finally {
      setDeleting(false);
    }
  };

  // Helper functions
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
    const parts = filePath.split('/');
    return parts.slice(-3).join('/');
  };

  if (loading) {
    return <div className="loading">Loading jobs...</div>;
  }

  return (
    <div className="tab-content jobs-settings">
      {/* Section tabs */}
      <div className="section-tabs">
        <button
          className={`section-tab ${activeSection === 'jobs' ? 'active' : ''}`}
          onClick={() => setActiveSection('jobs')}
        >
          Background Jobs
        </button>
        <button
          className={`section-tab ${activeSection === 'library' ? 'active' : ''}`}
          onClick={() => setActiveSection('library')}
        >
          Library Management
        </button>
        <button
          className={`section-tab ${activeSection === 'duplicates' ? 'active' : ''}`}
          onClick={() => setActiveSection('duplicates')}
        >
          Duplicates
        </button>
        <button
          className={`section-tab ${activeSection === 'orphans' ? 'active' : ''}`}
          onClick={() => setActiveSection('orphans')}
        >
          Orphans
        </button>
      </div>

      {/* Background Jobs Section */}
      {activeSection === 'jobs' && (
        <>
          <div className="section-header">
            <div>
              <h2>Background Jobs</h2>
              <p className="section-description">
                Monitor scheduled background tasks and their status.
              </p>
            </div>
            <div className="header-actions">
              <label className="checkbox-inline">
                <input
                  type="checkbox"
                  checked={autoRefresh}
                  onChange={(e) => setAutoRefresh(e.target.checked)}
                />
                <span>Auto-refresh</span>
              </label>
              <button type="button" className="btn btn-secondary" onClick={loadJobs}>
                Refresh
              </button>
            </div>
          </div>

          {jobs ? (
            <div className="jobs-grid">
              {Object.entries(jobs).map(([key, job]) => (
                <div key={key} className={`job-card ${job.status}`}>
                  <div className="job-header">
                    <span className="job-name">{job.name}</span>
                    <span className={`job-status-badge ${job.status}`}>
                      {job.status === 'running' ? '● Running' : job.status === 'locked' ? '◐ Locked' : '○ Idle'}
                    </span>
                  </div>
                  <p className="job-description">{job.description}</p>
                  <div className="job-details">
                    <div className="job-detail">
                      <span className="job-detail-label">Interval:</span>
                      <span className="job-detail-value">{job.interval}</span>
                    </div>
                    {job.lastRun && (
                      <div className="job-detail">
                        <span className="job-detail-label">Last Run:</span>
                        <span className="job-detail-value">{new Date(job.lastRun).toLocaleString()}</span>
                      </div>
                    )}
                    {job.nextRun && job.status === 'idle' && (
                      <div className="job-detail">
                        <span className="job-detail-label">Next Run:</span>
                        <span className="job-detail-value">{new Date(job.nextRun).toLocaleString()}</span>
                      </div>
                    )}
                    {job.lastResult && (
                      <div className="job-detail">
                        <span className="job-detail-label">Last Result:</span>
                        <span className="job-detail-value">
                          {job.lastResult.error
                            ? `Error: ${job.lastResult.error}`
                            : `${job.lastResult.imported || 0} imported, ${job.lastResult.skipped || 0} skipped`
                          }
                        </span>
                      </div>
                    )}
                  </div>
                  {job.canTrigger && (
                    <div className="job-actions">
                      <button
                        type="button"
                        className="btn btn-small btn-primary"
                        onClick={() => handleRunNow(key)}
                        disabled={job.status !== 'idle' || runningJob === key}
                      >
                        {runningJob === key ? 'Starting...' : 'Run Now'}
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="empty-state">
              <p>No background jobs found.</p>
            </div>
          )}
        </>
      )}

      {/* Library Management Section */}
      {activeSection === 'library' && (
        <>
          <div className="section-header">
            <div>
              <h2>Library Management</h2>
              <p className="section-description">
                Manually trigger a library scan to import new audiobooks immediately, or reorganize files into the standard folder structure.
              </p>
            </div>
          </div>

          <div className="management-actions">
            <div className="action-card">
              <h3>Scan Library</h3>
              <p>Import new audiobooks and refresh metadata for existing ones. For large libraries, this runs in the background.</p>
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleScanLibrary}
                disabled={scanning}
              >
                {scanning ? 'Scanning...' : 'Scan Library Now'}
              </button>
            </div>

            <div className="action-card">
              <h3>Reorganize Library</h3>
              <p>Move audiobooks into the standard Author/Series/Book folder structure.</p>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={handleOrganizeLibrary}
                disabled={organizing}
              >
                {organizing ? 'Reorganizing...' : 'Reorganize Library'}
              </button>
            </div>

            <div className="action-card danger">
              <h3>Refresh Library</h3>
              <p>Clear the entire library database and reimport all audiobooks. User playback progress will be preserved.</p>
              <div className="warning-box" style={{ background: '#450a0a', borderColor: '#991b1b', marginBottom: '1rem' }}>
                <p className="warning-text">
                  Warning: This will delete all audiobook entries from the database. Your audio files will not be deleted.
                </p>
              </div>
              <button
                type="button"
                className="btn btn-danger"
                onClick={handleForceRefresh}
                disabled={rescanning}
              >
                {rescanning ? 'Refreshing...' : 'Refresh Library'}
              </button>
            </div>
          </div>
        </>
      )}

      {/* Duplicates Section */}
      {activeSection === 'duplicates' && (
        <div className="duplicates-settings">
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
              disabled={duplicatesLoading}
            >
              {duplicatesLoading ? 'Scanning...' : duplicatesScanned ? 'Rescan' : 'Scan for Duplicates'}
            </button>

            {duplicatesScanned && duplicateGroups.length > 0 && (
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
                  disabled={duplicatesLoading}
                >
                  Merge All ({duplicateGroups.length} groups)
                </button>
              </>
            )}
          </div>

          {duplicatesScanned && (
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
      )}

      {/* Orphans Section */}
      {activeSection === 'orphans' && (
        <div className="duplicates-settings">
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
              disabled={orphansLoading}
            >
              {orphansLoading ? 'Scanning...' : orphansScanned ? 'Rescan' : 'Scan for Orphans'}
            </button>

            {orphansScanned && orphanDirs.length > 0 && (
              <>
                <button
                  className="btn btn-secondary"
                  onClick={selectAll}
                >
                  {selectedDirs.size === orphanDirs.length ? 'Deselect All' : 'Select All'}
                </button>
                <button
                  className="btn btn-danger"
                  onClick={handleDeleteOrphans}
                  disabled={deleting || selectedDirs.size === 0}
                >
                  {deleting ? 'Deleting...' : `Delete Selected (${selectedDirs.size})`}
                </button>
              </>
            )}
          </div>

          {orphansScanned && (
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
                              {dir.orphanType === 'empty' && (
                                <span className="badge" style={{ marginLeft: '0.5rem', background: 'rgba(107, 114, 128, 0.2)', color: '#9ca3af' }}>Empty</span>
                              )}
                              {dir.orphanType === 'metadata_only' && (
                                <span className="badge badge-cover" style={{ marginLeft: '0.5rem' }}>Metadata Only</span>
                              )}
                              {dir.orphanType === 'mixed' && (
                                <span className="badge badge-progress" style={{ marginLeft: '0.5rem' }}>Mixed</span>
                              )}
                            </div>
                            <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.5rem', marginLeft: '2rem' }}>
                              <span className="match-reason">{dir.fileCount} file{dir.fileCount === 1 ? '' : 's'}</span>
                              {dir.audioFileCount > 0 && (
                                <span className="match-reason">{dir.untrackedAudioCount} untracked audio</span>
                              )}
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
      )}

      {/* Reorganization Preview Modal */}
      {showPreview && (
        <div className="modal-overlay" onClick={handleCancelReorganize}>
          <div className="modal-content reorganize-preview" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Reorganization Preview</h3>
              <button className="modal-close" onClick={handleCancelReorganize}>&times;</button>
            </div>
            <div className="modal-body">
              <p className="preview-summary">
                <strong>{previewData.length}</strong> audiobook{previewData.length === 1 ? '' : 's'} will be moved to the Author/Series/Book folder structure:
              </p>
              <div className="preview-list">
                {previewData.map((book) => (
                  <div key={book.id} className="preview-item">
                    <div className="preview-book-title">{book.title}</div>
                    <div className="preview-book-author">{book.author}</div>
                    <div className="preview-paths">
                      <div className="preview-path from">
                        <span className="path-label">From:</span>
                        <code>{book.currentPath}</code>
                      </div>
                      <div className="preview-path to">
                        <span className="path-label">To:</span>
                        <code>{book.targetPath}</code>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={handleCancelReorganize}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={handleConfirmReorganize}>
                Confirm Reorganization
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
