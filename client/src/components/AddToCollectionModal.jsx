import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { getCollections, createCollection, addToCollection, removeFromCollection, getCollectionsForBook } from '../api';
import './AddToCollectionModal.css';

export default function AddToCollectionModal({ isOpen, onClose, audiobookId, audiobookTitle }) {
  const [collections, setCollections] = useState([]);
  const [bookCollections, setBookCollections] = useState(new Set());
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (isOpen && audiobookId) {
      loadData();
    }
  }, [isOpen, audiobookId]);

  // Close on Escape key
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const loadData = async () => {
    setLoading(true);
    try {
      const [collectionsRes, bookCollectionsRes] = await Promise.all([
        getCollections(),
        getCollectionsForBook(audiobookId)
      ]);
      setCollections(collectionsRes.data);
      // Filter for collections where contains_book is 1 (true)
      setBookCollections(new Set(
        bookCollectionsRes.data
          .filter(c => c.contains_book === 1)
          .map(c => c.id)
      ));
    } catch (error) {
      console.error('Error loading collections:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleToggleCollection = async (collectionId) => {
    const isInCollection = bookCollections.has(collectionId);

    try {
      if (isInCollection) {
        await removeFromCollection(collectionId, audiobookId);
        setBookCollections(prev => {
          const next = new Set(prev);
          next.delete(collectionId);
          return next;
        });
      } else {
        await addToCollection(collectionId, audiobookId);
        setBookCollections(prev => new Set([...prev, collectionId]));
      }
    } catch (error) {
      console.error('Error toggling collection:', error);
      alert('Failed to update collection');
    }
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!newName.trim() || creating) return;

    setCreating(true);
    try {
      const response = await createCollection(newName.trim(), '');
      const newCollection = response.data;

      // Add the book to the new collection
      await addToCollection(newCollection.id, audiobookId);

      setCollections([newCollection, ...collections]);
      setBookCollections(prev => new Set([...prev, newCollection.id]));
      setNewName('');
      setShowCreate(false);
    } catch (error) {
      console.error('Error creating collection:', error);
      alert('Failed to create collection');
    } finally {
      setCreating(false);
    }
  };

  if (!isOpen) return null;

  return createPortal(
    <div className="add-to-collection-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-label="Add to collection">
      <div className="add-to-collection-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Add to Collection</h3>
          <button className="modal-close" onClick={onClose}>&times;</button>
        </div>

        <div className="modal-body">
          {loading ? (
            <div className="modal-loading">Loading collections...</div>
          ) : (
            <>
              {showCreate ? (
                <form className="create-form" onSubmit={handleCreate}>
                  <input
                    type="text"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="Collection name"
                    autoFocus
                  />
                  <div className="create-actions">
                    <button type="button" className="btn btn-secondary" onClick={() => setShowCreate(false)}>
                      Cancel
                    </button>
                    <button type="submit" className="btn btn-primary" disabled={!newName.trim() || creating}>
                      {creating ? 'Creating...' : 'Create & Add'}
                    </button>
                  </div>
                </form>
              ) : (
                <button className="new-collection-btn" onClick={() => setShowCreate(true)}>
                  <span className="plus-icon">+</span>
                  New Collection
                </button>
              )}

              <div className="collections-list">
                {collections.length === 0 && !showCreate ? (
                  <div className="no-collections">No collections yet. Create one above!</div>
                ) : (
                  collections.map((collection) => (
                    <div
                      key={collection.id}
                      className={`collection-item ${bookCollections.has(collection.id) ? 'selected' : ''}`}
                      onClick={() => handleToggleCollection(collection.id)}
                    >
                      <div className="collection-checkbox">
                        {bookCollections.has(collection.id) && (
                          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="20 6 9 17 4 12"></polyline>
                          </svg>
                        )}
                      </div>
                      <div className="collection-info">
                        <span className="collection-name">{collection.name}</span>
                        <span className="collection-count">{collection.book_count || 0} books</span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </>
          )}
        </div>

        <div className="modal-footer">
          <button className="btn btn-primary" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>,
    document.body
  );
}
