import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { getAudiobooks, getSeries, getAuthors } from '../api';
import './Library.css';

export default function Library({ onPlay }) {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [categories, setCategories] = useState({ series: [], authors: [], genreCount: 0 });

  useEffect(() => {
    loadCategories();
  }, []);

  const loadCategories = async () => {
    try {
      const [seriesRes, authorsRes, audiobooksRes] = await Promise.all([
        getSeries(),
        getAuthors(),
        getAudiobooks({ limit: 10000 })
      ]);

      // Count books with genres
      const booksWithGenres = audiobooksRes.data.audiobooks.filter(book => book.genre).length;

      setCategories({
        series: seriesRes.data,
        authors: authorsRes.data,
        genreCount: booksWithGenres
      });
    } catch (error) {
      console.error('Error loading categories:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <div className="loading">Loading library...</div>;
  }

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
        <div className="category-card" onClick={() => navigate('/authors')}>
          <div className="category-icon">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
              <circle cx="12" cy="7" r="4"></circle>
            </svg>
          </div>
          <h3>Authors</h3>
          <p>{categories.authors.length} authors</p>
        </div>
        <div className="category-card" onClick={() => navigate('/genres')}>
          <div className="category-icon">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polygon points="12 2 2 7 12 12 22 7 12 2"></polygon>
              <polyline points="2 17 12 22 22 17"></polyline>
              <polyline points="2 12 12 17 22 12"></polyline>
            </svg>
          </div>
          <h3>Genres</h3>
          <p>Browse by category</p>
        </div>
        <div className="category-card" onClick={() => navigate('/all-books')}>
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
