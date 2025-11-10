import { useState, useEffect } from 'react';
import axios from 'axios';
import './ProfileSettings.css';

export default function ProfileSettings() {
  const [profile, setProfile] = useState({
    username: '',
    email: '',
    displayName: '',
    avatar: null
  });
  const [avatarPreview, setAvatarPreview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadProfile();
  }, []);

  const loadProfile = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await axios.get('/api/profile', {
        headers: { Authorization: `Bearer ${token}` }
      });
      setProfile(response.data);
      if (response.data.avatar) {
        setAvatarPreview(`/api/profile/avatar?token=${encodeURIComponent(token)}`);
      }
    } catch (error) {
      console.error('Error loading profile:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleAvatarChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      if (file.size > 5 * 1024 * 1024) { // 5MB limit
        alert('File size must be less than 5MB');
        return;
      }
      setProfile({ ...profile, avatar: file });
      setAvatarPreview(URL.createObjectURL(file));
    }
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);

    try {
      const token = localStorage.getItem('token');
      const formData = new FormData();

      if (profile.displayName) {
        formData.append('displayName', profile.displayName);
      }
      if (profile.email) {
        formData.append('email', profile.email);
      }
      if (profile.avatar instanceof File) {
        formData.append('avatar', profile.avatar);
      }

      await axios.put('/api/profile', formData, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'multipart/form-data'
        }
      });

      alert('Profile updated successfully');
      loadProfile();
    } catch (error) {
      console.error('Error saving profile:', error);
      alert(error.response?.data?.error || 'Failed to update profile');
    } finally {
      setSaving(false);
    }
  };

  const handleRemoveAvatar = async () => {
    if (!confirm('Remove avatar?')) return;

    try {
      const token = localStorage.getItem('token');
      await axios.delete('/api/profile/avatar', {
        headers: { Authorization: `Bearer ${token}` }
      });
      setProfile({ ...profile, avatar: null });
      setAvatarPreview(null);
      alert('Avatar removed successfully');
    } catch (error) {
      console.error('Error removing avatar:', error);
      alert('Failed to remove avatar');
    }
  };

  if (loading) {
    return <div className="loading">Loading profile...</div>;
  }

  return (
    <div className="tab-content profile-settings">
      <div className="section-header">
        <div>
          <h2>Profile Settings</h2>
          <p className="section-description">
            Manage your personal information and avatar.
          </p>
        </div>
      </div>

      <form onSubmit={handleSave} className="profile-form">
        <div className="avatar-section">
          <div className="avatar-preview">
            {avatarPreview ? (
              <img src={avatarPreview} alt="Avatar" />
            ) : (
              <div className="avatar-placeholder">
                {profile.displayName ? profile.displayName.charAt(0).toUpperCase() : profile.username.charAt(0).toUpperCase()}
              </div>
            )}
          </div>
          <div className="avatar-actions">
            <label className="btn btn-secondary">
              <input
                type="file"
                accept="image/*"
                onChange={handleAvatarChange}
                style={{ display: 'none' }}
              />
              Upload Avatar
            </label>
            {avatarPreview && (
              <button
                type="button"
                className="btn btn-danger btn-small"
                onClick={handleRemoveAvatar}
              >
                Remove
              </button>
            )}
          </div>
        </div>

        <div className="form-group">
          <label>Username</label>
          <input
            type="text"
            className="input"
            value={profile.username}
            disabled
          />
          <p className="help-text">Username cannot be changed</p>
        </div>

        <div className="form-group">
          <label htmlFor="displayName">Display Name</label>
          <input
            type="text"
            id="displayName"
            className="input"
            value={profile.displayName || ''}
            onChange={(e) => setProfile({ ...profile, displayName: e.target.value })}
            placeholder="Your display name"
          />
          <p className="help-text">This is how your name will be displayed</p>
        </div>

        <div className="form-group">
          <label htmlFor="email">Email</label>
          <input
            type="email"
            id="email"
            className="input"
            value={profile.email || ''}
            onChange={(e) => setProfile({ ...profile, email: e.target.value })}
            placeholder="your.email@example.com"
          />
        </div>

        <div className="form-actions">
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </form>
    </div>
  );
}
