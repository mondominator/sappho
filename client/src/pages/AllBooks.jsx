import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { getAudiobooks, getCoverUrl, getProgress, getGenreMappings, getProfile } from '../api';
import BatchActionBar from '../components/BatchActionBar';
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
  const favoritesOnly = searchParams.get('favorites') === 'true';
  const [audiobooks, setAudiobooks] = useState([]);
  const [genreMappings, setGenreMappings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [sortBy, setSortBy] = useState(() => localStorage.getItem('sortBy') || 'title');
  const [sortOrder, setSortOrder] = useState(() => localStorage.getItem('sortOrder') || 'asc');
  const [progressFilter, setProgressFilter] = useState(() => localStorage.getItem('progressFilter') || 'all');
  const [durationFilter, setDurationFilter] = useState(() => localStorage.getItem('durationFilter') || 'all');
  const [dateAddedFilter, setDateAddedFilter] = useState(() => localStorage.getItem('dateAddedFilter') || 'all');
  const [narratorFilter, setNarratorFilter] = useState(() => localStorage.getItem('narratorFilter') || 'all');
  const [showFilters, setShowFilters] = useState(false);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [isAdmin, setIsAdmin] = useState(false);

  // Save preferences to localStorage
  useEffect(() => {
    localStorage.setItem('sortBy', sortBy);
  }, [sortBy]);

  useEffect(() => {
    localStorage.setItem('sortOrder', sortOrder);
  }, [sortOrder]);

  useEffect(() => {
    localStorage.setItem('progressFilter', progressFilter);
  }, [progressFilter]);

  useEffect(() => {
    localStorage.setItem('durationFilter', durationFilter);
  }, [durationFilter]);

  useEffect(() => {
    localStorage.setItem('dateAddedFilter', dateAddedFilter);
  }, [dateAddedFilter]);

  useEffect(() => {
    localStorage.setItem('narratorFilter', narratorFilter);
  }, [narratorFilter]);

  useEffect(() => {
    loadData();
    loadProfile();
  }, [favoritesOnly]);

  const loadData = async () => {
    try {
      const [audiobooksRes, mappingsRes] = await Promise.all([
        getAudiobooks({ limit: 10000, favorites: favoritesOnly }),
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
    setSelectedIds(new Set(sortedAudiobooks.map(b => b.id)));
  };

  const deselectAll = () => {
    setSelectedIds(new Set());
  };

  const handleBatchActionComplete = (message) => {
    alert(message);
    setSelectedIds(new Set());
    setSelectionMode(false);
    loadData();
  };

  // Get unique narrators for filter dropdown
  const uniqueNarrators = [...new Set(audiobooks.map(b => b.narrator).filter(Boolean))].sort();

  // Count active filters
  const activeFilterCount = [durationFilter, dateAddedFilter, narratorFilter].filter(f => f !== 'all').length;

  // Filter audiobooks based on genre filter (using normalized genres)
  const genreFilteredAudiobooks = genreFilter && genreMappings
    ? audiobooks.filter(book => {
        const normalizedGenres = normalizeGenreString(book.genre, genreMappings);
        return normalizedGenres.includes(genreFilter);
      })
    : audiobooks;

  // Filter audiobooks based on all filters
  const filteredAudiobooks = genreFilteredAudiobooks.filter(book => {
    // Progress filter
    const isFinished = book.progress?.completed === 1;
    const hasProgress = book.progress && book.progress.position > 0;

    switch (progressFilter) {
      case 'hide-finished':
        if (isFinished) return false;
        break;
      case 'in-progress':
        if (!hasProgress || isFinished) return false;
        break;
      case 'not-started':
        if (hasProgress || isFinished) return false;
        break;
      case 'finished':
        if (!isFinished) return false;
        break;
    }

    // Duration filter
    const durationHours = (book.duration || 0) / 3600;
    switch (durationFilter) {
      case 'under-5':
        if (durationHours >= 5) return false;
        break;
      case '5-10':
        if (durationHours < 5 || durationHours >= 10) return false;
        break;
      case '10-20':
        if (durationHours < 10 || durationHours >= 20) return false;
        break;
      case '20-plus':
        if (durationHours < 20) return false;
        break;
    }

    // Date added filter
    if (dateAddedFilter !== 'all' && book.created_at) {
      const addedDate = new Date(book.created_at);
      const now = new Date();
      const diffDays = Math.floor((now - addedDate) / (1000 * 60 * 60 * 24));

      switch (dateAddedFilter) {
        case 'today':
          if (diffDays > 0) return false;
          break;
        case 'week':
          if (diffDays > 7) return false;
          break;
        case 'month':
          if (diffDays > 30) return false;
          break;
        case '3-months':
          if (diffDays > 90) return false;
          break;
      }
    }

    // Narrator filter
    if (narratorFilter !== 'all' && book.narrator !== narratorFilter) {
      return false;
    }

    return true;
  });

  // Sort audiobooks
  const sortedAudiobooks = [...filteredAudiobooks].sort((a, b) => {
    let result = 0;

    switch (sortBy) {
      case 'title':
        result = (a.title || '').localeCompare(b.title || '');
        break;
      case 'author':
        result = (a.author || '').localeCompare(b.author || '');
        break;
      case 'narrator':
        result = (a.narrator || '').localeCompare(b.narrator || '');
        break;
      case 'series':
        // Sort by series name, then by position within series
        const seriesCompare = (a.series || '').localeCompare(b.series || '');
        if (seriesCompare !== 0) {
          result = seriesCompare;
        } else {
          result = (a.series_position || 0) - (b.series_position || 0);
        }
        break;
      case 'genre':
        result = (a.genre || '').localeCompare(b.genre || '');
        break;
      case 'recent':
        result = new Date(b.created_at || 0) - new Date(a.created_at || 0);
        break;
      case 'year':
        result = (a.year || 0) - (b.year || 0);
        break;
      case 'duration':
        result = (a.duration || 0) - (b.duration || 0);
        break;
      case 'progress':
        // Sort by progress percentage
        const aProgress = a.progress ? (a.progress.position / (a.duration || 1)) * 100 : 0;
        const bProgress = b.progress ? (b.progress.position / (b.duration || 1)) * 100 : 0;
        result = aProgress - bProgress;
        break;
      case 'recently-played':
        const aPlayed = a.progress?.updated_at ? new Date(a.progress.updated_at) : new Date(0);
        const bPlayed = b.progress?.updated_at ? new Date(b.progress.updated_at) : new Date(0);
        result = bPlayed - aPlayed;
        break;
      default:
        result = 0;
    }

    // Apply sort order (desc reverses the result)
    return sortOrder === 'desc' ? -result : result;
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
        onClick={handleCardClick}
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
          {book.is_favorite && (
            <div className="favorite-ribbon" title="In Reading List"></div>
          )}
          {progressPercent > 0 && (
            <div className="progress-bar-overlay">
              <div
                className={`progress-bar-fill ${isFinished ? 'completed' : ''}`}
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          )}
          {!selectionMode && (
            <div className="play-overlay">
              <button
                className="play-button"
                onClick={(e) => {
                  e.stopPropagation();
                  if (onPlay) onPlay(book);
                }}
              />
            </div>
          )}
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
              {favoritesOnly && <span className="genre-label">Reading List: </span>}
              {genreFilter && <span className="genre-label">{genreFilter}: </span>}
              {sortedAudiobooks.length} {sortedAudiobooks.length === 1 ? 'Book' : 'Books'}
            </h2>
            <div className="all-books-controls">
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
              <button
                className={`filters-toggle-btn ${showFilters ? 'active' : ''} ${activeFilterCount > 0 ? 'has-filters' : ''}`}
                onClick={() => setShowFilters(!showFilters)}
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>
                </svg>
                Filters
                {activeFilterCount > 0 && <span className="filter-badge">{activeFilterCount}</span>}
              </button>
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
                  <option value="narrator">Narrator</option>
                  <option value="series">Series</option>
                  <option value="genre">Genre</option>
                  <option value="recent">Date Added</option>
                  <option value="year">Year Published</option>
                  <option value="duration">Duration</option>
                  <option value="progress">Progress</option>
                  <option value="recently-played">Recently Played</option>
                </select>
                <button
                  className="sort-order-btn"
                  onClick={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')}
                  title={sortOrder === 'asc' ? 'Ascending' : 'Descending'}
                >
                  {sortOrder === 'asc' ? '↑' : '↓'}
                </button>
              </div>
            </div>
          </div>

          {/* Advanced Filters Panel */}
          {showFilters && (
            <div className="filters-panel">
              <div className="filter-group">
                <label>Duration</label>
                <select
                  value={durationFilter}
                  onChange={(e) => setDurationFilter(e.target.value)}
                >
                  <option value="all">Any Length</option>
                  <option value="under-5">Under 5 hours</option>
                  <option value="5-10">5-10 hours</option>
                  <option value="10-20">10-20 hours</option>
                  <option value="20-plus">20+ hours</option>
                </select>
              </div>

              <div className="filter-group">
                <label>Date Added</label>
                <select
                  value={dateAddedFilter}
                  onChange={(e) => setDateAddedFilter(e.target.value)}
                >
                  <option value="all">Any Time</option>
                  <option value="today">Today</option>
                  <option value="week">This Week</option>
                  <option value="month">This Month</option>
                  <option value="3-months">Last 3 Months</option>
                </select>
              </div>

              <div className="filter-group">
                <label>Narrator</label>
                <select
                  value={narratorFilter}
                  onChange={(e) => setNarratorFilter(e.target.value)}
                >
                  <option value="all">All Narrators</option>
                  {uniqueNarrators.map(narrator => (
                    <option key={narrator} value={narrator}>{narrator}</option>
                  ))}
                </select>
              </div>

              {activeFilterCount > 0 && (
                <button
                  className="clear-filters-btn"
                  onClick={() => {
                    setDurationFilter('all');
                    setDateAddedFilter('all');
                    setNarratorFilter('all');
                  }}
                >
                  Clear Filters
                </button>
              )}
            </div>
          )}
          <div className={`audiobook-grid ${selectionMode && selectedIds.size > 0 ? 'has-action-bar' : ''}`}>
            {sortedAudiobooks.map(renderBookCard)}
          </div>
          {selectionMode && selectedIds.size > 0 && (
            <BatchActionBar
              selectedIds={Array.from(selectedIds)}
              onActionComplete={handleBatchActionComplete}
              onClose={() => {
                setSelectedIds(new Set());
                setSelectionMode(false);
              }}
              isAdmin={isAdmin}
            />
          )}
        </>
      )}
    </div>
  );
}
