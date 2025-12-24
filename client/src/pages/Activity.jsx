import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { getActivityFeed, getPersonalActivity, getServerActivity, getCoverUrl, getActivityPrivacy, updateActivityPrivacy } from '../api';
import './Activity.css';

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

export default function Activity() {
  const navigate = useNavigate();
  const [activities, setActivities] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState('all');
  const [privacy, setPrivacy] = useState({ share_activity: true, show_in_feed: true });
  const [showSettings, setShowSettings] = useState(false);

  useEffect(() => {
    loadActivity();
  }, [activeTab]);

  useEffect(() => {
    loadPrivacy();
  }, []);

  const loadPrivacy = async () => {
    try {
      const response = await getActivityPrivacy();
      setPrivacy(response.data);
    } catch (err) {
      console.error('Failed to load privacy settings:', err);
    }
  };

  const loadActivity = async () => {
    try {
      setLoading(true);
      let response;
      if (activeTab === 'all') {
        response = await getActivityFeed({ limit: 50 });
      } else if (activeTab === 'personal') {
        response = await getPersonalActivity({ limit: 50 });
      } else {
        response = await getServerActivity({ limit: 50 });
      }
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

  const handlePrivacyChange = async (setting, value) => {
    try {
      const newPrivacy = { ...privacy, [setting]: value };
      await updateActivityPrivacy(newPrivacy);
      setPrivacy(newPrivacy);
    } catch (err) {
      console.error('Failed to update privacy:', err);
    }
  };

  return (
    <div className="activity-page">
      <div className="activity-page-header">
        <h1>Activity</h1>
        <button
          className="activity-settings-button"
          onClick={() => setShowSettings(!showSettings)}
          title="Privacy Settings"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3"></circle>
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
          </svg>
        </button>
      </div>

      {showSettings && (
        <div className="activity-privacy-panel">
          <h3>Privacy Settings</h3>
          <label className="privacy-toggle">
            <input
              type="checkbox"
              checked={privacy.share_activity}
              onChange={(e) => handlePrivacyChange('share_activity', e.target.checked)}
            />
            <span>Share my activity with others</span>
          </label>
          <label className="privacy-toggle">
            <input
              type="checkbox"
              checked={privacy.show_in_feed}
              onChange={(e) => handlePrivacyChange('show_in_feed', e.target.checked)}
            />
            <span>Show others' activity in my feed</span>
          </label>
        </div>
      )}

      <div className="activity-tabs">
        <button
          className={`activity-tab ${activeTab === 'all' ? 'active' : ''}`}
          onClick={() => setActiveTab('all')}
        >
          All Activity
        </button>
        <button
          className={`activity-tab ${activeTab === 'personal' ? 'active' : ''}`}
          onClick={() => setActiveTab('personal')}
        >
          My Activity
        </button>
        <button
          className={`activity-tab ${activeTab === 'server' ? 'active' : ''}`}
          onClick={() => setActiveTab('server')}
        >
          Community
        </button>
      </div>

      {loading ? (
        <div className="activity-loading">Loading activity...</div>
      ) : error ? (
        <div className="activity-error">{error}</div>
      ) : activities.length === 0 ? (
        <div className="activity-empty">
          <p>No activity yet</p>
          <p className="activity-empty-hint">
            {activeTab === 'personal'
              ? 'Start listening to books to see your activity here!'
              : 'Activity from you and other users will appear here.'}
          </p>
        </div>
      ) : (
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
      )}
    </div>
  );
}
