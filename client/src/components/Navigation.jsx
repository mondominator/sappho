import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useState, useEffect } from 'react';
import './Navigation.css';

export default function Navigation({ onLogout, onOpenUpload }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showMobileMenu, setShowMobileMenu] = useState(false);
  const [castReady, setCastReady] = useState(false);

  // Check for Cast SDK availability
  useEffect(() => {
    let attempts = 0;
    const maxAttempts = 50; // 5 seconds

    const checkCastReady = () => {
      attempts++;
      console.log(`Cast check attempt ${attempts}, cast available:`, !!window.cast, 'framework:', !!(window.cast?.framework));

      if (window.cast && window.cast.framework) {
        console.log('Cast SDK is ready!');
        setCastReady(true);
        return;
      }

      if (attempts < maxAttempts) {
        setTimeout(checkCastReady, 100);
      } else {
        console.error('Cast SDK failed to load after 5 seconds');
      }
    };

    window['__onGCastApiAvailable'] = (isAvailable) => {
      console.log('__onGCastApiAvailable called, available:', isAvailable);
      if (isAvailable) {
        setCastReady(true);
      }
    };

    // Check if script is loaded
    console.log('Cast script loaded:', !!document.querySelector('script[src*="cast_sender.js"]'));

    checkCastReady();
  }, []);

  const handleCastClick = () => {
    if (!castReady) {
      alert('Cast is initializing. Please wait a moment and try again.');
      return;
    }

    try {
      const castContext = window.cast.framework.CastContext.getInstance();
      castContext.requestSession().then(
        () => {
          console.log('Cast session started');
        },
        (error) => {
          if (error !== 'cancel') {
            console.error('Error starting cast session:', error);
          }
        }
      );
    } catch (error) {
      console.error('Error opening cast dialog:', error);
      alert('Error initializing Cast: ' + error.message);
    }
  };

  useEffect(() => {
    // Decode JWT to get user info
    const token = localStorage.getItem('token');
    if (token) {
      try {
        const payload = JSON.parse(atob(token.split('.')[1]));
        setUser(payload);
      } catch (error) {
        console.error('Error decoding token:', error);
      }
    }
  }, []);

  // Close dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (showUserMenu && !event.target.closest('.user-menu')) {
        setShowUserMenu(false);
      }
      if (showMobileMenu && !event.target.closest('.mobile-menu-container') && !event.target.closest('.hamburger-button') && !event.target.closest('.more-button')) {
        setShowMobileMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showUserMenu, showMobileMenu]);

  return (
    <nav className="navigation">
      <div className="container nav-container">
        <Link to="/" className="nav-brand">
          <img src="/logo.svg" alt="Sapho" className="nav-logo nav-logo-full" />
          <img src="/icon-192.png" alt="Sapho" className="nav-logo nav-logo-icon" />
        </Link>

        <div className="nav-links">
          <Link to="/" className={`nav-link ${location.pathname === '/' ? 'active' : ''}`} title="Home">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
              <polyline points="9 22 9 12 15 12 15 22"/>
            </svg>
            <span className="nav-link-text">Home</span>
          </Link>
          <Link to="/library" className={`nav-link ${location.pathname === '/library' ? 'active' : ''}`} title="Library">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/>
              <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
            </svg>
            <span className="nav-link-text">Library</span>
          </Link>
          <Link to="/series" className={`nav-link ${location.pathname === '/series' ? 'active' : ''}`} title="Series">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/>
              <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>
            </svg>
            <span className="nav-link-text">Series</span>
          </Link>
          <button
            className="nav-link mobile-only cast-nav-button"
            onClick={handleCastClick}
            title="Cast"
            type="button"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M2 16.1A5 5 0 0 1 5.9 20M2 12.05A9 9 0 0 1 9.95 20M2 8V6a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-6"></path>
              <line x1="2" y1="20" x2="2.01" y2="20"></line>
            </svg>
            <span className="nav-link-text">Cast</span>
          </button>
          <button
            className="nav-link mobile-only more-button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setShowMobileMenu(!showMobileMenu);
            }}
            title="More"
            type="button"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="1"/>
              <circle cx="12" cy="5" r="1"/>
              <circle cx="12" cy="19" r="1"/>
            </svg>
            <span className="nav-link-text">More</span>
          </button>
        </div>

        <div className="nav-actions">
          {/* Desktop user menu */}
          {user && (
            <div className="user-menu desktop-only">
              <button
                className="user-button"
                onClick={() => setShowUserMenu(!showUserMenu)}
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                  <circle cx="12" cy="7" r="4"></circle>
                </svg>
                <span>{user.username}</span>
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="dropdown-arrow">
                  <polyline points="6 9 12 15 18 9"></polyline>
                </svg>
              </button>

              {showUserMenu && (
                <div className="user-dropdown">
                  <button onClick={() => { navigate('/profile'); setShowUserMenu(false); }}>
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                      <circle cx="12" cy="7" r="4"></circle>
                    </svg>
                    Profile
                  </button>
                  {user?.is_admin && (
                    <>
                      <button onClick={() => { navigate('/settings'); setShowUserMenu(false); }}>
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <circle cx="12" cy="12" r="3"></circle>
                          <path d="M12 1v6m0 6v6"/>
                        </svg>
                        Settings
                      </button>
                      <button onClick={() => { onOpenUpload(); setShowUserMenu(false); }}>
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <line x1="12" y1="5" x2="12" y2="19"></line>
                          <line x1="5" y1="12" x2="19" y2="12"></line>
                        </svg>
                        Upload
                      </button>
                    </>
                  )}
                  <button onClick={() => { onLogout(); setShowUserMenu(false); }}>
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
                      <polyline points="16 17 21 12 16 7"></polyline>
                      <line x1="21" y1="12" x2="9" y2="12"></line>
                    </svg>
                    Logout
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Mobile hamburger menu */}
          <button
            className="icon-button hamburger-button mobile-only"
            onClick={() => setShowMobileMenu(!showMobileMenu)}
            title="Menu"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="3" y1="12" x2="21" y2="12"></line>
              <line x1="3" y1="6" x2="21" y2="6"></line>
              <line x1="3" y1="18" x2="21" y2="18"></line>
            </svg>
          </button>

        </div>
      </div>

      {/* Mobile menu dropdown - outside nav-container so it's not hidden */}
      {showMobileMenu && (
        <div className="mobile-menu-container mobile-only">
          <div className="mobile-menu-dropdown">
            <div className="mobile-menu-header">
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                <circle cx="12" cy="7" r="4"></circle>
              </svg>
              <span>{user?.username}</span>
            </div>

            <button onClick={() => { navigate('/profile'); setShowMobileMenu(false); }}>
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                <circle cx="12" cy="7" r="4"></circle>
              </svg>
              <span>Profile</span>
            </button>

            {user?.is_admin && (
              <>
                <button onClick={() => { navigate('/settings'); setShowMobileMenu(false); }}>
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="3"></circle>
                    <path d="M12 1v6m0 6v6"/>
                  </svg>
                  <span>Settings</span>
                </button>

                <button onClick={() => { onOpenUpload(); setShowMobileMenu(false); }}>
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="12" y1="5" x2="12" y2="19"></line>
                    <line x1="5" y1="12" x2="19" y2="12"></line>
                  </svg>
                  <span>Upload</span>
                </button>
              </>
            )}

            <button onClick={() => { onLogout(); setShowMobileMenu(false); }} className="logout-button">
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
                <polyline points="16 17 21 12 16 7"></polyline>
                <line x1="21" y1="12" x2="9" y2="12"></line>
              </svg>
              <span>Logout</span>
            </button>
          </div>
        </div>
      )}
    </nav>
  );
}
