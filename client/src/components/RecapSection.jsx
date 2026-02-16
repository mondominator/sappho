import { useState } from 'react';
import axios from 'axios';

/**
 * Hook that manages recap state and actions.
 * Used by RecapTrigger and RecapContent to share state.
 */
export function useRecap({ audiobookId, aiConfigured, progress }) {
  const [recap, setRecap] = useState(null);
  const [recapLoading, setRecapLoading] = useState(false);
  const [recapError, setRecapError] = useState(null);
  const [recapExpanded, setRecapExpanded] = useState(false);

  const hasProgress = progress && (progress.position > 0 || progress.completed === 1);

  const loadRecap = async () => {
    setRecapLoading(true);
    setRecapError(null);

    try {
      const token = localStorage.getItem('token');
      const response = await axios.get(`/api/audiobooks/${audiobookId}/recap`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setRecap(response.data);
      setRecapExpanded(true);
    } catch (error) {
      console.error('Error loading recap:', error);
      setRecapError(error.response?.data?.message || error.response?.data?.error || 'Failed to generate recap');
    } finally {
      setRecapLoading(false);
    }
  };

  const clearRecapCache = async () => {
    try {
      const token = localStorage.getItem('token');
      await axios.delete(`/api/audiobooks/${audiobookId}/recap`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setRecap(null);
      loadRecap();
    } catch (error) {
      console.error('Error clearing recap cache:', error);
    }
  };

  return {
    recap, recapLoading, recapError, recapExpanded, setRecapExpanded,
    hasProgress, loadRecap, clearRecapCache, aiConfigured
  };
}

/**
 * Trigger button + loading spinner for the recap feature.
 * Renders inline in the About header area.
 */
export function RecapTrigger({ aiConfigured, hasProgress, recap, recapLoading, recapError, loadRecap }) {
  if (!aiConfigured) return null;

  return (
    <>
      {hasProgress && !recap && !recapLoading && !recapError && (
        <button className="catch-me-up-subtle" onClick={loadRecap} title="AI-generated recap of what you've listened to">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/>
            <polyline points="14 2 14 8 20 8"/>
            <line x1="16" y1="13" x2="8" y2="13"/>
            <line x1="16" y1="17" x2="8" y2="17"/>
            <line x1="10" y1="9" x2="8" y2="9"/>
          </svg>
          Catch Up
        </button>
      )}
      {recapLoading && (
        <span className="catch-me-up-subtle loading">
          <div className="recap-spinner-small"></div>
        </span>
      )}
    </>
  );
}

/**
 * Recap content: error state, collapsible recap display, and regenerate action.
 * Renders below the description area.
 */
export function RecapContent({ aiConfigured, recap, recapError, recapExpanded, setRecapExpanded, loadRecap, clearRecapCache }) {
  if (!aiConfigured) return null;

  return (
    <>
      {recapError && (
        <div className="recap-error">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10"/>
            <line x1="12" y1="8" x2="12" y2="12"/>
            <line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
          <span>{recapError}</span>
          <button className="retry-button" onClick={loadRecap}>Try Again</button>
        </div>
      )}

      {recap && (
        <div className={`recap-container ${recapExpanded ? 'expanded' : ''}`}>
          <div className="recap-header" onClick={() => setRecapExpanded(!recapExpanded)}>
            <div className="recap-header-left">
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/>
                <polyline points="14 2 14 8 20 8"/>
                <line x1="16" y1="13" x2="8" y2="13"/>
                <line x1="16" y1="17" x2="8" y2="17"/>
                <line x1="10" y1="9" x2="8" y2="9"/>
              </svg>
              <span>Your Recap</span>
              {recap.cached && (
                <span className="cached-badge">Cached</span>
              )}
            </div>
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className={`expand-icon ${recapExpanded ? 'expanded' : ''}`}
            >
              <polyline points="6 9 12 15 18 9"/>
            </svg>
          </div>

          {recapExpanded && (
            <div className="recap-content">
              {recap.priorBooks && recap.priorBooks.length > 0 && (
                <div className="recap-books-included">
                  <span>Based on prior books: </span>
                  {recap.priorBooks.map((book, i) => (
                    <span key={book.id} className="book-tag">
                      {book.position ? `#${book.position} ` : ''}{book.title}
                      {i < recap.priorBooks.length - 1 && ', '}
                    </span>
                  ))}
                </div>
              )}
              <div className="recap-text">
                {recap.recap.split('\n\n').map((paragraph, i) => (
                  <p key={i}>{paragraph}</p>
                ))}
              </div>
              <div className="recap-actions">
                <button className="recap-action-btn" onClick={clearRecapCache}>
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 2v6h-6M3 12a9 9 0 0 1 15-6.7L21 8M3 22v-6h6M21 12a9 9 0 0 1-15 6.7L3 16"/>
                  </svg>
                  Regenerate
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
}
