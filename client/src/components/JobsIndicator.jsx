import { useState, useEffect, useCallback, useRef } from 'react';
import { useWebSocketEvent } from '../contexts/WebSocketContext';
import { getConversionJobs, cancelConversionJob } from '../api';
import './JobsIndicator.css';

export default function JobsIndicator({ user }) {
  const [jobs, setJobs] = useState([]);
  const [completedJobs, setCompletedJobs] = useState([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const dropdownRef = useRef(null);

  // Fetch active jobs on mount
  useEffect(() => {
    if (user?.is_admin) {
      fetchJobs();
    }
  }, [user?.is_admin]);

  const fetchJobs = async () => {
    try {
      const response = await getConversionJobs();
      setJobs(response.data.jobs || []);
    } catch (error) {
      console.error('Failed to fetch conversion jobs:', error);
    }
  };

  // Handle WebSocket job updates
  const handleJobUpdate = useCallback((data) => {
    const job = data.job;
    if (!job) return;

    if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') {
      // Move to completed jobs
      setJobs(prev => prev.filter(j => j.jobId !== job.jobId));
      setCompletedJobs(prev => {
        // Don't add duplicates
        if (prev.some(j => j.jobId === job.jobId)) {
          return prev.map(j => j.jobId === job.jobId ? job : j);
        }
        return [...prev, job];
      });

      // Auto-remove completed job after 3 seconds
      setTimeout(() => {
        setCompletedJobs(prev => prev.filter(j => j.jobId !== job.jobId));
      }, 3000);
    } else {
      // Update or add active job
      setJobs(prev => {
        const existing = prev.find(j => j.jobId === job.jobId);
        if (existing) {
          return prev.map(j => j.jobId === job.jobId ? job : j);
        }
        return [...prev, job];
      });
    }
  }, []);

  useWebSocketEvent('job.update', handleJobUpdate);

  // Click outside to close dropdown
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (showDropdown && dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showDropdown]);

  const handleCancel = async (jobId, e) => {
    e.stopPropagation();
    try {
      await cancelConversionJob(jobId);
      // Job will be removed via WebSocket update
    } catch (error) {
      console.error('Failed to cancel job:', error);
    }
  };

  const getStatusBadgeClass = (status) => {
    switch (status) {
      case 'completed': return 'job-status-completed';
      case 'failed': return 'job-status-failed';
      case 'cancelled': return 'job-status-cancelled';
      default: return '';
    }
  };

  // Only render for admin users with active or recently completed jobs
  const allJobs = [...jobs, ...completedJobs];
  if (!user?.is_admin || allJobs.length === 0) {
    return null;
  }

  const activeCount = jobs.length;

  return (
    <div className="jobs-indicator" ref={dropdownRef}>
      <button
        className="jobs-indicator-button"
        onClick={() => setShowDropdown(!showDropdown)}
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
        {activeCount > 0 && (
          <span className="jobs-badge">{activeCount}</span>
        )}
      </button>

      {showDropdown && (
        <div className="jobs-dropdown">
          <div className="jobs-dropdown-header">
            Background Jobs
          </div>
          {allJobs.map(job => (
            <div key={job.jobId} className="job-item">
              <div className="job-info">
                <div className="job-title">{job.audiobookTitle || 'Conversion'}</div>
                <div className="job-message">
                  {job.message || job.status}
                  {(job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') && (
                    <span className={`job-status-badge ${getStatusBadgeClass(job.status)}`}>
                      {job.status}
                    </span>
                  )}
                </div>
                {job.status !== 'completed' && job.status !== 'failed' && job.status !== 'cancelled' && (
                  <div className="job-progress-bar">
                    <div
                      className="job-progress-fill"
                      style={{ width: `${job.progress || 0}%` }}
                    />
                  </div>
                )}
              </div>
              {job.status !== 'completed' && job.status !== 'failed' && job.status !== 'cancelled' && (
                <button
                  className="job-cancel"
                  onClick={(e) => handleCancel(job.jobId, e)}
                  title="Cancel job"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
