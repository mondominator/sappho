import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { getAudiobooks, getCoverUrl, getProgress, getGenreMappings, getProfile } from '../api';
import BatchActionBar from '../components/BatchActionBar';
import VirtualGrid from '../components/VirtualGrid';
import './AllBooks.css';

// Long press duration in ms
const LONG_PRESS_DURATION = 500;

// Threshold: use virtual scrolling when the library has more than this many items
const VIRTUAL_SCROLL_THRESHOLD = 50;

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

// Get storage key prefix based on current URL to keep settings independent per screen
function getStoragePrefix() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('favorites') === 'true') return 'readingList_';
  if (params.get('genre')) return `genre_${params.get('genre')}_`;
  return 'allBooks_';
}

export default function AllBooks({ onPlay }) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const genreFilter = searchParams.get('genre');
  const favoritesOnly = searchParams.get('favorites') === 'true';

  // Compute storage prefix for this view (changes when URL params change)
  const storagePrefix = favoritesOnly ? 'readingList_' : (genreFilter ? `genre_${genreFilter}_` : 'allBooks_');

  const [audiobooks, setAudiobooks] = useState([]);
  const [genreMappings, setGenreMappings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [sortBy, setSortBy] = useState(() => localStorage.getItem(getStoragePrefix() + 'sortBy') || 'title');
  const [sortOrder, setSortOrder] = useState(() => localStorage.getItem(getStoragePrefix() + 'sortOrder') || 'asc');
  const [progressFilter, setProgressFilter] = useState(() => localStorage.getItem(getStoragePrefix() + 'progressFilter') || 'all');
  const [durationFilter, setDurationFilter] = useState(() => localStorage.getItem(getStoragePrefix() + 'durationFilter') || 'all');
  const [dateAddedFilter, setDateAddedFilter] = useState(() => localStorage.getItem(getStoragePrefix() + 'dateAddedFilter') || 'all');
  const [narratorFilter, setNarratorFilter] = useState(() => localStorage.getItem(getStoragePrefix() + 'narratorFilter') || 'all');
  const [showFilters, setShowFilters] = useState(false);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [isAdmin, setIsAdmin] = useState(false);
  const [windowWidth, setWindowWidth] = useState(() => window.innerWidth);

  // Track window width for responsive virtual grid column calculations
  useEffect(() => {
    const handleResize = () => setWindowWidth(window.innerWidth);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Long press detection
  const longPressTimer = useRef(null);
  const longPressTriggered = useRef(false);

  // Save preferences to localStorage (using per-screen prefix)
  useEffect(() => {
    localStorage.setItem(storagePrefix + 'sortBy', sortBy);
  }, [sortBy, storagePrefix]);

  useEffect(() => {
    localStorage.setItem(storagePrefix + 'sortOrder', sortOrder);
  }, [sortOrder, storagePrefix]);

  useEffect(() => {
    localStorage.setItem(storagePrefix + 'progressFilter', progressFilter);
  }, [progressFilter, storagePrefix]);

  useEffect(() => {
    localStorage.setItem(storagePrefix + 'durationFilter', durationFilter);
  }, [durationFilter, storagePrefix]);

  useEffect(() => {
    localStorage.setItem(storagePrefix + 'dateAddedFilter', dateAddedFilter);
  }, [dateAddedFilter, storagePrefix]);

  useEffect(() => {
    localStorage.setItem(storagePrefix + 'narratorFilter', narratorFilter);
  }, [narratorFilter, storagePrefix]);

  // Reset filter/sort state when switching between views (All Books vs Reading List vs Genre)
  useEffect(() => {
    setSortBy(localStorage.getItem(storagePrefix + 'sortBy') || 'title');
    setSortOrder(localStorage.getItem(storagePrefix + 'sortOrder') || 'asc');
    setProgressFilter(localStorage.getItem(storagePrefix + 'progressFilter') || 'all');
    setDurationFilter(localStorage.getItem(storagePrefix + 'durationFilter') || 'all');
    setDateAddedFilter(localStorage.getItem(storagePrefix + 'dateAddedFilter') || 'all');
    setNarratorFilter(localStorage.getItem(storagePrefix + 'narratorFilter') || 'all');
  }, [storagePrefix]);

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
        // Auto-exit selection mode when last book is deselected
        if (newSet.size === 0) {
          setSelectionMode(false);
        }
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
      case 'rating':
        // Sort by user rating first, then average rating, unrated at end
        const aRating = a.user_rating || a.average_rating || 0;
        const bRating = b.user_rating || b.average_rating || 0;
        // Put unrated books at the end
        if (aRating === 0 && bRating !== 0) return 1;
        if (bRating === 0 && aRating !== 0) return -1;
        result = bRating - aRating; // Higher ratings first by default
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
      // If long press was triggered, don't navigate
      if (longPressTriggered.current) {
        longPressTriggered.current = false;
        return;
      }
      if (selectionMode) {
        toggleBookSelection(book.id);
      } else {
        navigate(`/audiobook/${book.id}`);
      }
    };

    const handleLongPressStart = (e) => {
      longPressTriggered.current = false;
      longPressTimer.current = setTimeout(() => {
        longPressTriggered.current = true;
        // Vibrate if available (mobile haptic feedback)
        if (navigator.vibrate) {
          navigator.vibrate(50);
        }
        // Enter selection mode and select this book
        if (!selectionMode) {
          setSelectionMode(true);
        }
        setSelectedIds(prev => {
          const newSet = new Set(prev);
          newSet.add(book.id);
          return newSet;
        });
      }, LONG_PRESS_DURATION);
    };

    const handleLongPressEnd = () => {
      if (longPressTimer.current) {
        clearTimeout(longPressTimer.current);
        longPressTimer.current = null;
      }
    };

    const handleContextMenu = (e) => {
      // Prevent context menu on long press
      e.preventDefault();
    };

    return (
      <div
        key={book.id}
        className={`audiobook-card ${selectionMode ? 'selection-mode' : ''} ${isSelected ? 'selected' : ''}`}
        onClick={handleCardClick}
        onTouchStart={handleLongPressStart}
        onTouchEnd={handleLongPressEnd}
        onTouchMove={handleLongPressEnd}
        onMouseDown={handleLongPressStart}
        onMouseUp={handleLongPressEnd}
        onMouseLeave={handleLongPressEnd}
        onContextMenu={handleContextMenu}
      >
        {/* Selection indicator - circular checkbox in top-right (Android style) */}
        {selectionMode ? (
          <div className={`selection-indicator ${isSelected ? 'selected' : ''}`}>
            {isSelected && (
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12"></polyline>
              </svg>
            )}
          </div>
        ) : (
          /* Reading list ribbon - blue folded corner (Android style) */
          book.is_favorite && (
            <div className="reading-list-ribbon" />
          )
        )}
        <div className="audiobook-cover">
          {book.cover_image ? (
            <img
              src={getCoverUrl(book.id)}
              alt={book.title}
              loading="lazy"
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
          {/* Header Row - matches Android layout */}
          <div className="all-books-header-row">
            <button
              className="header-icon-btn"
              onClick={() => selectionMode ? (setSelectionMode(false), setSelectedIds(new Set())) : navigate(-1)}
            >
              {selectionMode ? (
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="19" y1="12" x2="5" y2="12"></line>
                  <polyline points="12 19 5 12 12 5"></polyline>
                </svg>
              )}
            </button>
            <h2 className="header-title">
              {selectionMode ? (
                `${selectedIds.size} selected`
              ) : (
                <>
                  {favoritesOnly && <span className="genre-label">Reading List: </span>}
                  {genreFilter && <span className="genre-label">{genreFilter}: </span>}
                  {sortedAudiobooks.length} {sortedAudiobooks.length === 1 ? 'Book' : 'Books'}
                </>
              )}
            </h2>
            {selectionMode && (
              <button
                className="select-all-text-btn"
                onClick={() => selectedIds.size === sortedAudiobooks.length ? deselectAll() : selectAll()}
              >
                {selectedIds.size === sortedAudiobooks.length ? 'Deselect All' : 'Select All'}
              </button>
            )}
          </div>

          {/* Filters Row - hidden in selection mode (matches Android) */}
          {!selectionMode && (
            <div className="filters-row">
              <div className="filter-dropdown">
                <span className="filter-label">Show</span>
                <select
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
              <div className="filter-dropdown">
                <span className="filter-label">Sort</span>
                <select
                  className="filter-select"
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value)}
                >
                  <option value="title">Title</option>
                  <option value="author">Author</option>
                  <option value="narrator">Narrator</option>
                  <option value="series">Series</option>
                  <option value="genre">Genre</option>
                  <option value="recent">Recently Added</option>
                  <option value="recently-played">Recently Listened</option>
                  <option value="duration">Duration</option>
                  <option value="progress">Progress</option>
                  <option value="rating">Rating</option>
                </select>
              </div>
            </div>
          )}

          {sortedAudiobooks.length > VIRTUAL_SCROLL_THRESHOLD ? (
            <VirtualGrid
              items={sortedAudiobooks}
              renderItem={renderBookCard}
              minColumnWidth={windowWidth < 769 ? 100 : windowWidth >= 1200 ? 180 : 150}
              gap={windowWidth < 769 ? 6 : windowWidth >= 1200 ? 16 : 12}
              className={`audiobook-grid-virtual ${selectionMode ? 'has-action-bar' : ''}`}
              overscanRowCount={4}
            />
          ) : (
            <div className={`audiobook-grid ${selectionMode ? 'has-action-bar' : ''}`}>
              {sortedAudiobooks.map(renderBookCard)}
            </div>
          )}
          {selectionMode && (
            <BatchActionBar
              selectedIds={Array.from(selectedIds)}
              onActionComplete={handleBatchActionComplete}
              onClose={() => {
                setSelectedIds(new Set());
                setSelectionMode(false);
              }}
            />
          )}
        </>
      )}
    </div>
  );
}
