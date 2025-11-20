import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getAudiobooks, getCoverUrl, getProgress } from '../api';
import './SeriesDetail.css';

export default function SeriesDetail({ onPlay }) {
  const { name } = useParams();
  const navigate = useNavigate();
  const [audiobooks, setAudiobooks] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadSeriesBooks();
  }, [name]);

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

  const renderBookCard = (book) => (
    <div key={book.id} className="audiobook-card">
      <div className="audiobook-cover" onClick={() => navigate(`/audiobook/${book.id}`)}>
        {book.cover_image ? (
          <img src={getCoverUrl(book.id)} alt={book.title} onError={(e) => e.target.style.display = 'none'} />
        ) : (
          <div className="audiobook-cover-placeholder">
            <h3>{book.title}</h3>
          </div>
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
  );

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
        <h1 className="series-detail-name">{name}</h1>
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

      <div className="series-books-grid">
        {audiobooks.map(renderBookCard)}
      </div>
    </div>
  );
}
