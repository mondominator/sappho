import { useState, useEffect, useRef } from 'react';
import { getBackups, createBackup, downloadBackup, deleteBackup, restoreBackup, uploadAndRestoreBackup } from '../../api';
import './BackupSettings.css';

export default function BackupSettings() {
  const [backups, setBackups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [restoring, setRestoring] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [includeCovers, setIncludeCovers] = useState(true);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const fileInputRef = useRef(null);

  useEffect(() => {
    loadBackups();
  }, []);

  const loadBackups = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await getBackups();
      setBackups(response.data.backups || []);
    } catch (err) {
      console.error('Error loading backups:', err);
      setError('Failed to load backups');
    } finally {
      setLoading(false);
    }
  };

  const handleCreateBackup = async () => {
    try {
      setCreating(true);
      setError(null);
      setSuccess(null);
      await createBackup(includeCovers);
      setSuccess('Backup created');
      loadBackups();
    } catch (err) {
      setError('Failed to create backup');
    } finally {
      setCreating(false);
    }
  };

  const handleDownload = (filename) => {
    const url = downloadBackup(filename);
    window.open(url, '_blank');
  };

  const handleDelete = async (filename) => {
    if (!confirm(`Delete "${filename}"?`)) return;
    try {
      setError(null);
      await deleteBackup(filename);
      setSuccess('Deleted');
      loadBackups();
    } catch (err) {
      setError('Failed to delete');
    }
  };

  const handleRestore = async (filename) => {
    if (!confirm(`Restore from "${filename}"?\n\nThis will replace current data.`)) return;
    try {
      setRestoring(filename);
      setError(null);
      setSuccess(null);
      await restoreBackup(filename, { restoreDatabase: true, restoreCovers: true });
      setSuccess('Restored! Refresh the page.');
    } catch (err) {
      setError('Failed to restore');
    } finally {
      setRestoring(null);
    }
  };

  const handleUploadRestore = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!confirm(`Restore from "${file.name}"?\n\nThis will replace current data.`)) {
      e.target.value = '';
      return;
    }
    try {
      setUploading(true);
      setError(null);
      setSuccess(null);
      await uploadAndRestoreBackup(file, { restoreDatabase: true, restoreCovers: true });
      setSuccess('Restored! Refresh the page.');
      loadBackups();
    } catch (err) {
      setError('Failed to restore');
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  const formatBytes = (bytes) => {
    if (!bytes) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  const formatDate = (dateString) => {
    if (!dateString) return '';
    const d = new Date(dateString);
    return d.toLocaleDateString();
  };

  if (loading) {
    return <div className="backup-loading">Loading...</div>;
  }

  return (
    <div className="backup-page">
      {error && (
        <div className="backup-alert error" onClick={() => setError(null)}>{error}</div>
      )}
      {success && (
        <div className="backup-alert success" onClick={() => setSuccess(null)}>{success}</div>
      )}

      {/* Create Section */}
      <div className="backup-section">
        <div className="backup-create">
          <label className="backup-checkbox">
            <input
              type="checkbox"
              checked={includeCovers}
              onChange={(e) => setIncludeCovers(e.target.checked)}
            />
            <span>Include covers</span>
          </label>
          <button
            className="backup-btn primary"
            onClick={handleCreateBackup}
            disabled={creating}
          >
            {creating ? 'Creating...' : 'Create Backup'}
          </button>
        </div>
      </div>

      {/* Upload Section */}
      <div className="backup-section">
        <input
          type="file"
          accept=".zip"
          ref={fileInputRef}
          onChange={handleUploadRestore}
          style={{ display: 'none' }}
        />
        <button
          className="backup-btn full"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
        >
          {uploading ? 'Restoring...' : 'Upload & Restore'}
        </button>
      </div>

      {/* Backups List */}
      <div className="backup-list">
        {backups.length === 0 ? (
          <div className="backup-empty">No backups yet</div>
        ) : (
          backups.map((backup) => (
            <div key={backup.filename} className="backup-item">
              <div className="backup-item-info">
                <span className="backup-item-name">{backup.filename}</span>
                <span className="backup-item-meta">
                  {formatBytes(backup.size)} · {formatDate(backup.created)}
                </span>
              </div>
              <div className="backup-item-actions">
                <button className="backup-btn small" onClick={() => handleDownload(backup.filename)}>
                  Download
                </button>
                <button
                  className="backup-btn small primary"
                  onClick={() => handleRestore(backup.filename)}
                  disabled={restoring === backup.filename}
                >
                  {restoring === backup.filename ? '...' : 'Restore'}
                </button>
                <button className="backup-btn small danger" onClick={() => handleDelete(backup.filename)}>
                  Delete
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
