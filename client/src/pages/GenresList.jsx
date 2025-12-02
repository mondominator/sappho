import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { getGenres, getCoverUrl } from '../api';
import './GenresList.css';

// Genre icons for fallback display
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

export default function GenresList() {
  const navigate = useNavigate();
  const [genres, setGenres] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadGenres();
  }, []);

  const loadGenres = async () => {
    try {
      const response = await getGenres();
      // Add icons to genres from server
      const genresWithIcons = response.data.map(g => ({
        ...g,
        icon: GENRE_ICONS[g.genre] || '📚'
      }));
      setGenres(genresWithIcons);
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
                  {genreData.cover_ids && genreData.cover_ids.length > 0 ? (
                    <div className={`cover-grid cover-grid-${Math.min(genreData.cover_ids.length, 4)}`}>
                      {genreData.cover_ids.slice(0, 4).map((coverId, index) => (
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
