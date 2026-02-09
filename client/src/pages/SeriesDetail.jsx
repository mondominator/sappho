import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import axios from 'axios';
import { getAudiobooks, getCoverUrl, getProgress, getProfile } from '../api';
import BatchActionBar from '../components/BatchActionBar';
import './SeriesDetail.css';

export default function SeriesDetail({ onPlay }) {
  const { name } = useParams();
  const navigate = useNavigate();
  const [audiobooks, setAudiobooks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [recap, setRecap] = useState(null);
  const [recapLoading, setRecapLoading] = useState(false);
  const [recapError, setRecapError] = useState(null);
  const [recapExpanded, setRecapExpanded] = useState(false);
  const [aiConfigured, setAiConfigured] = useState(false);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    loadSeriesBooks();
    checkAiStatus();
    loadProfile();
    setRecap(null);
    setRecapExpanded(false);
    setRecapError(null);
    setSelectionMode(false);
    setSelectedIds(new Set());
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

  const loadProfile = async () => {
    try {
      const response = await getProfile();
      setIsAdmin(response.data.is_admin === 1);
    } catch (error) {
      console.error('Error loading profile:', error);
    }
  };

  const toggleSelectionMode = () => {
    if (selectionMode) {
      setSelectedIds(new Set());
    }
    setSelectionMode(!selectionMode);
  };

  const toggleBookSelection = (bookId) => {
    setSelectedIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(bookId)) {
        newSet.delete(bookId);
      } else {
        newSet.add(bookId);
      }
      return newSet;
    });
  };

  const selectAll = () => {
    setSelectedIds(new Set(audiobooks.map(b => b.id)));
  };

  const deselectAll = () => {
    setSelectedIds(new Set());
  };

  const handleBatchActionComplete = (message) => {
    alert(message);
    setSelectedIds(new Set());
    setSelectionMode(false);
    loadSeriesBooks();
  };

  const loadSeriesBooks = async () => {
    try {
      const response = await getAudiobooks({ series: name });
      // Sort by series position
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
    const total = audiobooks.reduce((sum, book) => sum + (book.duration || 0), 0);
    const hours = Math.floor(total / 3600);
    return `${hours}h total`;
  };

  const getAuthors = () => {
    const authors = audiobooks
      .filter(book => book.author)
      .map(book => book.author);
    return [...new Set(authors)];
  };

  const renderBookCard = (book) => {
    const isSelected = selectedIds.has(book.id);

    const handleCardClick = () => {
      if (selectionMode) {
        toggleBookSelection(book.id);
      } else {
        navigate(`/audiobook/${book.id}`);
      }
    };

    return (
      <div
        key={book.id}
        className={`audiobook-card ${selectionMode ? 'selection-mode' : ''} ${isSelected ? 'selected' : ''}`}
      >
        {selectionMode && (
          <div className="selection-checkbox">
            <input
              type="checkbox"
              checked={isSelected}
              onChange={() => toggleBookSelection(book.id)}
              onClick={(e) => e.stopPropagation()}
            />
          </div>
        )}
        <div className="audiobook-cover" onClick={handleCardClick}>
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
          {!selectionMode && (
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
          )}
        </div>
      </div>
    );
  };

  if (loading) {
    return <div className="loading">Loading series...</div>;
  }

  return (
    <div className="series-detail-page container">
      <button className="back-button-modern" onClick={() => navigate(-1)}>
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M19 12H5M12 19l-7-7 7-7"/>
        </svg>
        Back
      </button>

      <div className="series-detail-header">
        <div className="series-detail-title-row">
          <h1 className="series-detail-name">{name}</h1>
          <div className="series-detail-actions">
            <button
              className={`selection-mode-btn ${selectionMode ? 'active' : ''}`}
              onClick={toggleSelectionMode}
              title={selectionMode ? 'Exit selection mode' : 'Select multiple books'}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="9 11 12 14 22 4"></polyline>
                <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"></path>
              </svg>
              {selectionMode ? 'Cancel' : 'Select'}
            </button>
            {selectionMode && (
              <div className="selection-controls">
                <button onClick={selectAll} className="select-all-btn">Select All</button>
                <button onClick={deselectAll} className="deselect-all-btn" disabled={selectedIds.size === 0}>Deselect All</button>
              </div>
            )}
          </div>
        </div>
        <div className="series-detail-stats">
          <span className="stat-item">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/>
              <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
            </svg>
            {audiobooks.length} book{audiobooks.length !== 1 ? 's' : ''}
          </span>
          {getAuthors().length > 0 && (
            <span className="stat-item">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"></path>
                <circle cx="12" cy="7" r="4"></circle>
              </svg>
              {getAuthors().join(', ')}
            </span>
          )}
          <span className="stat-item">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"></circle>
              <polyline points="12 6 12 12 16 14"></polyline>
            </svg>
            {getTotalDuration()}
          </span>
        </div>
      </div>

      {/* Catch Me Up Section */}
      {aiConfigured && hasProgress() && (
        <div className="catch-me-up-section">
          {!recap && !recapLoading && !recapError && (
            <button className="catch-me-up-button" onClick={loadRecap}>
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/>
                <polyline points="14 2 14 8 20 8"/>
                <line x1="16" y1="13" x2="8" y2="13"/>
                <line x1="16" y1="17" x2="8" y2="17"/>
                <line x1="10" y1="9" x2="8" y2="9"/>
              </svg>
              Catch Me Up
            </button>
          )}

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
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/>
                    <polyline points="14 2 14 8 20 8"/>
                    <line x1="16" y1="13" x2="8" y2="13"/>
                    <line x1="16" y1="17" x2="8" y2="17"/>
                    <line x1="10" y1="9" x2="8" y2="9"/>
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

      <div className={`series-books-grid ${selectionMode && selectedIds.size > 0 ? 'has-action-bar' : ''}`}>
        {audiobooks.map(renderBookCard)}
      </div>

      {selectionMode && selectedIds.size > 0 && (
        <BatchActionBar
          selectedIds={Array.from(selectedIds)}
          onActionComplete={handleBatchActionComplete}
          onClose={() => {
            setSelectedIds(new Set());
            setSelectionMode(false);
          }}
        />
      )}
    </div>
  );
}
