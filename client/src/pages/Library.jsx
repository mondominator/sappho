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
  const [sortBy, setSortBy] = useState('title');

  useEffect(() => {
    loadAudiobooks();
  }, [search, filter]);

  const loadAudiobooks = async () => {
    try {
      console.log('Loading audiobooks with params:', { search, ...filter, limit: 10000 });
      const response = await getAudiobooks({ search, ...filter, limit: 10000 });
      console.log('Audiobooks response:', response);
      console.log('Audiobooks data:', response.data);
      console.log('Audiobooks array:', response.data.audiobooks);
      setAudiobooks(response.data.audiobooks);
    } catch (error) {
      console.error('Error loading audiobooks:', error);
      console.error('Error details:', error.response);
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

  const renderBookCard = (book) => {
    console.log('Rendering book card:', book.id, book.title);
    const coverUrl = getCoverUrl(book.id);
    console.log('Cover URL for', book.title, ':', coverUrl);

    return (
      <div key={book.id} className="audiobook-card" data-book-id={book.id}>
        <div className="audiobook-cover" onClick={() => navigate(`/audiobook/${book.id}`)}>
          {book.cover_image ? (
            <img
              src={coverUrl}
              alt={book.title}
              onError={(e) => {
                console.error('Cover image failed to load:', coverUrl);
                e.target.style.display = 'none';
              }}
              onLoad={() => console.log('Cover loaded successfully:', coverUrl)}
            />
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
  };

  console.log('Library render - audiobooks count:', audiobooks.length);
  console.log('Library render - loading:', loading);
  console.log('Library render - audiobooks:', audiobooks);

  return (
    <div className="library-page container">
      {audiobooks.length === 0 ? (
        <div className="empty-state">
          <p>No audiobooks found.</p>
          <p>Upload some audiobooks or drop them in the watch directory!</p>
        </div>
      ) : (
        <>
          <div className="library-header">
            <h2 className="library-count">{audiobooks.length} {audiobooks.length === 1 ? 'Book' : 'Books'}</h2>
            <div className="library-sort">
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
