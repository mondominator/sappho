import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { getCollections, createCollection, deleteCollection, getCoverUrl } from '../api';
import './Collections.css';

export default function Collections() {
  const navigate = useNavigate();
  const [collections, setCollections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDescription, setNewDescription] = useState('');
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
      const response = await createCollection(newName.trim(), newDescription.trim());
      setCollections([response.data, ...collections]);
      setShowCreateModal(false);
      setNewName('');
      setNewDescription('');
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
          <button className="btn btn-primary" onClick={() => setShowCreateModal(true)}>
            + New Collection
          </button>
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
              <button
                className="delete-btn"
                onClick={(e) => handleDelete(e, collection)}
                title="Delete collection"
              >
                ×
              </button>
              <div className="collection-covers">
                <div className="collection-book-count">{collection.book_count || 0}</div>
                {collection.first_cover ? (
                  <div className="cover-single">
                    <img
                      src={getCoverUrl(collection.first_cover.split('/').pop().split('.')[0])}
                      alt={collection.name}
                      onError={(e) => e.target.style.display = 'none'}
                    />
                  </div>
                ) : (
                  <div className="collection-placeholder">
                    <span>{collection.name.charAt(0).toUpperCase()}</span>
                  </div>
                )}
              </div>
              <div className="collection-card-content">
                <h3 className="collection-title">{collection.name}</h3>
                {collection.description && (
                  <p className="collection-description">{collection.description}</p>
                )}
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
