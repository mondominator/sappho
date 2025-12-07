import { useState, useEffect, useRef } from 'react';
import { getBackups, createBackup, downloadBackup, deleteBackup, restoreBackup, uploadAndRestoreBackup } from '../../api';
import './BackupSettings.css';

export default function BackupSettings() {
  const [backups, setBackups] = useState([]);
  const [status, setStatus] = useState(null);
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
      setStatus(response.data.status || null);
    } catch (err) {
      console.error('Error loading backups:', err);
      setError(err.response?.data?.error || 'Failed to load backups');
    } finally {
      setLoading(false);
    }
  };

  const handleCreateBackup = async () => {
    try {
      setCreating(true);
      setError(null);
      setSuccess(null);
      const response = await createBackup(includeCovers);
      setSuccess(`Backup created: ${response.data.filename} (${response.data.size ? formatBytes(response.data.size) : 'unknown size'})`);
      loadBackups();
    } catch (err) {
      console.error('Error creating backup:', err);
      setError(err.response?.data?.error || 'Failed to create backup');
    } finally {
      setCreating(false);
    }
  };

  const handleDownload = (filename) => {
    const url = downloadBackup(filename);
    window.open(url, '_blank');
  };

  const handleDelete = async (filename) => {
    if (!confirm(`Delete backup "${filename}"? This cannot be undone.`)) {
      return;
    }

    try {
      setError(null);
      await deleteBackup(filename);
      setSuccess(`Deleted: ${filename}`);
      loadBackups();
    } catch (err) {
      console.error('Error deleting backup:', err);
      setError(err.response?.data?.error || 'Failed to delete backup');
    }
  };

  const handleRestore = async (filename) => {
    if (!confirm(`Restore from "${filename}"?\n\nThis will replace the current database and covers. A backup of the current database will be created first.\n\nThe server may need to be restarted after restore.`)) {
      return;
    }

    try {
      setRestoring(filename);
      setError(null);
      setSuccess(null);
      await restoreBackup(filename, { restoreDatabase: true, restoreCovers: true });
      setSuccess('Restore complete! You may need to refresh the page or restart the server.');
    } catch (err) {
      console.error('Error restoring backup:', err);
      setError(err.response?.data?.error || 'Failed to restore backup');
    } finally {
      setRestoring(null);
    }
  };

  const handleUploadRestore = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!confirm(`Restore from uploaded file "${file.name}"?\n\nThis will replace the current database and covers. A backup of the current database will be created first.\n\nThe server may need to be restarted after restore.`)) {
      e.target.value = '';
      return;
    }

    try {
      setUploading(true);
      setError(null);
      setSuccess(null);
      await uploadAndRestoreBackup(file, { restoreDatabase: true, restoreCovers: true });
      setSuccess('Restore complete! You may need to refresh the page or restart the server.');
      loadBackups();
    } catch (err) {
      console.error('Error uploading and restoring backup:', err);
      setError(err.response?.data?.error || 'Failed to restore from uploaded backup');
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  const formatBytes = (bytes) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const formatDate = (dateString) => {
    if (!dateString) return 'Unknown';
    return new Date(dateString).toLocaleString();
  };

  if (loading) {
    return <div className="backup-settings loading">Loading backups...</div>;
  }

  return (
    <div className="backup-settings">
      <div className="section-header">
        <div>
          <h2>Backup & Restore</h2>
          <p className="section-description">
            Create and manage backups of your database and cover images.
            Backups are stored on the server in the data directory.
          </p>
        </div>
      </div>

      {error && (
        <div className="alert alert-error">
          {error}
          <button className="alert-dismiss" onClick={() => setError(null)}>&times;</button>
        </div>
      )}

      {success && (
        <div className="alert alert-success">
          {success}
          <button className="alert-dismiss" onClick={() => setSuccess(null)}>&times;</button>
        </div>
      )}

      {/* Create Backup Section */}
      <div className="backup-section">
        <h3>Create Backup</h3>
        <div className="backup-create-form">
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={includeCovers}
              onChange={(e) => setIncludeCovers(e.target.checked)}
            />
            <span>Include cover images</span>
          </label>
          <button
            className="btn btn-primary"
            onClick={handleCreateBackup}
            disabled={creating}
          >
            {creating ? 'Creating...' : 'Create Backup'}
          </button>
        </div>
        {status?.lastBackup && (
          <p className="last-backup-info">
            Last backup: {formatDate(status.lastBackup)}
          </p>
        )}
      </div>

      {/* Upload & Restore Section */}
      <div className="backup-section">
        <h3>Upload & Restore</h3>
        <p className="section-description">
          Upload a backup file from your computer to restore.
        </p>
        <input
          type="file"
          accept=".zip"
          ref={fileInputRef}
          onChange={handleUploadRestore}
          style={{ display: 'none' }}
        />
        <button
          className="btn btn-secondary"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
        >
          {uploading ? 'Uploading & Restoring...' : 'Upload Backup File'}
        </button>
      </div>

      {/* Existing Backups Section */}
      <div className="backup-section">
        <h3>Available Backups</h3>
        {backups.length === 0 ? (
          <p className="empty-state">No backups found. Create your first backup above.</p>
        ) : (
          <div className="backups-table">
            <table>
              <thead>
                <tr>
                  <th>Filename</th>
                  <th>Size</th>
                  <th>Created</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {backups.map((backup) => (
                  <tr key={backup.filename}>
                    <td data-label="Filename" className="backup-filename">
                      {backup.filename}
                    </td>
                    <td data-label="Size">
                      {backup.sizeFormatted || formatBytes(backup.size)}
                    </td>
                    <td data-label="Created">
                      {backup.createdFormatted || formatDate(backup.created)}
                    </td>
                    <td className="actions">
                      <div className="action-buttons">
                        <button
                          className="btn btn-small btn-secondary"
                          onClick={() => handleDownload(backup.filename)}
                          title="Download backup"
                        >
                          Download
                        </button>
                        <button
                          className="btn btn-small btn-primary"
                          onClick={() => handleRestore(backup.filename)}
                          disabled={restoring === backup.filename}
                          title="Restore from this backup"
                        >
                          {restoring === backup.filename ? 'Restoring...' : 'Restore'}
                        </button>
                        <button
                          className="btn btn-small btn-danger"
                          onClick={() => handleDelete(backup.filename)}
                          title="Delete backup"
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Status Info */}
      {status && (
        <div className="backup-section backup-status">
          <h3>Backup Status</h3>
          <div className="status-grid">
            <div className="status-item">
              <span className="status-label">Backup Directory:</span>
              <span className="status-value">{status.backupDir}</span>
            </div>
            <div className="status-item">
              <span className="status-label">Total Backups:</span>
              <span className="status-value">{status.backupCount}</span>
            </div>
            {status.scheduledBackups && (
              <div className="status-item">
                <span className="status-label">Scheduled Backups:</span>
                <span className="status-value status-active">Enabled</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
