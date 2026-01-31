import { useDownload } from '../contexts/DownloadContext';
import { formatBytes } from '../services/offlineStorage';
import './DownloadButton.css';

/**
 * Download Button Component
 *
 * Displays different states based on download status:
 * - Not downloaded: "Download" button with download icon
 * - Queued: "Queued (#N)" with queue position, cancel option
 * - Downloading: Progress bar, pause button, percentage
 * - Paused: Resume/cancel buttons
 * - Completed: "Downloaded" with checkmark, delete option
 * - Error: "Retry" button, error message
 *
 * @param {Object} props
 * @param {Object} props.audiobook - Audiobook object with id, title, author, duration, file_size, etc.
 */
export default function DownloadButton({ audiobook }) {
  const {
    getDownloadStatus,
    downloadBook,
    pauseDownload,
    resumeDownload,
    cancelDownload,
    deleteDownload,
    isReady,
    downloads
  } = useDownload();

  if (!audiobook || !audiobook.id) {
    return null;
  }

  const status = getDownloadStatus(audiobook.id);

  // Calculate queue position for queued downloads
  const getQueuePosition = () => {
    if (!status || status.status !== 'queued') return 0;

    const queuedDownloads = Object.values(downloads)
      .filter(d => d.status === 'queued')
      .sort((a, b) => new Date(a.startedAt) - new Date(b.startedAt));

    const position = queuedDownloads.findIndex(d => String(d.id) === String(audiobook.id));
    return position >= 0 ? position + 1 : 0;
  };

  const handleDownload = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    await downloadBook(audiobook);
  };

  const handlePause = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    await pauseDownload(audiobook.id);
  };

  const handleResume = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    await resumeDownload(audiobook.id);
  };

  const handleCancel = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    await cancelDownload(audiobook.id);
  };

  const handleDelete = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (window.confirm(`Remove downloaded file for "${audiobook.title}"?`)) {
      await deleteDownload(audiobook.id);
    }
  };

  const handleRetry = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    // Delete failed download and start fresh
    await deleteDownload(audiobook.id);
    await downloadBook(audiobook);
  };

  // Not ready yet - show disabled state
  if (!isReady) {
    return (
      <div className="download-button download-button--disabled">
        <span className="download-button__icon">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
        </span>
        <span className="download-button__text">Download</span>
      </div>
    );
  }

  // Not downloaded - show download button
  if (!status) {
    return (
      <button
        className="download-button download-button--available"
        onClick={handleDownload}
        title={`Download ${audiobook.title}${audiobook.file_size ? ` (${formatBytes(audiobook.file_size)})` : ''}`}
      >
        <span className="download-button__icon">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
        </span>
        <span className="download-button__text">Download</span>
        {audiobook.file_size && (
          <span className="download-button__size">{formatBytes(audiobook.file_size)}</span>
        )}
      </button>
    );
  }

  // Queued - show queue position with cancel option
  if (status.status === 'queued') {
    const queuePosition = getQueuePosition();
    return (
      <div className="download-button download-button--queued">
        <span className="download-button__icon">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <polyline points="12 6 12 12 16 14" />
          </svg>
        </span>
        <span className="download-button__text">
          Queued{queuePosition > 0 ? ` (#${queuePosition})` : ''}
        </span>
        <button
          className="download-button__action"
          onClick={handleCancel}
          title="Cancel download"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>
    );
  }

  // Downloading - show progress bar with pause button
  if (status.status === 'downloading') {
    const progressPercent = Math.round((status.progress || 0) * 100);
    return (
      <div className="download-button download-button--downloading">
        <div className="download-button__progress-container">
          <div className="download-button__progress-header">
            <span className="download-button__progress-text">
              Downloading... {progressPercent}%
            </span>
            <button
              className="download-button__action"
              onClick={handlePause}
              title="Pause download"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none">
                <rect x="6" y="4" width="4" height="16" />
                <rect x="14" y="4" width="4" height="16" />
              </svg>
            </button>
          </div>
          <div className="download-button__progress-bar">
            <div
              className="download-button__progress-fill"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
          {status.bytesDownloaded > 0 && status.totalBytes > 0 && (
            <span className="download-button__progress-bytes">
              {formatBytes(status.bytesDownloaded)} / {formatBytes(status.totalBytes)}
            </span>
          )}
        </div>
      </div>
    );
  }

  // Paused - show resume and cancel buttons
  if (status.status === 'paused') {
    const progressPercent = Math.round((status.progress || 0) * 100);
    return (
      <div className="download-button download-button--paused">
        <div className="download-button__progress-container">
          <div className="download-button__progress-header">
            <span className="download-button__progress-text">
              Paused ({progressPercent}%)
            </span>
            <div className="download-button__actions">
              <button
                className="download-button__action download-button__action--resume"
                onClick={handleResume}
                title="Resume download"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none">
                  <polygon points="5 3 19 12 5 21 5 3" />
                </svg>
              </button>
              <button
                className="download-button__action download-button__action--cancel"
                onClick={handleCancel}
                title="Cancel download"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
          </div>
          <div className="download-button__progress-bar download-button__progress-bar--paused">
            <div
              className="download-button__progress-fill download-button__progress-fill--paused"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>
      </div>
    );
  }

  // Completed - show downloaded status with delete option
  if (status.status === 'completed') {
    return (
      <div className="download-button download-button--completed">
        <span className="download-button__icon">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="none">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
          </svg>
        </span>
        <span className="download-button__text">Downloaded</span>
        <button
          className="download-button__action download-button__action--delete"
          onClick={handleDelete}
          title="Remove download"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
          </svg>
        </button>
      </div>
    );
  }

  // Error - show retry button with error message
  if (status.status === 'error') {
    return (
      <div className="download-button download-button--error">
        <span className="download-button__icon">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="none">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z" />
          </svg>
        </span>
        <span className="download-button__text download-button__text--error">
          Failed
        </span>
        <button
          className="download-button__action download-button__action--retry"
          onClick={handleRetry}
          title="Retry download"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 2v6h-6M3 12a9 9 0 0 1 15-6.7L21 8M3 22v-6h6M21 12a9 9 0 0 1-15 6.7L3 16" />
          </svg>
        </button>
        {status.error && (
          <span className="download-button__error-message" title={status.error}>
            {status.error.length > 30 ? status.error.substring(0, 30) + '...' : status.error}
          </span>
        )}
      </div>
    );
  }

  // Fallback - shouldn't reach here
  return null;
}
