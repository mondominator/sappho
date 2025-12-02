import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { getAudiobooks, getCoverUrl, getProgress, getGenreMappings } from '../api';
import './AllBooks.css';

/**
 * Normalize a genre string to major bookstore categories using mappings from server
 */
function normalizeGenreString(genreStr, genreMappings) {
  if (!genreStr || !genreMappings) return [];

  const genres = genreStr.split(',').map(g => g.trim().toLowerCase()).filter(Boolean);
  const normalized = new Set();

  for (const genre of genres) {
    for (const [category, data] of Object.entries(genreMappings)) {
      // Handle both formats: { keywords: [...] } or just [...]
      const keywords = Array.isArray(data) ? data : (data.keywords || []);
      for (const keyword of keywords) {
        if (genre === keyword || genre.includes(keyword)) {
          normalized.add(category);
          break;
        }
      }
    }
  }

  return Array.from(normalized);
}

export default function AllBooks({ onPlay }) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const genreFilter = searchParams.get('genre');
  const [audiobooks, setAudiobooks] = useState([]);
  const [genreMappings, setGenreMappings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [sortBy, setSortBy] = useState('title');
  const [progressFilter, setProgressFilter] = useState('all');

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [audiobooksRes, mappingsRes] = await Promise.all([
        getAudiobooks({ limit: 10000 }),
        getGenreMappings()
      ]);
      setAudiobooks(audiobooksRes.data.audiobooks);
      // Extract genres from response (server returns { genres: {...}, defaults: {...} })
      setGenreMappings(mappingsRes.data.genres || mappingsRes.data);
    } catch (error) {
      console.error('Error loading data:', error);
    } finally {
      setLoading(false);
    }
  };

  // Filter audiobooks based on genre filter (using normalized genres)
  const genreFilteredAudiobooks = genreFilter && genreMappings
    ? audiobooks.filter(book => {
        const normalizedGenres = normalizeGenreString(book.genre, genreMappings);
        return normalizedGenres.includes(genreFilter);
      })
    : audiobooks;

  // Filter audiobooks based on progress filter
  const filteredAudiobooks = genreFilteredAudiobooks.filter(book => {
    const isFinished = book.progress?.completed === 1;
    const hasProgress = book.progress && book.progress.position > 0;

    switch (progressFilter) {
      case 'hide-finished':
        return !isFinished;
      case 'in-progress':
        return hasProgress && !isFinished;
      case 'not-started':
        return !hasProgress && !isFinished;
      case 'finished':
        return isFinished;
      default:
        return true;
    }
  });

  // Sort audiobooks
  const sortedAudiobooks = [...filteredAudiobooks].sort((a, b) => {
    switch (sortBy) {
      case 'title':
        return (a.title || '').localeCompare(b.title || '');
      case 'author':
        return (a.author || '').localeCompare(b.author || '');
      case 'series':
        // Sort by series name, then by position within series
        const seriesCompare = (a.series || '').localeCompare(b.series || '');
        if (seriesCompare !== 0) return seriesCompare;
        return (a.series_position || 0) - (b.series_position || 0);
      case 'genre':
        return (a.genre || '').localeCompare(b.genre || '');
      case 'recent':
        return new Date(b.created_at || 0) - new Date(a.created_at || 0);
      case 'duration':
        return (a.duration || 0) - (b.duration || 0);
      case 'progress':
        // Sort by progress percentage
        const aProgress = a.progress ? (a.progress.position / (a.duration || 1)) * 100 : 0;
        const bProgress = b.progress ? (b.progress.position / (b.duration || 1)) * 100 : 0;
        return bProgress - aProgress;
      default:
        return 0;
    }
  });

  const formatDuration = (seconds) => {
    if (!seconds) return '';
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    }
    return `${minutes}m`;
  };

  const getProgressPercent = (book) => {
    if (!book.progress || !book.duration) return 0;
    return Math.round((book.progress.position / book.duration) * 100);
  };

  const renderBookCard = (book) => {
    const progressPercent = getProgressPercent(book);
    const isFinished = book.progress?.completed === 1;

    return (
      <div
        key={book.id}
        className="audiobook-card"
        onClick={() => navigate(`/audiobook/${book.id}`)}
      >
        <div className="audiobook-cover">
          {book.cover_image ? (
            <img
              src={getCoverUrl(book.id)}
              alt={book.title}
              onError={(e) => {
                e.target.style.display = 'none';
                e.target.nextSibling.style.display = 'flex';
              }}
            />
          ) : null}
          <div className="audiobook-cover-placeholder" style={{ display: book.cover_image ? 'none' : 'flex' }}>
            <h3>{book.title}</h3>
          </div>
          {progressPercent > 0 && (
            <div className="progress-bar-overlay">
              <div
                className={`progress-bar-fill ${isFinished ? 'completed' : ''}`}
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          )}
          <div className="play-overlay">
            <button
              className="play-button"
              onClick={(e) => {
                e.stopPropagation();
                if (onPlay) onPlay(book);
              }}
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
            <button className="back-button" onClick={() => navigate(-1)}>← Back</button>
            <h2 className="all-books-count">
              {genreFilter && <span className="genre-label">{genreFilter}: </span>}
              {sortedAudiobooks.length} {sortedAudiobooks.length === 1 ? 'Book' : 'Books'}
            </h2>
            <div className="all-books-controls">
              <div className="all-books-filter">
                <label htmlFor="filter-select">Show:</label>
                <select
                  id="filter-select"
                  className="filter-select"
                  value={progressFilter}
                  onChange={(e) => setProgressFilter(e.target.value)}
                >
                  <option value="all">All Books</option>
                  <option value="hide-finished">Hide Finished</option>
                  <option value="in-progress">In Progress</option>
                  <option value="not-started">Not Started</option>
                  <option value="finished">Finished Only</option>
                </select>
              </div>
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
                  <option value="duration">Duration</option>
                  <option value="progress">Progress</option>
                </select>
              </div>
            </div>
          </div>
          <div className="audiobook-grid">
            {sortedAudiobooks.map(renderBookCard)}
          </div>
        </>
      )}
    </div>
  );
}
