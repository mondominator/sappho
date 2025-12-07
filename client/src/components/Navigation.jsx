import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useState, useEffect } from 'react';
import SearchModal from './SearchModal';
import './Navigation.css';

export default function Navigation({ onLogout, onOpenUpload }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showMobileMenu, setShowMobileMenu] = useState(false);
  const [showSearchModal, setShowSearchModal] = useState(false);
  const [castReady, setCastReady] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Check for Cast SDK availability
  useEffect(() => {
    let attempts = 0;
    const maxAttempts = 30; // 3 seconds
    let timeoutId;

    const checkCastReady = () => {
      attempts++;

      if (window.cast && window.cast.framework) {
        setCastReady(true);
        return;
      }

      if (attempts < maxAttempts) {
        timeoutId = setTimeout(checkCastReady, 100);
      }
      // Silently fail if Cast SDK doesn't load - it's an optional feature
    };

    window['__onGCastApiAvailable'] = (isAvailable) => {
      if (isAvailable) {
        setCastReady(true);
      }
    };

    checkCastReady();

    return () => {
      if (timeoutId) clearTimeout(timeoutId);
    };
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

  const loadUserProfile = () => {
    const token = localStorage.getItem('token');
    if (token) {
      // Fetch user profile from server (don't rely on JWT claims for is_admin)
      fetch('/api/profile', {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      })
        .then(res => res.json())
        .then(profile => {
          console.log('Profile data:', profile);
          setUser({
            id: profile.id,
            username: profile.username,
            avatar: profile.avatar ? `/api/profile/avatar?token=${encodeURIComponent(token)}&t=${Date.now()}` : null,
            display_name: profile.display_name,
            is_admin: profile.is_admin
          });
        })
        .catch(err => console.error('Error fetching profile:', err));
    }
  };

  useEffect(() => {
    loadUserProfile();

    // Listen for profile updates
    const handleProfileUpdate = () => {
      loadUserProfile();
    };

    window.addEventListener('profileUpdated', handleProfileUpdate);

    return () => {
      window.removeEventListener('profileUpdated', handleProfileUpdate);
    };
  }, []);

  const getUserDisplayName = () => {
    if (!user) return '';
    return user.display_name || user.username || 'User';
  };

  const getUserInitials = () => {
    const name = getUserDisplayName();
    return name.charAt(0).toUpperCase();
  };

  // Close dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (showUserMenu && !event.target.closest('.user-menu')) {
        setShowUserMenu(false);
      }
      if (showMobileMenu && !event.target.closest('.mobile-menu-container') && !event.target.closest('.user-avatar-button')) {
        setShowMobileMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showUserMenu, showMobileMenu]);

  return (
    <>
    <nav className="navigation">
      <div className="container nav-container">
        <Link to="/" className="nav-brand">
          <img src="/sappho-logo-navbar.png" alt="Sappho" className="nav-logo" />
        </Link>

        <div className="nav-links desktop-only">
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
          <div className="nav-search-container">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="nav-search-icon">
              <circle cx="11" cy="11" r="8"/>
              <path d="m21 21-4.35-4.35"/>
            </svg>
            <input
              type="text"
              className="nav-search-input"
              placeholder="Search audiobooks..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onFocus={() => setShowSearchModal(true)}
              onClick={() => setShowSearchModal(true)}
            />
            {searchQuery && (
              <button
                className="nav-search-clear"
                onClick={(e) => {
                  e.stopPropagation();
                  setSearchQuery('');
                }}
                title="Clear search"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
              </button>
            )}
          </div>
        </div>

        {/* Mobile primary nav - Home, Library, Search (centered) */}
        <div className="nav-links mobile-only mobile-nav-actions">
          <Link to="/" className={`nav-link ${location.pathname === '/' ? 'active' : ''}`} title="Home">
            <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
              <polyline points="9 22 9 12 15 12 15 22"/>
            </svg>
          </Link>
          <Link to="/library" className={`nav-link ${location.pathname === '/library' ? 'active' : ''}`} title="Library">
            <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/>
              <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
            </svg>
          </Link>
          <button
            className="nav-link search-button no-background"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setShowSearchModal(true);
            }}
            title="Search"
            type="button"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8"/>
              <path d="m21 21-4.35-4.35"/>
            </svg>
          </button>
        </div>

        {/* Mobile user avatar (right side) */}
        <button
          className="user-avatar-button mobile-only"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setShowMobileMenu(!showMobileMenu);
          }}
          title="Menu"
          type="button"
        >
          {user?.avatar ? (
            <img
              src={user.avatar}
              alt={getUserDisplayName()}
              className="user-avatar-mobile"
              onError={(e) => {
                e.target.style.display = 'none';
                e.target.parentElement.innerHTML = `<div class="user-avatar-placeholder-mobile">${getUserInitials()}</div>`;
              }}
            />
          ) : (
            <div className="user-avatar-placeholder-mobile">{getUserInitials()}</div>
          )}
        </button>

        <div className="nav-actions">
          {/* Desktop user menu */}
          {user && (
            <div className="user-menu desktop-only">
              <button
                className="user-button"
                onClick={() => setShowUserMenu(!showUserMenu)}
              >
                {user.avatar ? (
                  <img
                    src={user.avatar}
                    alt={getUserDisplayName()}
                    className="user-avatar"
                    onError={(e) => {
                      e.target.style.display = 'none';
                      const placeholder = document.createElement('div');
                      placeholder.className = 'user-avatar-placeholder';
                      placeholder.textContent = getUserInitials();
                      e.target.parentElement.insertBefore(placeholder, e.target.nextSibling);
                    }}
                  />
                ) : (
                  <div className="user-avatar-placeholder">{getUserInitials()}</div>
                )}
                <span>{getUserDisplayName()}</span>
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
                  <button onClick={() => { navigate('/all-books?favorites=true'); setShowUserMenu(false); }}>
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
                    </svg>
                    Favorites
                  </button>
                  {user?.is_admin && (
                    <>
                      <button onClick={() => { navigate('/settings'); setShowUserMenu(false); }}>
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <circle cx="12" cy="12" r="3"></circle>
                          <path d="M12 1v6m0 6v6"/>
                        </svg>
                        Admin
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
              {user?.avatar ? (
                <img
                  src={user.avatar}
                  alt={getUserDisplayName()}
                  className="user-avatar-mobile"
                  onError={(e) => {
                    e.target.style.display = 'none';
                    const placeholder = document.createElement('div');
                    placeholder.className = 'user-avatar-placeholder-mobile';
                    placeholder.textContent = getUserInitials();
                    e.target.parentElement.insertBefore(placeholder, e.target.nextSibling);
                  }}
                />
              ) : (
                <div className="user-avatar-placeholder-mobile">{getUserInitials()}</div>
              )}
              <span>{getUserDisplayName()}</span>
            </div>

            <button onClick={() => { navigate('/profile'); setShowMobileMenu(false); }}>
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                <circle cx="12" cy="7" r="4"></circle>
              </svg>
              <span>Profile</span>
            </button>

            <button onClick={() => { navigate('/all-books?favorites=true'); setShowMobileMenu(false); }}>
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
              </svg>
              <span>Favorites</span>
            </button>

            {user?.is_admin && (
              <>
                <button onClick={() => { navigate('/settings'); setShowMobileMenu(false); }}>
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="3"></circle>
                    <path d="M12 1v6m0 6v6"/>
                  </svg>
                  <span>Admin</span>
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

    <SearchModal isOpen={showSearchModal} onClose={() => setShowSearchModal(false)} />
    </>
  );
}
