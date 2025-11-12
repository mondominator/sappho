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

  if (loading) {
    return <div className="loading">Loading authors...</div>;
  }

  return (
    <div className="authors-list-page container">
      <div className="authors-search">
        <input
          type="text"
          className="input search-input"
          placeholder="Search authors..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {filteredAuthors.length === 0 ? (
        <div className="empty-state">
          <p>No authors found.</p>
        </div>
      ) : (
        <>
          <div className="authors-list-header">
            <h2 className="authors-list-count">{filteredAuthors.length} {filteredAuthors.length === 1 ? 'Author' : 'Authors'}</h2>
          </div>
          <div className="authors-grid">
            {filteredAuthors.map((author) => (
            <div
              key={author.author}
              className="author-card"
              onClick={() => navigate(`/author/${encodeURIComponent(author.author)}`)}
            >
              <div className="author-covers">
                {author.cover_ids && author.cover_ids.length > 0 ? (
                  <div className={`cover-grid cover-grid-${Math.min(author.cover_ids.length, 4)}`}>
                    {author.cover_ids.slice(0, 4).map((coverId, index) => (
                      <div key={index} className="cover-thumbnail">
                        <img
                          src={getCoverUrl(coverId)}
                          alt={`${author.author} cover ${index + 1}`}
                          onError={(e) => e.target.src = '/placeholder-cover.png'}
                        />
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="author-placeholder">
                    <span>{author.author.charAt(0)}</span>
                  </div>
                )}
              </div>
              <div className="author-card-content">
                <h3 className="author-name">{author.author}</h3>
                <div className="author-stats">
                  <p className="author-count">{author.book_count} book{author.book_count !== 1 ? 's' : ''}</p>
                  {author.completed_count > 0 && (
                    <span className="completion-badge">
                      {author.completed_count}/{author.book_count} read
                    </span>
                  )}
                </div>
              </div>
            </div>
          ))}
          </div>
        </>
      )}
    </div>
  );
}
