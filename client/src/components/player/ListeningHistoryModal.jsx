import { useState, useEffect } from 'react';
import { getListeningSessions } from '../../api';

function formatPosition(seconds) {
  if (seconds == null) return '--:--:--';
  const totalSeconds = Math.floor(seconds);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function formatDuration(seconds) {
  if (seconds == null || seconds <= 0) return '0 min';
  const minutes = Math.round(seconds / 60);
  if (minutes < 1) return '<1 min';
  if (minutes >= 60) {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }
  return `${minutes} min`;
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now - date;
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) {
    return `Today at ${date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
  }
  if (diffDays === 1) {
    return `Yesterday at ${date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
  }
  if (diffDays < 7) {
    return `${date.toLocaleDateString([], { weekday: 'long' })} at ${date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
  }
  return date.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export default function ListeningHistoryModal({ audiobookId, onSeek, onClose }) {
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    async function fetchSessions() {
      try {
        setLoading(true);
        setError(null);
        const response = await getListeningSessions(audiobookId, 50);
        if (!cancelled) {
          setSessions(response.data.sessions || response.data || []);
        }
      } catch (err) {
        if (!cancelled) {
          setError('Failed to load listening history');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }
    fetchSessions();
    return () => { cancelled = true; };
  }, [audiobookId]);

  const handleEntryClick = (session) => {
    onSeek(session.start_position);
    onClose();
  };

  return (
    <div className="listening-history-modal" onClick={onClose}>
      <div className="listening-history-content" onClick={(e) => e.stopPropagation()}>
        <div className="listening-history-header">
          <h3>Listening History</h3>
          <button className="listening-history-close" onClick={onClose} aria-label="Close history">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>

        <div className="listening-history-list">
          {loading && (
            <div className="listening-history-empty">Loading...</div>
          )}

          {error && (
            <div className="listening-history-empty">{error}</div>
          )}

          {!loading && !error && sessions.length === 0 && (
            <div className="listening-history-empty">No listening sessions yet</div>
          )}

          {!loading && !error && sessions.map((session) => (
            <button
              key={session.id}
              className="listening-history-entry"
              onClick={() => handleEntryClick(session)}
            >
              <div className="listening-history-date">
                {formatDate(session.started_at)}
              </div>
              <div className="listening-history-positions">
                {formatPosition(session.start_position)}
                {' → '}
                {session.stopped_at
                  ? formatPosition(session.end_position)
                  : <span className="listening-history-in-progress">In progress</span>
                }
              </div>
              <div className="listening-history-meta">
                <span className="listening-history-duration">
                  {formatDuration(session.duration_seconds)}
                </span>
                {session.client_name && (
                  <span className="listening-history-device">{session.client_name}</span>
                )}
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
