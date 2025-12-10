import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { getCollections, createCollection, deleteCollection, getCoverUrl } from '../api';
import './Collections.css';

// Component for rotating collection covers
function RotatingCover({ bookIds, collectionName }) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [imageError, setImageError] = useState(false);

  useEffect(() => {
    if (!bookIds || bookIds.length <= 1) return;

    const interval = setInterval(() => {
      setCurrentIndex(prev => (prev + 1) % bookIds.length);
      setImageError(false);
    }, 4000); // Change every 4 seconds

    return () => clearInterval(interval);
  }, [bookIds]);

  if (!bookIds || bookIds.length === 0 || imageError) {
    return (
      <div className="collection-placeholder">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path>
          <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path>
          <line x1="12" y1="6" x2="12" y2="10"></line>
          <line x1="10" y1="8" x2="14" y2="8"></line>
        </svg>
        <span>{collectionName.charAt(0).toUpperCase()}</span>
      </div>
    );
  }

  return (
    <div className="cover-single">
      <img
        src={getCoverUrl(bookIds[currentIndex])}
        alt={collectionName}
        onError={() => setImageError(true)}
      />
    </div>
  );
}

export default function Collections() {
  const navigate = useNavigate();
  const [collections, setCollections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [newIsPublic, setNewIsPublic] = useState(false);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    loadCollections();
  }, []);

  const loadCollections = async () => {
    try {
      const response = await getCollections();
      setCollections(response.data);
    } catch (error) {
      console.error('Error loading collections:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!newName.trim() || creating) return;

    setCreating(true);
    try {
      const response = await createCollection(newName.trim(), newDescription.trim(), newIsPublic);
      setCollections([response.data, ...collections]);
      setShowCreateModal(false);
      setNewName('');
      setNewDescription('');
      setNewIsPublic(false);
      // Navigate to the new collection
      navigate(`/collections/${response.data.id}`);
    } catch (error) {
      console.error('Error creating collection:', error);
      alert('Failed to create collection');
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (e, collection) => {
    e.stopPropagation();
    if (!collection.is_owner) {
      alert("You can only delete collections you created.");
      return;
    }
    if (!confirm(`Delete "${collection.name}"? This cannot be undone.`)) return;

    try {
      await deleteCollection(collection.id);
      setCollections(collections.filter(c => c.id !== collection.id));
    } catch (error) {
      console.error('Error deleting collection:', error);
      alert('Failed to delete collection');
    }
  };

  if (loading) {
    return <div className="loading">Loading collections...</div>;
  }

  return (
    <div className="collections-page container">
      <div className="collections-header">
        <button className="back-button" onClick={() => navigate(-1)}>← Back</button>
        <div className="header-row">
          <h2 className="collections-count">
            {collections.length} {collections.length === 1 ? 'Collection' : 'Collections'}
          </h2>
          {collections.length > 0 && (
            <button className="btn btn-primary" onClick={() => setShowCreateModal(true)}>
              + New Collection
            </button>
          )}
        </div>
      </div>

      {collections.length === 0 ? (
        <div className="empty-state">
          <p>No collections yet. Create one to organize your audiobooks!</p>
          <button className="btn btn-primary" onClick={() => setShowCreateModal(true)}>
            Create Your First Collection
          </button>
        </div>
      ) : (
        <div className="collections-grid">
          {collections.map((collection) => (
            <div
              key={collection.id}
              className="collection-card"
              onClick={() => navigate(`/collections/${collection.id}`)}
            >
              {collection.is_owner === 1 && (
                <button
                  className="delete-btn"
                  onClick={(e) => handleDelete(e, collection)}
                  title="Delete collection"
                >
                  ×
                </button>
              )}
              <div className="collection-covers">
                <div className="collection-book-count">{collection.book_count || 0}</div>
                <RotatingCover bookIds={collection.book_ids} collectionName={collection.name} />
              </div>
              <div className="collection-card-content">
                <div className="title-with-visibility">
                  <h3 className="collection-title">{collection.name}</h3>
                  <span className={`visibility-tag ${collection.is_public === 1 ? 'public' : 'private'}`}>
                    {collection.is_public === 1 ? 'Public' : 'Private'}
                  </span>
                </div>
                {collection.description && (
                  <p className="collection-description">{collection.description}</p>
                )}
                {/* Creator label */}
                <p className="collection-creator">
                  {collection.is_owner === 1 ? 'Created by you' : `Created by ${collection.creator_username || 'Unknown'}`}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}

      {showCreateModal && (
        <div className="modal-overlay" onClick={() => setShowCreateModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Create Collection</h3>
            <form onSubmit={handleCreate}>
              <div className="form-group">
                <label htmlFor="collection-name">Name</label>
                <input
                  id="collection-name"
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="e.g., Road Trip, Bedtime Stories"
                  autoFocus
                />
              </div>
              <div className="form-group">
                <label htmlFor="collection-description">Description (optional)</label>
                <textarea
                  id="collection-description"
                  value={newDescription}
                  onChange={(e) => setNewDescription(e.target.value)}
                  placeholder="What's this collection for?"
                  rows={3}
                />
              </div>
              <div className="form-group visibility-toggle">
                <label className="toggle-label">
                  <input
                    type="checkbox"
                    checked={newIsPublic}
                    onChange={(e) => setNewIsPublic(e.target.checked)}
                  />
                  <span className="toggle-text">
                    Make this collection public
                  </span>
                </label>
                <p className="toggle-hint">
                  {newIsPublic
                    ? 'All users will be able to view and edit this collection'
                    : 'Only you can see this collection'}
                </p>
              </div>
              <div className="modal-actions">
                <button type="button" className="btn btn-secondary" onClick={() => setShowCreateModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={!newName.trim() || creating}>
                  {creating ? 'Creating...' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
