import { useState, useEffect, useRef } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import Login from './pages/Login'
import ForcePasswordChange from './components/ForcePasswordChange'
import Home from './pages/Home'
import Library from './pages/Library'
import AllBooks from './pages/AllBooks'
import Profile from './pages/Profile'
import AudiobookDetail from './pages/AudiobookDetail'
import AuthorDetail from './pages/AuthorDetail'
import AuthorsList from './pages/AuthorsList'
import SeriesList from './pages/SeriesList'
import SeriesDetail from './pages/SeriesDetail'
import GenresList from './pages/GenresList'
import Settings from './pages/Settings'
import AudioPlayer from './components/AudioPlayer'
import Navigation from './components/Navigation'
import UploadModal from './components/UploadModal'
import { WebSocketProvider } from './contexts/WebSocketContext'
import { getProgress, getProfile } from './api'
import './App.css'

// Scroll to top on route change
function ScrollToTop() {
  const { pathname } = useLocation();

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

  return null;
}

function AppContent({ token, onLogout, showUploadModal, setShowUploadModal, currentAudiobook, setCurrentAudiobook, currentProgress, setCurrentProgress, playAudiobook }) {
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
      <Navigation
        onLogout={onLogout}
        onOpenUpload={() => setShowUploadModal(true)}
      />
      <main className="main-content">
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
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </main>
      <UploadModal
        isOpen={showUploadModal}
        onClose={() => setShowUploadModal(false)}
      />
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
  const [showUploadModal, setShowUploadModal] = useState(false)
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
            console.log('Token expired, logging out');
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
          console.log('Cast SDK initialized successfully');
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
          console.log('Fetching latest progress for audiobook:', currentAudiobook.id);
          const progressResponse = await getProgress(currentAudiobook.id);
          const latestProgress = progressResponse.data;
          console.log('Latest progress from server:', latestProgress);
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

  if (!token) {
    return <Login onLogin={handleLogin} />
  }

  if (mustChangePassword) {
    return <ForcePasswordChange onLogout={handleLogout} />
  }

  return (
    <BrowserRouter>
      <ScrollToTop />
      <WebSocketProvider>
        <AppContent
          token={token}
          onLogout={handleLogout}
          showUploadModal={showUploadModal}
          setShowUploadModal={setShowUploadModal}
          currentAudiobook={currentAudiobook}
          setCurrentAudiobook={setCurrentAudiobook}
          currentProgress={currentProgress}
          setCurrentProgress={setCurrentProgress}
          playAudiobook={playAudiobook}
        />
      </WebSocketProvider>
    </BrowserRouter>
  )
}

export default App
