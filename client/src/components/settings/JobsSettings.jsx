import { useState, useEffect } from 'react';
import { getBackgroundJobs } from '../../api';
import './JobsSettings.css';

export default function JobsSettings() {
  const [jobs, setJobs] = useState(null);
  const [loading, setLoading] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(true);

  const loadJobs = async () => {
    try {
      const result = await getBackgroundJobs();
      setJobs(result.data.jobs);
    } catch (error) {
      console.error('Error loading jobs:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadJobs();
  }, []);

  useEffect(() => {
    let interval = null;
    if (autoRefresh) {
      interval = setInterval(loadJobs, 5000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [autoRefresh]);

  if (loading) {
    return <div className="loading">Loading jobs...</div>;
  }

  return (
    <div className="tab-content jobs-settings">
      <div className="section-header">
        <div>
          <h2>Background Jobs</h2>
          <p className="section-description">
            Monitor scheduled background tasks and their status.
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
          <button type="button" className="btn btn-secondary" onClick={loadJobs}>
            Refresh
          </button>
        </div>
      </div>

      {jobs ? (
        <div className="jobs-grid">
          {Object.entries(jobs).map(([key, job]) => (
            <div key={key} className={`job-card ${job.status}`}>
              <div className="job-header">
                <span className="job-name">{job.name}</span>
                <span className={`job-status-badge ${job.status}`}>
                  {job.status === 'running' ? '● Running' : job.status === 'locked' ? '◐ Locked' : '○ Idle'}
                </span>
              </div>
              <p className="job-description">{job.description}</p>
              <div className="job-details">
                <div className="job-detail">
                  <span className="job-detail-label">Interval:</span>
                  <span className="job-detail-value">{job.interval}</span>
                </div>
                {job.lastRun && (
                  <div className="job-detail">
                    <span className="job-detail-label">Last Run:</span>
                    <span className="job-detail-value">{new Date(job.lastRun).toLocaleString()}</span>
                  </div>
                )}
                {job.nextRun && job.status === 'idle' && (
                  <div className="job-detail">
                    <span className="job-detail-label">Next Run:</span>
                    <span className="job-detail-value">{new Date(job.nextRun).toLocaleString()}</span>
                  </div>
                )}
                {job.lastResult && (
                  <div className="job-detail">
                    <span className="job-detail-label">Last Result:</span>
                    <span className="job-detail-value">
                      {job.lastResult.error
                        ? `Error: ${job.lastResult.error}`
                        : `${job.lastResult.imported || 0} imported, ${job.lastResult.skipped || 0} skipped`
                      }
                    </span>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="empty-state">
          <p>No background jobs found.</p>
        </div>
      )}
    </div>
  );
}
