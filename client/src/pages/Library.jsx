import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { getAudiobooks, getCoverUrl, getProgress } from '../api';
import './Library.css';

export default function Library({ onPlay }) {
  const navigate = useNavigate();
  const [audiobooks, setAudiobooks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState({ series: '', author: '' });

  useEffect(() => {
    loadAudiobooks();
  }, [search, filter]);

  const loadAudiobooks = async () => {
    try {
      const response = await getAudiobooks({ search, ...filter });
      setAudiobooks(response.data.audiobooks);
    } catch (error) {
      console.error('Error loading audiobooks:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <div className="loading">Loading library...</div>;
  }

  const handlePlay = async (book, e) => {
    e.stopPropagation();
    try {
      const progressResponse = await getProgress(book.id);
      const progress = progressResponse.data;
      onPlay(book, progress);
    } catch (error) {
      console.error('Error loading progress:', error);
      onPlay(book, null);
    }
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
        <div className="play-overlay">
          <button
            className="play-button"
            onClick={(e) => handlePlay(book, e)}
            aria-label={`Play ${book.title}`}
          />
        </div>
      </div>
    </div>
  );

  return (
    <div className="library-page container">
      <div className="library-search">
        <input
          type="text"
          className="input search-input"
          placeholder="Search audiobooks..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {audiobooks.length === 0 ? (
        <div className="empty-state">
          <p>No audiobooks found.</p>
          <p>Upload some audiobooks or drop them in the watch directory!</p>
        </div>
      ) : (
        <div className="audiobook-grid">
          {audiobooks.map(renderBookCard)}
        </div>
      )}
    </div>
  );
}
