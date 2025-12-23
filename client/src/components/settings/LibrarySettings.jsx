import { useState, useEffect } from 'react';
import axios from 'axios';
import { scanLibrary, forceRescan, getOrganizationPreview, organizeLibrary as apiOrganizeLibrary } from '../../api';
import './LibrarySettings.css';

export default function LibrarySettings() {
  const [settings, setSettings] = useState({
    libraryPath: '',
    uploadPath: ''
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [rescanning, setRescanning] = useState(false);
  const [organizing, setOrganizing] = useState(false);

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await axios.get('/api/settings/library', {
        headers: { Authorization: `Bearer ${token}` }
      });
      setSettings(response.data);
    } catch (error) {
      console.error('Error loading settings:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);

    try {
      const token = localStorage.getItem('token');
      await axios.put('/api/settings/library', settings, {
        headers: { Authorization: `Bearer ${token}` }
      });
      alert('Library settings updated successfully. Triggering library scan...');

      // Trigger immediate scan after saving settings
      try {
        const scanResult = await scanLibrary();
        const stats = scanResult.data.stats;
        alert(`Library scan complete!\nImported: ${stats.imported}\nSkipped: ${stats.skipped}\nErrors: ${stats.errors}`);
        if (stats.imported > 0) {
          window.location.reload();
        }
      } catch (scanError) {
        console.error('Error triggering scan:', scanError);
      }
    } catch (error) {
      console.error('Error saving settings:', error);
      alert(error.response?.data?.error || 'Failed to update settings');
    } finally {
      setSaving(false);
    }
  };

  const handleScanLibrary = async () => {
    if (!confirm('Scan library and refresh all metadata? This will import new audiobooks and update metadata for existing ones. For large libraries, this process runs in the background.')) {
      return;
    }

    setScanning(true);
    try {
      const result = await scanLibrary(true); // Pass true to refresh metadata
      const stats = result.data.stats;

      // Check if scan is running in background
      if (stats.scanning) {
        alert(result.data.message || 'Metadata refresh started in background. This may take several minutes for large libraries. Check Docker logs for progress.');
      } else {
        // Synchronous scan completed
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

      // Check if scan is running in background
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
      // First get preview
      const preview = await getOrganizationPreview();
      const needsMove = preview.data.needsMove || [];

      if (needsMove.length === 0) {
        alert('All audiobooks are already in their correct locations. Nothing to reorganize.');
        return;
      }

      if (!confirm(`${needsMove.length} audiobook(s) will be moved to match the Author/Series/Book folder structure. Continue?`)) {
        return;
      }

      const result = await apiOrganizeLibrary();
      const stats = result.data;
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

  if (loading) {
    return <div className="loading">Loading library settings...</div>;
  }

  return (
    <div className="tab-content library-settings">
      <div className="section-header">
        <div>
          <h2>Library Settings</h2>
          <p className="section-description">
            Configure where your audiobooks are stored. The library is automatically scanned every 5 minutes for new books.
          </p>
        </div>
      </div>

      <form onSubmit={handleSave} className="library-form">
        <div className="form-group">
          <label htmlFor="libraryPath">Library Directory</label>
          <input
            type="text"
            id="libraryPath"
            className="input"
            value={settings.libraryPath}
            onChange={(e) => setSettings({ ...settings, libraryPath: e.target.value })}
            placeholder="/app/data/audiobooks"
            required
          />
          <p className="help-text">
            Main directory where audiobooks are stored. Can be organized in Author/Book folders or any structure.
          </p>
        </div>

        <div className="form-group">
          <label htmlFor="uploadPath">Upload Directory</label>
          <input
            type="text"
            id="uploadPath"
            className="input"
            value={settings.uploadPath}
            onChange={(e) => setSettings({ ...settings, uploadPath: e.target.value })}
            placeholder="/app/data/uploads"
            required
          />
          <p className="help-text">
            Temporary directory for web uploads. Files are moved to the library after processing.
          </p>
        </div>

        <div className="info-box">
          <h4>Folder Organization</h4>
          <p>
            Uploaded and imported audiobooks will be automatically organized using this structure:
          </p>
          <div className="folder-example">
            <code>
              {settings.libraryPath || '/app/data/audiobooks'}/
              <br />
              └── Author Name/
              <br />
              &nbsp;&nbsp;&nbsp;&nbsp;└── Book Title/
              <br />
              &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;├── book.m4b
              <br />
              &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;└── cover.jpg
            </code>
          </div>
        </div>

        <div className="form-actions">
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? 'Saving & Scanning...' : 'Save Settings'}
          </button>
        </div>
      </form>

      <div className="settings-section" style={{ marginTop: '2rem' }}>
        <div className="section-header">
          <div>
            <h2>Library Management</h2>
            <p className="section-description">
              Manually trigger a library scan to import new audiobooks immediately, reorganize files into the standard folder structure, or refresh the library to clear and reimport everything.
            </p>
          </div>
        </div>
        <div className="form-actions" style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleScanLibrary}
            disabled={scanning}
          >
            {scanning ? 'Scanning...' : 'Scan Library Now'}
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={handleOrganizeLibrary}
            disabled={organizing}
          >
            {organizing ? 'Reorganizing...' : 'Reorganize Library'}
          </button>
        </div>
      </div>

      <div className="settings-section" style={{ marginTop: '2rem', background: '#7f1d1d', borderColor: '#dc2626' }}>
        <div className="section-header">
          <div>
            <h2>Danger Zone</h2>
            <p className="section-description" style={{ color: '#fca5a5' }}>
              Library refresh will clear the entire library database and reimport all audiobooks. Use this if you have
              duplicate entries or corrupted data.
            </p>
          </div>
        </div>
        <div className="warning-box" style={{ background: '#450a0a', borderColor: '#991b1b' }}>
          <p className="warning-text">
            Warning: This will delete all audiobook entries from the database. User playback progress will be preserved.
            Your audio files will not be deleted and will be automatically reimported.
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
  );
}
