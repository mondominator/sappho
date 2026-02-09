import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getCollection, updateCollection, removeFromCollection, reorderCollection, getCoverUrl } from '../api';
import './CollectionDetail.css';

export default function CollectionDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [collection, setCollection] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editIsPublic, setEditIsPublic] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draggedIndex, setDraggedIndex] = useState(null);

  useEffect(() => {
    loadCollection();
  }, [id]);

  const loadCollection = async () => {
    try {
      const response = await getCollection(id);
      setCollection(response.data);
      setEditName(response.data.name);
      setEditDescription(response.data.description || '');
      setEditIsPublic(response.data.is_public === 1);
    } catch (error) {
      console.error('Error loading collection:', error);
      if (error.response?.status === 404) {
        navigate('/collections');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!editName.trim() || saving) return;

    setSaving(true);
    try {
      // Only pass is_public if user is the owner
      const isPublicValue = collection.is_owner === 1 ? editIsPublic : collection.is_public === 1;
      const response = await updateCollection(id, editName.trim(), editDescription.trim(), isPublicValue);
      setCollection({ ...collection, ...response.data });
      setEditing(false);
    } catch (error) {
      console.error('Error updating collection:', error);
      alert('Failed to update collection');
    } finally {
      setSaving(false);
    }
  };

  const handleRemoveBook = async (bookId) => {
    if (!confirm('Remove this book from the collection?')) return;

    try {
      await removeFromCollection(id, bookId);
      setCollection({
        ...collection,
        books: collection.books.filter(b => b.id !== bookId)
      });
    } catch (error) {
      console.error('Error removing book:', error);
      alert('Failed to remove book');
    }
  };

  const handleDragStart = (index) => {
    setDraggedIndex(index);
  };

  const handleDragOver = (e, index) => {
    e.preventDefault();
    if (draggedIndex === null || draggedIndex === index) return;

    const newBooks = [...collection.books];
    const [draggedItem] = newBooks.splice(draggedIndex, 1);
    newBooks.splice(index, 0, draggedItem);

    setCollection({ ...collection, books: newBooks });
    setDraggedIndex(index);
  };

  const handleDragEnd = async () => {
    if (draggedIndex === null) return;

    setDraggedIndex(null);

    // Save new order
    try {
      await reorderCollection(id, collection.books.map(b => b.id));
    } catch (error) {
      console.error('Error saving order:', error);
      // Reload to get correct order
      loadCollection();
    }
  };

  const formatDuration = (seconds) => {
    if (!seconds) return '';
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
  };

  const getProgress = (book) => {
    if (book.progress_completed) return 100;
    if (!book.progress_position || !book.duration) return 0;
    return Math.round((book.progress_position / book.duration) * 100);
  };

  if (loading) {
    return <div className="loading">Loading collection...</div>;
  }

  if (!collection) {
    return <div className="empty-state">Collection not found</div>;
  }

  return (
    <div className="collection-detail-page container">
      <div className="collection-header">
        <button className="back-button" onClick={() => navigate('/collections')}>← Collections</button>

        {editing ? (
          <div className="edit-form">
            <input
              type="text"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              placeholder="Collection name"
              autoFocus
            />
            <textarea
              value={editDescription}
              onChange={(e) => setEditDescription(e.target.value)}
              placeholder="Description (optional)"
              rows={2}
            />
            {/* Only owner can change visibility */}
            {collection.is_owner === 1 && (
              <div className="visibility-toggle">
                <label className="toggle-label">
                  <input
                    type="checkbox"
                    checked={editIsPublic}
                    onChange={(e) => setEditIsPublic(e.target.checked)}
                  />
                  <span className="toggle-text">
                    Make this collection public
                  </span>
                </label>
                <p className="toggle-hint">
                  {editIsPublic
                    ? 'All users will be able to view and edit this collection'
                    : 'Only you can see this collection'}
                </p>
              </div>
            )}
            <div className="edit-actions">
              <button className="btn btn-secondary" onClick={() => setEditing(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleSave} disabled={!editName.trim() || saving}>
                {saving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        ) : (
          <div className="collection-info">
            <div className="title-row">
              <h1>{collection.name}</h1>
              {collection.is_public === 1 && (
                <span className="public-badge" title="Public collection">
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10"></circle>
                    <line x1="2" y1="12" x2="22" y2="12"></line>
                    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path>
                  </svg>
                  Public
                </span>
              )}
            </div>
            {collection.description && <p className="description">{collection.description}</p>}
            <p className="creator-label">
              {collection.is_owner === 1 ? 'Created by you' : `Created by ${collection.creator_username || 'Unknown'}`}
            </p>
            <div className="collection-meta">
              <span>{collection.books?.length || 0} books</span>
              <button className="edit-btn" onClick={() => setEditing(true)}>Edit</button>
            </div>
          </div>
        )}
      </div>

      {collection.books?.length === 0 ? (
        <div className="empty-books">
          <p>No books in this collection yet.</p>
          <p>Browse your library and add books using the + button on book covers.</p>
        </div>
      ) : (
        <div className="books-list">
          {collection.books.map((book, index) => (
            <div
              key={book.id}
              className={`book-item ${draggedIndex === index ? 'dragging' : ''}`}
              draggable
              onDragStart={() => handleDragStart(index)}
              onDragOver={(e) => handleDragOver(e, index)}
              onDragEnd={handleDragEnd}
            >
              <div className="drag-handle">⋮⋮</div>
              <div className="book-cover" onClick={() => navigate(`/audiobook/${book.id}`)}>
                <img
                  src={getCoverUrl(book.id, null, 300)}
                  alt={book.title}
                  loading="lazy"
                  onError={(e) => e.target.src = '/placeholder-cover.png'}
                />
                {getProgress(book) > 0 && (
                  <div className="progress-bar-overlay">
                    <div className={`progress-bar-fill${getProgress(book) >= 100 ? ' completed' : ''}`} style={{ width: `${getProgress(book)}%` }} />
                  </div>
                )}
              </div>
              <div className="book-info" onClick={() => navigate(`/audiobook/${book.id}`)}>
                <div className="book-title-row">
                  <h3 className="book-title">{book.title}</h3>
                </div>
                <p className="book-author">{book.author || 'Unknown Author'}</p>
                {book.duration && (
                  <span className="book-duration">{formatDuration(book.duration)}</span>
                )}
                <span className={`book-rating ${!book.user_rating && !book.average_rating ? 'no-rating' : ''}`}>
                  <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill={book.user_rating || book.average_rating ? '#fbbf24' : 'none'} stroke="#fbbf24" strokeWidth="1.5">
                    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
                  </svg>
                  {book.user_rating || (book.average_rating ? Math.round(book.average_rating * 10) / 10 : '—')}
                </span>
              </div>
              {editing && (
                <button
                  className="remove-btn"
                  onClick={() => handleRemoveBook(book.id)}
                  title="Remove from collection"
                >
                  ×
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
