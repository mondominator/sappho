import { useState, useEffect } from 'react';
import axios from 'axios';
import { clearLibrary } from '../../api';
import './LibrarySettings.css';

export default function LibrarySettings() {
  const [settings, setSettings] = useState({
    libraryPath: '',
    watchPath: '',
    uploadPath: ''
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [clearing, setClearing] = useState(false);

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
      alert('Library settings updated successfully');
    } catch (error) {
      console.error('Error saving settings:', error);
      alert(error.response?.data?.error || 'Failed to update settings');
    } finally {
      setSaving(false);
    }
  };

  const handleClearLibrary = async () => {
    if (!confirm('Are you sure you want to clear the entire library database? This will remove all audiobook entries and progress. Files will not be deleted and will be reimported on the next scan.')) {
      return;
    }

    if (!confirm('This action cannot be undone. Are you absolutely sure?')) {
      return;
    }

    setClearing(true);
    try {
      await clearLibrary();
      alert('Library database cleared successfully. Audiobooks will be reimported on the next scan (every 5 minutes).');
      window.location.reload();
    } catch (error) {
      console.error('Error clearing library:', error);
      alert(error.response?.data?.error || 'Failed to clear library');
    } finally {
      setClearing(false);
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
            Configure where your audiobooks are stored and managed. Books will be organized in an
            "Author/Book" folder structure.
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
            Main directory where audiobooks are organized in Author/Book folders
          </p>
        </div>

        <div className="form-group">
          <label htmlFor="watchPath">Watch Directory</label>
          <input
            type="text"
            id="watchPath"
            className="input"
            value={settings.watchPath}
            onChange={(e) => setSettings({ ...settings, watchPath: e.target.value })}
            placeholder="/app/data/watch"
            required
          />
          <p className="help-text">
            Directory to monitor for new audiobook files. Files will be automatically imported and
            organized.
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
            {saving ? 'Saving...' : 'Save Settings'}
          </button>
        </div>
      </form>

      <div className="settings-section" style={{ marginTop: '2rem', background: '#7f1d1d', borderColor: '#dc2626' }}>
        <div className="section-header">
          <div>
            <h2>Danger Zone</h2>
            <p className="section-description" style={{ color: '#fca5a5' }}>
              Clear the library database and reimport all audiobooks. This is useful if you have
              duplicate entries or want to reset the library completely.
            </p>
          </div>
        </div>
        <div className="warning-box" style={{ background: '#450a0a', borderColor: '#991b1b' }}>
          <p className="warning-text">
            Warning: This will delete all audiobook entries and playback progress from the database.
            Your audio files will not be deleted and will be automatically reimported.
          </p>
        </div>
        <button
          type="button"
          className="btn btn-danger"
          onClick={handleClearLibrary}
          disabled={clearing}
        >
          {clearing ? 'Clearing Library...' : 'Clear Library Database'}
        </button>
      </div>
    </div>
  );
}
