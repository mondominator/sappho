import { useState, useEffect } from 'react';
import { getLibraryStatistics } from '../../api';
import './StatisticsSettings.css';

export default function StatisticsSettings() {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const loadStats = async () => {
    try {
      setLoading(true);
      const result = await getLibraryStatistics();
      setStats(result.data);
      setError(null);
    } catch (err) {
      console.error('Error loading statistics:', err);
      setError('Failed to load statistics');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadStats();
  }, []);

  const formatBytes = (bytes) => {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const formatDuration = (seconds) => {
    if (!seconds || seconds === 0) return '0h';
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    if (hours >= 24) {
      const days = Math.floor(hours / 24);
      const remainingHours = hours % 24;
      return `${days}d ${remainingHours}h`;
    }
    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    }
    return `${minutes}m`;
  };

  const formatDurationHours = (seconds) => {
    if (!seconds) return '0';
    return Math.round(seconds / 3600);
  };

  if (loading) {
    return <div className="loading">Loading statistics...</div>;
  }

  if (error) {
    return (
      <div className="tab-content statistics-settings">
        <div className="error-state">
          <p>{error}</p>
          <button className="btn btn-primary" onClick={loadStats}>Retry</button>
        </div>
      </div>
    );
  }

  return (
    <div className="tab-content statistics-settings">
      <div className="section-header">
        <div>
          <h2>Library Statistics</h2>
          <p className="section-description">
            Storage usage and library analytics overview.
          </p>
        </div>
        <button type="button" className="btn btn-secondary" onClick={loadStats}>
          Refresh
        </button>
      </div>

      {/* Overview Cards */}
      <div className="stats-overview">
        <div className="stat-card">
          <div className="stat-value">{stats.totals.books}</div>
          <div className="stat-label">Total Audiobooks</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{formatBytes(stats.totals.size)}</div>
          <div className="stat-label">Total Storage</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{formatDuration(stats.totals.duration)}</div>
          <div className="stat-label">Total Duration</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{formatDuration(stats.totals.avgDuration)}</div>
          <div className="stat-label">Avg Book Length</div>
        </div>
      </div>

      {/* Storage by Format */}
      <div className="stats-section">
        <h3>Storage by Format</h3>
        <div className="stats-table">
          <table>
            <thead>
              <tr>
                <th>Format</th>
                <th>Count</th>
                <th>Size</th>
                <th>% of Library</th>
              </tr>
            </thead>
            <tbody>
              {stats.byFormat.map((format) => (
                <tr key={format.format}>
                  <td className="format-cell">
                    <span className="format-badge">{format.format?.toUpperCase() || 'Unknown'}</span>
                  </td>
                  <td>{format.count}</td>
                  <td>{formatBytes(format.size)}</td>
                  <td>
                    <div className="progress-bar-container">
                      <div
                        className="progress-bar"
                        style={{ width: `${stats.totals.size > 0 ? (format.size / stats.totals.size) * 100 : 0}%` }}
                      />
                      <span className="progress-text">
                        {stats.totals.size > 0 ? ((format.size / stats.totals.size) * 100).toFixed(1) : 0}%
                      </span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Top Authors */}
      <div className="stats-section">
        <h3>Top Authors by Storage</h3>
        <div className="stats-table">
          <table>
            <thead>
              <tr>
                <th>Author</th>
                <th>Books</th>
                <th>Size</th>
                <th>Duration</th>
              </tr>
            </thead>
            <tbody>
              {stats.topAuthors.map((author, index) => (
                <tr key={author.author || index}>
                  <td>{author.author}</td>
                  <td>{author.count}</td>
                  <td>{formatBytes(author.size)}</td>
                  <td>{formatDurationHours(author.duration)}h</td>
                </tr>
              ))}
              {stats.topAuthors.length === 0 && (
                <tr><td colSpan="4" className="empty-row">No authors found</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Top Series */}
      <div className="stats-section">
        <h3>Top Series by Book Count</h3>
        <div className="stats-table">
          <table>
            <thead>
              <tr>
                <th>Series</th>
                <th>Books</th>
                <th>Size</th>
                <th>Duration</th>
              </tr>
            </thead>
            <tbody>
              {stats.topSeries.map((series, index) => (
                <tr key={series.series || index}>
                  <td>{series.series}</td>
                  <td>{series.count}</td>
                  <td>{formatBytes(series.size)}</td>
                  <td>{formatDurationHours(series.duration)}h</td>
                </tr>
              ))}
              {stats.topSeries.length === 0 && (
                <tr><td colSpan="4" className="empty-row">No series found</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Top Narrators */}
      <div className="stats-section">
        <h3>Top Narrators</h3>
        <div className="stats-table">
          <table>
            <thead>
              <tr>
                <th>Narrator</th>
                <th>Books</th>
                <th>Total Duration</th>
              </tr>
            </thead>
            <tbody>
              {stats.topNarrators.map((narrator, index) => (
                <tr key={narrator.narrator || index}>
                  <td>{narrator.narrator}</td>
                  <td>{narrator.count}</td>
                  <td>{formatDurationHours(narrator.duration)}h</td>
                </tr>
              ))}
              {stats.topNarrators.length === 0 && (
                <tr><td colSpan="3" className="empty-row">No narrators found</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* User Activity */}
      <div className="stats-section">
        <h3>User Activity</h3>
        <div className="stats-table">
          <table>
            <thead>
              <tr>
                <th>User</th>
                <th>Books Started</th>
                <th>Books Completed</th>
                <th>Listen Time</th>
              </tr>
            </thead>
            <tbody>
              {stats.userStats.map((user, index) => (
                <tr key={user.username || index}>
                  <td>{user.username}</td>
                  <td>{user.booksStarted || 0}</td>
                  <td>{user.booksCompleted || 0}</td>
                  <td>{formatDuration(user.totalListenTime)}</td>
                </tr>
              ))}
              {stats.userStats.length === 0 && (
                <tr><td colSpan="4" className="empty-row">No user activity</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Library Growth */}
      {stats.addedOverTime.length > 0 && (
        <div className="stats-section">
          <h3>Library Growth (Last 12 Months)</h3>
          <div className="growth-chart">
            {stats.addedOverTime.map((month) => {
              const maxCount = Math.max(...stats.addedOverTime.map(m => m.count));
              const heightPercent = maxCount > 0 ? (month.count / maxCount) * 100 : 0;
              return (
                <div key={month.month} className="growth-bar-container">
                  <div className="growth-bar" style={{ height: `${heightPercent}%` }}>
                    <span className="growth-count">{month.count}</span>
                  </div>
                  <span className="growth-month">{month.month.slice(5)}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
