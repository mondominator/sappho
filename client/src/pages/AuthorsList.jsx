import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { getAuthors, getCoverUrl } from '../api';
import './AuthorsList.css';

export default function AuthorsList() {
  const navigate = useNavigate();
  const [authorsList, setAuthorsList] = useState([]);
  const [filteredAuthors, setFilteredAuthors] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadAuthors();
  }, []);

  useEffect(() => {
    if (search.trim()) {
      setFilteredAuthors(
        authorsList.filter(author =>
          author.author.toLowerCase().includes(search.toLowerCase())
        )
      );
    } else {
      setFilteredAuthors(authorsList);
    }
  }, [search, authorsList]);

  const loadAuthors = async () => {
    try {
      const response = await getAuthors();
      setAuthorsList(response.data);
      setFilteredAuthors(response.data);
    } catch (error) {
      console.error('Error loading authors:', error);
    } finally {
      setLoading(false);
    }
  };

  const getTotalBooks = () => {
    return authorsList.reduce((sum, author) => sum + author.book_count, 0);
  };

  if (loading) {
    return (
      <div className="authors-list-page">
        <div className="authors-loading">Loading authors...</div>
      </div>
    );
  }

  return (
    <div className="authors-list-page">
      <div className="authors-header">
        <h1>Authors</h1>
        <p className="authors-subtitle">
          {authorsList.length} {authorsList.length === 1 ? 'author' : 'authors'} · {getTotalBooks()} {getTotalBooks() === 1 ? 'book' : 'books'}
        </p>
      </div>

      <div className="authors-search-container">
        <div className="authors-search-wrapper">
          <svg className="authors-search-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8"></circle>
            <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
          </svg>
          <input
            type="text"
            className="authors-search-input"
            placeholder="Search authors..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {filteredAuthors.length === 0 ? (
        <div className="authors-empty">
          <div className="authors-empty-icon">📚</div>
          <h3>No authors found</h3>
          <p>{search ? 'Try a different search term' : 'Add some audiobooks to get started'}</p>
        </div>
      ) : (
        <div className="authors-grid">
          {filteredAuthors.map((author) => (
            <div
              key={author.author}
              className="author-card"
              onClick={() => navigate(`/author/${encodeURIComponent(author.author)}`)}
            >
              <div className="author-covers">
                {author.cover_ids && author.cover_ids.length > 0 ? (
                  <div className={`cover-mosaic covers-${Math.min(author.cover_ids.length, 4)}`}>
                    {author.cover_ids.slice(0, 4).map((coverId, index) => (
                      <div key={index} className="cover-item">
                        <img
                          src={getCoverUrl(coverId)}
                          alt=""
                          onError={(e) => e.target.style.display = 'none'}
                        />
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="author-avatar">
                    <span className="author-avatar-letter">{author.author.charAt(0)}</span>
                  </div>
                )}
              </div>
              <div className="author-card-body">
                <h3 className="author-name">{author.author}</h3>
                <div className="author-meta">
                  <span className="author-book-count">
                    {author.book_count} {author.book_count === 1 ? 'book' : 'books'}
                  </span>
                  {author.completed_count > 0 && (
                    <span className={`author-progress-badge ${author.completed_count === author.book_count ? 'complete' : ''}`}>
                      {author.completed_count === author.book_count
                        ? '✓ All read'
                        : `${author.completed_count}/${author.book_count} read`}
                    </span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
