import { useState, useEffect, useRef, lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import AudioPlayer from './components/AudioPlayer'
import Navigation from './components/Navigation'
import { WebSocketProvider } from './contexts/WebSocketContext'
import { getProgress, getProfile } from './api'
import './App.css'

// Lazy-loaded pages
const Login = lazy(() => import('./pages/Login'))
const UnlockAccount = lazy(() => import('./pages/UnlockAccount'))
const ForcePasswordChange = lazy(() => import('./components/ForcePasswordChange'))
const Home = lazy(() => import('./pages/Home'))
const Library = lazy(() => import('./pages/Library'))
const AllBooks = lazy(() => import('./pages/AllBooks'))
const Profile = lazy(() => import('./pages/Profile'))
const AudiobookDetail = lazy(() => import('./pages/AudiobookDetail'))
const AuthorDetail = lazy(() => import('./pages/AuthorDetail'))
const AuthorsList = lazy(() => import('./pages/AuthorsList'))
const SeriesList = lazy(() => import('./pages/SeriesList'))
const SeriesDetail = lazy(() => import('./pages/SeriesDetail'))
const GenresList = lazy(() => import('./pages/GenresList'))
const Collections = lazy(() => import('./pages/Collections'))
const CollectionDetail = lazy(() => import('./pages/CollectionDetail'))
const Settings = lazy(() => import('./pages/Settings'))

// Scroll to top on route change
function ScrollToTop() {
  const { pathname } = useLocation();

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

  return null;
}

function AppContent({ token, onLogout, currentAudiobook, setCurrentAudiobook, currentProgress, setCurrentProgress, playAudiobook }) {
  const location = useLocation();
  const playerRef = useRef();

  // Close fullscreen when location changes
  useEffect(() => {
    if (playerRef.current && playerRef.current.closeFullscreen) {
      playerRef.current.closeFullscreen();
    }
  }, [location.pathname]);

  return (
    <div className={`app ${currentAudiobook ? 'player-active' : ''}`}>
      <Navigation onLogout={onLogout} />
      <main className="main-content">
        <Suspense fallback={<div className="loading-screen">Loading...</div>}>
          <Routes>
            <Route path="/" element={<Home onPlay={playAudiobook} />} />
            <Route path="/library" element={<Library onPlay={playAudiobook} />} />
            <Route path="/all-books" element={<AllBooks onPlay={playAudiobook} />} />
            <Route path="/profile" element={<Profile />} />
            <Route path="/audiobook/:id" element={<AudiobookDetail onPlay={playAudiobook} />} />
            <Route path="/authors" element={<AuthorsList />} />
            <Route path="/author/:name" element={<AuthorDetail onPlay={playAudiobook} />} />
            <Route path="/series" element={<SeriesList />} />
            <Route path="/series/:name" element={<SeriesDetail onPlay={playAudiobook} />} />
            <Route path="/genres" element={<GenresList />} />
            <Route path="/collections" element={<Collections />} />
            <Route path="/collections/:id" element={<CollectionDetail />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="*" element={<Navigate to="/" />} />
          </Routes>
        </Suspense>
      </main>
      {currentAudiobook && currentAudiobook.id && (
        <AudioPlayer
          ref={playerRef}
          audiobook={currentAudiobook}
          progress={currentProgress}
          onClose={() => {
            setCurrentAudiobook(null)
            setCurrentProgress(null)
            localStorage.removeItem('playerPlaying')
            localStorage.removeItem('currentAudiobookId')
            localStorage.removeItem('currentAudiobook')
            localStorage.removeItem('currentProgress')
          }}
        />
      )}
    </div>
  );
}

function App() {
  const [token, setToken] = useState(localStorage.getItem('token'))
  const [mustChangePassword, setMustChangePassword] = useState(() => {
    return localStorage.getItem('mustChangePassword') === 'true';
  })
  const [currentAudiobook, setCurrentAudiobook] = useState(() => {
    try {
      const saved = localStorage.getItem('currentAudiobook')
      if (!saved) return null
      const parsed = JSON.parse(saved)
      // Validate that the audiobook object has required properties
      if (!parsed || !parsed.id) {
        console.warn('Invalid audiobook in localStorage, clearing')
        localStorage.removeItem('currentAudiobook')
        return null
      }
      return parsed
    } catch (err) {
      console.error('Error restoring audiobook state:', err)
      localStorage.removeItem('currentAudiobook')
      return null
    }
  })
  const [currentProgress, setCurrentProgress] = useState(() => {
    try {
      const saved = localStorage.getItem('currentProgress')
      return saved ? JSON.parse(saved) : null
    } catch (err) {
      console.error('Error restoring progress state:', err)
      localStorage.removeItem('currentProgress')
      return null
    }
  })

  // Validate token on mount and check for forced password change
  useEffect(() => {
    if (token) {
      getProfile()
        .then((response) => {
          // Check if user must change password
          if (response.data.must_change_password) {
            localStorage.setItem('mustChangePassword', 'true');
            setMustChangePassword(true);
          }
        })
        .catch((error) => {
          if (error.response && (error.response.status === 401 || error.response.status === 403)) {
            // Token is invalid/expired - clear state
            setToken(null);
            setMustChangePassword(false);
            setCurrentAudiobook(null);
            setCurrentProgress(null);
          }
        });
    }
  }, [token]);

  // Initialize Google Cast SDK
  useEffect(() => {
    window['__onGCastApiAvailable'] = (isAvailable) => {
      if (isAvailable) {
        try {
          // Check if Cast API is actually available
          if (!window.cast || !window.cast.framework || !window.chrome || !window.chrome.cast) {
            console.warn('Cast API reported available but framework not found');
            return;
          }
          const castContext = window.cast.framework.CastContext.getInstance();
          castContext.setOptions({
            receiverApplicationId: window.chrome.cast.media.DEFAULT_MEDIA_RECEIVER_APP_ID,
            autoJoinPolicy: window.chrome.cast.AutoJoinPolicy.ORIGIN_SCOPED
          });
        } catch (error) {
          console.error('Error initializing Cast SDK:', error);
        }
      }
    };
  }, [])

  // Save player state to localStorage whenever it changes
  useEffect(() => {
    if (currentAudiobook) {
      localStorage.setItem('currentAudiobook', JSON.stringify(currentAudiobook))
    } else {
      localStorage.removeItem('currentAudiobook')
    }
  }, [currentAudiobook])

  useEffect(() => {
    if (currentProgress) {
      localStorage.setItem('currentProgress', JSON.stringify(currentProgress))
    } else {
      localStorage.removeItem('currentProgress')
    }
  }, [currentProgress])

  // Fetch latest progress from server on page load if there's a current audiobook
  useEffect(() => {
    const fetchLatestProgress = async () => {
      if (currentAudiobook && currentAudiobook.id && token) {
        try {
          const progressResponse = await getProgress(currentAudiobook.id);
          const latestProgress = progressResponse.data;
          setCurrentProgress(latestProgress);
        } catch (error) {
          console.error('Error fetching latest progress on load:', error);
          // Keep the cached progress if server fetch fails
        }
      }
    };

    fetchLatestProgress();
  }, []); // Run only once on mount

  const handleLogin = (newToken, mustChange = false) => {
    localStorage.setItem('token', newToken)
    setToken(newToken)
    if (mustChange) {
      localStorage.setItem('mustChangePassword', 'true')
      setMustChangePassword(true)
    } else {
      localStorage.removeItem('mustChangePassword')
      setMustChangePassword(false)
    }
    // Reset URL to home page on login
    window.history.replaceState(null, '', '/')
  }

  const handleLogout = () => {
    localStorage.removeItem('token')
    localStorage.removeItem('currentAudiobook')
    localStorage.removeItem('currentProgress')
    localStorage.removeItem('playerPlaying')
    localStorage.removeItem('currentAudiobookId')
    localStorage.removeItem('mustChangePassword')
    setToken(null)
    setMustChangePassword(false)
    setCurrentAudiobook(null)
    setCurrentProgress(null)
    // Force a page reload to ensure clean logout
    window.location.href = '/'
  }

  const playAudiobook = (audiobook, progress = null, openFullscreen = false) => {
    // If clicking the same book that's already loaded, we need to signal a play request
    if (currentAudiobook && currentAudiobook.id === audiobook.id) {
      // Create a new object reference to trigger re-render and include play signal
      setCurrentAudiobook({ ...audiobook, _playRequested: Date.now(), _openFullscreen: openFullscreen })
      setCurrentProgress(progress)
    } else {
      setCurrentAudiobook({ ...audiobook, _openFullscreen: openFullscreen })
      setCurrentProgress(progress)
    }
  }

  // Wrap everything in BrowserRouter to support public routes like /unlock
  return (
    <BrowserRouter>
      <ScrollToTop />
      <Suspense fallback={<div className="loading-screen">Loading...</div>}>
        <Routes>
          {/* Public route for account unlock - accessible without authentication */}
          <Route path="/unlock" element={<UnlockAccount />} />

          {/* All other routes require authentication */}
          <Route path="*" element={
            !token ? (
              <Login onLogin={handleLogin} />
            ) : mustChangePassword ? (
              <ForcePasswordChange onLogout={handleLogout} />
            ) : (
              <WebSocketProvider>
                <AppContent
                  token={token}
                  onLogout={handleLogout}
                  currentAudiobook={currentAudiobook}
                  setCurrentAudiobook={setCurrentAudiobook}
                  currentProgress={currentProgress}
                  setCurrentProgress={setCurrentProgress}
                  playAudiobook={playAudiobook}
                />
              </WebSocketProvider>
            )
          } />
        </Routes>
      </Suspense>
    </BrowserRouter>
  )
}

export default App
