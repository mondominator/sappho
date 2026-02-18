import { useState, useEffect, useCallback, useRef } from 'react';
import { useWebSocketEvent } from '../contexts/WebSocketContext';
import { getConversionJobs, cancelConversionJob } from '../api';
import './JobsIndicator.css';

function formatElapsed(startTime) {
  const seconds = Math.floor((Date.now() - startTime) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (minutes < 60) return `${minutes}m ${secs}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

export default function JobsIndicator({ user }) {
  const [jobs, setJobs] = useState([]);
  const [completedJobs, setCompletedJobs] = useState([]);
  const [panelState, setPanelState] = useState('hidden'); // 'hidden' | 'badge' | 'compact' | 'expanded'
  const [, forceUpdate] = useState(0);
  const jobStartTimes = useRef(new Map());
  const userDismissedRef = useRef(false);

  // Tick elapsed time every second when panel is visible
  useEffect(() => {
    if (jobs.length === 0 || panelState === 'hidden' || panelState === 'badge') return;
    const interval = setInterval(() => forceUpdate(n => n + 1), 1000);
    return () => clearInterval(interval);
  }, [jobs.length, panelState]);

  // Fetch active jobs on mount
  useEffect(() => {
    if (user?.is_admin) {
      fetchJobs();
    }
  }, [user?.is_admin]);

  const fetchJobs = async () => {
    try {
      const response = await getConversionJobs();
      const activeJobs = response.data.jobs || [];
      setJobs(activeJobs);
      activeJobs.forEach(job => {
        if (!jobStartTimes.current.has(job.jobId)) {
          jobStartTimes.current.set(job.jobId, Date.now());
        }
      });
      if (activeJobs.length > 0 && !userDismissedRef.current) {
        setPanelState('compact');
      }
    } catch (error) {
      // Silent fail on fetch
    }
  };

  // Handle WebSocket job updates
  const handleJobUpdate = useCallback((data) => {
    const job = data.job;
    if (!job) return;

    if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') {
      setJobs(prev => prev.filter(j => j.jobId !== job.jobId));
      setCompletedJobs(prev => {
        if (prev.some(j => j.jobId === job.jobId)) {
          return prev.map(j => j.jobId === job.jobId ? job : j);
        }
        return [...prev, job];
      });

      // Auto-remove completed job after 5 seconds
      setTimeout(() => {
        setCompletedJobs(prev => prev.filter(j => j.jobId !== job.jobId));
        jobStartTimes.current.delete(job.jobId);
      }, 5000);
    } else {
      // Track start time for new jobs
      if (!jobStartTimes.current.has(job.jobId)) {
        jobStartTimes.current.set(job.jobId, Date.now());
      }

      setJobs(prev => {
        const existing = prev.find(j => j.jobId === job.jobId);
        if (existing) {
          return prev.map(j => j.jobId === job.jobId ? job : j);
        }
        return [...prev, job];
      });

      // Auto-show panel for new jobs (unless user explicitly dismissed)
      if (!userDismissedRef.current) {
        setPanelState(prev => prev === 'hidden' ? 'compact' : prev);
      } else {
        // At minimum show badge when user dismissed
        setPanelState(prev => prev === 'hidden' ? 'badge' : prev);
      }
    }
  }, []);

  useWebSocketEvent('job.update', handleJobUpdate);

  // Reset panel when all jobs finish
  useEffect(() => {
    if (jobs.length === 0 && completedJobs.length === 0) {
      setPanelState('hidden');
      userDismissedRef.current = false;
    }
  }, [jobs.length, completedJobs.length]);

  const handleCancel = async (jobId, e) => {
    e.stopPropagation();
    try {
      await cancelConversionJob(jobId);
    } catch (error) {
      // Job will be removed via WebSocket update
    }
  };

  const handleDismiss = (e) => {
    e.stopPropagation();
    userDismissedRef.current = true;
    setPanelState(jobs.length > 0 ? 'badge' : 'hidden');
  };

  const handleGearClick = () => {
    const allJobs = [...jobs, ...completedJobs];
    if (allJobs.length === 0) return;
    if (panelState === 'hidden' || panelState === 'badge') {
      userDismissedRef.current = false;
      setPanelState('compact');
    } else {
      userDismissedRef.current = true;
      setPanelState('badge');
    }
  };

  const handlePanelClick = () => {
    if (panelState === 'compact') {
      setPanelState('expanded');
    }
  };

  const handleMinimize = (e) => {
    e.stopPropagation();
    setPanelState('compact');
  };

  const allJobs = [...jobs, ...completedJobs];
  if (!user?.is_admin || allJobs.length === 0) {
    return null;
  }

  const activeCount = jobs.length;
  const showBadge = panelState === 'badge' || panelState === 'hidden';

  return (
    <>
      {/* Gear icon button in navbar */}
      <div className="jobs-indicator">
        <button
          className={`jobs-indicator-button ${activeCount > 0 ? 'has-active' : ''}`}
          onClick={handleGearClick}
          title={`${activeCount} active job${activeCount !== 1 ? 's' : ''}`}
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2v4" />
            <path d="m16.2 7.8 2.9-2.9" />
            <path d="M18 12h4" />
            <path d="m16.2 16.2 2.9 2.9" />
            <path d="M12 18v4" />
            <path d="m4.9 19.1 2.9-2.9" />
            <path d="M2 12h4" />
            <path d="m4.9 4.9 2.9 2.9" />
          </svg>
          {showBadge && activeCount > 0 && (
            <span className="jobs-badge">{activeCount}</span>
          )}
        </button>
      </div>

      {/* Floating progress panel */}
      {(panelState === 'compact' || panelState === 'expanded') && (
        <div
          className={`jobs-panel ${panelState} ${panelState === 'compact' ? 'jobs-panel-slide-in' : ''}`}
          onClick={panelState === 'compact' ? handlePanelClick : undefined}
          role={panelState === 'compact' ? 'button' : undefined}
          tabIndex={panelState === 'compact' ? 0 : undefined}
        >
          {/* Header */}
          <div className="jobs-panel-header">
            <span className="jobs-panel-title">
              {activeCount > 0
                ? `${activeCount} conversion${activeCount !== 1 ? 's' : ''} running`
                : 'Jobs complete'}
            </span>
            <div className="jobs-panel-actions">
              {panelState === 'expanded' && (
                <button
                  className="jobs-panel-btn"
                  onClick={handleMinimize}
                  title="Minimize"
                  aria-label="Minimize panel"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="6 15 12 9 18 15" />
                  </svg>
                </button>
              )}
              <button
                className="jobs-panel-btn"
                onClick={handleDismiss}
                title="Dismiss"
                aria-label="Dismiss panel"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
          </div>

          {/* Job list */}
          <div className="jobs-panel-list">
            {allJobs.map(job => {
              const isFinished = job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled';
              const startTime = jobStartTimes.current.get(job.jobId);
              const elapsed = startTime ? formatElapsed(startTime) : '';

              return (
                <div
                  key={job.jobId}
                  className={`jobs-panel-item ${isFinished ? `jobs-panel-item-${job.status}` : ''}`}
                >
                  <div className="jobs-panel-item-info">
                    <div className="jobs-panel-item-title">
                      {job.audiobookTitle || 'Conversion'}
                    </div>
                    {panelState === 'expanded' && (
                      <div className="jobs-panel-item-detail">
                        <span className="jobs-panel-item-message">
                          {isFinished ? (
                            <span className={`jobs-panel-status jobs-panel-status-${job.status}`}>
                              {job.status === 'completed' ? 'Completed' : job.status === 'failed' ? 'Failed' : 'Cancelled'}
                            </span>
                          ) : (
                            job.message || 'Processing...'
                          )}
                        </span>
                        {!isFinished && elapsed && (
                          <span className="jobs-panel-item-elapsed">{elapsed}</span>
                        )}
                      </div>
                    )}
                  </div>

                  {!isFinished && (
                    <div className="jobs-panel-item-progress-row">
                      <div className="jobs-panel-progress-bar">
                        <div
                          className="jobs-panel-progress-fill"
                          style={{ width: `${job.progress || 0}%` }}
                        />
                      </div>
                      <span className="jobs-panel-progress-pct">{job.progress || 0}%</span>
                    </div>
                  )}

                  {panelState === 'expanded' && !isFinished && (
                    <button
                      className="jobs-panel-cancel"
                      onClick={(e) => handleCancel(job.jobId, e)}
                      title="Cancel conversion"
                    >
                      Cancel
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}
