import { useState, useEffect } from 'react';
import { getLibraryStatistics } from '../../api';
import './StatisticsSettings.css';

export default function StatisticsSettings() {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadStats();
  }, []);

  const loadStats = async () => {
    try {
      setLoading(true);
      const result = await getLibraryStatistics();
      setStats(result.data);
    } catch (err) {
      console.error('Error loading statistics:', err);
    } finally {
      setLoading(false);
    }
  };

  const formatBytes = (bytes) => {
    if (!bytes) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  const formatDuration = (seconds) => {
    if (!seconds) return '0h';
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    if (hours >= 24) {
      const days = Math.floor(hours / 24);
      return `${days}d ${hours % 24}h`;
    }
    return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
  };

  if (loading) return <div className="stats-loading">Loading...</div>;
  if (!stats) return <div className="stats-loading">Failed to load</div>;

  return (
    <div className="stats-page">
      {/* Overview */}
      <div className="stats-grid">
        <div className="stats-card">
          <span className="stats-number">{stats.totals.books}</span>
          <span className="stats-label">Books</span>
        </div>
        <div className="stats-card">
          <span className="stats-number">{formatBytes(stats.totals.size)}</span>
          <span className="stats-label">Storage</span>
        </div>
        <div className="stats-card">
          <span className="stats-number">{formatDuration(stats.totals.duration)}</span>
          <span className="stats-label">Total Length</span>
        </div>
        <div className="stats-card">
          <span className="stats-number">{formatDuration(stats.totals.avgDuration)}</span>
          <span className="stats-label">Avg Length</span>
        </div>
      </div>

      {/* Formats */}
      <div className="stats-section">
        <h3 className="stats-section-title">By Format</h3>
        <div className="stats-list">
          {stats.byFormat.map((f) => (
            <div key={f.format} className="stats-row">
              <span className="stats-row-label">{f.format?.toUpperCase() || 'Unknown'}</span>
              <span className="stats-row-value">{f.count} · {formatBytes(f.size)}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Top Authors */}
      {stats.topAuthors.length > 0 && (
        <div className="stats-section">
          <h3 className="stats-section-title">Top Authors</h3>
          <div className="stats-list">
            {stats.topAuthors.slice(0, 5).map((a, i) => (
              <div key={a.author || i} className="stats-row">
                <span className="stats-row-label">{a.author}</span>
                <span className="stats-row-value">{a.count} books</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Top Series */}
      {stats.topSeries.length > 0 && (
        <div className="stats-section">
          <h3 className="stats-section-title">Top Series</h3>
          <div className="stats-list">
            {stats.topSeries.slice(0, 5).map((s, i) => (
              <div key={s.series || i} className="stats-row">
                <span className="stats-row-label">{s.series}</span>
                <span className="stats-row-value">{s.count} books</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Top Narrators */}
      {stats.topNarrators.length > 0 && (
        <div className="stats-section">
          <h3 className="stats-section-title">Top Narrators</h3>
          <div className="stats-list">
            {stats.topNarrators.slice(0, 5).map((n, i) => (
              <div key={n.narrator || i} className="stats-row">
                <span className="stats-row-label">{n.narrator}</span>
                <span className="stats-row-value">{n.count} books</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* User Activity */}
      {stats.userStats.length > 0 && (
        <div className="stats-section">
          <h3 className="stats-section-title">User Activity</h3>
          <div className="stats-list">
            {stats.userStats.map((u, i) => (
              <div key={u.username || i} className="stats-row">
                <span className="stats-row-label">{u.username}</span>
                <span className="stats-row-value">{u.booksCompleted || 0} completed · {formatDuration(u.totalListenTime)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
