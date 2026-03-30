import { useState, useEffect, useCallback } from 'react';
import { getRating, setRating as apiSetRating, getAverageRating, getAllRatings } from '../api';

/**
 * Format an ISO date string to a relative time string (e.g., "2 days ago").
 */
function formatRelativeDate(isoString) {
  if (!isoString) return '';
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now - date;
  const diffSeconds = Math.floor(diffMs / 1000);
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);
  const diffWeeks = Math.floor(diffDays / 7);
  const diffMonths = Math.floor(diffDays / 30);
  const diffYears = Math.floor(diffDays / 365);

  if (diffSeconds < 60) return 'just now';
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays === 1) return 'yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffWeeks === 1) return '1 week ago';
  if (diffWeeks < 5) return `${diffWeeks} weeks ago`;
  if (diffMonths === 1) return '1 month ago';
  if (diffMonths < 12) return `${diffMonths} months ago`;
  if (diffYears === 1) return '1 year ago';
  return `${diffYears} years ago`;
}

/**
 * Render small filled stars for a given rating value.
 */
function SmallStars({ rating }) {
  return (
    <span className="review-stars">
      {[1, 2, 3, 4, 5].map((star) => (
        <svg
          key={star}
          xmlns="http://www.w3.org/2000/svg"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill={star <= rating ? '#fbbf24' : 'none'}
          stroke={star <= rating ? '#fbbf24' : '#4b5563'}
          strokeWidth="1.5"
        >
          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
        </svg>
      ))}
    </span>
  );
}

/**
 * Self-contained rating component with user rating picker, review input,
 * average display, and reviews list.
 * Manages its own state for userRating, averageRating, showRatingPicker, reviews.
 */
export default function RatingSection({ audiobookId }) {
  const [userRating, setUserRating] = useState(null);
  const [userReview, setUserReview] = useState('');
  const [userRatingData, setUserRatingData] = useState(null);
  const [averageRating, setAverageRating] = useState(null);
  const [showRatingPicker, setShowRatingPicker] = useState(false);
  const [isUpdatingRating, setIsUpdatingRating] = useState(false);
  const [reviews, setReviews] = useState([]);
  const [reviewText, setReviewText] = useState('');
  const [isSubmittingReview, setIsSubmittingReview] = useState(false);
  const [showReviewsList, setShowReviewsList] = useState(false);

  const loadReviews = useCallback(async () => {
    if (!audiobookId) return;
    try {
      const response = await getAllRatings(audiobookId);
      setReviews(response.data || []);
    } catch (error) {
      console.error('Error loading reviews:', error);
    }
  }, [audiobookId]);

  useEffect(() => {
    if (!audiobookId) return;
    // Load user rating, average, and all reviews in parallel
    Promise.all([
      getRating(audiobookId).catch(() => ({ data: null })),
      getAverageRating(audiobookId).catch(() => ({ data: null })),
      getAllRatings(audiobookId).catch(() => ({ data: [] }))
    ]).then(([ratingRes, avgRes, reviewsRes]) => {
      setUserRating(ratingRes.data?.rating || null);
      setUserReview(ratingRes.data?.review || '');
      setUserRatingData(ratingRes.data);
      setReviewText(ratingRes.data?.review || '');
      setAverageRating(avgRes.data);
      setReviews(reviewsRes.data || []);
    });
    setShowRatingPicker(false);
  }, [audiobookId]);

  const handleRatingChange = async (newRating) => {
    if (isUpdatingRating) return;
    setIsUpdatingRating(true);
    try {
      await apiSetRating(audiobookId, newRating, userReview || null);
      setUserRating(newRating);
      const avgResponse = await getAverageRating(audiobookId);
      setAverageRating(avgResponse.data);
      if (newRating !== null) {
        setShowRatingPicker(false);
      }
      // Reload the user's own rating data to get the user_id
      const ratingRes = await getRating(audiobookId).catch(() => ({ data: null }));
      setUserRatingData(ratingRes.data);
      await loadReviews();
    } catch (error) {
      console.error('Error setting rating:', error);
    } finally {
      setIsUpdatingRating(false);
    }
  };

  const handleSubmitReview = async () => {
    if (isSubmittingReview) return;
    setIsSubmittingReview(true);
    try {
      await apiSetRating(audiobookId, userRating, reviewText || null);
      setUserReview(reviewText);
      // Reload the user's own rating data
      const ratingRes = await getRating(audiobookId).catch(() => ({ data: null }));
      setUserRatingData(ratingRes.data);
      await loadReviews();
    } catch (error) {
      console.error('Error submitting review:', error);
    } finally {
      setIsSubmittingReview(false);
    }
  };

  // Filter reviews: only those with non-empty review text, excluding current user
  const currentUserId = userRatingData?.user_id;
  const allReviewsWithText = reviews.filter(
    (r) => r.review && r.review.trim() !== ''
  );

  const showReviewInput = showRatingPicker && userRating !== null;

  return (
    <div className="detail-rating-section">
      <div className="rating-row">
        {averageRating && averageRating.count > 0 && (
          <div className="average-rating-display">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="#fbbf24" stroke="none">
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
            </svg>
            <span className="average-value">{averageRating.average?.toFixed(1)}</span>

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

        {reviews.length > 0 && (
          <button
            className={`rate-button ${showReviewsList ? 'rated' : ''}`}
            onClick={() => setShowReviewsList(!showReviewsList)}
            style={{ marginLeft: '8px' }}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill={showReviewsList ? '#3B82F6' : 'none'} stroke={showReviewsList ? '#3B82F6' : '#9ca3af'} strokeWidth="2">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
            </svg>
            <span style={{ color: showReviewsList ? '#3B82F6' : '#9ca3af' }}>{reviews.length}</span>
          </button>
        )}
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

      {showReviewInput && (
        <div className="review-input-section">
          <textarea
            className="review-textarea"
            placeholder="Write a review (optional)"
            value={reviewText}
            onChange={(e) => setReviewText(e.target.value)}
            disabled={isSubmittingReview}
            rows={3}
          />
          <button
            className="review-submit-btn"
            onClick={handleSubmitReview}
            disabled={isSubmittingReview || (reviewText === (userReview || ''))}
          >
            {isSubmittingReview ? (
              <span className="rate-spinner"></span>
            ) : (
              'Submit'
            )}
          </button>
        </div>
      )}

      {showReviewsList && allReviewsWithText.length > 0 && (
        <div className="reviews-list-section">
          <div className="reviews-list">
            {allReviewsWithText.map((review) => (
              <div key={review.user_id} className="review-card">
                <div className="review-card-header">
                  <span className="review-author">
                    {review.display_name || review.username}
                  </span>
                  <SmallStars rating={review.rating} />
                </div>
                <p className="review-text">{review.review}</p>
                <span className="review-date">
                  {formatRelativeDate(review.updated_at)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
