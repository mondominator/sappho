import { useState } from 'react';
import { getCollections, batchMarkFinished, batchClearProgress, batchAddToReadingList, batchAddToCollection, batchDelete } from '../api';
import './BatchActionBar.css';

export default function BatchActionBar({ selectedIds, onActionComplete, onClose, isAdmin }) {
  const [showCollectionPicker, setShowCollectionPicker] = useState(false);
  const [collections, setCollections] = useState([]);
  const [loading, setLoading] = useState(false);

  const count = selectedIds.length;

  const handleMarkFinished = async () => {
    if (!confirm(`Mark ${count} book${count !== 1 ? 's' : ''} as finished?`)) return;
    setLoading(true);
    try {
      await batchMarkFinished(selectedIds);
      onActionComplete('Marked as finished');
    } catch (error) {
      alert('Failed to mark as finished: ' + (error.response?.data?.error || error.message));
    } finally {
      setLoading(false);
    }
  };

  const handleClearProgress = async () => {
    if (!confirm(`Clear progress for ${count} book${count !== 1 ? 's' : ''}? This cannot be undone.`)) return;
    setLoading(true);
    try {
      await batchClearProgress(selectedIds);
      onActionComplete('Progress cleared');
    } catch (error) {
      alert('Failed to clear progress: ' + (error.response?.data?.error || error.message));
    } finally {
      setLoading(false);
    }
  };

  const handleAddToReadingList = async () => {
    setLoading(true);
    try {
      await batchAddToReadingList(selectedIds);
      onActionComplete('Added to reading list');
    } catch (error) {
      alert('Failed to add to reading list: ' + (error.response?.data?.error || error.message));
    } finally {
      setLoading(false);
    }
  };

  const handleShowCollections = async () => {
    try {
      const response = await getCollections();
      setCollections(response.data);
      setShowCollectionPicker(true);
    } catch (error) {
      alert('Failed to load collections: ' + (error.response?.data?.error || error.message));
    }
  };

  const handleAddToCollection = async (collectionId) => {
    setLoading(true);
    setShowCollectionPicker(false);
    try {
      await batchAddToCollection(selectedIds, collectionId);
      onActionComplete('Added to collection');
    } catch (error) {
      alert('Failed to add to collection: ' + (error.response?.data?.error || error.message));
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm(`DELETE ${count} book${count !== 1 ? 's' : ''}? This cannot be undone!`)) return;
    setLoading(true);
    try {
      await batchDelete(selectedIds, false);
      onActionComplete('Deleted');
    } catch (error) {
      alert('Failed to delete: ' + (error.response?.data?.error || error.message));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="batch-action-bar">
      <div className="batch-action-bar-content">
        <div className="batch-selected-count">
          <button className="batch-close-btn" onClick={onClose} title="Exit selection mode">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
          <span>{count} selected</span>
        </div>

        <div className="batch-actions">
          <button
            className="batch-action-btn"
            onClick={handleMarkFinished}
            disabled={loading}
            title="Mark as finished"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
            <span>Finished</span>
          </button>

          <button
            className="batch-action-btn"
            onClick={handleClearProgress}
            disabled={loading}
            title="Clear progress"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 6h18"></path>
              <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path>
            </svg>
            <span>Clear</span>
          </button>

          <button
            className="batch-action-btn"
            onClick={handleAddToReadingList}
            disabled={loading}
            title="Add to reading list"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"></path>
              <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"></path>
            </svg>
            <span>Read Later</span>
          </button>

          <button
            className="batch-action-btn"
            onClick={handleShowCollections}
            disabled={loading}
            title="Add to collection"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
              <line x1="12" y1="11" x2="12" y2="17"></line>
              <line x1="9" y1="14" x2="15" y2="14"></line>
            </svg>
            <span>Collection</span>
          </button>

          {isAdmin && (
            <button
              className="batch-action-btn batch-action-danger"
              onClick={handleDelete}
              disabled={loading}
              title="Delete"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="3 6 5 6 21 6"></polyline>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                <line x1="10" y1="11" x2="10" y2="17"></line>
                <line x1="14" y1="11" x2="14" y2="17"></line>
              </svg>
              <span>Delete</span>
            </button>
          )}
        </div>
      </div>

      {/* Collection Picker Modal */}
      {showCollectionPicker && (
        <div className="collection-picker-overlay" onClick={() => setShowCollectionPicker(false)}>
          <div className="collection-picker" onClick={e => e.stopPropagation()}>
            <h3>Add to Collection</h3>
            {collections.length === 0 ? (
              <p className="no-collections">No collections yet. Create one first!</p>
            ) : (
              <div className="collection-list">
                {collections.map(collection => (
                  <button
                    key={collection.id}
                    className="collection-option"
                    onClick={() => handleAddToCollection(collection.id)}
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
                    </svg>
                    <span>{collection.name}</span>
                    <span className="collection-count">{collection.item_count || 0} books</span>
                  </button>
                ))}
              </div>
            )}
            <button className="collection-picker-close" onClick={() => setShowCollectionPicker(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
