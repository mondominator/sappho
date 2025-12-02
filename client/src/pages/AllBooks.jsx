import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { getAudiobooks, getCoverUrl, getProgress } from '../api';
import './AllBooks.css';

/**
 * Major bookstore genre categories with keyword mappings
 */
const GENRE_MAPPINGS = {
  'Mystery & Thriller': ['mystery', 'thriller', 'suspense', 'detective', 'crime', 'crime fiction', 'murder mystery', 'whodunit', 'noir', 'police procedural', 'legal thriller', 'psychological thriller', 'espionage', 'spy', 'cozy mystery'],
  'Science Fiction': ['science fiction', 'sci-fi', 'scifi', 'sf', 'space opera', 'cyberpunk', 'dystopia', 'dystopian', 'post-apocalyptic', 'apocalyptic', 'alien', 'time travel', 'hard science fiction', 'soft science fiction', 'military science fiction'],
  'Fantasy': ['fantasy', 'epic fantasy', 'high fantasy', 'urban fantasy', 'dark fantasy', 'sword and sorcery', 'paranormal', 'magic', 'dragons', 'wizards', 'mythological', 'fairy tale', 'folklore', 'grimdark', 'portal fantasy'],
  'Romance': ['romance', 'romantic', 'love story', 'contemporary romance', 'historical romance', 'paranormal romance', 'romantic suspense', 'romantic comedy', 'rom-com', 'regency romance', 'erotic romance', 'clean romance'],
  'Horror': ['horror', 'scary', 'supernatural horror', 'gothic', 'haunted', 'ghost story', 'zombies', 'vampires', 'occult', 'dark fiction'],
  'Historical Fiction': ['historical fiction', 'historical novel', 'period drama', 'civil war', 'world war', 'medieval', 'victorian', 'ancient rome', 'ancient greece', 'tudor', 'regency'],
  'Biography & Memoir': ['biography', 'memoir', 'autobiography', 'memoirs', 'biographies', 'personal narratives', 'life stories', 'biographical'],
  'Self-Help': ['self-help', 'self help', 'personal development', 'personal growth', 'self-improvement', 'motivation', 'motivational', 'inspirational', 'success', 'happiness', 'mindfulness', 'productivity', 'habits'],
  'Business & Finance': ['business', 'finance', 'economics', 'investing', 'entrepreneurship', 'management', 'leadership', 'marketing', 'money', 'career', 'real estate', 'stock market', 'personal finance', 'wealth'],
  'History': ['american history', 'world history', 'military history', 'ancient history', 'modern history', 'european history', 'asian history', 'nonfiction history', 'non-fiction history'],
  'Science & Technology': ['popular science', 'physics', 'chemistry', 'biology', 'astronomy', 'mathematics', 'engineering', 'computer science', 'artificial intelligence', 'nature', 'environment', 'ecology', 'evolution', 'neuroscience', 'medicine', 'nonfiction science', 'non-fiction science', 'science nonfiction', 'technology nonfiction'],
  'Health & Wellness': ['health', 'wellness', 'fitness', 'nutrition', 'diet', 'exercise', 'mental health', 'psychology', 'meditation', 'yoga', 'healing', 'alternative medicine', 'holistic'],
  'Religion & Spirituality': ['religion', 'spirituality', 'spiritual', 'christian', 'christianity', 'buddhism', 'buddhist', 'islam', 'jewish', 'judaism', 'faith', 'prayer', 'bible', 'theology', 'new age', 'metaphysical'],
  'True Crime': ['true crime', 'true-crime', 'criminal', 'forensic', 'serial killer', 'cold case', 'investigation'],
  'Comedy & Humor': ['comedy', 'humor', 'humorous', 'funny', 'satire', 'parody', 'wit', 'jokes', 'stand-up'],
  'Young Adult': ['young adult', 'ya', 'teen', 'teenage', 'adolescent', 'coming of age', 'coming-of-age', 'juvenile fiction'],
  'Children\'s': ['children', 'kids', 'juvenile', 'picture book', 'middle grade', 'chapter book', 'bedtime stories'],
  'Classics': ['classic', 'classics', 'classic literature', 'classic fiction', 'literary classics', 'great books'],
  'Poetry': ['poetry', 'poems', 'verse', 'poetic'],
  'Drama': ['drama', 'plays', 'theater', 'theatre', 'dramatic'],
  'Adventure': ['adventure', 'action', 'action & adventure', 'action-adventure', 'survival', 'exploration', 'quest'],
  'Western': ['western', 'westerns', 'cowboy', 'frontier', 'wild west'],
  'LitRPG': ['litrpg', 'lit-rpg', 'gamelit', 'game-lit', 'progression fantasy'],
  'Erotica': ['erotica', 'erotic', 'adult fiction', 'steamy']
};

/**
 * Normalize a genre string to major bookstore categories
 */
function normalizeGenreString(genreStr) {
  if (!genreStr) return [];

  const genres = genreStr.split(',').map(g => g.trim().toLowerCase()).filter(Boolean);
  const normalized = new Set();

  for (const genre of genres) {
    for (const [category, keywords] of Object.entries(GENRE_MAPPINGS)) {
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
  const [loading, setLoading] = useState(true);
  const [sortBy, setSortBy] = useState('title');
  const [progressFilter, setProgressFilter] = useState('all');

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

  // Filter audiobooks based on genre filter (using normalized genres)
  const genreFilteredAudiobooks = genreFilter
    ? audiobooks.filter(book => {
        const normalizedGenres = normalizeGenreString(book.genre);
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
      case 'all':
      default:
        return true;
    }
  });

  const sortedAudiobooks = [...filteredAudiobooks].sort((a, b) => {
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
                </select>
              </div>
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
