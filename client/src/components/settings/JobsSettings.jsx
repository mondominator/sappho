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

export default function JobsSettings() {
  const [activeTab, setActiveTab] = useState('jobs');
  const [jobs, setJobs] = useState(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(null);

  // Duplicates
  const [duplicateGroups, setDuplicateGroups] = useState([]);
  const [duplicatesScanned, setDuplicatesScanned] = useState(false);
  const [selectedKeep, setSelectedKeep] = useState({});
  const [deleteFiles, setDeleteFiles] = useState(false);

  // Orphans
  const [orphanDirs, setOrphanDirs] = useState([]);
  const [orphansScanned, setOrphansScanned] = useState(false);
  const [selectedDirs, setSelectedDirs] = useState(new Set());

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

  useEffect(() => {
    loadJobs();
    const interval = setInterval(loadJobs, 10000);
    return () => clearInterval(interval);
  }, []);

  const handleAction = async (action) => {
    setActionLoading(action);
    try {
      if (action === 'scan') {
        const result = await scanLibrary(true);
        if (result.data.stats?.scanning) {
          alert('Scan started in background');
        } else {
          alert(`Done! Imported: ${result.data.stats.imported}`);
          if (result.data.stats.imported > 0) window.location.reload();
        }
      } else if (action === 'refresh') {
        if (!confirm('Clear library and reimport? Progress will be preserved.')) return;
        const result = await forceRescan();
        alert('Library refresh complete');
        window.location.reload();
      } else if (action === 'organize') {
        const preview = await getOrganizationPreview();
        if (!preview.data.books?.length) {
          alert('Nothing to reorganize');
          return;
        }
        if (confirm(`Move ${preview.data.books.length} books to Author/Book folders?`)) {
          await apiOrganizeLibrary();
          alert('Done');
          window.location.reload();
        }
      }
    } catch (error) {
      alert(error.response?.data?.error || 'Action failed');
    } finally {
      setActionLoading(null);
    }
  };

  const scanDuplicates = async () => {
    setActionLoading('duplicates');
    try {
      const response = await getDuplicates();
      setDuplicateGroups(response.data.duplicateGroups);
      setDuplicatesScanned(true);
      const initial = {};
      response.data.duplicateGroups.forEach(g => initial[g.id] = g.suggestedKeep);
      setSelectedKeep(initial);
    } catch (error) {
      alert('Failed to scan');
    } finally {
      setActionLoading(null);
    }
  };

  const handleMerge = async (group) => {
    const keepId = selectedKeep[group.id];
    const deleteIds = group.books.filter(b => b.id !== keepId).map(b => b.id);
    if (!confirm(`Merge and remove ${deleteIds.length} copies?`)) return;

    setActionLoading(`merge-${group.id}`);
    try {
      await mergeDuplicates(keepId, deleteIds, deleteFiles);
      setDuplicateGroups(prev => prev.filter(g => g.id !== group.id));
    } catch (error) {
      alert('Merge failed');
    } finally {
      setActionLoading(null);
    }
  };

  const scanOrphans = async () => {
    setActionLoading('orphans');
    try {
      const response = await getOrphanDirectories();
      setOrphanDirs(response.data.orphanDirectories || []);
      setOrphansScanned(true);
      setSelectedDirs(new Set());
    } catch (error) {
      alert('Failed to scan');
    } finally {
      setActionLoading(null);
    }
  };

  const handleDeleteOrphans = async () => {
    if (selectedDirs.size === 0) return;
    if (!confirm(`Delete ${selectedDirs.size} directories permanently?`)) return;

    setActionLoading('delete-orphans');
    try {
      await deleteOrphanDirectories(Array.from(selectedDirs));
      setOrphanDirs(prev => prev.filter(d => !selectedDirs.has(d.path)));
      setSelectedDirs(new Set());
    } catch (error) {
      alert('Delete failed');
    } finally {
      setActionLoading(null);
    }
  };

  const formatSize = (bytes) => {
    if (!bytes) return '-';
    const mb = bytes / (1024 * 1024);
    return mb > 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb.toFixed(0)} MB`;
  };

  if (loading) return <div className="settings-loading">Loading...</div>;

  return (
    <div className="jobs-page">
      <div className="jobs-tabs">
        {['jobs', 'library', 'duplicates', 'orphans'].map(tab => (
          <button
            key={tab}
            className={`jobs-tab ${activeTab === tab ? 'active' : ''}`}
            onClick={() => setActiveTab(tab)}
          >
            {tab === 'jobs' ? 'Jobs' : tab === 'library' ? 'Library' : tab === 'duplicates' ? 'Duplicates' : 'Orphans'}
          </button>
        ))}
      </div>

      {activeTab === 'jobs' && (
        <div className="jobs-list">
          {jobs && Object.entries(jobs).map(([key, job]) => (
            <div key={key} className="job-item">
              <div className="job-row">
                <span className="job-name">{job.name}</span>
                <span className={`job-status ${job.status}`}>{job.status}</span>
              </div>
              <div className="job-meta">
                {job.lastRun && <span>Last: {new Date(job.lastRun).toLocaleString()}</span>}
              </div>
            </div>
          ))}
        </div>
      )}

      {activeTab === 'library' && (
        <div className="action-list">
          <button
            className="action-btn"
            onClick={() => handleAction('scan')}
            disabled={actionLoading === 'scan'}
          >
            <span className="action-title">Scan Library</span>
            <span className="action-desc">Import new audiobooks</span>
          </button>
          <button
            className="action-btn"
            onClick={() => handleAction('organize')}
            disabled={actionLoading === 'organize'}
          >
            <span className="action-title">Reorganize</span>
            <span className="action-desc">Move to Author/Book folders</span>
          </button>
          <button
            className="action-btn danger"
            onClick={() => handleAction('refresh')}
            disabled={actionLoading === 'refresh'}
          >
            <span className="action-title">Refresh Library</span>
            <span className="action-desc">Clear and reimport all</span>
          </button>
        </div>
      )}

      {activeTab === 'duplicates' && (
        <div className="scan-section">
          <button
            className="scan-btn"
            onClick={scanDuplicates}
            disabled={actionLoading === 'duplicates'}
          >
            {actionLoading === 'duplicates' ? 'Scanning...' : duplicatesScanned ? 'Rescan' : 'Scan for Duplicates'}
          </button>

          {duplicatesScanned && (
            <>
              {duplicateGroups.length === 0 ? (
                <p className="no-results">No duplicates found</p>
              ) : (
                <>
                  <label className="checkbox-row">
                    <input
                      type="checkbox"
                      checked={deleteFiles}
                      onChange={(e) => setDeleteFiles(e.target.checked)}
                    />
                    <span>Also delete files</span>
                  </label>
                  <div className="duplicate-list">
                    {duplicateGroups.map(group => (
                      <div key={group.id} className="dup-item">
                        <div className="dup-info">
                          <span className="dup-title">{group.books[0].title}</span>
                          <span className="dup-author">{group.books[0].author}</span>
                          <span className="dup-count">{group.books.length} copies</span>
                        </div>
                        <button
                          className="merge-btn"
                          onClick={() => handleMerge(group)}
                          disabled={actionLoading === `merge-${group.id}`}
                        >
                          Merge
                        </button>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </>
          )}
        </div>
      )}

      {activeTab === 'orphans' && (
        <div className="scan-section">
          <div className="orphan-actions">
            <button
              className="scan-btn"
              onClick={scanOrphans}
              disabled={actionLoading === 'orphans'}
            >
              {actionLoading === 'orphans' ? 'Scanning...' : orphansScanned ? 'Rescan' : 'Scan for Orphans'}
            </button>
            {selectedDirs.size > 0 && (
              <button
                className="delete-btn"
                onClick={handleDeleteOrphans}
                disabled={actionLoading === 'delete-orphans'}
              >
                Delete ({selectedDirs.size})
              </button>
            )}
          </div>

          {orphansScanned && (
            <>
              {orphanDirs.length === 0 ? (
                <p className="no-results">No orphan directories found</p>
              ) : (
                <div className="orphan-list">
                  {orphanDirs.map(dir => (
                    <label key={dir.path} className="orphan-item">
                      <input
                        type="checkbox"
                        checked={selectedDirs.has(dir.path)}
                        onChange={() => {
                          const newSet = new Set(selectedDirs);
                          if (newSet.has(dir.path)) newSet.delete(dir.path);
                          else newSet.add(dir.path);
                          setSelectedDirs(newSet);
                        }}
                      />
                      <div className="orphan-info">
                        <span className="orphan-path">{dir.path.split('/').slice(-2).join('/')}</span>
                        <span className="orphan-meta">{dir.fileCount} files · {formatSize(dir.totalSize)}</span>
                      </div>
                    </label>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
