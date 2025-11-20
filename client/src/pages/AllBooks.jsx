import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { getAudiobooks, getCoverUrl, getProgress } from '../api';
import './AllBooks.css';

export default function AllBooks({ onPlay }) {
  const navigate = useNavigate();
  const [audiobooks, setAudiobooks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sortBy, setSortBy] = useState('title');

  useEffect(() => {
    loadAudiobooks();
  }, []);

  const loadAudiobooks = async () => {
    try {
      const response = await getAudiobooks({ limit: 10000 });
      setAudiobooks(response.data.audiobooks);
    } catch (error) {
      console.error('Error loading audiobooks:', error);
    } finally {
      setLoading(false);
    }
  };

  const sortedAudiobooks = [...audiobooks].sort((a, b) => {
    switch (sortBy) {
      case 'title':
        return (a.title || '').localeCompare(b.title || '');
      case 'author':
        return (a.author || '').localeCompare(b.author || '');
      case 'series':
        if (!a.series && !b.series) return 0;
        if (!a.series) return 1;
        if (!b.series) return -1;
        const seriesCompare = a.series.localeCompare(b.series);
        if (seriesCompare !== 0) return seriesCompare;
        return (a.series_position || 0) - (b.series_position || 0);
      case 'genre':
        return (a.genre || '').localeCompare(b.genre || '');
      case 'recent':
        return new Date(b.created_at || 0) - new Date(a.created_at || 0);
      default:
        return 0;
    }
  });

  const handlePlay = async (book, e) => {
    // On desktop, prevent navigation to detail page when clicking play button
    // On mobile, both cover and button trigger play, so no need to stop propagation
    const isMobile = window.innerWidth <= 768;
    if (!isMobile) {
      e.stopPropagation();
    }

    try {
      const progressResponse = await getProgress(book.id);
      const progress = progressResponse.data;
      onPlay(book, progress);
    } catch (error) {
      console.error('Error loading progress:', error);
      onPlay(book, null);
    }
  };

  const renderBookCard = (book) => {
    const coverUrl = getCoverUrl(book.id);

    return (
      <div key={book.id} className="audiobook-card" data-book-id={book.id}>
        <div className="audiobook-cover" onClick={() => navigate(`/audiobook/${book.id}`)}>
          {book.cover_image ? (
            <img
              src={coverUrl}
              alt={book.title}
              onError={(e) => {
                e.target.style.display = 'none';
              }}
            />
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
  };

  if (loading) {
    return <div className="loading">Loading library...</div>;
  }

  return (
    <div className="all-books-page container">
      {audiobooks.length === 0 ? (
        <div className="empty-state">
          <p>No audiobooks found.</p>
          <p>Upload some audiobooks or drop them in the watch directory!</p>
        </div>
      ) : (
        <>
          <div className="all-books-header">
            <button className="back-button" onClick={() => navigate('/library')}>← Back</button>
            <h2 className="all-books-count">{audiobooks.length} {audiobooks.length === 1 ? 'Book' : 'Books'}</h2>
            <div className="all-books-sort">
              <label htmlFor="sort-select">Sort by:</label>
              <select
                id="sort-select"
                className="sort-select"
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
              >
                <option value="title">Title</option>
                <option value="author">Author</option>
                <option value="series">Series</option>
                <option value="genre">Genre</option>
                <option value="recent">Recently Added</option>
              </select>
            </div>
          </div>
          <div className="audiobook-grid" data-book-count={sortedAudiobooks.length}>
            {sortedAudiobooks.map(renderBookCard)}
          </div>
        </>
      )}
    </div>
  );
}
