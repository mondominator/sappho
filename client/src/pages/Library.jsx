import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { getAudiobooks, getSeries, getAuthors, getFavorites } from '../api';
import { useWebSocket } from '../contexts/WebSocketContext';
import './Library.css';

export default function Library({ onPlay }) {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({
    totalBooks: 0,
    totalSeries: 0,
    totalAuthors: 0,
    totalDuration: 0,
    totalFavorites: 0
  });
  const { subscribe } = useWebSocket();

  const loadStats = useCallback(async () => {
    try {
      const [seriesRes, authorsRes, audiobooksRes, favoritesRes] = await Promise.all([
        getSeries(),
        getAuthors(),
        getAudiobooks({ limit: 10000 }),
        getFavorites().catch(() => ({ data: [] }))
      ]);

      // Calculate total duration
      const totalDuration = audiobooksRes.data.audiobooks.reduce(
        (sum, book) => sum + (book.duration || 0), 0
      );

      setStats({
        totalBooks: audiobooksRes.data.audiobooks.length,
        totalSeries: seriesRes.data.length,
        totalAuthors: authorsRes.data.length,
        totalDuration,
        totalFavorites: favoritesRes.data.length
      });
    } catch (error) {
      console.error('Error loading stats:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStats();
  }, [loadStats]);

  // Subscribe to real-time updates
  useEffect(() => {
    const unsubAdd = subscribe('library.add', loadStats);
    const unsubDelete = subscribe('library.delete', loadStats);
    return () => { unsubAdd(); unsubDelete(); };
  }, [subscribe, loadStats]);

  const formatDuration = (seconds) => {
    const hours = Math.floor(seconds / 3600);
    if (hours >= 24) {
      const days = Math.floor(hours / 24);
      const remainingHours = hours % 24;
      return `${days}d ${remainingHours}h`;
    }
    return `${hours}h`;
  };

  if (loading) {
    return (
      <div className="library-page">
        <div className="library-loading">
          <div className="loading-spinner"></div>
          <p>Loading your library...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="library-page">
      {/* Stats Bar */}
      <div className="library-stats-bar">
        <div className="stat-item">
          <span className="stat-value">{stats.totalBooks}</span>
          <span className="stat-label">Books</span>
        </div>
        <div className="stat-divider"></div>
        <div className="stat-item">
          <span className="stat-value">{stats.totalAuthors}</span>
          <span className="stat-label">Authors</span>
        </div>
        <div className="stat-divider"></div>
        <div className="stat-item">
          <span className="stat-value">{stats.totalSeries}</span>
          <span className="stat-label">Series</span>
        </div>
        <div className="stat-divider"></div>
        <div className="stat-item">
          <span className="stat-value">{formatDuration(stats.totalDuration)}</span>
          <span className="stat-label">Total</span>
        </div>
      </div>

      {/* Category Cards */}
      <div className="library-categories">
        {/* All Books - Featured Card */}
        <div
          className="category-card featured"
          onClick={() => navigate('/all-books')}
        >
          <div className="category-card-bg">
            <svg viewBox="0 0 200 200" className="category-bg-pattern">
              <defs>
                <linearGradient id="grad-all" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.3" />
                  <stop offset="100%" stopColor="#8b5cf6" stopOpacity="0.1" />
                </linearGradient>
              </defs>
              <circle cx="150" cy="50" r="80" fill="url(#grad-all)" />
              <circle cx="50" cy="150" r="60" fill="url(#grad-all)" />
            </svg>
          </div>
          <div className="category-card-content">
            <div className="category-icon-wrapper all-books">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <rect x="3" y="3" width="7" height="7" rx="1" />
                <rect x="14" y="3" width="7" height="7" rx="1" />
                <rect x="3" y="14" width="7" height="7" rx="1" />
                <rect x="14" y="14" width="7" height="7" rx="1" />
              </svg>
            </div>
            <div className="category-text">
              <h3>All Books</h3>
              <p>{stats.totalBooks} audiobooks</p>
            </div>
            <div className="category-arrow">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M5 12h14M12 5l7 7-7 7" />
              </svg>
            </div>
          </div>
        </div>

        {/* Series Card */}
        <div
          className="category-card"
          onClick={() => navigate('/series')}
        >
          <div className="category-card-bg">
            <svg viewBox="0 0 200 200" className="category-bg-pattern">
              <defs>
                <linearGradient id="grad-series" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#10b981" stopOpacity="0.3" />
                  <stop offset="100%" stopColor="#06b6d4" stopOpacity="0.1" />
                </linearGradient>
              </defs>
              <circle cx="160" cy="40" r="70" fill="url(#grad-series)" />
            </svg>
          </div>
          <div className="category-card-content">
            <div className="category-icon-wrapper series">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H19a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H6.5a1 1 0 0 1 0-5H20" />
                <path d="M8 2v5" />
              </svg>
            </div>
            <div className="category-text">
              <h3>Series</h3>
              <p>{stats.totalSeries} collections</p>
            </div>
            <div className="category-arrow">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M5 12h14M12 5l7 7-7 7" />
              </svg>
            </div>
          </div>
        </div>

        {/* Authors Card */}
        <div
          className="category-card"
          onClick={() => navigate('/authors')}
        >
          <div className="category-card-bg">
            <svg viewBox="0 0 200 200" className="category-bg-pattern">
              <defs>
                <linearGradient id="grad-authors" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#f59e0b" stopOpacity="0.3" />
                  <stop offset="100%" stopColor="#ef4444" stopOpacity="0.1" />
                </linearGradient>
              </defs>
              <circle cx="170" cy="30" r="60" fill="url(#grad-authors)" />
            </svg>
          </div>
          <div className="category-card-content">
            <div className="category-icon-wrapper authors">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <circle cx="12" cy="8" r="4" />
                <path d="M20 21a8 8 0 1 0-16 0" />
              </svg>
            </div>
            <div className="category-text">
              <h3>Authors</h3>
              <p>{stats.totalAuthors} writers</p>
            </div>
            <div className="category-arrow">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M5 12h14M12 5l7 7-7 7" />
              </svg>
            </div>
          </div>
        </div>

        {/* Genres Card */}
        <div
          className="category-card"
          onClick={() => navigate('/genres')}
        >
          <div className="category-card-bg">
            <svg viewBox="0 0 200 200" className="category-bg-pattern">
              <defs>
                <linearGradient id="grad-genres" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#ec4899" stopOpacity="0.3" />
                  <stop offset="100%" stopColor="#8b5cf6" stopOpacity="0.1" />
                </linearGradient>
              </defs>
              <circle cx="150" cy="50" r="65" fill="url(#grad-genres)" />
            </svg>
          </div>
          <div className="category-card-content">
            <div className="category-icon-wrapper genres">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                <path d="M22 6l-10 7L2 6" />
              </svg>
            </div>
            <div className="category-text">
              <h3>Genres</h3>
              <p>Browse by category</p>
            </div>
            <div className="category-arrow">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M5 12h14M12 5l7 7-7 7" />
              </svg>
            </div>
          </div>
        </div>

        {/* Favorites Card */}
        <div
          className="category-card"
          onClick={() => navigate('/all-books?favorites=true')}
        >
          <div className="category-card-bg">
            <svg viewBox="0 0 200 200" className="category-bg-pattern">
              <defs>
                <linearGradient id="grad-favorites" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#facc15" stopOpacity="0.3" />
                  <stop offset="100%" stopColor="#f59e0b" stopOpacity="0.1" />
                </linearGradient>
              </defs>
              <circle cx="140" cy="60" r="70" fill="url(#grad-favorites)" />
            </svg>
          </div>
          <div className="category-card-content">
            <div className="category-icon-wrapper favorites">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
              </svg>
            </div>
            <div className="category-text">
              <h3>Favorites</h3>
              <p>{stats.totalFavorites} starred</p>
            </div>
            <div className="category-arrow">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M5 12h14M12 5l7 7-7 7" />
              </svg>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
