import { useState, useEffect } from 'react';
import { getUsers, createUser, updateUser, deleteUser, unlockUser, getUserDetails, disableUser, enableUser } from '../../api';
import './UsersSettings.css';

export default function UsersSettings({ currentUserId }) {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  const [selectedUser, setSelectedUser] = useState(null);
  const [userDetails, setUserDetails] = useState(null);
  const [loadingDetails, setLoadingDetails] = useState(false);

  // Form state
  const [formData, setFormData] = useState({
    username: '',
    email: '',
    password: '',
    confirmPassword: '',
    is_admin: false
  });
  const [formErrors, setFormErrors] = useState({});

  const loadUsers = async () => {
    try {
      setLoading(true);
      const response = await getUsers();
      setUsers(response.data);
      setError(null);
    } catch (err) {
      console.error('Error loading users:', err);
      setError('Failed to load users');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadUsers();
  }, []);

  const loadUserDetails = async (userId) => {
    try {
      setLoadingDetails(true);
      const response = await getUserDetails(userId);
      setUserDetails(response.data);
    } catch (err) {
      console.error('Error loading user details:', err);
      setUserDetails(null);
    } finally {
      setLoadingDetails(false);
    }
  };

  const handleViewDetails = async (user) => {
    setSelectedUser(user);
    await loadUserDetails(user.id);
  };

  const handleCloseDetails = () => {
    setSelectedUser(null);
    setUserDetails(null);
  };

  const handleUnlock = async (user) => {
    try {
      await unlockUser(user.id);
      await loadUsers();
      if (selectedUser?.id === user.id) {
        await loadUserDetails(user.id);
      }
    } catch (err) {
      console.error('Error unlocking user:', err);
      alert('Failed to unlock user');
    }
  };

  const handleDisable = async (user) => {
    const reason = prompt('Enter a reason for disabling this account (optional):');
    try {
      await disableUser(user.id, reason);
      await loadUsers();
      if (selectedUser?.id === user.id) {
        await loadUserDetails(user.id);
      }
    } catch (err) {
      console.error('Error disabling user:', err);
      alert(err.response?.data?.error || 'Failed to disable user');
    }
  };

  const handleEnable = async (user) => {
    try {
      await enableUser(user.id);
      await loadUsers();
      if (selectedUser?.id === user.id) {
        await loadUserDetails(user.id);
      }
    } catch (err) {
      console.error('Error enabling user:', err);
      alert('Failed to enable user');
    }
  };

  const validatePassword = (password) => {
    const errors = [];
    if (password.length < 6) errors.push('At least 6 characters');
    if (!/[A-Z]/.test(password)) errors.push('One uppercase letter');
    if (!/[a-z]/.test(password)) errors.push('One lowercase letter');
    if (!/[0-9]/.test(password)) errors.push('One number');
    if (!/[^A-Za-z0-9]/.test(password)) errors.push('One special character');
    return errors;
  };

  const handleCreateUser = async (e) => {
    e.preventDefault();
    const errors = {};

    if (!formData.username.trim()) errors.username = 'Username is required';
    if (!formData.password) errors.password = 'Password is required';
    else {
      const pwdErrors = validatePassword(formData.password);
      if (pwdErrors.length > 0) errors.password = pwdErrors.join(', ');
    }
    if (formData.password !== formData.confirmPassword) {
      errors.confirmPassword = 'Passwords do not match';
    }

    if (Object.keys(errors).length > 0) {
      setFormErrors(errors);
      return;
    }

    try {
      await createUser(formData.username, formData.password, formData.email, formData.is_admin);
      setShowCreateForm(false);
      setFormData({ username: '', email: '', password: '', confirmPassword: '', is_admin: false });
      setFormErrors({});
      await loadUsers();
    } catch (err) {
      setFormErrors({ submit: err.response?.data?.error || 'Failed to create user' });
    }
  };

  const handleEditUser = async (e) => {
    e.preventDefault();
    const errors = {};

    if (!formData.username.trim()) errors.username = 'Username is required';
    if (formData.password) {
      const pwdErrors = validatePassword(formData.password);
      if (pwdErrors.length > 0) errors.password = pwdErrors.join(', ');
      if (formData.password !== formData.confirmPassword) {
        errors.confirmPassword = 'Passwords do not match';
      }
    }

    if (Object.keys(errors).length > 0) {
      setFormErrors(errors);
      return;
    }

    try {
      const updates = {
        username: formData.username,
        email: formData.email,
        is_admin: formData.is_admin
      };
      if (formData.password) updates.password = formData.password;

      await updateUser(editingUser.id, updates);
      setEditingUser(null);
      setFormData({ username: '', email: '', password: '', confirmPassword: '', is_admin: false });
      setFormErrors({});
      await loadUsers();
    } catch (err) {
      setFormErrors({ submit: err.response?.data?.error || 'Failed to update user' });
    }
  };

  const handleDeleteUser = async (user) => {
    if (!confirm(`Are you sure you want to delete user "${user.username}"? This cannot be undone.`)) {
      return;
    }

    try {
      await deleteUser(user.id);
      await loadUsers();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to delete user');
    }
  };

  const startEdit = (user) => {
    setEditingUser(user);
    setFormData({
      username: user.username,
      email: user.email || '',
      password: '',
      confirmPassword: '',
      is_admin: !!user.is_admin
    });
    setFormErrors({});
    setShowCreateForm(false);
  };

  const startCreate = () => {
    setShowCreateForm(true);
    setEditingUser(null);
    setFormData({ username: '', email: '', password: '', confirmPassword: '', is_admin: false });
    setFormErrors({});
  };

  const cancelForm = () => {
    setShowCreateForm(false);
    setEditingUser(null);
    setFormData({ username: '', email: '', password: '', confirmPassword: '', is_admin: false });
    setFormErrors({});
  };

  const formatDuration = (seconds) => {
    if (!seconds || seconds === 0) return '0h';
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    if (hours >= 24) {
      const days = Math.floor(hours / 24);
      const remainingHours = hours % 24;
      return `${days}d ${remainingHours}h`;
    }
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return 'Never';
    return new Date(dateStr).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  if (loading) {
    return <div className="loading">Loading users...</div>;
  }

  if (error) {
    return (
      <div className="tab-content users-settings">
        <div className="error-state">
          <p>{error}</p>
          <button className="btn btn-primary" onClick={loadUsers}>Retry</button>
        </div>
      </div>
    );
  }

  return (
    <div className="tab-content users-settings">
      <div className="section-header">
        <div>
          <h2>User Management</h2>
          <p className="section-description">
            Manage user accounts, unlock locked accounts, and view user activity.
          </p>
        </div>
        <div className="header-actions">
          <button type="button" className="btn btn-secondary" onClick={loadUsers}>
            Refresh
          </button>
          <button type="button" className="btn btn-primary" onClick={startCreate}>
            Add User
          </button>
        </div>
      </div>

      {/* Create/Edit Form */}
      {(showCreateForm || editingUser) && (
        <div className="user-form-section">
          <h3>{editingUser ? 'Edit User' : 'Create New User'}</h3>
          <form onSubmit={editingUser ? handleEditUser : handleCreateUser}>
            <div className="form-row">
              <div className="form-group">
                <label>Username</label>
                <input
                  type="text"
                  value={formData.username}
                  onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                  className={formErrors.username ? 'error' : ''}
                />
                {formErrors.username && <span className="error-text">{formErrors.username}</span>}
              </div>
              <div className="form-group">
                <label>Email</label>
                <input
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                />
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>{editingUser ? 'New Password (leave blank to keep)' : 'Password'}</label>
                <input
                  type="password"
                  value={formData.password}
                  onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                  className={formErrors.password ? 'error' : ''}
                />
                {formErrors.password && <span className="error-text">{formErrors.password}</span>}
              </div>
              <div className="form-group">
                <label>Confirm Password</label>
                <input
                  type="password"
                  value={formData.confirmPassword}
                  onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })}
                  className={formErrors.confirmPassword ? 'error' : ''}
                />
                {formErrors.confirmPassword && <span className="error-text">{formErrors.confirmPassword}</span>}
              </div>
            </div>
            <div className="form-group checkbox-group">
              <label>
                <input
                  type="checkbox"
                  checked={formData.is_admin}
                  onChange={(e) => setFormData({ ...formData, is_admin: e.target.checked })}
                />
                Administrator
              </label>
            </div>
            {formErrors.submit && <div className="error-banner">{formErrors.submit}</div>}
            <div className="form-actions">
              <button type="button" className="btn btn-secondary" onClick={cancelForm}>Cancel</button>
              <button type="submit" className="btn btn-primary">
                {editingUser ? 'Save Changes' : 'Create User'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Users List - Card Based */}
      <div className="users-table">
        {users.map((user) => (
          <div key={user.id} className={`user-card ${user.account_disabled ? 'disabled-row' : ''}`}>
            <div className="user-card-header">
              <div className="user-card-info">
                <span className="user-card-name">{user.username}</span>
                {user.email && <span className="user-card-email">{user.email}</span>}
              </div>
              <div className="user-card-badges">
                {user.account_disabled ? (
                  <span className="status-badge disabled">Disabled</span>
                ) : user.is_locked ? (
                  <span className="status-badge locked">
                    Locked ({Math.ceil(user.lockout_remaining / 60)}m)
                  </span>
                ) : (
                  <span className="status-badge active">Active</span>
                )}
                <span className={`role-badge ${user.is_admin ? 'admin' : 'user'}`}>
                  {user.is_admin ? 'Admin' : 'User'}
                </span>
              </div>
            </div>
            <div className="user-card-meta">
              <span>Created {formatDate(user.created_at)}</span>
            </div>
            <div className="user-card-actions">
              <button
                className="btn btn-secondary"
                onClick={() => handleViewDetails(user)}
              >
                Details
              </button>
              {user.is_locked && (
                <button
                  className="btn btn-warning"
                  onClick={() => handleUnlock(user)}
                >
                  Unlock
                </button>
              )}
              {user.account_disabled ? (
                <button
                  className="btn btn-success"
                  onClick={() => handleEnable(user)}
                >
                  Enable
                </button>
              ) : user.id !== currentUserId && (
                <button
                  className="btn btn-warning"
                  onClick={() => handleDisable(user)}
                >
                  Disable
                </button>
              )}
              <button
                className="btn btn-secondary"
                onClick={() => startEdit(user)}
              >
                Edit
              </button>
              {user.id !== currentUserId && (
                <button
                  className="btn btn-danger"
                  onClick={() => handleDeleteUser(user)}
                >
                  Delete
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* User Details Modal */}
      {selectedUser && (
        <div className="modal-overlay" onClick={handleCloseDetails}>
          <div className="modal-content user-details-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>User Details: {selectedUser.username}</h3>
              <button className="modal-close" onClick={handleCloseDetails}>&times;</button>
            </div>

            {loadingDetails ? (
              <div className="loading">Loading details...</div>
            ) : userDetails ? (
              <div className="user-details-content">
                {/* Account Status */}
                <div className="details-section">
                  <h4>Account Status</h4>
                  <div className="details-grid">
                    <div className="detail-item">
                      <span className="detail-label">Status</span>
                      <span className="detail-value">
                        {userDetails.user.account_disabled ? (
                          <span className="status-badge disabled">Disabled</span>
                        ) : userDetails.loginAttempts.isLocked ? (
                          <span className="status-badge locked">Locked</span>
                        ) : (
                          <span className="status-badge active">Active</span>
                        )}
                      </span>
                    </div>
                    <div className="detail-item">
                      <span className="detail-label">Role</span>
                      <span className="detail-value">
                        <span className={`role-badge ${userDetails.user.is_admin ? 'admin' : 'user'}`}>
                          {userDetails.user.is_admin ? 'Administrator' : 'User'}
                        </span>
                      </span>
                    </div>
                    <div className="detail-item">
                      <span className="detail-label">Created</span>
                      <span className="detail-value">{formatDate(userDetails.user.created_at)}</span>
                    </div>
                    <div className="detail-item">
                      <span className="detail-label">Email</span>
                      <span className="detail-value">{userDetails.user.email || 'Not set'}</span>
                    </div>
                  </div>
                </div>

                {/* Login Attempts */}
                <div className="details-section">
                  <h4>Login Security</h4>
                  <div className="details-grid">
                    <div className="detail-item">
                      <span className="detail-label">Failed Attempts</span>
                      <span className={`detail-value ${userDetails.loginAttempts.count > 0 ? 'warning' : ''}`}>
                        {userDetails.loginAttempts.count} / 5
                      </span>
                    </div>
                    <div className="detail-item">
                      <span className="detail-label">Lockout Status</span>
                      <span className="detail-value">
                        {userDetails.loginAttempts.isLocked ? (
                          <>
                            Locked for {Math.ceil(userDetails.loginAttempts.remainingSeconds / 60)} minutes
                            <button
                              className="btn btn-sm btn-warning inline-btn"
                              onClick={() => handleUnlock(selectedUser)}
                            >
                              Unlock
                            </button>
                          </>
                        ) : (
                          'Not locked'
                        )}
                      </span>
                    </div>
                  </div>
                  {userDetails.user.account_disabled && (
                    <div className="disabled-info">
                      <p><strong>Account Disabled</strong></p>
                      <p>Disabled: {formatDate(userDetails.user.disabled_at)}</p>
                      {userDetails.user.disabled_reason && (
                        <p>Reason: {userDetails.user.disabled_reason}</p>
                      )}
                      <button
                        className="btn btn-sm btn-success"
                        onClick={() => handleEnable(selectedUser)}
                      >
                        Enable Account
                      </button>
                    </div>
                  )}
                </div>

                {/* Listening Statistics */}
                <div className="details-section">
                  <h4>Listening Statistics</h4>
                  <div className="details-grid">
                    <div className="detail-item">
                      <span className="detail-label">Books Started</span>
                      <span className="detail-value">{userDetails.listeningStats.booksStarted}</span>
                    </div>
                    <div className="detail-item">
                      <span className="detail-label">Books Completed</span>
                      <span className="detail-value">{userDetails.listeningStats.booksCompleted}</span>
                    </div>
                    <div className="detail-item">
                      <span className="detail-label">Total Listen Time</span>
                      <span className="detail-value">
                        {formatDuration(userDetails.listeningStats.totalListenTimeSeconds)}
                      </span>
                    </div>
                    <div className="detail-item">
                      <span className="detail-label">Last Activity</span>
                      <span className="detail-value">
                        {formatDate(userDetails.listeningStats.lastActivity)}
                      </span>
                    </div>
                    <div className="detail-item">
                      <span className="detail-label">API Keys</span>
                      <span className="detail-value">{userDetails.apiKeysCount}</span>
                    </div>
                  </div>
                </div>

                {/* Recent Activity */}
                {userDetails.recentActivity.length > 0 && (
                  <div className="details-section">
                    <h4>Recent Activity</h4>
                    <div className="recent-activity-list">
                      {userDetails.recentActivity.map((item) => (
                        <div key={item.audiobook_id} className="activity-item">
                          <div className="activity-info">
                            <span className="activity-title">{item.title}</span>
                            <span className="activity-author">{item.author}</span>
                          </div>
                          <div className="activity-meta">
                            <span className={`completion-badge ${item.completed ? 'completed' : ''}`}>
                              {item.completed ? 'Completed' : formatDuration(item.position)}
                            </span>
                            <span className="activity-date">{formatDate(item.lastPlayed)}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="error-state">Failed to load user details</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
