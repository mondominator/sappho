import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getAudiobooks, getCoverUrl, getProgress } from '../api';
import { formatDuration } from '../utils/formatting';
import './AuthorDetail.css';

export default function AuthorDetail({ onPlay }) {
  const { name } = useParams();
  const navigate = useNavigate();
  const [audiobooks, setAudiobooks] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadAuthorBooks();
  }, [name]);

  const loadAuthorBooks = async () => {
    try {
      const response = await getAudiobooks({ author: name });
      setAudiobooks(response.data.audiobooks);
    } catch (error) {
      console.error('Error loading author audiobooks:', error);
    } finally {
      setLoading(false);
    }
  };


  const getTotalDuration = () => {
    const total = audiobooks.reduce((sum, book) => sum + (book.duration || 0), 0);
    const hours = Math.floor(total / 3600);
    return hours;
  };

  const getUniqueSeries = () => {
    const seriesMap = new Map();
    audiobooks.forEach(book => {
      if (book.series) {
        const count = seriesMap.get(book.series) || 0;
        seriesMap.set(book.series, count + 1);
      }
    });
    return Array.from(seriesMap.entries()).map(([series, count]) => ({ series, count }));
  };

  const getCompletedCount = () => {
    return audiobooks.filter(book => book.progress >= 98).length;
  };

  const handlePlayBook = async (e, book) => {
    e.stopPropagation();
    try {
      const progressResponse = await getProgress(book.id);
      onPlay(book, progressResponse.data);
    } catch (error) {
      console.error('Error loading progress:', error);
      onPlay(book, null);
    }
  };

  if (loading) {
    return (
      <div className="author-detail-page">
        <div className="author-loading">Loading author...</div>
      </div>
    );
  }

  const uniqueSeries = getUniqueSeries();

  return (
    <div className="author-detail-page">
      <button className="author-back-btn" onClick={() => navigate(-1)}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="15 18 9 12 15 6"></polyline>
        </svg>
        Back
      </button>

      {/* Hero Section */}
      <div className="author-hero">
        <div className="author-hero-avatar">
          <span className="author-hero-letter">{name.charAt(0)}</span>
        </div>
        <div className="author-hero-info">
          <h1 className="author-hero-name">{name}</h1>
          <div className="author-hero-stats">
            <div className="author-stat">
              <span className="author-stat-value">{audiobooks.length}</span>
              <span className="author-stat-label">{audiobooks.length === 1 ? 'Book' : 'Books'}</span>
            </div>
            {uniqueSeries.length > 0 && (
              <div className="author-stat">
                <span className="author-stat-value">{uniqueSeries.length}</span>
                <span className="author-stat-label">{uniqueSeries.length === 1 ? 'Series' : 'Series'}</span>
              </div>
            )}
            <div className="author-stat">
              <span className="author-stat-value">{getTotalDuration()}</span>
              <span className="author-stat-label">Hours</span>
            </div>
            {getCompletedCount() > 0 && (
              <div className="author-stat">
                <span className="author-stat-value">{getCompletedCount()}</span>
                <span className="author-stat-label">Completed</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Series Section */}
      {uniqueSeries.length > 0 && (
        <div className="author-series-section">
          <h2 className="author-section-title">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path>
              <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path>
            </svg>
            Series
          </h2>
          <div className="series-tags">
            {uniqueSeries.map(({ series, count }) => (
              <button
                key={series}
                className="series-tag"
                onClick={() => navigate(`/series/${encodeURIComponent(series)}`)}
              >
                {series}
                <span className="series-tag-count">{count}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Books Section */}
      <div className="author-books-section">
        <h2 className="author-section-title">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="7" height="7"></rect>
            <rect x="14" y="3" width="7" height="7"></rect>
            <rect x="14" y="14" width="7" height="7"></rect>
            <rect x="3" y="14" width="7" height="7"></rect>
          </svg>
          All Books
        </h2>

        {audiobooks.length === 0 ? (
          <div className="author-empty">
            <p>No audiobooks found for this author.</p>
          </div>
        ) : (
          <div className="books-grid">
            {audiobooks.map((book) => (
              <div
                key={book.id}
                className="book-card"
                onClick={() => navigate(`/audiobook/${book.id}`)}
              >
                <div className="book-card-cover">
                  {book.cover_image ? (
                    <img
                      src={getCoverUrl(book.id, book.updated_at, 300)}
                      alt={book.title}
                      loading="lazy"
                      onError={(e) => {
                        e.target.style.display = 'none';
                        e.target.nextSibling.style.display = 'flex';
                      }}
                    />
                  ) : null}
                  <div className="book-card-placeholder" style={{ display: book.cover_image ? 'none' : 'flex' }}>
                    <span>{book.title}</span>
                  </div>

                  {/* Play overlay */}
                  <div className="book-play-overlay">
                    <button
                      className="book-play-btn"
                      onClick={(e) => handlePlayBook(e, book)}
                    >
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                        <polygon points="5 3 19 12 5 21 5 3"></polygon>
                      </svg>
                    </button>
                  </div>

                  {/* Rating badge on cover */}
                  {(book.user_rating || book.average_rating) > 0 && (
                    <div className="cover-rating-badge">
                      <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="#fbbf24" stroke="#fbbf24" strokeWidth="1.5">
                        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
                      </svg>
                      <span>{book.user_rating || (Math.round(book.average_rating * 10) / 10)}</span>
                    </div>
                  )}

                  {/* Progress bar */}
                  {book.progress > 0 && (
                    <div className="book-progress-bar">
                      <div
                        className={`book-progress-fill ${book.progress >= 98 ? 'complete' : ''}`}
                        style={{ width: `${Math.min(book.progress, 100)}%` }}
                      ></div>
                    </div>
                  )}
                </div>

                <div className="book-card-info">
                  <h3 className="book-card-title">{book.title}</h3>
                  {book.series && (
                    <p className="book-card-series">
                      {book.series}{book.series_position ? ` #${book.series_position}` : ''}
                    </p>
                  )}
                  <div className="book-card-meta">
                    {book.narrator && (
                      <span className="book-card-narrator">{book.narrator}</span>
                    )}
                    {book.duration && (
                      <>
                        {book.narrator && <span>·</span>}
                        <span className="book-card-duration">{formatDuration(book.duration)}</span>
                      </>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
