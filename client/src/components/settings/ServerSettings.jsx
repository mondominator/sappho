import { useState, useEffect } from 'react';
import { getServerSettings, updateServerSettings } from '../../api';
import './ServerSettings.css';

export default function ServerSettings() {
  const [settings, setSettings] = useState({
    port: '',
    nodeEnv: 'production',
    databasePath: '',
    dataDir: '',
    audiobooksDir: '',
    uploadDir: '',
    libraryScanInterval: 5,
  });
  const [originalSettings, setOriginalSettings] = useState({});
  const [lockedFields, setLockedFields] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState([]);

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      const response = await getServerSettings();
      setSettings(response.data.settings);
      setOriginalSettings(response.data.settings);
      setLockedFields(response.data.lockedFields || []);
    } catch (error) {
      console.error('Error loading server settings:', error);
    } finally {
      setLoading(false);
    }
  };

  const isLocked = (field) => lockedFields.includes(field);

  const getChangedSettings = () => {
    const changed = {};
    for (const [key, value] of Object.entries(settings)) {
      if (value !== originalSettings[key]) {
        changed[key] = value;
      }
    }
    return changed;
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    setErrors([]);

    const changed = getChangedSettings();

    if (Object.keys(changed).length === 0) {
      alert('No changes to save.');
      setSaving(false);
      return;
    }

    try {
      const response = await updateServerSettings(changed);

      if (response.data.requiresRestart) {
        alert(`Settings saved. The following changes require a container restart to take effect:\n\n${response.data.requiresRestart.join(', ')}`);
      } else {
        alert('Settings saved successfully.');
      }

      setOriginalSettings({ ...settings });
    } catch (error) {
      console.error('Error saving settings:', error);
      if (error.response?.data?.errors) {
        setErrors(error.response.data.errors);
      } else {
        setErrors([error.response?.data?.error || 'Failed to save settings']);
      }
    } finally {
      setSaving(false);
    }
  };

  const hasChanges = () => {
    return Object.keys(getChangedSettings()).length > 0;
  };

  if (loading) {
    return <div className="loading">Loading server settings...</div>;
  }

  return (
    <div className="tab-content server-settings">
      <div className="section-header">
        <div>
          <h2>Server Configuration</h2>
          <p className="section-description">
            Configure server settings. Changes marked with a restart badge require a container restart.
          </p>
        </div>
      </div>

      {lockedFields.length > 0 && (
        <div className="info-box">
          <p>
            <strong>Note:</strong> Settings marked as "locked" are configured via environment variables
            (docker-compose.yml) and cannot be changed here. To edit these settings, remove them from
            your docker-compose.yml file and restart the container.
          </p>
        </div>
      )}

      {errors.length > 0 && (
        <div className="error-box">
          {errors.map((error, index) => (
            <p key={index}>{error}</p>
          ))}
        </div>
      )}

      <form onSubmit={handleSave} className="server-form">
        {/* Server Settings */}
        <div className="settings-section">
          <h3>Server</h3>
          <div className="form-row">
            <div className={`form-group ${isLocked('port') ? 'locked' : ''}`}>
              <label htmlFor="port">
                Port
                {isLocked('port') ? (
                  <span className="locked-badge" title="Set via environment variable">locked</span>
                ) : (
                  <span className="restart-badge" title="Requires restart">restart</span>
                )}
              </label>
              <input
                type="number"
                id="port"
                className="input"
                value={settings.port}
                onChange={(e) => setSettings({ ...settings, port: e.target.value })}
                min="1"
                max="65535"
                disabled={isLocked('port')}
              />
              {isLocked('port') && <p className="locked-text">Set via docker-compose.yml</p>}
            </div>
            <div className={`form-group ${isLocked('nodeEnv') ? 'locked' : ''}`}>
              <label htmlFor="nodeEnv">
                Environment
                {isLocked('nodeEnv') ? (
                  <span className="locked-badge" title="Set via environment variable">locked</span>
                ) : (
                  <span className="restart-badge" title="Requires restart">restart</span>
                )}
              </label>
              <select
                id="nodeEnv"
                className="input"
                value={settings.nodeEnv}
                onChange={(e) => setSettings({ ...settings, nodeEnv: e.target.value })}
                disabled={isLocked('nodeEnv')}
              >
                <option value="production">Production</option>
                <option value="development">Development</option>
              </select>
              {isLocked('nodeEnv') && <p className="locked-text">Set via docker-compose.yml</p>}
            </div>
          </div>
        </div>

        {/* Path Settings */}
        <div className="settings-section">
          <h3>Paths</h3>

          <div className={`form-group ${isLocked('databasePath') ? 'locked' : ''}`}>
            <label htmlFor="databasePath">
              Database Path
              {isLocked('databasePath') ? (
                <span className="locked-badge" title="Set via environment variable">locked</span>
              ) : (
                <span className="restart-badge" title="Requires restart">restart</span>
              )}
            </label>
            <input
              type="text"
              id="databasePath"
              className="input mono"
              value={settings.databasePath}
              onChange={(e) => setSettings({ ...settings, databasePath: e.target.value })}
              placeholder="/app/data/sappho.db"
              disabled={isLocked('databasePath')}
            />
            {isLocked('databasePath') ? (
              <p className="locked-text">Set via docker-compose.yml</p>
            ) : (
              <p className="help-text">Path to the SQLite database file.</p>
            )}
          </div>

          <div className={`form-group ${isLocked('dataDir') ? 'locked' : ''}`}>
            <label htmlFor="dataDir">
              Data Directory
              {isLocked('dataDir') && <span className="locked-badge" title="Set via environment variable">locked</span>}
            </label>
            <input
              type="text"
              id="dataDir"
              className="input mono"
              value={settings.dataDir}
              onChange={(e) => setSettings({ ...settings, dataDir: e.target.value })}
              placeholder="/app/data"
              disabled={isLocked('dataDir')}
            />
            {isLocked('dataDir') ? (
              <p className="locked-text">Set via docker-compose.yml</p>
            ) : (
              <p className="help-text">Base directory for covers and other data files.</p>
            )}
          </div>

          <div className={`form-group ${isLocked('audiobooksDir') ? 'locked' : ''}`}>
            <label htmlFor="audiobooksDir">
              Audiobooks Directory
              {isLocked('audiobooksDir') && <span className="locked-badge" title="Set via environment variable">locked</span>}
            </label>
            <input
              type="text"
              id="audiobooksDir"
              className="input mono"
              value={settings.audiobooksDir}
              onChange={(e) => setSettings({ ...settings, audiobooksDir: e.target.value })}
              placeholder="/app/data/audiobooks"
              disabled={isLocked('audiobooksDir')}
            />
            {isLocked('audiobooksDir') ? (
              <p className="locked-text">Set via docker-compose.yml</p>
            ) : (
              <p className="help-text">Main directory where audiobooks are stored.</p>
            )}
          </div>

          <div className={`form-group ${isLocked('uploadDir') ? 'locked' : ''}`}>
            <label htmlFor="uploadDir">
              Upload Directory
              {isLocked('uploadDir') && <span className="locked-badge" title="Set via environment variable">locked</span>}
            </label>
            <input
              type="text"
              id="uploadDir"
              className="input mono"
              value={settings.uploadDir}
              onChange={(e) => setSettings({ ...settings, uploadDir: e.target.value })}
              placeholder="/app/data/uploads"
              disabled={isLocked('uploadDir')}
            />
            {isLocked('uploadDir') ? (
              <p className="locked-text">Set via docker-compose.yml</p>
            ) : (
              <p className="help-text">Temporary directory for web uploads before processing.</p>
            )}
          </div>
        </div>

        {/* Library Settings */}
        <div className="settings-section">
          <h3>Library Scanning</h3>
          <div className={`form-group ${isLocked('libraryScanInterval') ? 'locked' : ''}`}>
            <label htmlFor="libraryScanInterval">
              Scan Interval (minutes)
              {isLocked('libraryScanInterval') && <span className="locked-badge" title="Set via environment variable">locked</span>}
            </label>
            <input
              type="number"
              id="libraryScanInterval"
              className="input"
              value={settings.libraryScanInterval}
              onChange={(e) => setSettings({ ...settings, libraryScanInterval: parseInt(e.target.value) || 5 })}
              min="1"
              max="1440"
              disabled={isLocked('libraryScanInterval')}
            />
            {isLocked('libraryScanInterval') ? (
              <p className="locked-text">Set via docker-compose.yml</p>
            ) : (
              <p className="help-text">
                How often to automatically scan the library for new audiobooks (1-1440 minutes).
              </p>
            )}
          </div>

          {!isLocked('libraryScanInterval') && (
            <div className="interval-presets">
              <span className="presets-label">Quick set:</span>
              <button type="button" className="preset-btn" onClick={() => setSettings({ ...settings, libraryScanInterval: 1 })}>
                1 min
              </button>
              <button type="button" className="preset-btn" onClick={() => setSettings({ ...settings, libraryScanInterval: 5 })}>
                5 min
              </button>
              <button type="button" className="preset-btn" onClick={() => setSettings({ ...settings, libraryScanInterval: 15 })}>
                15 min
              </button>
              <button type="button" className="preset-btn" onClick={() => setSettings({ ...settings, libraryScanInterval: 60 })}>
                1 hour
              </button>
              <button type="button" className="preset-btn" onClick={() => setSettings({ ...settings, libraryScanInterval: 1440 })}>
                24 hours
              </button>
            </div>
          )}
        </div>

        <div className="form-actions">
          <button type="submit" className="btn btn-primary" disabled={saving || !hasChanges()}>
            {saving ? 'Saving...' : 'Save Settings'}
          </button>
          {hasChanges() && (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setSettings({ ...originalSettings })}
            >
              Reset Changes
            </button>
          )}
        </div>
      </form>

      {/* Environment Variables Reference */}
      <div className="settings-section env-reference">
        <h3>Environment Variables</h3>
        <p className="section-description">
          These settings can also be configured via environment variables in docker-compose.yml:
        </p>
        <div className="env-table">
          <table>
            <thead>
              <tr>
                <th>Variable</th>
                <th>Description</th>
                <th>Default</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><code>PORT</code></td>
                <td>Server port</td>
                <td>3001</td>
              </tr>
              <tr>
                <td><code>NODE_ENV</code></td>
                <td>Environment mode</td>
                <td>development</td>
              </tr>
              <tr>
                <td><code>JWT_SECRET</code></td>
                <td>Secret for JWT token signing (not editable in UI)</td>
                <td>-</td>
              </tr>
              <tr>
                <td><code>DATABASE_PATH</code></td>
                <td>Path to SQLite database</td>
                <td>/app/data/sappho.db</td>
              </tr>
              <tr>
                <td><code>DATA_DIR</code></td>
                <td>Base data directory</td>
                <td>/app/data</td>
              </tr>
              <tr>
                <td><code>AUDIOBOOKS_DIR</code></td>
                <td>Main audiobook library</td>
                <td>/app/data/audiobooks</td>
              </tr>
              <tr>
                <td><code>UPLOAD_DIR</code></td>
                <td>Web upload directory</td>
                <td>/app/data/uploads</td>
              </tr>
              <tr>
                <td><code>LIBRARY_SCAN_INTERVAL</code></td>
                <td>Minutes between library scans</td>
                <td>5</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
