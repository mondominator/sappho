import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import axios from 'axios';
import { getAudiobooks, getCoverUrl, getProgress, getProfile } from '../api';
import { formatDurationCompact } from '../utils/formatting';
import './SeriesDetail.css';

export default function SeriesDetail({ onPlay }) {
  const { name } = useParams();
  const navigate = useNavigate();
  const [audiobooks, setAudiobooks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [recap, setRecap] = useState(null);
  const [recapLoading, setRecapLoading] = useState(false);
  const [recapError, setRecapError] = useState(null);
  const [recapExpanded, setRecapExpanded] = useState(true);
  const [aiConfigured, setAiConfigured] = useState(false);

  useEffect(() => {
    loadSeriesBooks();
    checkAiStatus();
    setRecap(null);
    setRecapExpanded(true);
    setRecapError(null);
  }, [name]);

  const checkAiStatus = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await axios.get('/api/settings/ai/status', {
        headers: { Authorization: `Bearer ${token}` }
      });
      setAiConfigured(response.data.configured);
    } catch (error) {
      console.error('Error checking AI status:', error);
      setAiConfigured(false);
    }
  };

  const loadSeriesBooks = async () => {
    try {
      const response = await getAudiobooks({ series: name });
      const sorted = response.data.audiobooks.sort((a, b) => {
        const posA = a.series_position || 999;
        const posB = b.series_position || 999;
        return posA - posB;
      });
      setAudiobooks(sorted);
    } catch (error) {
      console.error('Error loading series audiobooks:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadRecap = async () => {
    setRecapLoading(true);
    setRecapError(null);

    try {
      const token = localStorage.getItem('token');
      const response = await axios.get(`/api/series/${encodeURIComponent(name)}/recap`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setRecap(response.data);
      setRecapExpanded(true);
    } catch (error) {
      console.error('Error loading recap:', error);
      setRecapError(error.response?.data?.message || error.response?.data?.error || 'Failed to generate recap');
    } finally {
      setRecapLoading(false);
    }
  };

  const clearRecapCache = async () => {
    try {
      const token = localStorage.getItem('token');
      await axios.delete(`/api/series/${encodeURIComponent(name)}/recap`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setRecap(null);
      loadRecap();
    } catch (error) {
      console.error('Error clearing recap cache:', error);
    }
  };

  const hasProgress = () => {
    return audiobooks.some(book =>
      book.progress && (book.progress.position > 0 || book.progress.completed === 1)
    );
  };

  const getTotalDuration = () => {
    return audiobooks.reduce((sum, book) => sum + (book.duration || 0), 0);
  };

  const getAuthors = () => {
    const authors = audiobooks
      .filter(book => book.author)
      .map(book => book.author);
    return [...new Set(authors)];
  };

  const getSeriesRating = () => {
    const ratings = audiobooks
      .map(book => book.user_rating || book.average_rating)
      .filter(r => r && r > 0);
    if (ratings.length === 0) return null;
    return {
      average: (ratings.reduce((a, b) => a + b, 0) / ratings.length),
      count: ratings.length
    };
  };

  const getCompletedCount = () => {
    return audiobooks.filter(book => book.progress?.completed === 1).length;
  };

  const getOverallProgress = () => {
    const totalDur = getTotalDuration();
    if (totalDur === 0) return 0;
    const totalProgress = audiobooks.reduce((sum, book) => {
      if (book.progress?.completed === 1) return sum + (book.duration || 0);
      return sum + (book.progress?.position || 0);
    }, 0);
    return Math.min(1, totalProgress / totalDur);
  };


  const renderBookCard = (book) => {
    const displayRating = book.user_rating || book.average_rating;

    return (
      <div
        key={book.id}
        className="audiobook-card-wrapper"
        onClick={() => navigate(`/audiobook/${book.id}`)}
      >
        <div className="audiobook-card">
          <div className="audiobook-cover">
            <div className="audiobook-cover-placeholder">
              <h3>{book.title}</h3>
            </div>
            {book.cover_image && (
              <img src={getCoverUrl(book.id, null, 300)} alt={book.title} loading="lazy" onError={(e) => e.target.style.display = 'none'} />
            )}
            {book.progress && (book.progress.position > 0 || book.progress.completed === 1) && book.duration && (
              <div className="progress-bar-overlay">
                <div
                  className={`progress-bar-fill ${book.progress.completed === 1 ? 'completed' : ''}`}
                  style={{ width: book.progress.completed === 1 ? '100%' : `${Math.round((book.progress.position / book.duration) * 100)}%` }}
                />
              </div>
            )}
            {book.series_position && (
              <div className="series-badge">#{book.series_position}</div>
            )}
            {displayRating > 0 && (
              <div className="cover-rating-badge">
                <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="#fbbf24" stroke="#fbbf24" strokeWidth="1.5">
                  <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
                </svg>
                <span>{book.user_rating || (Math.round(book.average_rating * 10) / 10)}</span>
              </div>
            )}
            <div className="play-overlay">
              <button
                className="play-button"
                onClick={async (e) => {
                  e.stopPropagation();
                  try {
                    const progressResponse = await getProgress(book.id);
                    onPlay(book, progressResponse.data);
                  } catch (error) {
                    console.error('Error loading progress:', error);
                    onPlay(book, null);
                  }
                }}
                aria-label={`Play ${book.title}`}
              />
            </div>
          </div>
        </div>
        <div className="book-card-info">
          <div className="book-card-title">{book.title}</div>
          {book.author && <div className="book-card-author">{book.author}</div>}
        </div>
      </div>
    );
  };

  if (loading) {
    return <div className="loading">Loading series...</div>;
  }

  const seriesRating = getSeriesRating();
  const completedCount = getCompletedCount();
  const overallProgress = getOverallProgress();
  const totalDuration = getTotalDuration();

  return (
    <div className="series-detail-page container">
      {/* Header bar: back + catch me up icon */}
      <div className="series-header-bar">
        <button className="series-back-btn" onClick={() => navigate(-1)}>
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 12H5M12 19l-7-7 7-7"/>
          </svg>
        </button>

        {aiConfigured && hasProgress() && !recap && !recapLoading && !recapError && (
          <button className="catch-me-up-icon-btn" onClick={loadRecap} title="Catch Me Up">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/>
              <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>
            </svg>
          </button>
        )}
      </div>

      {/* Title section - centered */}
      <div className="series-title-section">
        <h1 className="series-detail-name">{name}</h1>
        {getAuthors().length > 0 && (
          <p className="series-author">by {getAuthors().join(', ')}</p>
        )}
        {seriesRating && (
          <div className="series-rating">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="#fbbf24" stroke="#fbbf24" strokeWidth="1.5">
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
            </svg>
            <span className="series-rating-value">{seriesRating.average.toFixed(1)}</span>
            <span className="series-rating-count">({seriesRating.count} rated)</span>
          </div>
        )}
      </div>

      {/* Catch Me Up expanded content */}
      {aiConfigured && hasProgress() && (recapLoading || recapError || recap) && (
        <div className="catch-me-up-section">
          {recapLoading && (
            <div className="recap-loading">
              <div className="recap-spinner"></div>
              <span>Generating your personalized recap...</span>
            </div>
          )}

          {recapError && (
            <div className="recap-error">
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"/>
                <line x1="12" y1="8" x2="12" y2="12"/>
                <line x1="12" y1="16" x2="12.01" y2="16"/>
              </svg>
              <span>{recapError}</span>
              <button className="retry-button" onClick={loadRecap}>Try Again</button>
            </div>
          )}

          {recap && (
            <div className={`recap-container ${recapExpanded ? 'expanded' : ''}`}>
              <div className="recap-header" onClick={() => setRecapExpanded(!recapExpanded)}>
                <div className="recap-header-left">
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/>
                    <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>
                  </svg>
                  <span>Series Recap</span>
                  {recap.cached && (
                    <span className="cached-badge">Cached</span>
                  )}
                </div>
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className={`expand-icon ${recapExpanded ? 'expanded' : ''}`}
                >
                  <polyline points="6 9 12 15 18 9"/>
                </svg>
              </div>

              {recapExpanded && (
                <div className="recap-content">
                  <div className="recap-books-included">
                    <span>Based on: </span>
                    {recap.booksIncluded.map((book, i) => (
                      <span key={book.id} className="book-tag">
                        {book.position ? `#${book.position} ` : ''}{book.title}
                        {i < recap.booksIncluded.length - 1 && ', '}
                      </span>
                    ))}
                  </div>
                  <div className="recap-text">
                    {recap.recap.split('\n\n').map((paragraph, i) => (
                      <p key={i}>{paragraph}</p>
                    ))}
                  </div>
                  <div className="recap-actions">
                    <button className="recap-action-btn" onClick={clearRecapCache}>
                      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21 2v6h-6M3 12a9 9 0 0 1 15-6.7L21 8M3 22v-6h6M21 12a9 9 0 0 1-15 6.7L3 16"/>
                      </svg>
                      Regenerate
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Stats cards */}
      <div className="series-stats-row">
        <div className="stat-card">
          <span className="stat-card-value">{audiobooks.length}</span>
          <span className="stat-card-label">{audiobooks.length === 1 ? 'Book' : 'Books'}</span>
        </div>
        <div className="stat-card">
          <span className="stat-card-value">{formatDurationCompact(totalDuration)}</span>
          <span className="stat-card-label">Total</span>
        </div>
        <div className="stat-card">
          <span className="stat-card-value">{completedCount}/{audiobooks.length}</span>
          <span className="stat-card-label">Complete</span>
        </div>
      </div>

      {/* Series progress bar */}
      {overallProgress > 0 && (
        <div className="series-progress-section">
          <div className="series-progress-header">
            <span>Series Progress</span>
            <span className="series-progress-pct">{Math.round(overallProgress * 100)}%</span>
          </div>
          <div className="series-progress-track">
            <div className="series-progress-fill" style={{ width: `${Math.round(overallProgress * 100)}%` }} />
          </div>
        </div>
      )}

      {/* Books section header */}
      <h2 className="books-section-title">Books in Series</h2>

      {/* Book grid */}
      <div className="series-books-grid">
        {audiobooks.map(renderBookCard)}
      </div>
    </div>
  );
}
