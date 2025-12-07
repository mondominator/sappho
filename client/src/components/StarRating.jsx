import { useState } from 'react';
import './StarRating.css';

export default function StarRating({ rating, onRate, size = 'medium', readonly = false, showLabel = true }) {
  const [hoverRating, setHoverRating] = useState(0);

  const handleClick = (star) => {
    if (readonly || !onRate) return;
    // If clicking the same star, clear the rating
    if (star === rating) {
      onRate(null);
    } else {
      onRate(star);
    }
  };

  const handleMouseEnter = (star) => {
    if (readonly) return;
    setHoverRating(star);
  };

  const handleMouseLeave = () => {
    setHoverRating(0);
  };

  const displayRating = hoverRating || rating || 0;

  const getSizeClass = () => {
    switch (size) {
      case 'small': return 'star-rating-small';
      case 'large': return 'star-rating-large';
      default: return 'star-rating-medium';
    }
  };

  const getRatingLabel = () => {
    if (hoverRating) {
      const labels = ['', 'Poor', 'Fair', 'Good', 'Great', 'Excellent'];
      return labels[hoverRating];
    }
    if (rating) {
      const labels = ['', 'Poor', 'Fair', 'Good', 'Great', 'Excellent'];
      return labels[rating];
    }
    return 'Rate this book';
  };

  return (
    <div className={`star-rating ${getSizeClass()} ${readonly ? 'readonly' : ''}`}>
      <div className="stars-container" onMouseLeave={handleMouseLeave}>
        {[1, 2, 3, 4, 5].map((star) => (
          <button
            key={star}
            type="button"
            className={`star-button ${star <= displayRating ? 'filled' : ''}`}
            onClick={() => handleClick(star)}
            onMouseEnter={() => handleMouseEnter(star)}
            disabled={readonly}
            title={readonly ? `${star} star${star !== 1 ? 's' : ''}` : `Rate ${star} star${star !== 1 ? 's' : ''}`}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill={star <= displayRating ? 'currentColor' : 'none'}
              stroke="currentColor"
              strokeWidth="1.5"
            >
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
            </svg>
          </button>
        ))}
      </div>
      {showLabel && !readonly && (
        <span className="rating-label">{getRatingLabel()}</span>
      )}
    </div>
  );
}
