import { useState, useEffect } from 'react';
import { getServerLogs } from '../../api';
import './LogsSettings.css';

// Log category configuration with colors and labels
const LOG_CATEGORIES = {
  error: { label: 'Error', color: '#ef4444', bgColor: 'rgba(239, 68, 68, 0.15)' },
  success: { label: 'Success', color: '#22c55e', bgColor: 'rgba(34, 197, 94, 0.1)' },
  warning: { label: 'Warning', color: '#f59e0b', bgColor: 'rgba(245, 158, 11, 0.1)' },
  job: { label: 'Job', color: '#8b5cf6', bgColor: 'rgba(139, 92, 246, 0.1)' },
  library: { label: 'Library', color: '#06b6d4', bgColor: 'rgba(6, 182, 212, 0.1)' },
  websocket: { label: 'WebSocket', color: '#ec4899', bgColor: 'rgba(236, 72, 153, 0.1)' },
  auth: { label: 'Auth', color: '#f97316', bgColor: 'rgba(249, 115, 22, 0.1)' },
  system: { label: 'System', color: '#3b82f6', bgColor: 'rgba(59, 130, 246, 0.1)' },
  info: { label: 'Info', color: '#9ca3af', bgColor: 'transparent' },
};

export default function LogsSettings() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [logFilter, setLogFilter] = useState('all');

  const loadLogs = async () => {
    try {
      const result = await getServerLogs(200);
      setLogs(result.data.logs);
    } catch (error) {
      console.error('Error loading logs:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadLogs();
  }, []);

  useEffect(() => {
    let interval = null;
    if (autoRefresh) {
      interval = setInterval(loadLogs, 2000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [autoRefresh]);

  // Filter and reverse so newest logs appear at top
  const filteredLogs = logs
    .filter(log => {
      if (logFilter === 'all') return true;
      const category = log.level === 'error' ? 'error' : (log.category || 'info');
      return category === logFilter;
    })
    .slice()
    .reverse();

  if (loading) {
    return <div className="loading">Loading logs...</div>;
  }

  return (
    <div className="tab-content logs-settings">
      <div className="section-header">
        <div>
          <h2>Server Logs</h2>
          <p className="section-description">
            View recent server activity including scan progress, errors, and system events.
          </p>
        </div>
        <div className="header-actions">
          <label className="checkbox-inline">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
            />
            <span>Auto-refresh</span>
          </label>
          <button type="button" className="btn btn-secondary" onClick={loadLogs}>
            Refresh
          </button>
        </div>
      </div>

      {/* Log Category Filter */}
      <div className="log-category-key">
        <button
          className={`log-category-btn ${logFilter === 'all' ? 'active' : ''}`}
          onClick={() => setLogFilter('all')}
        >
          All
        </button>
        {Object.entries(LOG_CATEGORIES).map(([key, config]) => (
          <button
            key={key}
            className={`log-category-btn ${logFilter === key ? 'active' : ''}`}
            style={{ '--category-color': config.color }}
            onClick={() => setLogFilter(key)}
          >
            <span className="log-category-dot" style={{ background: config.color }} />
            {config.label}
          </button>
        ))}
      </div>

      <div className="logs-container">
        {filteredLogs.length === 0 ? (
          <div className="logs-empty">
            {logFilter === 'all' ? 'No logs available' : `No ${LOG_CATEGORIES[logFilter]?.label || logFilter} logs found`}
          </div>
        ) : (
          <div className="logs-list">
            {filteredLogs.map((log, index) => {
              const category = log.level === 'error' ? 'error' : (log.category || 'info');
              const config = LOG_CATEGORIES[category] || LOG_CATEGORIES.info;
              return (
                <div
                  key={index}
                  className="log-entry"
                  style={{
                    background: config.bgColor,
                    borderLeft: `3px solid ${config.color}`,
                  }}
                >
                  <span className="log-time">
                    {new Date(log.timestamp).toLocaleTimeString()}
                  </span>
                  <span
                    className="log-category-tag"
                    style={{ color: config.color }}
                  >
                    {config.label}
                  </span>
                  <span className="log-message" style={{ color: log.level === 'error' ? '#fca5a5' : '#d1d5db' }}>
                    {log.message}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="logs-stats">
        <span>Showing {filteredLogs.length} of {logs.length} logs</span>
      </div>
    </div>
  );
}
