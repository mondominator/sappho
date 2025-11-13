import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getAudiobooks, getCoverUrl, getProgress } from '../api';
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

  const formatDuration = (seconds) => {
    if (!seconds) return 'Unknown';
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return `${hours}h ${minutes}m`;
  };

  const getTotalDuration = () => {
    const total = audiobooks.reduce((sum, book) => sum + (book.duration || 0), 0);
    const hours = Math.floor(total / 3600);
    return `${hours}h total`;
  };

  const getUniqueSeries = () => {
    const series = audiobooks
      .filter(book => book.series)
      .map(book => book.series);
    return [...new Set(series)];
  };

  if (loading) {
    return <div className="loading">Loading author...</div>;
  }

  return (
    <div className="author-detail container">
      <button className="btn btn-secondary back-button" onClick={() => navigate(-1)}>
        ← Back
      </button>

      <div className="author-header">
        <h1 className="author-name">{name}</h1>
        <div className="author-stats">
          <span className="stat-item">{audiobooks.length} books</span>
          {getUniqueSeries().length > 0 && (
            <span className="stat-item">{getUniqueSeries().length} series</span>
          )}
          <span className="stat-item">{getTotalDuration()}</span>
        </div>
      </div>

      {getUniqueSeries().length > 0 && (
        <div className="author-series-list">
          <h2>Series</h2>
          <div className="series-chips">
            {getUniqueSeries().map(series => (
              <button
                key={series}
                className="series-chip"
                onClick={() => navigate(`/series/${encodeURIComponent(series)}`)}
              >
                {series}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="author-books">
        <h2>All Books</h2>
        <div className="audiobook-grid">
          {audiobooks.map((book) => (
            <div key={book.id} className="audiobook-card">
              {book.cover_image && (
                <div className="audiobook-cover" onClick={() => navigate(`/audiobook/${book.id}`)}>
                  <img src={getCoverUrl(book.id)} alt={book.title} onError={(e) => e.target.style.display = 'none'} />
                </div>
              )}
              <div className="audiobook-info" onClick={() => navigate(`/audiobook/${book.id}`)}>
                <h3 className="audiobook-title">{book.title}</h3>
                {book.series && (
                  <p className="audiobook-series">
                    {book.series} {book.series_position && `#${book.series_position}`}
                  </p>
                )}
                {book.narrator && <p className="audiobook-narrator">Narrated by {book.narrator}</p>}
                <p className="audiobook-duration">{formatDuration(book.duration)}</p>
              </div>
              <div className="audiobook-actions">
                <button className="btn btn-primary" onClick={async (e) => {
                  e.stopPropagation();
                  try {
                    const progressResponse = await getProgress(book.id);
                    onPlay(book, progressResponse.data);
                  } catch (error) {
                    console.error('Error loading progress:', error);
                    onPlay(book, null);
                  }
                }}>
                  Play
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
