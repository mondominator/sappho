import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { getApiKeys, createApiKey, updateApiKey, deleteApiKey, getUsers, createUser, updateUser, deleteUser, getProfile } from '../api';
import LibrarySettings from '../components/settings/LibrarySettings';
import ServerSettings from '../components/settings/ServerSettings';
import JobsSettings from '../components/settings/JobsSettings';
import LogsSettings from '../components/settings/LogsSettings';
import AISettings from '../components/settings/AISettings';
import StatisticsSettings from '../components/settings/StatisticsSettings';
import BackupSettings from '../components/settings/BackupSettings';
import EmailSettings from '../components/settings/EmailSettings';
import './Settings.css';

export default function Settings() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('library');
  const [apiKeys, setApiKeys] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newKeyName, setNewKeyName] = useState('');
  const [expiresInDays, setExpiresInDays] = useState('');
  const [newKeyData, setNewKeyData] = useState(null);
  const [copiedKey, setCopiedKey] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);
  const [accessChecked, setAccessChecked] = useState(false);

  // User management state
  const [showUserForm, setShowUserForm] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  const [userFormData, setUserFormData] = useState({
    username: '',
    password: '',
    confirmPassword: '',
    email: '',
    is_admin: false
  });
  const [showPassword, setShowPassword] = useState(false);
  const [passwordError, setPasswordError] = useState('');

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
    } else if (activeTab === 'users') {
      loadUsers();
    } else {
      // For library, jobs, logs tabs - no initial loading needed
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

  const loadUsers = async () => {
    setLoading(true);
    try {
      const response = await getUsers();
      setUsers(response.data);
    } catch (error) {
      console.error('Error loading users:', error);
      if (error.response?.status === 403) {
        alert('Admin privileges required to view users');
      }
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
  const validatePasswordRequirements = (password) => {
    const errors = [];
    if (password.length < 6) errors.push('At least 6 characters');
    if (!/[A-Z]/.test(password)) errors.push('One uppercase letter');
    if (!/[a-z]/.test(password)) errors.push('One lowercase letter');
    if (!/[0-9]/.test(password)) errors.push('One number');
    if (!/[^A-Za-z0-9]/.test(password)) errors.push('One special character');
    return errors;
  };

  // User management handlers
  const handleCreateUser = async (e) => {
    e.preventDefault();
    setPasswordError('');

    // Validate password requirements
    const passwordErrors = validatePasswordRequirements(userFormData.password);
    if (passwordErrors.length > 0) {
      setPasswordError(`Password requires: ${passwordErrors.join(', ')}`);
      return;
    }

    // Validate passwords match
    if (userFormData.password !== userFormData.confirmPassword) {
      setPasswordError('Passwords do not match');
      return;
    }

    try {
      await createUser(
        userFormData.username,
        userFormData.password,
        userFormData.email,
        userFormData.is_admin
      );
      setUserFormData({ username: '', password: '', confirmPassword: '', email: '', is_admin: false });
      setShowUserForm(false);
      setShowPassword(false);
      loadUsers();
      alert('User created successfully');
    } catch (error) {
      console.error('Error creating user:', error);
      alert(error.response?.data?.error || 'Failed to create user');
    }
  };

  const handleUpdateUser = async (e) => {
    e.preventDefault();
    try {
      const updates = {
        username: userFormData.username,
        email: userFormData.email,
        is_admin: userFormData.is_admin
      };
      if (userFormData.password) {
        updates.password = userFormData.password;
      }
      await updateUser(editingUser.id, updates);
      setUserFormData({ username: '', password: '', confirmPassword: '', email: '', is_admin: false });
      setEditingUser(null);
      setShowPassword(false);
      loadUsers();
      alert('User updated successfully');
    } catch (error) {
      console.error('Error updating user:', error);
      alert(error.response?.data?.error || 'Failed to update user');
    }
  };

  const handleDeleteUser = async (user) => {
    if (!confirm(`Delete user "${user.username}"? This action cannot be undone.`)) {
      return;
    }

    try {
      await deleteUser(user.id);
      loadUsers();
      alert('User deleted successfully');
    } catch (error) {
      console.error('Error deleting user:', error);
      alert(error.response?.data?.error || 'Failed to delete user');
    }
  };

  const startEditUser = (user) => {
    setEditingUser(user);
    setUserFormData({
      username: user.username,
      password: '',
      confirmPassword: '',
      email: user.email || '',
      is_admin: user.is_admin === 1
    });
    setShowUserForm(false);
    setShowPassword(false);
    setPasswordError('');
  };

  const cancelEditUser = () => {
    setEditingUser(null);
    setUserFormData({ username: '', password: '', confirmPassword: '', email: '', is_admin: false });
    setShowPassword(false);
    setPasswordError('');
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

  const renderTabContent = () => {
    if (loading && (activeTab === 'api-keys' || activeTab === 'users')) {
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
        return renderUsersTab();
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

  const renderUsersTab = () => (
    <div className="tab-content">
      <div className="section-header">
        <div>
          <h2>User Management</h2>
          <p className="section-description">
            Manage user accounts and permissions. Admin users have full access to all features.
          </p>
        </div>
        {!showUserForm && !editingUser && (
          <button
            className="btn btn-primary"
            onClick={() => setShowUserForm(true)}
          >
            Create User
          </button>
        )}
      </div>

      {showUserForm && (
        <div className="user-form-container">
          <h3>Create New User</h3>
          <form onSubmit={handleCreateUser} className="user-form">
            <div className="form-group">
              <label htmlFor="username">Username *</label>
              <input
                type="text"
                id="username"
                className="input"
                style={{ background: '#1e293b', border: '2px solid #4b5563' }}
                value={userFormData.username}
                onChange={(e) => setUserFormData({ ...userFormData, username: e.target.value })}
                required
              />
            </div>

            <div className="form-group">
              <label htmlFor="password">Password *</label>
              <div className="password-input-wrapper">
                <input
                  type={showPassword ? 'text' : 'password'}
                  id="password"
                  className="input"
                  style={{ background: '#1e293b', border: '2px solid #4b5563', paddingRight: '44px' }}
                  value={userFormData.password}
                  onChange={(e) => {
                    setUserFormData({ ...userFormData, password: e.target.value });
                    setPasswordError('');
                  }}
                  required
                />
                <button
                  type="button"
                  className="password-toggle"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? '👁️' : '👁️‍🗨️'}
                </button>
              </div>
              <small className="password-hint">
                Min 6 chars, uppercase, lowercase, number, special character
              </small>
            </div>

            <div className="form-group">
              <label htmlFor="confirmPassword">Confirm Password *</label>
              <div className="password-input-wrapper">
                <input
                  type={showPassword ? 'text' : 'password'}
                  id="confirmPassword"
                  className="input"
                  style={{ background: '#1e293b', border: '2px solid #4b5563' }}
                  value={userFormData.confirmPassword}
                  onChange={(e) => {
                    setUserFormData({ ...userFormData, confirmPassword: e.target.value });
                    setPasswordError('');
                  }}
                  required
                />
              </div>
            </div>

            {passwordError && (
              <div className="form-error">{passwordError}</div>
            )}

            <div className="form-group">
              <label htmlFor="email">Email</label>
              <input
                type="email"
                id="email"
                className="input"
                style={{ background: '#1e293b', border: '2px solid #4b5563' }}
                value={userFormData.email}
                onChange={(e) => setUserFormData({ ...userFormData, email: e.target.value })}
              />
            </div>

            <div className="form-group checkbox-group">
              <label>
                <input
                  type="checkbox"
                  checked={userFormData.is_admin}
                  onChange={(e) => setUserFormData({ ...userFormData, is_admin: e.target.checked })}
                />
                <span>Administrator</span>
              </label>
            </div>

            <div className="form-actions">
              <button type="submit" className="btn btn-primary">
                Create User
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => {
                  setShowUserForm(false);
                  setUserFormData({ username: '', password: '', confirmPassword: '', email: '', is_admin: false });
                  setShowPassword(false);
                  setPasswordError('');
                }}
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {editingUser && (
        <div className="user-form-container">
          <h3>Edit User: {editingUser.username}</h3>
          <form onSubmit={handleUpdateUser} className="user-form">
            <div className="form-group">
              <label htmlFor="edit-username">Username *</label>
              <input
                type="text"
                id="edit-username"
                className="input"
                style={{ background: '#1e293b', border: '2px solid #4b5563' }}
                value={userFormData.username}
                onChange={(e) => setUserFormData({ ...userFormData, username: e.target.value })}
                required
              />
            </div>

            <div className="form-group">
              <label htmlFor="edit-password">Password (leave blank to keep current)</label>
              <div className="password-input-wrapper">
                <input
                  type={showPassword ? 'text' : 'password'}
                  id="edit-password"
                  className="input"
                  style={{ background: '#1e293b', border: '2px solid #4b5563', paddingRight: '44px' }}
                  value={userFormData.password}
                  onChange={(e) => setUserFormData({ ...userFormData, password: e.target.value })}
                />
                <button
                  type="button"
                  className="password-toggle"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? '👁️' : '👁️‍🗨️'}
                </button>
              </div>
            </div>

            <div className="form-group">
              <label htmlFor="edit-email">Email</label>
              <input
                type="email"
                id="edit-email"
                className="input"
                style={{ background: '#1e293b', border: '2px solid #4b5563' }}
                value={userFormData.email}
                onChange={(e) => setUserFormData({ ...userFormData, email: e.target.value })}
              />
            </div>

            <div className="form-group checkbox-group">
              <label>
                <input
                  type="checkbox"
                  checked={userFormData.is_admin}
                  onChange={(e) => setUserFormData({ ...userFormData, is_admin: e.target.checked })}
                />
                <span>Administrator</span>
              </label>
            </div>

            <div className="form-actions">
              <button type="submit" className="btn btn-primary">
                Update User
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={cancelEditUser}
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="users-table">
        <table>
          <thead>
            <tr>
              <th>Username</th>
              <th>Email</th>
              <th>Role</th>
              <th>Created</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.id}>
                <td data-label="Username">{user.username}</td>
                <td data-label="Email">{user.email || '-'}</td>
                <td data-label="Role">
                  {user.is_admin ? (
                    <span className="badge badge-admin">Admin</span>
                  ) : (
                    <span className="badge badge-user">User</span>
                  )}
                </td>
                <td data-label="Created">{formatDate(user.created_at)}</td>
                <td>
                  <div className="action-buttons">
                    <button
                      className="btn btn-small btn-secondary"
                      onClick={() => startEditUser(user)}
                    >
                      Edit
                    </button>
                    <button
                      className="btn btn-small btn-danger"
                      onClick={() => handleDeleteUser(user)}
                    >
                      Delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {users.length === 0 && (
          <div className="empty-state">
            <p>No users found.</p>
          </div>
        )}
      </div>
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
