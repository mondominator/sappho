import { useState, useEffect } from 'react';
import { getApiKeys, createApiKey, updateApiKey, deleteApiKey, getUsers, createUser, updateUser, deleteUser } from '../api';
import LibrarySettings from '../components/settings/LibrarySettings';
import './Settings.css';

export default function Settings() {
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

  // User management state
  const [showUserForm, setShowUserForm] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  const [userFormData, setUserFormData] = useState({
    username: '',
    password: '',
    email: '',
    is_admin: false
  });

  useEffect(() => {
    // Decode JWT to get current user info
    const token = localStorage.getItem('token');
    if (token) {
      try {
        const payload = JSON.parse(atob(token.split('.')[1]));
        setCurrentUser(payload);
      } catch (error) {
        console.error('Error decoding token:', error);
      }
    }
  }, []);

  useEffect(() => {
    if (activeTab === 'api-keys') {
      loadApiKeys();
    } else if (activeTab === 'users') {
      loadUsers();
    } else {
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

  // User management handlers
  const handleCreateUser = async (e) => {
    e.preventDefault();
    try {
      await createUser(
        userFormData.username,
        userFormData.password,
        userFormData.email,
        userFormData.is_admin
      );
      setUserFormData({ username: '', password: '', email: '', is_admin: false });
      setShowUserForm(false);
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
      setUserFormData({ username: '', password: '', email: '', is_admin: false });
      setEditingUser(null);
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
      email: user.email || '',
      is_admin: user.is_admin === 1
    });
    setShowUserForm(false);
  };

  const cancelEditUser = () => {
    setEditingUser(null);
    setUserFormData({ username: '', password: '', email: '', is_admin: false });
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
    if (loading) {
      return <div className="loading">Loading...</div>;
    }

    switch (activeTab) {
      case 'library':
        if (!currentUser?.is_admin) {
          return (
            <div className="tab-content">
              <div className="info-message">
                <h3>Admin Access Required</h3>
                <p>Only administrators can configure library settings.</p>
              </div>
            </div>
          );
        }
        return <LibrarySettings />;

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
            API keys allow external applications to access your Sapho library.
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
                  <td className="key-name">{key.name}</td>
                  <td className="key-prefix">
                    <code>{key.key_prefix}...</code>
                  </td>
                  <td>
                    <span className={`status-badge ${key.is_active ? 'active' : 'inactive'}`}>
                      {key.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td>{formatDate(key.created_at)}</td>
                  <td>{formatDate(key.expires_at)}</td>
                  <td>{formatDate(key.last_used_at)}</td>
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
                value={userFormData.username}
                onChange={(e) => setUserFormData({ ...userFormData, username: e.target.value })}
                required
              />
            </div>

            <div className="form-group">
              <label htmlFor="password">Password *</label>
              <input
                type="password"
                id="password"
                className="input"
                value={userFormData.password}
                onChange={(e) => setUserFormData({ ...userFormData, password: e.target.value })}
                required
              />
            </div>

            <div className="form-group">
              <label htmlFor="email">Email</label>
              <input
                type="email"
                id="email"
                className="input"
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
                  setUserFormData({ username: '', password: '', email: '', is_admin: false });
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
                value={userFormData.username}
                onChange={(e) => setUserFormData({ ...userFormData, username: e.target.value })}
                required
              />
            </div>

            <div className="form-group">
              <label htmlFor="edit-password">Password (leave blank to keep current)</label>
              <input
                type="password"
                id="edit-password"
                className="input"
                value={userFormData.password}
                onChange={(e) => setUserFormData({ ...userFormData, password: e.target.value })}
              />
            </div>

            <div className="form-group">
              <label htmlFor="edit-email">Email</label>
              <input
                type="email"
                id="edit-email"
                className="input"
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
                <td>{user.username}</td>
                <td>{user.email || '-'}</td>
                <td>
                  {user.is_admin ? (
                    <span className="badge badge-admin">Admin</span>
                  ) : (
                    <span className="badge badge-user">User</span>
                  )}
                </td>
                <td>{formatDate(user.created_at)}</td>
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

  return (
    <div className="settings-page container">
      <h1 className="settings-header">Settings</h1>

      <div className="settings-tabs">
        <button
          className={`tab-button ${activeTab === 'library' ? 'active' : ''}`}
          onClick={() => setActiveTab('library')}
        >
          Library
        </button>
        {currentUser?.is_admin && (
          <>
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
          </>
        )}
      </div>

      <div className="settings-content">
        {renderTabContent()}
      </div>
    </div>
  );
}
