import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { getAudiobooks, getCoverUrl } from '../api';
import './GenresList.css';

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

// Genre icons using simple SVG paths
const GENRE_ICONS = {
  'Mystery & Thriller': '🔍',
  'Science Fiction': '🚀',
  'Fantasy': '🐉',
  'Romance': '💕',
  'Horror': '👻',
  'Historical Fiction': '🏛️',
  'Biography & Memoir': '📝',
  'Self-Help': '🌱',
  'Business & Finance': '💼',
  'History': '📜',
  'Science & Technology': '🔬',
  'Health & Wellness': '🧘',
  'Religion & Spirituality': '✨',
  'True Crime': '🔎',
  'Comedy & Humor': '😄',
  'Young Adult': '🎒',
  'Children\'s': '🧸',
  'Classics': '📖',
  'Poetry': '🪶',
  'Drama': '🎭',
  'Adventure': '🗺️',
  'Western': '🤠',
  'LitRPG': '🎮',
  'Erotica': '🔥'
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

export default function GenresList() {
  const navigate = useNavigate();
  const [genres, setGenres] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadGenres();
  }, []);

  const loadGenres = async () => {
    try {
      const response = await getAudiobooks({ limit: 10000 });
      const audiobooks = response.data.audiobooks;

      // Build genre data with book counts and cover IDs
      const genreData = {};

      audiobooks.forEach(book => {
        if (book.genre) {
          const normalizedGenres = normalizeGenreString(book.genre);
          normalizedGenres.forEach(genre => {
            if (!genreData[genre]) {
              genreData[genre] = {
                genre,
                count: 0,
                coverIds: [],
                icon: GENRE_ICONS[genre] || '📚'
              };
            }
            genreData[genre].count++;
            // Collect cover IDs (up to 4 for display)
            if (book.cover_image && genreData[genre].coverIds.length < 4) {
              genreData[genre].coverIds.push(book.id);
            }
          });
        }
      });

      // Convert to array and sort by count
      const sortedGenres = Object.values(genreData)
        .sort((a, b) => b.count - a.count);

      setGenres(sortedGenres);
    } catch (error) {
      console.error('Error loading genres:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <div className="loading">Loading genres...</div>;
  }

  return (
    <div className="genres-list-page container">
      {genres.length === 0 ? (
        <div className="empty-state">
          <p>No genres found.</p>
        </div>
      ) : (
        <>
          <div className="genres-list-header">
            <button className="back-button" onClick={() => navigate(-1)}>← Back</button>
            <h2 className="genres-list-count">{genres.length} {genres.length === 1 ? 'Genre' : 'Genres'}</h2>
          </div>
          <div className="genres-grid">
            {genres.map((genreData) => (
              <div
                key={genreData.genre}
                className="genre-card"
                onClick={() => navigate(`/all-books?genre=${encodeURIComponent(genreData.genre)}`)}
              >
                <div className="genre-covers">
                  <div className="genre-book-count">{genreData.count}</div>
                  {genreData.coverIds.length > 0 ? (
                    <div className={`cover-grid cover-grid-${Math.min(genreData.coverIds.length, 4)}`}>
                      {genreData.coverIds.slice(0, 4).map((coverId, index) => (
                        <div key={index} className="cover-thumbnail">
                          <img
                            src={getCoverUrl(coverId)}
                            alt={`${genreData.genre} cover ${index + 1}`}
                            onError={(e) => e.target.style.display = 'none'}
                          />
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="genre-placeholder">
                      <span className="genre-icon">{genreData.icon}</span>
                    </div>
                  )}
                </div>
                <div className="genre-card-content">
                  <h3 className="genre-title">{genreData.genre}</h3>
                  <p className="genre-subtitle">{genreData.count} {genreData.count === 1 ? 'book' : 'books'}</p>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
