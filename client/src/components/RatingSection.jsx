import { useState, useEffect } from 'react';
import { getRating, setRating as apiSetRating, getAverageRating } from '../api';

/**
 * Self-contained rating component with user rating picker and average display.
 * Manages its own state for userRating, averageRating, showRatingPicker.
 */
export default function RatingSection({ audiobookId }) {
  const [userRating, setUserRating] = useState(null);
  const [averageRating, setAverageRating] = useState(null);
  const [showRatingPicker, setShowRatingPicker] = useState(false);
  const [isUpdatingRating, setIsUpdatingRating] = useState(false);

  useEffect(() => {
    if (!audiobookId) return;
    // Load both ratings in parallel
    Promise.all([
      getRating(audiobookId).catch(() => ({ data: null })),
      getAverageRating(audiobookId).catch(() => ({ data: null }))
    ]).then(([ratingRes, avgRes]) => {
      setUserRating(ratingRes.data?.rating || null);
      setAverageRating(avgRes.data);
    });
    setShowRatingPicker(false);
  }, [audiobookId]);

  const handleRatingChange = async (newRating) => {
    if (isUpdatingRating) return;
    setIsUpdatingRating(true);
    try {
      await apiSetRating(audiobookId, newRating, null);
      setUserRating(newRating);
      const avgResponse = await getAverageRating(audiobookId);
      setAverageRating(avgResponse.data);
      if (newRating !== null) {
        setShowRatingPicker(false);
      }
    } catch (error) {
      console.error('Error setting rating:', error);
    } finally {
      setIsUpdatingRating(false);
    }
  };

  return (
    <div className="detail-rating-section">
      <div className="rating-row">
        {averageRating && averageRating.count > 0 && (
          <div className="average-rating-display">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="#fbbf24" stroke="none">
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
            </svg>
            <span className="average-value">{averageRating.average?.toFixed(1)}</span>
            <span className="average-count">({averageRating.count})</span>
          </div>
        )}

        <button
          className={`rate-button ${userRating ? 'rated' : ''}`}
          onClick={() => setShowRatingPicker(!showRatingPicker)}
          disabled={isUpdatingRating}
        >
          {isUpdatingRating ? (
            <span className="rate-spinner"></span>
          ) : userRating ? (
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="#fbbf24" stroke="none">
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
            </svg>
          ) : (
            <>
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
              </svg>
              <span>Rate</span>
            </>
          )}
        </button>
      </div>

      {showRatingPicker && (
        <div className="star-picker">
          {[1, 2, 3, 4, 5].map((star) => (
            <button
              key={star}
              className={`star-pick-btn ${userRating && star <= userRating ? 'filled' : ''}`}
              onClick={() => {
                if (userRating === star) {
                  handleRatingChange(null);
                } else {
                  handleRatingChange(star);
                }
              }}
              disabled={isUpdatingRating}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="32"
                height="32"
                viewBox="0 0 24 24"
                fill={userRating && star <= userRating ? '#fbbf24' : 'none'}
                stroke={userRating && star <= userRating ? '#fbbf24' : '#6b7280'}
                strokeWidth="1.5"
              >
                <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
              </svg>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
