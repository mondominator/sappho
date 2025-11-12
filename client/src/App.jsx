import { useState, useEffect, useRef } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import Login from './pages/Login'
import Home from './pages/Home'
import Library from './pages/Library'
import Profile from './pages/Profile'
import AudiobookDetail from './pages/AudiobookDetail'
import AuthorDetail from './pages/AuthorDetail'
import AuthorsList from './pages/AuthorsList'
import SeriesList from './pages/SeriesList'
import SeriesDetail from './pages/SeriesDetail'
import Settings from './pages/Settings'
import AudioPlayer from './components/AudioPlayer'
import Navigation from './components/Navigation'
import UploadModal from './components/UploadModal'
import './App.css'

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
    <div className="app">
      <Navigation
        onLogout={onLogout}
        onOpenUpload={() => setShowUploadModal(true)}
      />
      <main className="main-content">
        <Routes>
          <Route path="/" element={<Home onPlay={playAudiobook} />} />
          <Route path="/library" element={<Library onPlay={playAudiobook} />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="/audiobook/:id" element={<AudiobookDetail onPlay={playAudiobook} />} />
          <Route path="/authors" element={<AuthorsList />} />
          <Route path="/author/:name" element={<AuthorDetail onPlay={playAudiobook} />} />
          <Route path="/series" element={<SeriesList />} />
          <Route path="/series/:name" element={<SeriesDetail onPlay={playAudiobook} />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </main>
      <UploadModal
        isOpen={showUploadModal}
        onClose={() => setShowUploadModal(false)}
      />
      {currentAudiobook && (
        <AudioPlayer
          ref={playerRef}
          audiobook={currentAudiobook}
          progress={currentProgress}
          onClose={() => {
            setCurrentAudiobook(null)
            setCurrentProgress(null)
            localStorage.removeItem('playerPlaying')
          }}
        />
      )}
    </div>
  );
}

function App() {
  const [token, setToken] = useState(localStorage.getItem('token'))
  const [showUploadModal, setShowUploadModal] = useState(false)
  const [currentAudiobook, setCurrentAudiobook] = useState(() => {
    const saved = localStorage.getItem('currentAudiobook')
    return saved ? JSON.parse(saved) : null
  })
  const [currentProgress, setCurrentProgress] = useState(() => {
    const saved = localStorage.getItem('currentProgress')
    return saved ? JSON.parse(saved) : null
  })

  // Initialize Google Cast SDK
  useEffect(() => {
    window['__onGCastApiAvailable'] = (isAvailable) => {
      if (isAvailable) {
        try {
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

  const handleLogin = (newToken) => {
    localStorage.setItem('token', newToken)
    setToken(newToken)
    // Reset URL to home page on login
    window.history.replaceState(null, '', '/')
  }

  const handleLogout = () => {
    localStorage.removeItem('token')
    localStorage.removeItem('currentAudiobook')
    localStorage.removeItem('currentProgress')
    setToken(null)
    setCurrentAudiobook(null)
    setCurrentProgress(null)
  }

  const playAudiobook = (audiobook, progress = null) => {
    setCurrentAudiobook(audiobook)
    setCurrentProgress(progress)
  }

  if (!token) {
    return <Login onLogin={handleLogin} />
  }

  return (
    <BrowserRouter>
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
    </BrowserRouter>
  )
}

export default App
