/**
 * Hardcover Settings Component
 *
 * Allows users to configure their Hardcover.app integration:
 * - View connection status
 * - Choose between server-wide or personal API key
 * - Input personal API key
 * - Test connection
 * - Enable/disable sync
 * - (Admin) Configure server-wide API key
 */

import { useState, useEffect } from 'react';

function HardcoverSettings({ currentUser }) {
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [saveStatus, setSaveStatus] = useState(null); // 'success', 'error', null
  const [testStatus, setTestStatus] = useState(null); // 'success', 'error', null

  // Server-wide API key (admin only)
  const [serverApiKey, setServerApiKey] = useState('');
  const [serverKeySaving, setServerKeySaving] = useState(false);
  const [serverKeyStatus, setServerKeyStatus] = useState(null); // 'success', 'error', null

  // Load current configuration
  useEffect(() => {
    loadConfig();
  }, []);

  const loadConfig = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/hardcover/config', {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
      });

      if (response.ok) {
        const data = await response.json();
        setConfig(data);
      } else {
        console.error('Failed to load Hardcover config');
      }
    } catch (error) {
      console.error('Error loading config:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveApiKey = async (e) => {
    e.preventDefault();
    setSaveStatus(null);
    setTesting(true);

    try {
      const response = await fetch('/api/hardcover/api-key', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify({ apiKey })
      });

      const data = await response.json();

      if (response.ok) {
        setSaveStatus('success');
        setApiKey('');
        loadConfig(); // Reload configuration
        setTimeout(() => setSaveStatus(null), 3000);
      } else {
        setSaveStatus('error');
        alert(data.error || 'Failed to save API key');
      }
    } catch (error) {
      setSaveStatus('error');
      console.error('Error saving API key:', error);
    } finally {
      setTesting(false);
    }
  };

  const handleDeleteApiKey = async () => {
    if (!confirm('Remove your personal Hardcover API key?')) return;

    try {
      const response = await fetch('/api/hardcover/api-key', {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
      });

      if (response.ok) {
        loadConfig();
      } else {
        alert('Failed to remove API key');
      }
    } catch (error) {
      console.error('Error deleting API key:', error);
      alert('Failed to remove API key');
    }
  };

  const handleTestConnection = async () => {
    setTestStatus(null);
    setTesting(true);

    try {
      const response = await fetch('/api/hardcover/test-connection', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
      });

      const data = await response.json();

      if (response.ok && data.connected) {
        setTestStatus('success');
      } else {
        setTestStatus('error');
        alert(data.error || 'Connection test failed');
      }
    } catch (error) {
      setTestStatus('error');
      console.error('Error testing connection:', error);
      alert('Failed to test connection');
    } finally {
      setTesting(false);
      setTimeout(() => setTestStatus(null), 5000);
    }
  };

  const handleToggleSync = async () => {
    try {
      const response = await fetch('/api/hardcover/sync-enabled', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify({ enabled: !config.syncEnabled })
      });

      if (response.ok) {
        loadConfig();
      } else {
        alert('Failed to update sync setting');
      }
    } catch (error) {
      console.error('Error toggling sync:', error);
      alert('Failed to update sync setting');
    }
  };

  const loadServerSettings = async () => {
    if (!currentUser?.is_admin) return;

    try {
      const response = await fetch('/api/settings/all', {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
      });

      if (response.ok) {
        const data = await response.json();
        setServerApiKey(data.settings.hardcoverApiKey || '');
      }
    } catch (error) {
      console.error('Error loading server settings:', error);
    }
  };

  const handleSaveServerApiKey = async () => {
    setServerKeySaving(true);
    setServerKeyStatus(null);

    try {
      const response = await fetch('/api/settings/all', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify({ hardcoverApiKey: serverApiKey })
      });

      const data = await response.json();

      if (response.ok) {
        setServerKeyStatus('success');
        loadConfig(); // Reload to get updated serverHasKey status
        setTimeout(() => setServerKeyStatus(null), 3000);
      } else {
        setServerKeyStatus('error');
        alert(data.errors?.join(', ') || 'Failed to save server API key');
      }
    } catch (error) {
      setServerKeyStatus('error');
      console.error('Error saving server API key:', error);
      alert('Failed to save server API key');
    } finally {
      setServerKeySaving(false);
    }
  };

  useEffect(() => {
    if (currentUser?.is_admin) {
      loadServerSettings();
    }
  }, [currentUser]);

  if (loading) {
    return (
      <div className="settings-content">
        <div className="settings-loading">Loading Hardcover settings...</div>
      </div>
    );
  }

  if (!config) {
    return (
      <div className="settings-content">
        <div className="settings-error">Failed to load configuration</div>
      </div>
    );
  }

  const hasServerKey = config.serverHasKey;
  const hasUserConnection = config.userConnection !== 'none';
  const userConnection = config.userConnection;
  const isTokenExpired = config.tokenExpired;

  return (
    <div className="settings-content">
      {/* Connection Status Overview */}
      <div className="settings-section">
        <h3 className="settings-subtitle">Connection Status</h3>

        <div className={`status-card ${hasUserConnection ? 'connected' : ''}`}>
          <div className="status-header">
            <div className="status-info">
              <h4 className="status-title">
                {hasServerKey ? 'Hardcover Integration Available' : 'Hardcover Not Configured'}
              </h4>
              <p className="status-description">
                {hasServerKey
                  ? 'Server-wide metadata search is enabled'
                  : 'No server-wide API key configured'}
              </p>
            </div>
            <div className={`status-badge ${hasServerKey ? 'active' : 'inactive'}`}>
              {hasServerKey ? 'Active' : 'Inactive'}
            </div>
          </div>

          <div className="status-details">
            {hasUserConnection ? (
              <>
                <div className="status-item">
                  <span className="status-label">Your Connection:</span>
                  <span className="status-value">
                    {userConnection === 'oauth' ? 'OAuth (Personal)' : 'API Key (Personal)'}
                    {isTokenExpired && ' ⚠️ Expired'}
                  </span>
                </div>
                <div className="status-item">
                  <span className="status-label">Sync:</span>
                  <span className="status-value">{config.syncEnabled ? 'Enabled' : 'Disabled'}</span>
                </div>
                <div className="status-item">
                  <span className="status-label">Hardcover User ID:</span>
                  <span className="status-value">
                    {config.hardcoverUserId || 'Not connected'}
                  </span>
                </div>
              </>
            ) : (
              <div className="status-item">
                <span className="status-label">Personal Account:</span>
                <span className="status-value">Not connected</span>
              </div>
            )}
          </div>
        </div>

        {/* Features Grid */}
        <div className="features-grid">
          <div className={`feature-item ${config.features.metadataSearch ? 'available' : 'unavailable'}`}>
            <div className="feature-icon">📚</div>
            <div className="feature-info">
              <div className="feature-name">Metadata Search</div>
              <div className="feature-status">
                {config.features.metadataSearch ? 'Available' : 'Unavailable'}
              </div>
            </div>
          </div>

          <div className={`feature-item ${config.features.progressSync ? 'available' : 'unavailable'}`}>
            <div className="feature-icon">🔄</div>
            <div className="feature-info">
              <div className="feature-name">Progress Sync</div>
              <div className="feature-status">
                {config.features.progressSync ? 'Available' : 'Requires connection'}
              </div>
            </div>
          </div>

          <div className={`feature-item ${config.features.wantToReadImport ? 'available' : 'unavailable'}`}>
            <div className="feature-icon">📖</div>
            <div className="feature-info">
              <div className="feature-name">Want to Read Import</div>
              <div className="feature-status">
                {config.features.wantToReadImport ? 'Available' : 'Requires connection'}
              </div>
            </div>
          </div>

          <div className={`feature-item ${config.features.editionLinking ? 'available' : 'unavailable'}`}>
            <div className="feature-icon">🔗</div>
            <div className="feature-info">
              <div className="feature-name">Edition Linking</div>
              <div className="feature-status">
                {config.features.editionLinking ? 'Available' : 'Requires connection'}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Configuration Options */}
      <div className="settings-section">
        <h3 className="settings-subtitle">Configuration Options</h3>

        {!hasServerKey && (
          <div className="warning-box">
            <p>
              <strong>No server-wide API key configured.</strong> The administrator needs to set
              <code>HARDCOVER_API_KEY</code> in the server environment variables to enable basic metadata search.
            </p>
          </div>
        )}

        {/* Server-wide (Basic) */}
        <div className="option-card">
          <div className="option-header">
            <div className="option-info">
              <h4 className="option-title">Server-wide (Basic Features)</h4>
              <p className="option-description">
                Use shared server API key for metadata search. No personal data access.
              </p>
            </div>
            <div className={`option-badge ${hasServerKey ? 'active' : 'inactive'}`}>
              {hasServerKey ? 'Enabled' : 'Disabled'}
            </div>
          </div>
          <div className="option-features">
            <ul>
              <li>✅ Metadata search (title, author, ISBN lookup)</li>
              <li>❌ Reading progress sync</li>
              <li>❌ Personal "want to read" list</li>
              <li>❌ Edition linking</li>
            </ul>
          </div>
        </div>

        {/* Personal Account (Advanced) */}
        <div className="option-card">
          <div className="option-header">
            <div className="option-info">
              <h4 className="option-title">Personal Account (Advanced Features)</h4>
              <p className="option-description">
                Connect your own Hardcover account for personalized features and data sync.
              </p>
            </div>
            <div className={`option-badge ${hasUserConnection ? 'active' : 'inactive'}`}>
              {hasUserConnection ? 'Connected' : 'Not Connected'}
            </div>
          </div>

          {hasUserConnection ? (
            <div className="option-features">
              <ul>
                <li>✅ All basic features</li>
                <li>✅ Sync reading progress</li>
                <li>✅ Import "want to read" list</li>
                <li>✅ Link audiobooks to Hardcover editions</li>
              </ul>

              <div className="connected-actions">
                <button className="settings-btn small" onClick={handleTestConnection} disabled={testing}>
                  {testing ? 'Testing...' : 'Test Connection'}
                </button>

                {testStatus === 'success' && (
                  <span className="success-message">✓ Connection successful</span>
                )}
                {testStatus === 'error' && (
                  <span className="error-message">✗ Connection failed</span>
                )}

                <button className="settings-btn small danger" onClick={handleDeleteApiKey}>
                  Remove Connection
                </button>
              </div>
            </div>
          ) : (
            <div className="option-features">
              <p className="option-prompt">Connect your personal account to enable advanced features:</p>
              <form onSubmit={handleSaveApiKey} className="api-key-form">
                <div className="form-field">
                  <label htmlFor="hardcover-api-key">Hardcover API Key</label>
                  <input
                    id="hardcover-api-key"
                    name="hardcover-api-key"
                    type="password"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder="Enter your API key from hardcover.app/account/api"
                    required
                  />
                </div>

                <div className="form-help">
                  <p>
                    <strong>Get your API key:</strong>{' '}
                    <a href="https://hardcover.app/account/api" target="_blank" rel="noopener noreferrer">
                      hardcover.app/account/api
                    </a>
                  </p>
                  <p className="text-small">
                    Tokens expire annually and reset on January 1st. Rate limit: 60 req/min.
                  </p>
                </div>

                {saveStatus === 'success' && (
                  <div className="success-message">
                    ✓ API key saved successfully
                  </div>
                )}
                {saveStatus === 'error' && (
                  <div className="error-message">
                    ✗ Failed to save API key
                  </div>
                )}

                <button
                  type="submit"
                  className="settings-btn primary"
                  disabled={testing || !apiKey.trim()}
                >
                  {testing ? 'Saving...' : 'Connect Account'}
                </button>
              </form>
            </div>
          )}
        </div>

        {/* Sync Toggle */}
        {hasUserConnection && (
          <div className="sync-section">
            <h4 className="settings-subtitle">Sync Settings</h4>
            <div className="sync-controls">
              <label className="toggle-label">
                <input
                  id="hardcover-sync-enabled"
                  name="hardcover-sync-enabled"
                  type="checkbox"
                  checked={config.syncEnabled}
                  onChange={handleToggleSync}
                />
                <span>Enable reading progress sync with Hardcover</span>
              </label>
              <p className="text-small text-muted">
                When enabled, your reading progress will be synced to your Hardcover account automatically.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Server-wide API Key Configuration (Admin Only) */}
      {currentUser?.is_admin && (
        <div className="settings-section admin-section">
          <h3 className="settings-subtitle">
            Server-wide Configuration
            <span className="admin-badge">Admin Only</span>
          </h3>

          <div className="option-card">
            <div className="option-header">
              <div className="option-info">
                <h4 className="option-title">Server-wide API Key</h4>
                <p className="option-description">
                  Configure a server-wide Hardcover API key for basic metadata search available to all users.
                </p>
              </div>
            </div>

            <div className="server-key-form">
              <div className="form-field">
                <label htmlFor="server-api-key">Server-wide Hardcover API Key</label>
                <input
                  id="server-api-key"
                  name="server-api-key"
                  type="password"
                  value={serverApiKey}
                  onChange={(e) => setServerApiKey(e.target.value)}
                  placeholder="Enter 40-character API key (or leave empty to disable)"
                  maxLength={40}
                />
              </div>

              <div className="form-help">
                <p>
                  <strong>Get your API key:</strong>{' '}
                  <a href="https://hardcover.app/account/api" target="_blank" rel="noopener noreferrer">
                    hardcover.app/account/api
                  </a>
                </p>
                <p className="text-small">
                  This enables basic metadata search for all users. Leave empty to disable server-wide access.
                  Tokens expire annually and reset on January 1st. Rate limit: 60 req/min shared by all users.
                </p>
              </div>

              {serverKeyStatus === 'success' && (
                <div className="success-message">
                  ✓ Server API key saved successfully
                </div>
              )}
              {serverKeyStatus === 'error' && (
                <div className="error-message">
                  ✗ Failed to save server API key
                </div>
              )}

              <div className="form-actions">
                <button
                  className="settings-btn primary"
                  onClick={handleSaveServerApiKey}
                  disabled={serverKeySaving}
                >
                  {serverKeySaving ? 'Saving...' : 'Save Server Key'}
                </button>
                {serverApiKey && (
                  <button
                    className="settings-btn secondary"
                    onClick={() => {
                      setServerApiKey('');
                      handleSaveServerApiKey();
                    }}
                    disabled={serverKeySaving}
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Help & Documentation */}
      <div className="settings-section">
        <h3 className="settings-subtitle">Help & Resources</h3>

        <div className="help-links">
          <h4>Getting Started</h4>
          <ul>
            <li>
              <a href="https://hardcover.app" target="_blank" rel="noopener noreferrer">
                Get a Hardcover account
              </a>
            </li>
            <li>
              <a href="https://hardcover.app/account/api" target="_blank" rel="noopener noreferrer">
                Generate your API key
              </a>
            </li>
            <li>
              <a href="https://docs.hardcover.app/api/getting-started/" target="_blank" rel="noopener noreferrer">
                API documentation
              </a>
            </li>
          </ul>

          <h4>Features</h4>
          <ul>
            <li><strong>Metadata Search:</strong> Find audiobooks by title, author, or ISBN</li>
            <li><strong>Progress Sync:</strong> Sync your reading position across devices</li>
            <li><strong>Edition Linking:</strong> Connect Sappho audiobooks to Hardcover editions</li>
            <li><strong>Want to Read:</strong> Import your reading list to Sappho</li>
          </ul>

          <h4>Privacy & Security</h4>
          <ul>
            <li>API keys are encrypted and stored securely</li>
            <li>Your personal data is never shared</li>
            <li>You can revoke access at any time</li>
            <li>Server-wide key only accesses public metadata</li>
          </ul>
        </div>
      </div>
    </div>
  );
}

export default HardcoverSettings;