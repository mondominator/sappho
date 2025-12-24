import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { getActivityFeed, getCoverUrl } from '../api';
import './ActivityFeed.css';

const EVENT_LABELS = {
  started_listening: 'Started listening to',
  finished_book: 'Finished',
  rated_book: 'Rated',
  added_to_collection: 'Added to collection',
  progress_milestone: 'Reached milestone in',
  book_added: 'New book added'
};

const EVENT_ICONS = {
  started_listening: '▶️',
  finished_book: '🎉',
  rated_book: '⭐',
  added_to_collection: '📚',
  progress_milestone: '🏆',
  book_added: '📖'
};

function formatTimeAgo(dateString) {
  const date = new Date(dateString);
  const now = new Date();
  const seconds = Math.floor((now - date) / 1000);

  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
  return date.toLocaleDateString();
}

export default function ActivityFeed({ limit = 10, showTitle = true }) {
  const navigate = useNavigate();
  const [activities, setActivities] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    loadActivity();
  }, [limit]);

  const loadActivity = async () => {
    try {
      setLoading(true);
      const response = await getActivityFeed({ limit });
      setActivities(response.data.data || []);
      setError(null);
    } catch (err) {
      console.error('Failed to load activity:', err);
      setError('Failed to load activity feed');
    } finally {
      setLoading(false);
    }
  };

  const handleActivityClick = (activity) => {
    if (activity.audiobook_id) {
      navigate(`/audiobook/${activity.audiobook_id}`);
    }
  };

  if (loading) {
    return (
      <div className="activity-feed">
        {showTitle && <h3 className="activity-title">Activity</h3>}
        <div className="activity-loading">Loading activity...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="activity-feed">
        {showTitle && <h3 className="activity-title">Activity</h3>}
        <div className="activity-error">{error}</div>
      </div>
    );
  }

  if (activities.length === 0) {
    return (
      <div className="activity-feed">
        {showTitle && <h3 className="activity-title">Activity</h3>}
        <div className="activity-empty">
          <p>No activity yet</p>
          <p className="activity-empty-hint">Start listening to see your activity here!</p>
        </div>
      </div>
    );
  }

  return (
    <div className="activity-feed">
      {showTitle && <h3 className="activity-title">Activity</h3>}
      <div className="activity-list">
        {activities.map((activity) => (
          <div
            key={activity.id}
            className="activity-item"
            onClick={() => handleActivityClick(activity)}
          >
            <div className="activity-icon">
              {EVENT_ICONS[activity.event_type] || '📌'}
            </div>
            <div className="activity-content">
              <div className="activity-header">
                {activity.username && (
                  <span className="activity-user">{activity.username}</span>
                )}
                <span className="activity-action">
                  {EVENT_LABELS[activity.event_type] || activity.event_type}
                </span>
                {activity.metadata?.rating && (
                  <span className="activity-rating">
                    {'★'.repeat(activity.metadata.rating)}
                  </span>
                )}
              </div>
              {activity.book_title && (
                <div className="activity-book">
                  {activity.cover_path && (
                    <img
                      src={getCoverUrl(activity.audiobook_id)}
                      alt=""
                      className="activity-cover"
                      onError={(e) => e.target.style.display = 'none'}
                    />
                  )}
                  <div className="activity-book-info">
                    <span className="activity-book-title">{activity.book_title}</span>
                    {activity.book_author && (
                      <span className="activity-book-author">by {activity.book_author}</span>
                    )}
                  </div>
                </div>
              )}
              <div className="activity-time">{formatTimeAgo(activity.created_at)}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
