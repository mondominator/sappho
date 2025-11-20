import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { getAudiobooks, getCoverUrl, getProgress, getSeries, getAuthors } from '../api';
import './Library.css';

export default function Library({ onPlay }) {
  const navigate = useNavigate();
  const [audiobooks, setAudiobooks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState({ series: '', author: '' });
  const [sortBy, setSortBy] = useState('title');
  const [view, setView] = useState('categories'); // 'categories', 'series', 'authors', 'genres', 'all'
  const [categories, setCategories] = useState({ series: [], authors: [], genres: [] });

  useEffect(() => {
    if (view === 'categories') {
      loadCategories();
    } else if (view === 'all' || view === 'series' || view === 'authors' || view === 'genres') {
      loadAudiobooks();
    }
  }, [view, search, filter]);

  const loadCategories = async () => {
    try {
      const [seriesRes, authorsRes, audiobooksRes] = await Promise.all([
        getSeries(),
        getAuthors(),
        getAudiobooks({ limit: 10000 })
      ]);

      // Extract unique genres from audiobooks
      const genresSet = new Set();
      audiobooksRes.data.audiobooks.forEach(book => {
        if (book.genre) genresSet.add(book.genre);
      });

      setCategories({
        series: seriesRes.data,
        authors: authorsRes.data,
        genres: Array.from(genresSet).sort()
      });
    } catch (error) {
      console.error('Error loading categories:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadAudiobooks = async () => {
    try {
      const response = await getAudiobooks({ search, ...filter, limit: 10000 });
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

  if (loading) {
    return <div className="loading">Loading library...</div>;
  }

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

  // Categories view
  if (view === 'categories') {
    return (
      <div className="library-page container">
        <div className="library-header">
          <h2 className="library-count">Library</h2>
        </div>
        <div className="category-grid">
          <div className="category-card" onClick={() => navigate('/series')}>
            <div className="category-icon">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path>
                <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path>
              </svg>
            </div>
            <h3>Series</h3>
            <p>{categories.series.length} series</p>
          </div>
          <div className="category-card" onClick={() => setView('authors')}>
            <div className="category-icon">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                <circle cx="12" cy="7" r="4"></circle>
              </svg>
            </div>
            <h3>Authors</h3>
            <p>{categories.authors.length} authors</p>
          </div>
          <div className="category-card" onClick={() => setView('genres')}>
            <div className="category-icon">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polygon points="12 2 2 7 12 12 22 7 12 2"></polygon>
                <polyline points="2 17 12 22 22 17"></polyline>
                <polyline points="2 12 12 17 22 12"></polyline>
              </svg>
            </div>
            <h3>Genres</h3>
            <p>{categories.genres.length} genres</p>
          </div>
          <div className="category-card" onClick={() => setView('all')}>
            <div className="category-icon">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M3 3h18v18H3z"></path>
                <path d="M3 9h18"></path>
                <path d="M3 15h18"></path>
                <path d="M9 3v18"></path>
                <path d="M15 3v18"></path>
              </svg>
            </div>
            <h3>All Books</h3>
            <p>Browse everything</p>
          </div>
        </div>
      </div>
    );
  }

  // List views (authors, genres)
  if (view === 'authors') {
    return (
      <div className="library-page container">
        <div className="library-header">
          <button className="back-button" onClick={() => setView('categories')}>← Back</button>
          <h2 className="library-count">Authors</h2>
        </div>
        <div className="list-grid">
          {categories.authors.map((author) => (
            <div key={author.author} className="list-item" onClick={() => navigate(`/author/${encodeURIComponent(author.author)}`)}>
              <h3>{author.author}</h3>
              <p>{author.book_count} {author.book_count === 1 ? 'book' : 'books'}</p>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (view === 'genres') {
    return (
      <div className="library-page container">
        <div className="library-header">
          <button className="back-button" onClick={() => setView('categories')}>← Back</button>
          <h2 className="library-count">Genres</h2>
        </div>
        <div className="list-grid">
          {categories.genres.map((genre) => (
            <div key={genre} className="list-item" onClick={() => {
              setFilter({ ...filter, genre });
              setView('all');
            }}>
              <h3>{genre}</h3>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // All books view
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
            <button className="back-button" onClick={() => {
              setView('categories');
              setFilter({ series: '', author: '' });
            }}>← Back</button>
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
