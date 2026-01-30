import { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import { getCoverUrl, getMFAStatus, setupMFA, verifyMFASetup, disableMFA, regenerateBackupCodes } from '../api';
import './Profile.css';

// Format duration to hours and minutes only
const formatListenTime = (seconds) => {
  if (!seconds || seconds === 0) return { hours: 0, minutes: 0 };
  const totalMinutes = Math.floor(seconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return { hours, minutes };
};

export default function Profile() {
  const navigate = useNavigate();
  const fileInputRef = useRef(null);

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
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);

  // Password change
  const [showPasswordSection, setShowPasswordSection] = useState(false);
  const [passwordData, setPasswordData] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: ''
  });
  const [changingPassword, setChangingPassword] = useState(false);

  // MFA state
  const [mfaStatus, setMfaStatus] = useState({ enabled: false, remainingBackupCodes: 0 });
  const [showMFASetup, setShowMFASetup] = useState(false);
  const [mfaSetupData, setMfaSetupData] = useState(null);
  const [mfaVerifyCode, setMfaVerifyCode] = useState('');
  const [mfaLoading, setMfaLoading] = useState(false);
  const [mfaBackupCodes, setMfaBackupCodes] = useState(null);

  useEffect(() => {
    loadProfile();
    loadStats();
    loadMFAStatus();
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

  const handleAvatarClick = () => {
    fileInputRef.current?.click();
  };

  const handleAvatarChange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
      setMessage({ type: 'error', text: 'Image must be less than 5MB' });
      return;
    }

    // Preview immediately
    setAvatarPreview(URL.createObjectURL(file));

    // Upload
    try {
      const token = localStorage.getItem('token');
      const formData = new FormData();
      formData.append('avatar', file);

      await axios.put('/api/profile', formData, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'multipart/form-data'
        }
      });

      setMessage({ type: 'success', text: 'Avatar updated' });
      window.dispatchEvent(new CustomEvent('profileUpdated'));
    } catch (error) {
      setMessage({ type: 'error', text: 'Failed to update avatar' });
      loadProfile(); // Revert preview
    }
  };

  const handleRemoveAvatar = async () => {
    if (!confirm('Remove avatar?')) return;

    try {
      const token = localStorage.getItem('token');
      await axios.delete('/api/profile/avatar', {
        headers: { Authorization: `Bearer ${token}` }
      });
      setAvatarPreview(null);
      setProfile({ ...profile, avatar: null });
      setMessage({ type: 'success', text: 'Avatar removed' });
      window.dispatchEvent(new CustomEvent('profileUpdated'));
    } catch (error) {
      setMessage({ type: 'error', text: 'Failed to remove avatar' });
    }
  };

  const handleSaveProfile = async (e) => {
    e.preventDefault();
    setSaving(true);
    setMessage(null);

    try {
      const token = localStorage.getItem('token');
      await axios.put('/api/profile', {
        displayName: profile.displayName,
        email: profile.email
      }, {
        headers: { Authorization: `Bearer ${token}` }
      });

      setMessage({ type: 'success', text: 'Profile saved' });
      window.dispatchEvent(new CustomEvent('profileUpdated'));
    } catch (error) {
      setMessage({ type: 'error', text: error.response?.data?.error || 'Failed to save' });
    } finally {
      setSaving(false);
    }
  };

  const handlePasswordChange = async (e) => {
    e.preventDefault();
    setMessage(null);

    if (passwordData.newPassword !== passwordData.confirmPassword) {
      setMessage({ type: 'error', text: 'Passwords do not match' });
      return;
    }

    if (passwordData.newPassword.length < 6) {
      setMessage({ type: 'error', text: 'Password must be at least 6 characters' });
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

      setMessage({ type: 'success', text: 'Password changed' });
      setPasswordData({ currentPassword: '', newPassword: '', confirmPassword: '' });
      setShowPasswordSection(false);
    } catch (error) {
      setMessage({ type: 'error', text: error.response?.data?.error || 'Failed to change password' });
    } finally {
      setChangingPassword(false);
    }
  };

  // MFA handlers
  const handleStartMFASetup = async () => {
    setMfaLoading(true);
    try {
      const response = await setupMFA();
      setMfaSetupData(response.data);
      setShowMFASetup(true);
    } catch (error) {
      setMessage({ type: 'error', text: 'Failed to start MFA setup' });
    } finally {
      setMfaLoading(false);
    }
  };

  const handleVerifyMFA = async (e) => {
    e.preventDefault();
    setMfaLoading(true);
    try {
      const response = await verifyMFASetup(mfaSetupData.secret, mfaVerifyCode);
      setMfaBackupCodes(response.data.backupCodes);
      setMfaSetupData(null);
      setMfaVerifyCode('');
      setShowMFASetup(false);
      loadMFAStatus();
    } catch (error) {
      setMessage({ type: 'error', text: 'Invalid code' });
    } finally {
      setMfaLoading(false);
    }
  };

  const handleDisableMFA = async () => {
    const code = window.prompt('Enter your MFA code to disable:');
    if (!code) return;

    setMfaLoading(true);
    try {
      await disableMFA(code, null);
      loadMFAStatus();
      setMessage({ type: 'success', text: 'MFA disabled' });
    } catch (error) {
      setMessage({ type: 'error', text: 'Invalid code' });
    } finally {
      setMfaLoading(false);
    }
  };

  const listenTime = stats ? formatListenTime(stats.totalListenTime) : { hours: 0, minutes: 0 };

  if (loading) {
    return <div className="profile-loading">Loading...</div>;
  }

  return (
    <div className="profile-page">
      {/* Message toast */}
      {message && (
        <div className={`profile-toast ${message.type}`} onClick={() => setMessage(null)}>
          {message.text}
        </div>
      )}

      {/* Header with avatar */}
      <div className="profile-header">
        <div className="profile-avatar-wrapper" onClick={handleAvatarClick}>
          {avatarPreview ? (
            <img src={avatarPreview} alt="" className="profile-avatar" />
          ) : (
            <div className="profile-avatar-placeholder">
              {(profile.displayName || profile.username || '?').charAt(0).toUpperCase()}
            </div>
          )}
          <div className="profile-avatar-edit">Edit</div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleAvatarChange}
            style={{ display: 'none' }}
          />
        </div>
        {avatarPreview && (
          <button className="profile-avatar-remove" onClick={(e) => { e.stopPropagation(); handleRemoveAvatar(); }}>
            Remove photo
          </button>
        )}
        <h1 className="profile-name">{profile.displayName || profile.username}</h1>
        <p className="profile-meta">
          {profile.is_admin ? 'Admin' : 'Member'} since {new Date(profile.created_at).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}
        </p>
      </div>

      {/* Stats */}
      {stats && (
        <div className="profile-stats">
          <div className="stat-item">
            <span className="stat-number">
              {listenTime.hours}<span className="stat-unit">h</span> {listenTime.minutes}<span className="stat-unit">m</span>
            </span>
            <span className="stat-label">listened</span>
          </div>
          <div className="stat-divider" />
          <div className="stat-item">
            <span className="stat-number">{stats.booksCompleted}</span>
            <span className="stat-label">finished</span>
          </div>
          <div className="stat-divider" />
          <div className="stat-item">
            <span className="stat-number">{stats.currentlyListening}</span>
            <span className="stat-label">in progress</span>
          </div>
        </div>
      )}

      {/* Recent books */}
      {stats?.recentActivity?.length > 0 && (
        <div className="profile-section">
          <h2 className="section-title">Recent</h2>
          <div className="recent-books">
            {stats.recentActivity.slice(0, 4).map((book) => (
              <div
                key={book.id}
                className="recent-book"
                onClick={() => navigate(`/audiobook/${book.id}`)}
              >
                {book.cover_image ? (
                  <img src={getCoverUrl(book.id)} alt="" className="recent-book-cover" />
                ) : (
                  <div className="recent-book-placeholder">{book.title?.charAt(0)}</div>
                )}
                <div className="recent-book-progress" style={{ width: `${Math.min(100, Math.round((book.position / book.duration) * 100))}%` }} />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Account */}
      <div className="profile-section">
        <h2 className="section-title">Account</h2>
        <form onSubmit={handleSaveProfile} className="profile-form">
          <div className="form-field">
            <label>Display Name</label>
            <input
              type="text"
              value={profile.displayName || ''}
              onChange={(e) => setProfile({ ...profile, displayName: e.target.value })}
              placeholder={profile.username}
            />
          </div>
          <div className="form-field">
            <label>Email</label>
            <input
              type="email"
              value={profile.email || ''}
              onChange={(e) => setProfile({ ...profile, email: e.target.value })}
              placeholder="your@email.com"
            />
          </div>
          <button type="submit" className="btn-primary" disabled={saving}>
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
        </form>
      </div>

      {/* Security */}
      <div className="profile-section">
        <h2 className="section-title">Security</h2>

        {/* Password */}
        {!showPasswordSection ? (
          <button className="btn-secondary" onClick={() => setShowPasswordSection(true)}>
            Change Password
          </button>
        ) : (
          <form onSubmit={handlePasswordChange} className="profile-form">
            <div className="form-field">
              <label>Current Password</label>
              <input
                type="password"
                value={passwordData.currentPassword}
                onChange={(e) => setPasswordData({ ...passwordData, currentPassword: e.target.value })}
              />
            </div>
            <div className="form-field">
              <label>New Password</label>
              <input
                type="password"
                value={passwordData.newPassword}
                onChange={(e) => setPasswordData({ ...passwordData, newPassword: e.target.value })}
              />
            </div>
            <div className="form-field">
              <label>Confirm Password</label>
              <input
                type="password"
                value={passwordData.confirmPassword}
                onChange={(e) => setPasswordData({ ...passwordData, confirmPassword: e.target.value })}
              />
            </div>
            <div className="form-actions">
              <button type="button" className="btn-secondary" onClick={() => setShowPasswordSection(false)}>
                Cancel
              </button>
              <button type="submit" className="btn-primary" disabled={changingPassword}>
                {changingPassword ? 'Changing...' : 'Change Password'}
              </button>
            </div>
          </form>
        )}

        {/* MFA */}
        <div className="mfa-section">
          <div className="mfa-status">
            <span>Two-Factor Auth</span>
            <span className={`mfa-badge ${mfaStatus.enabled ? 'enabled' : ''}`}>
              {mfaStatus.enabled ? 'On' : 'Off'}
            </span>
          </div>
          {mfaStatus.enabled ? (
            <button className="btn-secondary btn-danger-text" onClick={handleDisableMFA} disabled={mfaLoading}>
              Disable
            </button>
          ) : (
            <button className="btn-secondary" onClick={handleStartMFASetup} disabled={mfaLoading}>
              Enable
            </button>
          )}
        </div>
      </div>

      {/* MFA Setup Modal */}
      {showMFASetup && mfaSetupData && (
        <div className="modal-overlay" onClick={() => setShowMFASetup(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h3>Setup Two-Factor Auth</h3>
            <p>Scan with your authenticator app</p>
            <img src={mfaSetupData.qrCode} alt="QR Code" className="mfa-qr" />
            <p className="mfa-secret">Or enter: <code>{mfaSetupData.secret}</code></p>
            <form onSubmit={handleVerifyMFA}>
              <input
                type="text"
                className="mfa-code-input"
                value={mfaVerifyCode}
                onChange={(e) => setMfaVerifyCode(e.target.value.replace(/\D/g, ''))}
                placeholder="000000"
                maxLength={6}
                autoFocus
              />
              <div className="modal-actions">
                <button type="button" className="btn-secondary" onClick={() => setShowMFASetup(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn-primary" disabled={mfaLoading || mfaVerifyCode.length !== 6}>
                  Verify
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Backup Codes Modal */}
      {mfaBackupCodes && (
        <div className="modal-overlay">
          <div className="modal-content">
            <h3>Backup Codes</h3>
            <p>Save these codes securely. Each can only be used once.</p>
            <div className="backup-codes">
              {mfaBackupCodes.map((code, i) => (
                <code key={i}>{code}</code>
              ))}
            </div>
            <button
              className="btn-primary"
              onClick={() => {
                navigator.clipboard.writeText(mfaBackupCodes.join('\n'));
                setMfaBackupCodes(null);
              }}
            >
              Copy & Close
            </button>
          </div>
        </div>
      )}

      {/* Player Settings */}
      <div className="profile-section">
        <h2 className="section-title">Player</h2>
        <label className="toggle-row">
          <span>Show chapter progress</span>
          <input
            type="checkbox"
            checked={localStorage.getItem('progressDisplayMode') === 'chapter'}
            onChange={(e) => {
              localStorage.setItem('progressDisplayMode', e.target.checked ? 'chapter' : 'book');
              window.dispatchEvent(new CustomEvent('playerSettingsChanged'));
            }}
          />
        </label>
      </div>

      {/* Spacer for bottom nav */}
      <div className="profile-spacer" />
    </div>
  );
}
