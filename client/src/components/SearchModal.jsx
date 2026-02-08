import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { getAudiobooks, getCoverUrl, getSeries, getAuthors } from '../api';
import './SearchModal.css';

export default function SearchModal({ isOpen, onClose }) {
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState('');
  const [results, setResults] = useState({ books: [], series: [], authors: [] });
  const [loading, setLoading] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  useEffect(() => {
    const searchAll = async () => {
      if (!searchQuery.trim()) {
        setResults({ books: [], series: [], authors: [] });
        return;
      }

      setLoading(true);
      try {
        const [booksRes, seriesRes, authorsRes] = await Promise.all([
          getAudiobooks({ search: searchQuery, limit: 100 }),
          getSeries(),
          getAuthors()
        ]);

        const books = booksRes.data.audiobooks || [];
        const allSeries = seriesRes.data.series || [];
        const allAuthors = authorsRes.data.authors || [];

        const query = searchQuery.toLowerCase();

        // Filter series and authors with better matching
        const filteredSeries = allSeries
          .filter(s => s.toLowerCase().includes(query))
          .sort((a, b) => {
            // Prioritize exact matches and starts-with matches
            const aLower = a.toLowerCase();
            const bLower = b.toLowerCase();
            if (aLower === query) return -1;
            if (bLower === query) return 1;
            if (aLower.startsWith(query)) return -1;
            if (bLower.startsWith(query)) return 1;
            return a.localeCompare(b);
          });

        const filteredAuthors = allAuthors
          .filter(a => a.toLowerCase().includes(query))
          .sort((a, b) => {
            // Prioritize exact matches and starts-with matches
            const aLower = a.toLowerCase();
            const bLower = b.toLowerCase();
            if (aLower === query) return -1;
            if (bLower === query) return 1;
            if (aLower.startsWith(query)) return -1;
            if (bLower.startsWith(query)) return 1;
            return a.localeCompare(b);
          });

        // Sort books by relevance
        const sortedBooks = books.sort((a, b) => {
          const aTitle = (a.title || '').toLowerCase();
          const bTitle = (b.title || '').toLowerCase();
          const aAuthor = (a.author || '').toLowerCase();
          const bAuthor = (b.author || '').toLowerCase();
          const aSeries = (a.series || '').toLowerCase();
          const bSeries = (b.series || '').toLowerCase();

          // Exact title match
          if (aTitle === query) return -1;
          if (bTitle === query) return 1;

          // Title starts with query
          if (aTitle.startsWith(query)) return -1;
          if (bTitle.startsWith(query)) return 1;

          // Author starts with query
          if (aAuthor.startsWith(query)) return -1;
          if (bAuthor.startsWith(query)) return 1;

          // Series starts with query
          if (aSeries.startsWith(query)) return -1;
          if (bSeries.startsWith(query)) return 1;

          // Title contains query
          if (aTitle.includes(query) && !bTitle.includes(query)) return -1;
          if (bTitle.includes(query) && !aTitle.includes(query)) return 1;

          return 0;
        });

        setResults({
          books: sortedBooks.slice(0, 8),
          series: filteredSeries.slice(0, 5),
          authors: filteredAuthors.slice(0, 5)
        });
      } catch (error) {
        console.error('Search error:', error);
      } finally {
        setLoading(false);
      }
    };

    const debounce = setTimeout(searchAll, 200);
    return () => clearTimeout(debounce);
  }, [searchQuery]);

  const handleBookClick = (book) => {
    navigate(`/audiobook/${book.id}`);
    onClose();
  };

  const handleSeriesClick = (series) => {
    navigate(`/series/${encodeURIComponent(series)}`);
    onClose();
  };

  const handleAuthorClick = (author) => {
    navigate(`/author/${encodeURIComponent(author)}`);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="search-modal-overlay" onClick={onClose}>
      <div className="search-modal" onClick={(e) => e.stopPropagation()}>
        <div className="search-modal-header">
          <input
            ref={inputRef}
            type="text"
            className="search-modal-input"
            placeholder="Search books, series, authors..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          <button className="search-modal-close" onClick={onClose}>
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>

        <div className="search-modal-results">
          {loading && <div className="search-loading">Searching...</div>}

          {!loading && searchQuery && (
            <>
              {results.books.length > 0 && (
                <div className="search-section">
                  <h3 className="search-section-title">Books</h3>
                  {results.books.map((book) => (
                    <div
                      key={book.id}
                      className="search-result-item"
                      onClick={() => handleBookClick(book)}
                    >
                      {book.cover_image && (
                        <img
                          src={getCoverUrl(book.id)}
                          alt={book.title}
                          className="search-result-cover"
                        />
                      )}
                      <div className="search-result-info">
                        <div className="search-result-title">{book.title}</div>
                        <div className="search-result-subtitle">
                          {book.author || 'Unknown Author'}
                          {book.series && ` • ${book.series}`}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {results.series.length > 0 && (
                <div className="search-section">
                  <h3 className="search-section-title">Series</h3>
                  {results.series.map((series, index) => (
                    <div
                      key={index}
                      className="search-result-item"
                      onClick={() => handleSeriesClick(series)}
                    >
                      <div className="search-result-icon">
                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/>
                          <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>
                        </svg>
                      </div>
                      <div className="search-result-info">
                        <div className="search-result-title">{series}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {results.authors.length > 0 && (
                <div className="search-section">
                  <h3 className="search-section-title">Authors</h3>
                  {results.authors.map((author, index) => (
                    <div
                      key={index}
                      className="search-result-item"
                      onClick={() => handleAuthorClick(author)}
                    >
                      <div className="search-result-icon">
                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path>
                          <circle cx="9" cy="7" r="4"></circle>
                          <path d="M22 21v-2a4 4 0 0 0-3-3.87"></path>
                          <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
                        </svg>
                      </div>
                      <div className="search-result-info">
                        <div className="search-result-title">{author}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {results.books.length === 0 && results.series.length === 0 && results.authors.length === 0 && (
                <div className="search-no-results">No results found</div>
              )}
            </>
          )}

          {!searchQuery && (
            <div className="search-empty-state">
              <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8"/>
                <path d="m21 21-4.35-4.35"/>
              </svg>
              <p>Search for books, series, or authors</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
