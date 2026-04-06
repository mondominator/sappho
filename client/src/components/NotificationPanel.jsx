import { useNavigate } from 'react-router-dom';
import { markNotificationRead, markAllNotificationsRead } from '../api';
import './NotificationPanel.css';

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

function getNotificationIcon(type) {
  switch (type) {
    case 'new_audiobook':
      return (
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/>
          <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>
        </svg>
      );
    case 'new_collection':
      return (
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
        </svg>
      );
    case 'new_review':
      return (
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
        </svg>
      );
    default:
      return (
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
          <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
        </svg>
      );
  }
}

function getNotificationTarget(notification) {
  try {
    const metadata = typeof notification.metadata === 'string'
      ? JSON.parse(notification.metadata)
      : notification.metadata;

    if (metadata?.audiobook_id) {
      return `/audiobook/${metadata.audiobook_id}`;
    }
    if (metadata?.collection_id) {
      return `/collections/${metadata.collection_id}`;
    }
  } catch {
    // metadata parsing failed
  }
  return null;
}

export default function NotificationPanel({ notifications, onClose, onNotificationsUpdated }) {
  const navigate = useNavigate();

  const handleNotificationClick = async (notification) => {
    if (!notification.is_read) {
      try {
        await markNotificationRead(notification.id);
        if (onNotificationsUpdated) onNotificationsUpdated();
      } catch (err) {
        console.error('Failed to mark notification as read:', err);
      }
    }

    const target = getNotificationTarget(notification);
    if (target) {
      navigate(target);
    }
    onClose();
  };

  const handleMarkAllRead = async () => {
    try {
      await markAllNotificationsRead();
      if (onNotificationsUpdated) onNotificationsUpdated();
    } catch (err) {
      console.error('Failed to mark all notifications as read:', err);
    }
  };

  const unreadNotifications = notifications.filter(n => !n.is_read);

  return (
    <div className="notification-panel">
      <div className="notification-panel-header">
        <span className="notification-panel-title">Notifications</span>
        {unreadNotifications.length > 0 && (
          <button
            className="notification-mark-all-read"
            onClick={handleMarkAllRead}
          >
            Mark all read
          </button>
        )}
      </div>

      <div className="notification-panel-list">
        {unreadNotifications.length === 0 ? (
          <div className="notification-empty">
            <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
              <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
            </svg>
            <span>No new notifications</span>
          </div>
        ) : (
          unreadNotifications.map(notification => (
            <button
              key={notification.id}
              className="notification-item unread"
              onClick={() => handleNotificationClick(notification)}
            >
              <div className="notification-item-icon">
                {getNotificationIcon(notification.type)}
              </div>
              <div className="notification-item-content">
                <span className="notification-item-message">{notification.message}</span>
                <span className="notification-item-time">
                  {formatRelativeDate(notification.created_at)}
                </span>
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
