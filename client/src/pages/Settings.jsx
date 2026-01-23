import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { getApiKeys, createApiKey, updateApiKey, deleteApiKey, getProfile } from '../api';
import LibrarySettings from '../components/settings/LibrarySettings';
import ServerSettings from '../components/settings/ServerSettings';
import JobsSettings from '../components/settings/JobsSettings';
import LogsSettings from '../components/settings/LogsSettings';
import AISettings from '../components/settings/AISettings';
import StatisticsSettings from '../components/settings/StatisticsSettings';
import BackupSettings from '../components/settings/BackupSettings';
import EmailSettings from '../components/settings/EmailSettings';
import UsersSettings from '../components/settings/UsersSettings';
import './Settings.css';

export default function Settings() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('library');
  const [apiKeys, setApiKeys] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newKeyName, setNewKeyName] = useState('');
  const [expiresInDays, setExpiresInDays] = useState('');
  const [newKeyData, setNewKeyData] = useState(null);
  const [copiedKey, setCopiedKey] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);
  const [accessChecked, setAccessChecked] = useState(false);

  useEffect(() => {
    // Fetch current user profile from server to get up-to-date is_admin status
    // Redirect non-admins away from this page
    const loadCurrentUser = async () => {
      try {
        const response = await getProfile();
        setCurrentUser(response.data);
        // Redirect non-admins to home page
        if (!response.data.is_admin) {
          navigate('/', { replace: true });
          return;
        }
        setAccessChecked(true);
      } catch (error) {
        console.error('Error loading profile:', error);
        // Redirect on error - can't verify admin status
        navigate('/', { replace: true });
      }
    };
    loadCurrentUser();
  }, [navigate]);

  useEffect(() => {
    if (activeTab === 'api-keys') {
      loadApiKeys();
    } else {
      // For other tabs - no initial loading needed
      setLoading(false);
    }
  }, [activeTab]);

  const loadApiKeys = async () => {
    setLoading(true);
    try {
      const response = await getApiKeys();
      setApiKeys(response.data);
    } catch (error) {
      console.error('Error loading API keys:', error);
    } finally {
      setLoading(false);
    }
  };

  
  // API Key handlers
  const handleCreateKey = async (e) => {
    e.preventDefault();
    try {
      const response = await createApiKey(
        newKeyName,
        'read',
        expiresInDays ? parseInt(expiresInDays) : null
      );
      setNewKeyData(response.data);
      setNewKeyName('');
      setExpiresInDays('');
      setShowCreateForm(false);
      loadApiKeys();
    } catch (error) {
      console.error('Error creating API key:', error);
      alert('Failed to create API key');
    }
  };

  const handleDeleteKey = async (id) => {
    if (!confirm('Are you sure you want to delete this API key?')) {
      return;
    }
    try {
      await deleteApiKey(id);
      loadApiKeys();
    } catch (error) {
      console.error('Error deleting API key:', error);
      alert('Failed to delete API key');
    }
  };

  const handleToggleActive = async (id, currentStatus) => {
    try {
      await updateApiKey(id, { is_active: currentStatus ? 0 : 1 });
      loadApiKeys();
    } catch (error) {
      console.error('Error updating API key:', error);
      alert('Failed to update API key');
    }
  };

  // Password validation helper
  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(true);
    setTimeout(() => setCopiedKey(false), 2000);
  };

  const formatDate = (dateString) => {
    if (!dateString) return 'Never';
    return new Date(dateString).toLocaleDateString();
  };

  const renderTabContent = () => {
    if (loading && activeTab === 'api-keys') {
      return <div className="loading">Loading...</div>;
    }

    switch (activeTab) {
      case 'library':
        return <LibrarySettings />;
      case 'server':
        return <ServerSettings />;
      case 'jobs':
        return <JobsSettings />;
      case 'statistics':
        return <StatisticsSettings />;
      case 'backup':
        return <BackupSettings />;
      case 'logs':
        return <LogsSettings />;
      case 'ai':
        return <AISettings />;
      case 'email':
        return <EmailSettings />;
      case 'api-keys':
        return renderApiKeysTab();
      case 'users':
        return <UsersSettings currentUserId={currentUser?.id} />;
      default:
        return null;
    }
  };

  const renderApiKeysTab = () => (
    <div className="tab-content">
      <div className="section-header">
        <div>
          <h2>API Keys</h2>
          <p className="section-description">
            API keys allow external applications to access your Sappho library.
            Keep your API keys secure and never share them publicly.
          </p>
        </div>
        <button
          className="btn btn-primary"
          onClick={() => setShowCreateForm(true)}
        >
          Create New Key
        </button>
      </div>

      {showCreateForm && (
        <div className="modal-overlay" onClick={() => setShowCreateForm(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Create New API Key</h3>
            <form onSubmit={handleCreateKey}>
              <div className="form-group">
                <label>Key Name</label>
                <input
                  type="text"
                  className="input"
                  value={newKeyName}
                  onChange={(e) => setNewKeyName(e.target.value)}
                  placeholder="e.g., OpsDec Integration"
                  required
                />
              </div>
              <div className="form-group">
                <label>Expires In (days, optional)</label>
                <input
                  type="number"
                  className="input"
                  value={expiresInDays}
                  onChange={(e) => setExpiresInDays(e.target.value)}
                  placeholder="Leave empty for no expiration"
                  min="1"
                />
              </div>
              <div className="modal-actions">
                <button type="submit" className="btn btn-primary">
                  Create Key
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setShowCreateForm(false)}
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {newKeyData && (
        <div className="modal-overlay" onClick={() => setNewKeyData(null)}>
          <div className="modal new-key-modal" onClick={(e) => e.stopPropagation()}>
            <h3>API Key Created</h3>
            <div className="warning-box">
              <p className="warning-text">
                Save this key securely - it will not be shown again!
              </p>
            </div>
            <div className="key-display">
              <code>{newKeyData.key}</code>
              <button
                className="btn btn-small"
                onClick={() => copyToClipboard(newKeyData.key)}
              >
                {copiedKey ? 'Copied!' : 'Copy'}
              </button>
            </div>
            <div className="modal-actions">
              <button
                className="btn btn-primary"
                onClick={() => setNewKeyData(null)}
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {apiKeys.length === 0 ? (
        <div className="empty-state">
          <p>No API keys created yet.</p>
        </div>
      ) : (
        <div className="api-keys-table">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Key Prefix</th>
                <th>Status</th>
                <th>Created</th>
                <th>Expires</th>
                <th>Last Used</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {apiKeys.map((key) => (
                <tr key={key.id}>
                  <td className="key-name" data-label="Name">{key.name}</td>
                  <td className="key-prefix" data-label="Key Prefix">
                    <code>{key.key_prefix}...</code>
                  </td>
                  <td data-label="Status">
                    <span className={`status-badge ${key.is_active ? 'active' : 'inactive'}`}>
                      {key.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td data-label="Created">{formatDate(key.created_at)}</td>
                  <td data-label="Expires">{formatDate(key.expires_at)}</td>
                  <td data-label="Last Used">{formatDate(key.last_used_at)}</td>
                  <td className="actions">
                    <button
                      className="btn btn-small btn-secondary"
                      onClick={() => handleToggleActive(key.id, key.is_active)}
                    >
                      {key.is_active ? 'Deactivate' : 'Activate'}
                    </button>
                    <button
                      className="btn btn-small btn-danger"
                      onClick={() => handleDeleteKey(key.id)}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );


  // Don't render anything until access is verified
  if (!accessChecked) {
    return (
      <div className="settings-page container">
        <div className="loading">Verifying access...</div>
      </div>
    );
  }

  return (
    <div className="settings-page container">
      <h1 className="settings-header">Administration</h1>

      <div className="settings-tabs">
        <button
          className={`tab-button ${activeTab === 'library' ? 'active' : ''}`}
          onClick={() => setActiveTab('library')}
        >
          Library
        </button>
        <button
          className={`tab-button ${activeTab === 'server' ? 'active' : ''}`}
          onClick={() => setActiveTab('server')}
        >
          Server
        </button>
        <button
          className={`tab-button ${activeTab === 'jobs' ? 'active' : ''}`}
          onClick={() => setActiveTab('jobs')}
        >
          Jobs
        </button>
        <button
          className={`tab-button ${activeTab === 'statistics' ? 'active' : ''}`}
          onClick={() => setActiveTab('statistics')}
        >
          Statistics
        </button>
        <button
          className={`tab-button ${activeTab === 'backup' ? 'active' : ''}`}
          onClick={() => setActiveTab('backup')}
        >
          Backup
        </button>
        <button
          className={`tab-button ${activeTab === 'logs' ? 'active' : ''}`}
          onClick={() => setActiveTab('logs')}
        >
          Logs
        </button>
        <button
          className={`tab-button ${activeTab === 'ai' ? 'active' : ''}`}
          onClick={() => setActiveTab('ai')}
        >
          AI
        </button>
        <button
          className={`tab-button ${activeTab === 'email' ? 'active' : ''}`}
          onClick={() => setActiveTab('email')}
        >
          Email
        </button>
        <button
          className={`tab-button ${activeTab === 'api-keys' ? 'active' : ''}`}
          onClick={() => setActiveTab('api-keys')}
        >
          API Keys
        </button>
        <button
          className={`tab-button ${activeTab === 'users' ? 'active' : ''}`}
          onClick={() => setActiveTab('users')}
        >
          Users
        </button>
      </div>

      <div className="settings-content">
        {renderTabContent()}
      </div>
    </div>
  );
}
