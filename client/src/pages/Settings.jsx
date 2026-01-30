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

const sections = [
  { id: 'library', label: 'Library', desc: 'Scan & organize' },
  { id: 'users', label: 'Users', desc: 'Manage accounts' },
  { id: 'jobs', label: 'Jobs', desc: 'Background tasks' },
  { id: 'statistics', label: 'Statistics', desc: 'Usage analytics' },
  { id: 'server', label: 'Server', desc: 'System settings' },
  { id: 'backup', label: 'Backup', desc: 'Export & restore' },
  { id: 'logs', label: 'Logs', desc: 'System logs' },
  { id: 'ai', label: 'AI', desc: 'AI features' },
  { id: 'email', label: 'Email', desc: 'Notifications' },
  { id: 'api-keys', label: 'API Keys', desc: 'External access' },
];

export default function Settings() {
  const navigate = useNavigate();
  const [activeSection, setActiveSection] = useState(null);
  const [apiKeys, setApiKeys] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newKeyName, setNewKeyName] = useState('');
  const [expiresInDays, setExpiresInDays] = useState('');
  const [newKeyData, setNewKeyData] = useState(null);
  const [copiedKey, setCopiedKey] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);
  const [accessChecked, setAccessChecked] = useState(false);

  useEffect(() => {
    const loadCurrentUser = async () => {
      try {
        const response = await getProfile();
        setCurrentUser(response.data);
        if (!response.data.is_admin) {
          navigate('/', { replace: true });
          return;
        }
        setAccessChecked(true);
      } catch (error) {
        navigate('/', { replace: true });
      }
    };
    loadCurrentUser();
  }, [navigate]);

  useEffect(() => {
    if (activeSection === 'api-keys') loadApiKeys();
  }, [activeSection]);

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

  const handleCreateKey = async (e) => {
    e.preventDefault();
    try {
      const response = await createApiKey(newKeyName, 'read', expiresInDays ? parseInt(expiresInDays) : null);
      setNewKeyData(response.data);
      setNewKeyName('');
      setExpiresInDays('');
      setShowCreateForm(false);
      loadApiKeys();
    } catch (error) {
      alert('Failed to create API key');
    }
  };

  const handleDeleteKey = async (id) => {
    if (!confirm('Delete this API key?')) return;
    try {
      await deleteApiKey(id);
      loadApiKeys();
    } catch (error) {
      alert('Failed to delete API key');
    }
  };

  const handleToggleActive = async (id, currentStatus) => {
    try {
      await updateApiKey(id, { is_active: currentStatus ? 0 : 1 });
      loadApiKeys();
    } catch (error) {
      alert('Failed to update API key');
    }
  };

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(true);
    setTimeout(() => setCopiedKey(false), 2000);
  };

  const formatDate = (dateString) => {
    if (!dateString) return 'Never';
    return new Date(dateString).toLocaleDateString();
  };

  const renderContent = () => {
    switch (activeSection) {
      case 'library': return <LibrarySettings />;
      case 'server': return <ServerSettings />;
      case 'jobs': return <JobsSettings />;
      case 'statistics': return <StatisticsSettings />;
      case 'backup': return <BackupSettings />;
      case 'logs': return <LogsSettings />;
      case 'ai': return <AISettings />;
      case 'email': return <EmailSettings />;
      case 'users': return <UsersSettings currentUserId={currentUser?.id} />;
      case 'api-keys': return (
        <div className="settings-content">
          <button className="settings-btn primary full" onClick={() => setShowCreateForm(true)}>
            Create New Key
          </button>

          {loading ? (
            <div className="settings-loading">Loading...</div>
          ) : apiKeys.length === 0 ? (
            <div className="settings-empty">No API keys created yet</div>
          ) : (
            <div className="api-list">
              {apiKeys.map((key) => (
                <div key={key.id} className="api-item">
                  <div className="api-item-header">
                    <span className="api-item-name">{key.name}</span>
                    <span className={`api-item-status ${key.is_active ? 'active' : ''}`}>
                      {key.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </div>
                  <div className="api-item-key">{key.key_prefix}...</div>
                  <div className="api-item-meta">
                    Created {formatDate(key.created_at)}
                    {key.expires_at && ` · Expires ${formatDate(key.expires_at)}`}
                  </div>
                  <div className="api-item-actions">
                    <button className="settings-btn small" onClick={() => handleToggleActive(key.id, key.is_active)}>
                      {key.is_active ? 'Disable' : 'Enable'}
                    </button>
                    <button className="settings-btn small danger" onClick={() => handleDeleteKey(key.id)}>
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {showCreateForm && (
            <div className="modal-overlay" onClick={() => setShowCreateForm(false)}>
              <div className="modal-box" onClick={(e) => e.stopPropagation()}>
                <h3>Create API Key</h3>
                <form onSubmit={handleCreateKey}>
                  <div className="form-field">
                    <label>Name</label>
                    <input
                      type="text"
                      value={newKeyName}
                      onChange={(e) => setNewKeyName(e.target.value)}
                      placeholder="e.g., OpsDec"
                      required
                    />
                  </div>
                  <div className="form-field">
                    <label>Expires in days (optional)</label>
                    <input
                      type="number"
                      value={expiresInDays}
                      onChange={(e) => setExpiresInDays(e.target.value)}
                      placeholder="Leave empty for no expiration"
                      min="1"
                    />
                  </div>
                  <div className="modal-actions">
                    <button type="button" className="settings-btn" onClick={() => setShowCreateForm(false)}>Cancel</button>
                    <button type="submit" className="settings-btn primary">Create</button>
                  </div>
                </form>
              </div>
            </div>
          )}

          {newKeyData && (
            <div className="modal-overlay" onClick={() => setNewKeyData(null)}>
              <div className="modal-box" onClick={(e) => e.stopPropagation()}>
                <h3>API Key Created</h3>
                <div className="warning-box">Save this key now - it won't be shown again!</div>
                <div className="key-display">{newKeyData.key}</div>
                <div className="modal-actions">
                  <button className="settings-btn" onClick={() => copyToClipboard(newKeyData.key)}>
                    {copiedKey ? 'Copied!' : 'Copy'}
                  </button>
                  <button className="settings-btn primary" onClick={() => setNewKeyData(null)}>Done</button>
                </div>
              </div>
            </div>
          )}
        </div>
      );
      default: return null;
    }
  };

  if (!accessChecked) {
    return <div className="settings-page"><div className="settings-loading">Loading...</div></div>;
  }

  return (
    <div className="settings-page">
      {!activeSection ? (
        <>
          <h1 className="settings-title">Admin</h1>
          <div className="settings-menu">
            {sections.map((s) => (
              <button key={s.id} className="settings-menu-item" onClick={() => setActiveSection(s.id)}>
                <div className="settings-menu-text">
                  <span className="settings-menu-label">{s.label}</span>
                  <span className="settings-menu-desc">{s.desc}</span>
                </div>
                <svg className="settings-menu-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M9 18l6-6-6-6" />
                </svg>
              </button>
            ))}
          </div>
        </>
      ) : (
        <>
          <div className="settings-header">
            <button className="settings-back" onClick={() => setActiveSection(null)}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M19 12H5M12 19l-7-7 7-7" />
              </svg>
            </button>
            <h2 className="settings-section-title">{sections.find(s => s.id === activeSection)?.label}</h2>
          </div>
          {renderContent()}
        </>
      )}
    </div>
  );
}
