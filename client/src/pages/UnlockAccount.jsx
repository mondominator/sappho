import { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { unlockAccount } from '../api';
import './Login.css';

export default function UnlockAccount() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState('loading'); // loading, success, error
  const [message, setMessage] = useState('');
  const [username, setUsername] = useState('');

  useEffect(() => {
    const token = searchParams.get('token');

    if (!token) {
      setStatus('error');
      setMessage('Invalid unlock link. No token provided.');
      return;
    }

    // Validate and consume the token
    unlockAccount(token)
      .then((response) => {
        setStatus('success');
        setMessage(response.data.message);
        setUsername(response.data.username);
      })
      .catch((error) => {
        setStatus('error');
        setMessage(error.response?.data?.error || 'Failed to unlock account. The link may be expired or already used.');
      });
  }, [searchParams]);

  const handleGoToLogin = () => {
    navigate('/');
  };

  return (
    <div className="login-page">
      <div className="login-container">
        <img src="/sappho-logo-navbar.png" alt="Sappho" className="login-logo" />

        <div className="unlock-status">
          {status === 'loading' && (
            <div className="mfa-header">
              <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="spinning">
                <line x1="12" y1="2" x2="12" y2="6"/>
                <line x1="12" y1="18" x2="12" y2="22"/>
                <line x1="4.93" y1="4.93" x2="7.76" y2="7.76"/>
                <line x1="16.24" y1="16.24" x2="19.07" y2="19.07"/>
                <line x1="2" y1="12" x2="6" y2="12"/>
                <line x1="18" y1="12" x2="22" y2="12"/>
                <line x1="4.93" y1="19.07" x2="7.76" y2="16.24"/>
                <line x1="16.24" y1="7.76" x2="19.07" y2="4.93"/>
              </svg>
              <h3>Unlocking Account...</h3>
              <p>Please wait while we verify your unlock link.</p>
            </div>
          )}

          {status === 'success' && (
            <div className="mfa-header">
              <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
                <polyline points="22 4 12 14.01 9 11.01"/>
              </svg>
              <h3>Account Unlocked</h3>
              <p>{message}</p>
              {username && <p className="username-display">Welcome back, <strong>{username}</strong>!</p>}
            </div>
          )}

          {status === 'error' && (
            <div className="mfa-header">
              <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"/>
                <line x1="15" y1="9" x2="9" y2="15"/>
                <line x1="9" y1="9" x2="15" y2="15"/>
              </svg>
              <h3>Unlock Failed</h3>
              <p>{message}</p>
            </div>
          )}

          <button
            type="button"
            className="btn btn-primary login-btn"
            onClick={handleGoToLogin}
            style={{ marginTop: '20px' }}
          >
            Go to Login
          </button>
        </div>
      </div>
    </div>
  );
}
