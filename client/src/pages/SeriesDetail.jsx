import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getAudiobooks, getCoverUrl } from '../api';
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
        {book.progress && book.progress.position > 0 && book.duration && (
          <div className="progress-bar-overlay">
            <div
              className="progress-bar-fill"
              style={{ width: `${Math.round((book.progress.position / book.duration) * 100)}%` }}
            />
          </div>
        )}
        {book.series_position && (
          <div className="series-badge">#{book.series_position}</div>
        )}
        <div className="play-overlay">
          <button
            className="play-button"
            onClick={(e) => { e.stopPropagation(); onPlay(book); }}
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
      <button className="btn btn-secondary back-button" onClick={() => navigate(-1)}>
        ← Back
      </button>

      <div className="series-detail-header">
        <h1 className="series-detail-name">{name}</h1>
        <div className="series-detail-stats">
          <span className="stat-item">{audiobooks.length} books</span>
          {getAuthors().length > 0 && (
            <span className="stat-item">by {getAuthors().join(', ')}</span>
          )}
          <span className="stat-item">{getTotalDuration()}</span>
        </div>
      </div>

      <div className="series-books-grid">
        {audiobooks.map(renderBookCard)}
      </div>
    </div>
  );
}
