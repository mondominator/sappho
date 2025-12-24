import { useState } from 'react';
import { login, verifyMFA } from '../api';
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

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
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
      setError(err.response?.data?.error || 'Login failed');
    } finally {
      setLoading(false);
    }
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
        </form>
      </div>
    </div>
  );
}
