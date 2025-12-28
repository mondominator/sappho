import { useState, useEffect } from 'react';
import { getUsers, createUser, updateUser, deleteUser, unlockUser, disableUser, enableUser } from '../api';
import './Users.css';

export default function Users() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  const [formData, setFormData] = useState({
    username: '',
    password: '',
    email: '',
    is_admin: false
  });

  useEffect(() => {
    loadUsers();
  }, []);

  const loadUsers = async () => {
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

  const handleCreateUser = async (e) => {
    e.preventDefault();
    try {
      await createUser(
        formData.username,
        formData.password,
        formData.email,
        formData.is_admin
      );
      setFormData({ username: '', password: '', email: '', is_admin: false });
      setShowCreateForm(false);
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
        username: formData.username,
        email: formData.email,
        is_admin: formData.is_admin
      };
      if (formData.password) {
        updates.password = formData.password;
      }
      await updateUser(editingUser.id, updates);
      setFormData({ username: '', password: '', email: '', is_admin: false });
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

  const handleUnlockUser = async (user) => {
    try {
      await unlockUser(user.id);
      loadUsers();
      alert(`Account "${user.username}" unlocked successfully`);
    } catch (error) {
      console.error('Error unlocking user:', error);
      alert(error.response?.data?.error || 'Failed to unlock user');
    }
  };

  const handleDisableUser = async (user) => {
    const reason = prompt(`Disable account "${user.username}"?\n\nOptionally enter a reason:`);
    if (reason === null) {
      return; // User cancelled
    }

    try {
      await disableUser(user.id, reason || null);
      loadUsers();
      alert(`Account "${user.username}" disabled successfully`);
    } catch (error) {
      console.error('Error disabling user:', error);
      alert(error.response?.data?.error || 'Failed to disable user');
    }
  };

  const handleEnableUser = async (user) => {
    try {
      await enableUser(user.id);
      loadUsers();
      alert(`Account "${user.username}" enabled successfully`);
    } catch (error) {
      console.error('Error enabling user:', error);
      alert(error.response?.data?.error || 'Failed to enable user');
    }
  };

  const startEdit = (user) => {
    setEditingUser(user);
    setFormData({
      username: user.username,
      password: '',
      email: user.email || '',
      is_admin: user.is_admin === 1
    });
    setShowCreateForm(false);
  };

  const cancelEdit = () => {
    setEditingUser(null);
    setFormData({ username: '', password: '', email: '', is_admin: false });
  };

  const formatDate = (dateString) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  if (loading) {
    return <div className="loading">Loading users...</div>;
  }

  return (
    <div className="users-page container">
      <div className="users-header">
        <h1>User Management</h1>
        {!showCreateForm && !editingUser && (
          <button
            className="btn btn-primary"
            onClick={() => setShowCreateForm(true)}
          >
            Create User
          </button>
        )}
      </div>

      {showCreateForm && (
        <div className="user-form-container">
          <h2>Create New User</h2>
          <form onSubmit={handleCreateUser} className="user-form">
            <div className="form-group">
              <label htmlFor="username">Username *</label>
              <input
                type="text"
                id="username"
                className="input"
                value={formData.username}
                onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                required
              />
            </div>

            <div className="form-group">
              <label htmlFor="password">Password *</label>
              <input
                type="password"
                id="password"
                className="input"
                value={formData.password}
                onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                required
              />
            </div>

            <div className="form-group">
              <label htmlFor="email">Email</label>
              <input
                type="email"
                id="email"
                className="input"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              />
            </div>

            <div className="form-group checkbox-group">
              <label>
                <input
                  type="checkbox"
                  checked={formData.is_admin}
                  onChange={(e) => setFormData({ ...formData, is_admin: e.target.checked })}
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
                  setShowCreateForm(false);
                  setFormData({ username: '', password: '', email: '', is_admin: false });
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
          <h2>Edit User: {editingUser.username}</h2>
          <form onSubmit={handleUpdateUser} className="user-form">
            <div className="form-group">
              <label htmlFor="edit-username">Username *</label>
              <input
                type="text"
                id="edit-username"
                className="input"
                value={formData.username}
                onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                required
              />
            </div>

            <div className="form-group">
              <label htmlFor="edit-password">Password (leave blank to keep current)</label>
              <input
                type="password"
                id="edit-password"
                className="input"
                value={formData.password}
                onChange={(e) => setFormData({ ...formData, password: e.target.value })}
              />
            </div>

            <div className="form-group">
              <label htmlFor="edit-email">Email</label>
              <input
                type="email"
                id="edit-email"
                className="input"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              />
            </div>

            <div className="form-group checkbox-group">
              <label>
                <input
                  type="checkbox"
                  checked={formData.is_admin}
                  onChange={(e) => setFormData({ ...formData, is_admin: e.target.checked })}
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
                onClick={cancelEdit}
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="users-list">
        <table className="users-table">
          <thead>
            <tr>
              <th>Username</th>
              <th>Email</th>
              <th>Role</th>
              <th>Status</th>
              <th>Created</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.id} className={user.account_disabled ? 'user-disabled' : ''}>
                <td>{user.username}</td>
                <td>{user.email || '-'}</td>
                <td>
                  {user.is_admin ? (
                    <span className="badge badge-admin">Admin</span>
                  ) : (
                    <span className="badge badge-user">User</span>
                  )}
                </td>
                <td>
                  <div className="status-badges">
                    {user.account_disabled ? (
                      <span className="badge badge-disabled" title={user.disabled_reason || 'Account disabled'}>
                        Disabled
                      </span>
                    ) : user.is_locked ? (
                      <span className="badge badge-locked" title={`Locked for ${user.lockout_remaining}s`}>
                        Locked ({user.lockout_remaining}s)
                      </span>
                    ) : (
                      <span className="badge badge-active">Active</span>
                    )}
                  </div>
                </td>
                <td>{formatDate(user.created_at)}</td>
                <td>
                  <div className="action-buttons">
                    {user.is_locked && !user.account_disabled && (
                      <button
                        className="btn btn-small btn-warning"
                        onClick={() => handleUnlockUser(user)}
                        title="Clear lockout"
                      >
                        Unlock
                      </button>
                    )}
                    {user.account_disabled ? (
                      <button
                        className="btn btn-small btn-success"
                        onClick={() => handleEnableUser(user)}
                        title="Enable account"
                      >
                        Enable
                      </button>
                    ) : (
                      <button
                        className="btn btn-small btn-warning"
                        onClick={() => handleDisableUser(user)}
                        title="Disable account"
                      >
                        Disable
                      </button>
                    )}
                    <button
                      className="btn btn-small btn-secondary"
                      onClick={() => startEdit(user)}
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
}
