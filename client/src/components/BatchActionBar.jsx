import { useState } from 'react';
import { getCollections, batchMarkFinished, batchClearProgress, batchAddToReadingList, batchAddToCollection } from '../api';
import './BatchActionBar.css';

export default function BatchActionBar({ selectedIds, onActionComplete, onClose }) {
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

  return (
    <div className="batch-action-bar">
      {/* Android-style: 4 evenly spaced icon columns */}
      <div className="batch-actions-row">
        {/* Finished - green */}
        <button
          className="batch-action-col"
          onClick={handleMarkFinished}
          disabled={loading || count === 0}
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
            <polyline points="22 4 12 14.01 9 11.01"></polyline>
          </svg>
          <span>Finished</span>
        </button>

        {/* Clear - yellow/orange */}
        <button
          className="batch-action-col"
          onClick={handleClearProgress}
          disabled={loading || count === 0}
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="1 4 1 10 7 10"></polyline>
            <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"></path>
          </svg>
          <span>Clear</span>
        </button>

        {/* Reading List - blue */}
        <button
          className="batch-action-col"
          onClick={handleAddToReadingList}
          disabled={loading || count === 0}
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"></path>
            <line x1="12" y1="7" x2="12" y2="13"></line>
            <line x1="9" y1="10" x2="15" y2="10"></line>
          </svg>
          <span>Reading List</span>
        </button>

        {/* Collection - blue */}
        <button
          className="batch-action-col"
          onClick={handleShowCollections}
          disabled={loading || count === 0}
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
          </svg>
          <span>Collection</span>
        </button>
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
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
