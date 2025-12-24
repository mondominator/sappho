import { useState, useEffect } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import { getCoverUrl, getMFAStatus, setupMFA, verifyMFASetup, disableMFA, regenerateBackupCodes, getEmailStatus, getNotificationPreferences, updateNotificationPreferences } from '../api';
import './Profile.css';

// Helper to format duration in seconds to readable string
const formatDuration = (seconds) => {
  if (!seconds || seconds === 0) return '0m';

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
};

// Format large durations (days, hours)
const formatLargeDuration = (seconds) => {
  if (!seconds || seconds === 0) return '0 minutes';

  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  if (days > 0) {
    return `${days} day${days !== 1 ? 's' : ''}, ${hours} hr${hours !== 1 ? 's' : ''}`;
  }
  if (hours > 0) {
    return `${hours} hour${hours !== 1 ? 's' : ''}, ${minutes} min`;
  }
  return `${minutes} minute${minutes !== 1 ? 's' : ''}`;
};

// Format date to relative or absolute
const formatDate = (dateString) => {
  const date = new Date(dateString);
  const now = new Date();
  const diff = now - date;
  const days = Math.floor(diff / 86400000);

  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  if (days < 30) return `${Math.floor(days / 7)} week${Math.floor(days / 7) !== 1 ? 's' : ''} ago`;

  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

export default function Profile() {
  const navigate = useNavigate();
  const [profile, setProfile] = useState({
    username: '',
    email: '',
    displayName: '',
    avatar: null,
    is_admin: false,
    created_at: null
  });
  const [stats, setStats] = useState(null);
  const [avatarPreview, setAvatarPreview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [statsLoading, setStatsLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState('stats');
  const [passwordData, setPasswordData] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: ''
  });
  const [changingPassword, setChangingPassword] = useState(false);
  const [passwordError, setPasswordError] = useState('');

  // MFA state
  const [mfaStatus, setMfaStatus] = useState({ enabled: false, remainingBackupCodes: 0 });
  const [mfaLoading, setMfaLoading] = useState(false);
  const [mfaSetupData, setMfaSetupData] = useState(null);
  const [mfaVerifyCode, setMfaVerifyCode] = useState('');
  const [mfaError, setMfaError] = useState('');
  const [mfaBackupCodes, setMfaBackupCodes] = useState(null);
  const [mfaDisableCode, setMfaDisableCode] = useState('');

  // Notification preferences state
  const [emailStatus, setEmailStatus] = useState({ configured: false, enabled: false });
  const [notifPrefs, setNotifPrefs] = useState({
    email_new_audiobook: false,
    email_weekly_summary: false,
    email_recommendations: false,
    email_enabled: true
  });
  const [notifLoading, setNotifLoading] = useState(false);
  const [notifSaving, setNotifSaving] = useState(false);
  const [notifMessage, setNotifMessage] = useState(null);

  useEffect(() => {
    loadProfile();
    loadStats();
    loadMFAStatus();
    loadNotificationPrefs();
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

  const loadStats = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await axios.get('/api/profile/stats', {
        headers: { Authorization: `Bearer ${token}` }
      });
      setStats(response.data);
    } catch (error) {
      console.error('Error loading stats:', error);
    } finally {
      setStatsLoading(false);
    }
  };

  const loadMFAStatus = async () => {
    try {
      const response = await getMFAStatus();
      setMfaStatus(response.data);
    } catch (error) {
      console.error('Error loading MFA status:', error);
    }
  };

  const loadNotificationPrefs = async () => {
    setNotifLoading(true);
    try {
      const [statusRes, prefsRes] = await Promise.all([
        getEmailStatus(),
        getNotificationPreferences()
      ]);
      setEmailStatus(statusRes.data);
      setNotifPrefs(prefsRes.data);
    } catch (error) {
      console.error('Error loading notification preferences:', error);
    } finally {
      setNotifLoading(false);
    }
  };

  const handleNotifPrefChange = (key, value) => {
    setNotifPrefs(prev => ({ ...prev, [key]: value }));
  };

  const handleSaveNotifPrefs = async () => {
    setNotifSaving(true);
    setNotifMessage(null);
    try {
      await updateNotificationPreferences(notifPrefs);
      setNotifMessage({ type: 'success', text: 'Notification preferences saved' });
    } catch (error) {
      console.error('Error saving notification preferences:', error);
      setNotifMessage({ type: 'error', text: error.response?.data?.error || 'Failed to save preferences' });
    } finally {
      setNotifSaving(false);
    }
  };

  const handleStartMFASetup = async () => {
    setMfaLoading(true);
    setMfaError('');
    try {
      const response = await setupMFA();
      setMfaSetupData(response.data);
    } catch (error) {
      setMfaError(error.response?.data?.error || 'Failed to start MFA setup');
    } finally {
      setMfaLoading(false);
    }
  };

  const handleVerifyMFASetup = async (e) => {
    e.preventDefault();
    setMfaLoading(true);
    setMfaError('');
    try {
      const response = await verifyMFASetup(mfaSetupData.secret, mfaVerifyCode);
      setMfaBackupCodes(response.data.backupCodes);
      setMfaSetupData(null);
      setMfaVerifyCode('');
      loadMFAStatus();
    } catch (error) {
      setMfaError(error.response?.data?.error || 'Failed to verify MFA');
    } finally {
      setMfaLoading(false);
    }
  };

  const handleDisableMFA = async (e) => {
    e.preventDefault();
    if (!window.confirm('Are you sure you want to disable two-factor authentication?')) {
      return;
    }
    setMfaLoading(true);
    setMfaError('');
    try {
      await disableMFA(mfaDisableCode, null);
      setMfaDisableCode('');
      loadMFAStatus();
      alert('Two-factor authentication disabled');
    } catch (error) {
      setMfaError(error.response?.data?.error || 'Failed to disable MFA');
    } finally {
      setMfaLoading(false);
    }
  };

  const handleRegenerateBackupCodes = async () => {
    const code = window.prompt('Enter your current MFA code to regenerate backup codes:');
    if (!code) return;

    setMfaLoading(true);
    setMfaError('');
    try {
      const response = await regenerateBackupCodes(code);
      setMfaBackupCodes(response.data.backupCodes);
      loadMFAStatus();
    } catch (error) {
      setMfaError(error.response?.data?.error || 'Failed to regenerate backup codes');
    } finally {
      setMfaLoading(false);
    }
  };

  const handleCancelMFASetup = () => {
    setMfaSetupData(null);
    setMfaVerifyCode('');
    setMfaError('');
  };

  const handleDismissBackupCodes = () => {
    setMfaBackupCodes(null);
  };

  const handleAvatarChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      if (file.size > 5 * 1024 * 1024) {
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
      await loadProfile();

      // Dispatch a custom event to notify other components (like Navigation)
      window.dispatchEvent(new CustomEvent('profileUpdated'));
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

      // Dispatch event to notify other components
      window.dispatchEvent(new CustomEvent('profileUpdated'));
    } catch (error) {
      console.error('Error removing avatar:', error);
      alert('Failed to remove avatar');
    }
  };

  const getProgressPercent = (position, duration) => {
    if (!duration || duration === 0) return 0;
    return Math.min(100, Math.round((position / duration) * 100));
  };

  const handlePasswordChange = async (e) => {
    e.preventDefault();
    setPasswordError('');

    if (passwordData.newPassword !== passwordData.confirmPassword) {
      setPasswordError('New passwords do not match');
      return;
    }

    if (passwordData.newPassword.length < 6) {
      setPasswordError('New password must be at least 6 characters');
      return;
    }

    setChangingPassword(true);

    try {
      const token = localStorage.getItem('token');
      await axios.put('/api/profile/password', {
        currentPassword: passwordData.currentPassword,
        newPassword: passwordData.newPassword
      }, {
        headers: { Authorization: `Bearer ${token}` }
      });

      alert('Password changed successfully');
      setPasswordData({ currentPassword: '', newPassword: '', confirmPassword: '' });
    } catch (error) {
      console.error('Error changing password:', error);
      setPasswordError(error.response?.data?.error || 'Failed to change password');
    } finally {
      setChangingPassword(false);
    }
  };

  if (loading) {
    return <div className="loading">Loading profile...</div>;
  }

  return (
    <div className="profile-page container">
      <div className="profile-content">
        {/* Profile Header Card */}
        <div className="profile-card">
          <div className="avatar-section">
            <div className="avatar-preview-large">
              {avatarPreview ? (
                <img src={avatarPreview} alt="Avatar" />
              ) : (
                <div className="avatar-placeholder-large">
                  {profile.displayName ? profile.displayName.charAt(0).toUpperCase() : profile.username.charAt(0).toUpperCase()}
                </div>
              )}
            </div>
            <div className="avatar-info">
              <h3>{profile.displayName || profile.username}</h3>
              <p className="user-role">{profile.is_admin ? 'Administrator' : 'User'}</p>
              {profile.created_at && (
                <p className="member-since">Member since {new Date(profile.created_at).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</p>
              )}
            </div>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="profile-tabs">
          <button
            className={`profile-tab ${activeTab === 'stats' ? 'active' : ''}`}
            onClick={() => setActiveTab('stats')}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 3v18h18"/>
              <path d="M18 17V9"/>
              <path d="M13 17V5"/>
              <path d="M8 17v-3"/>
            </svg>
            Statistics
          </button>
          <button
            className={`profile-tab ${activeTab === 'settings' ? 'active' : ''}`}
            onClick={() => setActiveTab('settings')}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3"/>
              <path d="M12 1v6m0 6v6"/>
            </svg>
            Settings
          </button>
          <button
            className={`profile-tab ${activeTab === 'security' ? 'active' : ''}`}
            onClick={() => setActiveTab('security')}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
              <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
            </svg>
            Security
          </button>
          <button
            className={`profile-tab ${activeTab === 'notifications' ? 'active' : ''}`}
            onClick={() => setActiveTab('notifications')}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
              <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
            </svg>
            Notifications
          </button>
        </div>

        {/* Stats Tab */}
        {activeTab === 'stats' && (
          <div className="stats-container">
            {statsLoading ? (
              <div className="stats-loading">Loading your stats...</div>
            ) : stats ? (
              <>
                {/* Quick Stats Grid */}
                <div className="stats-grid">
                  <div className="stat-card primary">
                    <div className="stat-icon">
                      <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="10"/>
                        <polyline points="12 6 12 12 16 14"/>
                      </svg>
                    </div>
                    <div className="stat-content">
                      <span className="stat-value">{formatLargeDuration(stats.totalListenTime)}</span>
                      <span className="stat-label">Total Listen Time</span>
                    </div>
                  </div>

                  <div className="stat-card">
                    <div className="stat-icon">
                      <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/>
                        <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
                      </svg>
                    </div>
                    <div className="stat-content">
                      <span className="stat-value">{stats.booksStarted}</span>
                      <span className="stat-label">Books Started</span>
                    </div>
                  </div>

                  <div className="stat-card success">
                    <div className="stat-icon">
                      <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
                        <polyline points="22 4 12 14.01 9 11.01"/>
                      </svg>
                    </div>
                    <div className="stat-content">
                      <span className="stat-value">{stats.booksCompleted}</span>
                      <span className="stat-label">Books Completed</span>
                    </div>
                  </div>

                  <div className="stat-card warning">
                    <div className="stat-icon">
                      <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polygon points="5 3 19 12 5 21 5 3"/>
                      </svg>
                    </div>
                    <div className="stat-content">
                      <span className="stat-value">{stats.currentlyListening}</span>
                      <span className="stat-label">In Progress</span>
                    </div>
                  </div>

                  <div className="stat-card streak">
                    <div className="stat-icon">
                      <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M12 2L2 7l10 5 10-5-10-5z"/>
                        <path d="M2 17l10 5 10-5"/>
                        <path d="M2 12l10 5 10-5"/>
                      </svg>
                    </div>
                    <div className="stat-content">
                      <span className="stat-value">{stats.currentStreak} day{stats.currentStreak !== 1 ? 's' : ''}</span>
                      <span className="stat-label">Current Streak</span>
                    </div>
                  </div>

                  <div className="stat-card">
                    <div className="stat-icon">
                      <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
                        <line x1="16" y1="2" x2="16" y2="6"/>
                        <line x1="8" y1="2" x2="8" y2="6"/>
                        <line x1="3" y1="10" x2="21" y2="10"/>
                      </svg>
                    </div>
                    <div className="stat-content">
                      <span className="stat-value">{stats.activeDaysLast30}</span>
                      <span className="stat-label">Active Days (30d)</span>
                    </div>
                  </div>
                </div>

                {/* Top Authors & Genres */}
                <div className="stats-row">
                  {stats.topAuthors && stats.topAuthors.length > 0 && (
                    <div className="stats-section">
                      <h4>
                        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                          <circle cx="12" cy="7" r="4"/>
                        </svg>
                        Top Authors
                      </h4>
                      <div className="top-list">
                        {stats.topAuthors.map((author, index) => (
                          <div key={author.author} className="top-item">
                            <span className="top-rank">#{index + 1}</span>
                            <div className="top-info">
                              <span className="top-name">{author.author}</span>
                              <span className="top-meta">{formatDuration(author.listenTime)} · {author.bookCount} book{author.bookCount !== 1 ? 's' : ''}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {stats.topGenres && stats.topGenres.length > 0 && (
                    <div className="stats-section">
                      <h4>
                        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                        </svg>
                        Top Genres
                      </h4>
                      <div className="top-list">
                        {stats.topGenres.map((genre, index) => (
                          <div key={genre.genre} className="top-item">
                            <span className="top-rank">#{index + 1}</span>
                            <div className="top-info">
                              <span className="top-name">{genre.genre}</span>
                              <span className="top-meta">{formatDuration(genre.listenTime)} · {genre.bookCount} book{genre.bookCount !== 1 ? 's' : ''}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Recent Activity */}
                {stats.recentActivity && stats.recentActivity.length > 0 && (
                  <div className="stats-section full-width">
                    <h4>
                      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
                      </svg>
                      Recent Activity
                    </h4>
                    <div className="activity-list">
                      {stats.recentActivity.map((book) => (
                        <div
                          key={book.id}
                          className="activity-item"
                          onClick={() => navigate(`/player/${book.id}`)}
                        >
                          <div className="activity-cover">
                            {book.cover_image ? (
                              <img src={getCoverUrl(book.id)} alt={book.title} />
                            ) : (
                              <div className="cover-placeholder">
                                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                  <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/>
                                  <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
                                </svg>
                              </div>
                            )}
                          </div>
                          <div className="activity-info">
                            <span className="activity-title">{book.title}</span>
                            <span className="activity-author">{book.author}</span>
                            <div className="activity-progress">
                              <div className="progress-bar">
                                <div
                                  className="progress-fill"
                                  style={{ width: `${getProgressPercent(book.position, book.duration)}%` }}
                                />
                              </div>
                              <span className="progress-text">
                                {book.completed ? 'Completed' : `${getProgressPercent(book.position, book.duration)}%`}
                              </span>
                            </div>
                          </div>
                          <div className="activity-date">
                            {formatDate(book.updated_at)}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Empty state */}
                {stats.booksStarted === 0 && (
                  <div className="empty-stats">
                    <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/>
                      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
                    </svg>
                    <h4>No listening history yet</h4>
                    <p>Start listening to audiobooks to see your stats here!</p>
                    <button className="btn btn-primary" onClick={() => navigate('/')}>
                      Browse Library
                    </button>
                  </div>
                )}
              </>
            ) : (
              <div className="stats-error">Failed to load stats</div>
            )}
          </div>
        )}

        {/* Settings Tab */}
        {activeTab === 'settings' && (
          <div className="profile-card">
            <form onSubmit={handleSave} className="profile-form">
              <div className="settings-avatar-section">
                <div className="avatar-preview-medium">
                  {avatarPreview ? (
                    <img src={avatarPreview} alt="Avatar" />
                  ) : (
                    <div className="avatar-placeholder-medium">
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

              <div className="form-section">
                <h3>Profile Information</h3>

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
              </div>
            </form>

            {/* Password Change Section */}
            <form onSubmit={handlePasswordChange} className="password-form">
              <div className="form-section">
                <h3>Change Password</h3>

                {passwordError && (
                  <div className="password-error">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="10"/>
                      <line x1="12" y1="8" x2="12" y2="12"/>
                      <line x1="12" y1="16" x2="12.01" y2="16"/>
                    </svg>
                    {passwordError}
                  </div>
                )}

                <div className="form-group">
                  <label htmlFor="currentPassword">Current Password</label>
                  <input
                    type="password"
                    id="currentPassword"
                    className="input"
                    value={passwordData.currentPassword}
                    onChange={(e) => setPasswordData({ ...passwordData, currentPassword: e.target.value })}
                    placeholder="Enter current password"
                  />
                </div>

                <div className="form-group">
                  <label htmlFor="newPassword">New Password</label>
                  <input
                    type="password"
                    id="newPassword"
                    className="input"
                    value={passwordData.newPassword}
                    onChange={(e) => setPasswordData({ ...passwordData, newPassword: e.target.value })}
                    placeholder="Enter new password"
                  />
                  <p className="help-text">Must be at least 6 characters</p>
                </div>

                <div className="form-group">
                  <label htmlFor="confirmPassword">Confirm New Password</label>
                  <input
                    type="password"
                    id="confirmPassword"
                    className="input"
                    value={passwordData.confirmPassword}
                    onChange={(e) => setPasswordData({ ...passwordData, confirmPassword: e.target.value })}
                    placeholder="Confirm new password"
                  />
                </div>

                <div className="form-actions">
                  <button
                    type="submit"
                    className="btn btn-secondary"
                    disabled={changingPassword || !passwordData.currentPassword || !passwordData.newPassword || !passwordData.confirmPassword}
                  >
                    {changingPassword ? 'Changing...' : 'Change Password'}
                  </button>
                </div>
              </div>
            </form>
          </div>
        )}

        {/* Security Tab */}
        {activeTab === 'security' && (
          <div className="profile-card">
            <div className="form-section">
              <h3>Two-Factor Authentication</h3>
              <p className="section-description">
                Add an extra layer of security to your account by enabling two-factor authentication.
              </p>

              {mfaError && (
                <div className="password-error">
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10"/>
                    <line x1="12" y1="8" x2="12" y2="12"/>
                    <line x1="12" y1="16" x2="12.01" y2="16"/>
                  </svg>
                  {mfaError}
                </div>
              )}

              {/* Backup codes display modal */}
              {mfaBackupCodes && (
                <div className="mfa-backup-codes-modal">
                  <div className="mfa-backup-codes-content">
                    <h4>Backup Codes</h4>
                    <p className="warning-text">
                      Save these backup codes in a safe place. You can use them to access your account if you lose your authenticator device.
                      Each code can only be used once.
                    </p>
                    <div className="backup-codes-grid">
                      {mfaBackupCodes.map((code, index) => (
                        <code key={index} className="backup-code">{code}</code>
                      ))}
                    </div>
                    <div className="backup-codes-actions">
                      <button
                        className="btn btn-secondary"
                        onClick={() => {
                          navigator.clipboard.writeText(mfaBackupCodes.join('\n'));
                          alert('Backup codes copied to clipboard');
                        }}
                      >
                        Copy to Clipboard
                      </button>
                      <button className="btn btn-primary" onClick={handleDismissBackupCodes}>
                        I've Saved These Codes
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* MFA Setup Flow */}
              {mfaSetupData ? (
                <div className="mfa-setup">
                  <div className="mfa-qr-section">
                    <h4>Scan QR Code</h4>
                    <p>Scan this QR code with your authenticator app (Google Authenticator, Authy, etc.)</p>
                    <div className="qr-code-container">
                      <img src={mfaSetupData.qrCode} alt="MFA QR Code" className="qr-code" />
                    </div>
                    <p className="manual-code">
                      Can't scan? Enter this code manually: <code>{mfaSetupData.secret}</code>
                    </p>
                  </div>

                  <form onSubmit={handleVerifyMFASetup} className="mfa-verify-form">
                    <div className="form-group">
                      <label>Verification Code</label>
                      <input
                        type="text"
                        className="input mfa-code-input"
                        value={mfaVerifyCode}
                        onChange={(e) => setMfaVerifyCode(e.target.value.replace(/[^0-9]/g, ''))}
                        placeholder="000000"
                        maxLength={6}
                        autoFocus
                      />
                      <p className="help-text">Enter the 6-digit code from your authenticator app</p>
                    </div>

                    <div className="form-actions">
                      <button type="button" className="btn btn-secondary" onClick={handleCancelMFASetup}>
                        Cancel
                      </button>
                      <button
                        type="submit"
                        className="btn btn-primary"
                        disabled={mfaLoading || mfaVerifyCode.length !== 6}
                      >
                        {mfaLoading ? 'Verifying...' : 'Enable MFA'}
                      </button>
                    </div>
                  </form>
                </div>
              ) : mfaStatus.enabled ? (
                /* MFA Enabled State */
                <div className="mfa-enabled">
                  <div className="mfa-status-badge enabled">
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
                      <polyline points="22 4 12 14.01 9 11.01"/>
                    </svg>
                    Two-factor authentication is enabled
                  </div>

                  <div className="mfa-info">
                    <p>Backup codes remaining: <strong>{mfaStatus.remainingBackupCodes}</strong></p>
                    {mfaStatus.remainingBackupCodes <= 2 && (
                      <p className="warning-text">You're running low on backup codes. Consider regenerating them.</p>
                    )}
                  </div>

                  <div className="mfa-actions">
                    <button
                      className="btn btn-secondary"
                      onClick={handleRegenerateBackupCodes}
                      disabled={mfaLoading}
                    >
                      Regenerate Backup Codes
                    </button>
                  </div>

                  <div className="mfa-disable-section">
                    <h4>Disable Two-Factor Authentication</h4>
                    <form onSubmit={handleDisableMFA}>
                      <div className="form-group">
                        <label>Current MFA Code or Backup Code</label>
                        <input
                          type="text"
                          className="input"
                          value={mfaDisableCode}
                          onChange={(e) => setMfaDisableCode(e.target.value.replace(/[^0-9A-Za-z]/g, ''))}
                          placeholder="Enter code"
                          maxLength={8}
                        />
                      </div>
                      <button
                        type="submit"
                        className="btn btn-danger"
                        disabled={mfaLoading || !mfaDisableCode}
                      >
                        {mfaLoading ? 'Disabling...' : 'Disable MFA'}
                      </button>
                    </form>
                  </div>
                </div>
              ) : (
                /* MFA Not Enabled State */
                <div className="mfa-disabled">
                  <div className="mfa-status-badge disabled">
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="10"/>
                      <line x1="12" y1="8" x2="12" y2="12"/>
                      <line x1="12" y1="16" x2="12.01" y2="16"/>
                    </svg>
                    Two-factor authentication is not enabled
                  </div>

                  <p className="mfa-description">
                    Protect your account with an authenticator app. You'll need to enter a code from the app
                    each time you log in.
                  </p>

                  <button
                    className="btn btn-primary"
                    onClick={handleStartMFASetup}
                    disabled={mfaLoading}
                  >
                    {mfaLoading ? 'Setting up...' : 'Enable Two-Factor Authentication'}
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Notifications Tab */}
        {activeTab === 'notifications' && (
          <div className="profile-card">
            <div className="form-section">
              <h3>Email Notifications</h3>
              <p className="section-description">
                Choose which email notifications you'd like to receive.
              </p>

              {notifLoading ? (
                <div className="stats-loading">Loading preferences...</div>
              ) : !emailStatus.enabled ? (
                <div className="notif-disabled-notice">
                  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10"/>
                    <line x1="12" y1="8" x2="12" y2="12"/>
                    <line x1="12" y1="16" x2="12.01" y2="16"/>
                  </svg>
                  <div>
                    <strong>Email notifications are not configured</strong>
                    <p>An administrator needs to configure email settings before notifications can be sent.</p>
                  </div>
                </div>
              ) : (
                <>
                  {notifMessage && (
                    <div className={`notif-message ${notifMessage.type}`}>
                      {notifMessage.text}
                    </div>
                  )}

                  <div className="notif-toggle-section">
                    <div className="notif-master-toggle">
                      <label className="toggle-label">
                        <input
                          type="checkbox"
                          checked={notifPrefs.email_enabled}
                          onChange={(e) => handleNotifPrefChange('email_enabled', e.target.checked)}
                        />
                        <span className="toggle-text">
                          <strong>Enable email notifications</strong>
                          <span className="toggle-description">Master switch for all email notifications</span>
                        </span>
                      </label>
                    </div>
                  </div>

                  {notifPrefs.email_enabled && (
                    <div className="notif-options">
                      <h4>Notification Types</h4>

                      <label className="toggle-label">
                        <input
                          type="checkbox"
                          checked={notifPrefs.email_new_audiobook}
                          onChange={(e) => handleNotifPrefChange('email_new_audiobook', e.target.checked)}
                        />
                        <span className="toggle-text">
                          <strong>New audiobooks</strong>
                          <span className="toggle-description">Get notified when new audiobooks are added to the library</span>
                        </span>
                      </label>

                      <label className="toggle-label">
                        <input
                          type="checkbox"
                          checked={notifPrefs.email_weekly_summary}
                          onChange={(e) => handleNotifPrefChange('email_weekly_summary', e.target.checked)}
                        />
                        <span className="toggle-text">
                          <strong>Weekly listening summary</strong>
                          <span className="toggle-description">Receive a weekly summary of your listening activity</span>
                        </span>
                      </label>

                      <label className="toggle-label">
                        <input
                          type="checkbox"
                          checked={notifPrefs.email_recommendations}
                          onChange={(e) => handleNotifPrefChange('email_recommendations', e.target.checked)}
                        />
                        <span className="toggle-text">
                          <strong>Book recommendations</strong>
                          <span className="toggle-description">Get personalized audiobook recommendations</span>
                        </span>
                      </label>
                    </div>
                  )}

                  <div className="form-actions">
                    <button
                      className="btn btn-primary"
                      onClick={handleSaveNotifPrefs}
                      disabled={notifSaving}
                    >
                      {notifSaving ? 'Saving...' : 'Save Preferences'}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
