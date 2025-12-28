import { useState } from 'react';
import { login, verifyMFA, requestUnlock } from '../api';
import './Login.css';

export default function Login({ onLogin }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // MFA state
  const [mfaRequired, setMfaRequired] = useState(false);
  const [mfaToken, setMfaToken] = useState('');
  const [mfaCode, setMfaCode] = useState('');

  // Unlock state
  const [showUnlockForm, setShowUnlockForm] = useState(false);
  const [unlockEmail, setUnlockEmail] = useState('');
  const [unlockMessage, setUnlockMessage] = useState('');
  const [isLocked, setIsLocked] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setIsLocked(false);
    setLoading(true);

    try {
      const response = await login(username, password);

      // Check if MFA is required
      if (response.data.mfa_required) {
        setMfaRequired(true);
        setMfaToken(response.data.mfa_token);
        setLoading(false);
        return;
      }

      onLogin(response.data.token, response.data.must_change_password);
    } catch (err) {
      const errorMessage = err.response?.data?.error || 'Login failed';
      setError(errorMessage);

      // Check if account is locked
      if (errorMessage.includes('locked')) {
        setIsLocked(true);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleUnlockRequest = async (e) => {
    e.preventDefault();
    setError('');
    setUnlockMessage('');
    setLoading(true);

    try {
      const response = await requestUnlock(unlockEmail);
      setUnlockMessage(response.data.message);
      setUnlockEmail('');
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to request unlock');
    } finally {
      setLoading(false);
    }
  };

  const handleBackFromUnlock = () => {
    setShowUnlockForm(false);
    setUnlockEmail('');
    setUnlockMessage('');
    setError('');
  };

  const handleMFASubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const response = await verifyMFA(mfaToken, mfaCode);
      onLogin(response.data.token, response.data.must_change_password);
    } catch (err) {
      setError(err.response?.data?.error || 'MFA verification failed');
    } finally {
      setLoading(false);
    }
  };

  const handleBackToLogin = () => {
    setMfaRequired(false);
    setMfaToken('');
    setMfaCode('');
    setError('');
    setPassword('');
  };

  // Unlock request form
  if (showUnlockForm) {
    return (
      <div className="login-page">
        <div className="login-container">
          <img src="/sappho-logo-navbar.png" alt="Sappho" className="login-logo" />

          <form onSubmit={handleUnlockRequest} className="login-form">
            <div className="mfa-header">
              <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                <path d="M7 11V7a5 5 0 0 1 9.9-1"/>
                <line x1="21" y1="3" x2="15" y2="9"/>
                <line x1="21" y1="9" x2="15" y2="3"/>
              </svg>
              <h3>Unlock Your Account</h3>
              <p>Enter your email address to receive an unlock link</p>
            </div>

            {error && <div className="error-message">{error}</div>}
            {unlockMessage && <div className="success-message">{unlockMessage}</div>}

            <div className="form-group">
              <label>Email Address</label>
              <input
                type="email"
                className="input"
                value={unlockEmail}
                onChange={(e) => setUnlockEmail(e.target.value)}
                placeholder="your@email.com"
                required
                autoFocus
              />
            </div>

            <button type="submit" className="btn btn-primary login-btn" disabled={loading || !unlockEmail}>
              {loading ? 'Sending...' : 'Send Unlock Link'}
            </button>

            <button type="button" className="btn btn-secondary login-btn" onClick={handleBackFromUnlock}>
              Back to Login
            </button>
          </form>
        </div>
      </div>
    );
  }

  // MFA verification form
  if (mfaRequired) {
    return (
      <div className="login-page">
        <div className="login-container">
          <img src="/sappho-logo-navbar.png" alt="Sappho" className="login-logo" />

          <form onSubmit={handleMFASubmit} className="login-form">
            <div className="mfa-header">
              <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
              </svg>
              <h3>Two-Factor Authentication</h3>
              <p>Enter the 6-digit code from your authenticator app</p>
            </div>

            {error && <div className="error-message">{error}</div>}

            <div className="form-group">
              <label>Verification Code</label>
              <input
                type="text"
                className="input mfa-input"
                value={mfaCode}
                onChange={(e) => setMfaCode(e.target.value.replace(/[^0-9A-Za-z]/g, ''))}
                placeholder="000000"
                maxLength={8}
                autoFocus
                autoComplete="one-time-code"
              />
              <p className="help-text">Or enter a backup code</p>
            </div>

            <button type="submit" className="btn btn-primary login-btn" disabled={loading || mfaCode.length < 6}>
              {loading ? 'Verifying...' : 'Verify'}
            </button>

            <button type="button" className="btn btn-secondary login-btn" onClick={handleBackToLogin}>
              Back to Login
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="login-page">
      <div className="login-container">
        <img src="/sappho-logo-navbar.png" alt="Sappho" className="login-logo" />

        <form onSubmit={handleSubmit} className="login-form">
          {error && <div className="error-message">{error}</div>}

          <div className="form-group">
            <label>Username</label>
            <input
              type="text"
              className="input"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              autoFocus
            />
          </div>

          <div className="form-group">
            <label>Password</label>
            <input
              type="password"
              className="input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>

          <button type="submit" className="btn btn-primary login-btn" disabled={loading}>
            {loading ? 'Logging in...' : 'Login'}
          </button>

          {isLocked && (
            <div className="unlock-link-container">
              <p>Account locked?</p>
              <button
                type="button"
                className="link-button"
                onClick={() => setShowUnlockForm(true)}
              >
                Request unlock via email
              </button>
            </div>
          )}
        </form>
      </div>
    </div>
  );
}
