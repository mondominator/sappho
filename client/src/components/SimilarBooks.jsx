/**
 * Similar Books Component
 *
 * Displays three categories of similar audiobook suggestions:
 * - More by this author
 * - More by this narrator
 * - Similar audiobooks (multi-factor matching)
 */

import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { getSimilarBooks, getCoverUrl } from '../api';
import { formatDuration } from '../utils/formatting';
import './SimilarBooks.css';

export default function SimilarBooks({ audiobookId }) {
  const navigate = useNavigate();
  const [similarData, setSimilarData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    loadSimilarBooks();
  }, [audiobookId]);

  const loadSimilarBooks = async () => {
    if (!audiobookId) return;

    setLoading(true);
    setError(null);

    try {
      const response = await getSimilarBooks(audiobookId);
      setSimilarData(response.data);
    } catch (err) {
      console.error('Error loading similar books:', err);
      // Don't show error for 404s or empty results - just show empty state
      if (err.response?.status !== 404) {
        setError('Unable to load similar books. Please try again later.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleBookClick = (book) => {
    navigate(`/audiobook/${book.id}`);
  };

  const renderBookCard = (book) => {
    const coverUrl = book.cover_image
      ? getCoverUrl(book.id, book.updated_at, 300)
      : '/placeholder-cover.png';

    return (
      <div
        key={book.id}
        className="similar-book-card"
        onClick={() => handleBookClick(book)}
      >
        <div className="similar-book-cover">
          <img
            src={coverUrl}
            alt={book.title}
            onError={(e) => e.target.src = '/placeholder-cover.png'}
          />
        </div>
        <div className="similar-book-info">
          <h4 className="similar-book-title">{book.title}</h4>
          {book.author && (
            <p className="similar-book-author">{book.author}</p>
          )}
          {book.duration && (
            <p className="similar-book-duration">{formatDuration(book.duration)}</p>
          )}
        </div>
      </div>
    );
  };

  const renderSection = (title, books, icon) => {
    if (!books || books.length === 0) return null;

    return (
      <div className="similar-section">
        <div className="similar-section-header">
          <h3 className="similar-section-title">
            <span className="similar-section-icon">{icon}</span>
            {title}
          </h3>
          <span className="similar-section-count">{books.length}</span>
        </div>
        <div className="similar-books-grid">
          {books.map((book) => (
            <div key={book.id} className="similar-book-card" onClick={() => handleBookClick(book)}>
              <div className="similar-book-cover">
                <img
                  src={book.cover_image ? getCoverUrl(book.id, book.updated_at, 300) : '/placeholder-cover.png'}
                  alt={book.title}
                  onError={(e) => e.target.src = '/placeholder-cover.png'}
                />
              </div>
              <div className="similar-book-info">
                <h4 className="similar-book-title">{book.title}</h4>
                {book.author && (
                  <p className="similar-book-author">{book.author}</p>
                )}
                {book.duration && (
                  <p className="similar-book-duration">{formatDuration(book.duration)}</p>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  if (loading) {
    return (
      <div className="similar-books-container">
        <h2 className="similar-books-heading">Similar Books</h2>
        <div className="similar-books-loading">Loading similar books...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="similar-books-container">
        <h2 className="similar-books-heading">Similar Books</h2>
        <div className="similar-books-error">
          <p>{error}</p>
          <button
            className="settings-btn small"
            onClick={loadSimilarBooks}
            style={{ marginTop: '0.5rem' }}
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  if (!similarData) {
    return (
      <div className="similar-books-container">
        <h2 className="similar-books-heading">Similar Books</h2>
        <div className="similar-books-empty">
          <p>No similar books found</p>
          <p className="text-small text-muted">Similar books will appear here when more audiobooks are added to the library.</p>
        </div>
      </div>
    );
  }

  const { more_by_author, more_by_narrator, similar_audiobooks } = similarData;
  const hasAnySuggestions =
    (more_by_author && more_by_author.length > 0) ||
    (more_by_narrator && more_by_narrator.length > 0) ||
    (similar_audiobooks && similar_audiobooks.length > 0);

  if (!hasAnySuggestions) {
    return (
      <div className="similar-books-container">
        <div className="similar-books-empty">
          <p>No similar books found</p>
          <p className="text-small text-muted">Similar books will appear here when more audiobooks are added to the library.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="similar-books-container">
      <h2 className="similar-books-heading">Similar Books</h2>

      {renderSection('More by this Author', more_by_author, '✍️')}
      {renderSection('More by this Narrator', more_by_narrator, '🎙️')}
      {renderSection('Similar Audiobooks', similar_audiobooks, '📚')}
    </div>
  );
}