import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDownload } from '../contexts/DownloadContext';
import { getStorageEstimate, formatBytes } from '../services/offlineStorage';
import { getCoverUrl } from '../api';
import './Downloads.css';

/**
 * Downloads Page - Offline Download Manager
 *
 * Shows:
 * - Storage usage bar
 * - Active/queued downloads with controls
 * - Completed downloads with delete option
 */
export default function Downloads() {
  const navigate = useNavigate();
  const {
    downloads,
    isReady,
    pauseDownload,
    resumeDownload,
    cancelDownload,
    deleteDownload
  } = useDownload();

  const [storage, setStorage] = useState({
    usage: 0,
    quota: 0,
    usageFormatted: '0 Bytes',
    quotaFormatted: 'Unknown',
    percentUsed: 0
  });

  // Load storage estimate on mount and when downloads change
  useEffect(() => {
    const loadStorage = async () => {
      try {
        const estimate = await getStorageEstimate();
        setStorage(estimate);
      } catch (error) {
        console.error('Failed to get storage estimate:', error);
      }
    };

    loadStorage();
  }, [downloads]);

  // Group downloads by status
  const groupedDownloads = Object.values(downloads).reduce(
    (acc, download) => {
      const status = download.status;
      if (status === 'downloading') {
        acc.active.push(download);
      } else if (status === 'paused') {
        acc.paused.push(download);
      } else if (status === 'queued') {
        acc.queued.push(download);
      } else if (status === 'completed') {
        acc.completed.push(download);
      } else if (status === 'error') {
        acc.error.push(download);
      }
      return acc;
    },
    { active: [], paused: [], queued: [], completed: [], error: [] }
  );

  // Calculate available storage
  const availableBytes = storage.quota - storage.usage;
  const availableFormatted = formatBytes(availableBytes);

  // Handle delete confirmation
  const handleDelete = async (audiobookId, title) => {
    if (confirm(`Delete "${title}" from offline storage?`)) {
      await deleteDownload(audiobookId);
    }
  };

  // Handle cancel confirmation
  const handleCancel = async (audiobookId, title) => {
    if (confirm(`Cancel download of "${title}"?`)) {
      await cancelDownload(audiobookId);
    }
  };

  if (!isReady) {
    return (
      <div className="downloads-page">
        <div className="downloads-loading">
          <div className="loading-spinner"></div>
          <p>Loading downloads...</p>
        </div>
      </div>
    );
  }

  const hasActiveDownloads = groupedDownloads.active.length > 0 ||
    groupedDownloads.paused.length > 0 ||
    groupedDownloads.queued.length > 0 ||
    groupedDownloads.error.length > 0;

  const hasCompletedDownloads = groupedDownloads.completed.length > 0;
  const hasNoDownloads = !hasActiveDownloads && !hasCompletedDownloads;

  return (
    <div className="downloads-page">
      {/* Storage Bar */}
      <div className="storage-card">
        <div className="storage-header">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="storage-icon">
            <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
            <polyline points="3.29 7 12 12 20.71 7" />
            <line x1="12" y1="22" x2="12" y2="12" />
          </svg>
          <div className="storage-text">
            <span className="storage-used">{storage.usageFormatted}</span>
            <span className="storage-separator"> used of </span>
            <span className="storage-available">{availableFormatted} available</span>
          </div>
        </div>
        <div className="storage-bar">
          <div
            className="storage-bar-fill"
            style={{ width: `${Math.min(storage.percentUsed, 100)}%` }}
          ></div>
        </div>
      </div>

      {/* Empty State */}
      {hasNoDownloads && (
        <div className="downloads-empty">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
          <h3>No downloads</h3>
          <p>Browse your library to download books for offline listening.</p>
          <button className="btn-browse" onClick={() => navigate('/library')}>
            Browse Library
          </button>
        </div>
      )}

      {/* Active Downloads Section */}
      {hasActiveDownloads && (
        <div className="downloads-section">
          <h2 className="section-title">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            Downloading
          </h2>

          {/* Active Download */}
          {groupedDownloads.active.map((download) => (
            <DownloadItem
              key={download.id}
              download={download}
              onPause={() => pauseDownload(download.id)}
              onCancel={() => handleCancel(download.id, download.title)}
            />
          ))}

          {/* Paused Downloads */}
          {groupedDownloads.paused.map((download) => (
            <DownloadItem
              key={download.id}
              download={download}
              onResume={() => resumeDownload(download.id)}
              onCancel={() => handleCancel(download.id, download.title)}
            />
          ))}

          {/* Error Downloads */}
          {groupedDownloads.error.map((download) => (
            <DownloadItem
              key={download.id}
              download={download}
              onCancel={() => handleCancel(download.id, download.title)}
            />
          ))}

          {/* Queued Downloads */}
          {groupedDownloads.queued
            .sort((a, b) => new Date(a.startedAt) - new Date(b.startedAt))
            .map((download, index) => (
            <DownloadItem
              key={download.id}
              download={download}
              queuePosition={index + 1}
              onCancel={() => handleCancel(download.id, download.title)}
            />
          ))}
        </div>
      )}

      {/* Completed Downloads Section */}
      {hasCompletedDownloads && (
        <div className="downloads-section">
          <h2 className="section-title">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
              <polyline points="22 4 12 14.01 9 11.01" />
            </svg>
            Downloaded
            <span className="section-count">{groupedDownloads.completed.length}</span>
          </h2>

          <div className="completed-grid">
            {groupedDownloads.completed.map((download) => (
              <CompletedItem
                key={download.id}
                download={download}
                onDelete={() => handleDelete(download.id, download.title)}
                onClick={() => navigate(`/audiobook/${download.id}`)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Active/Queued Download Item
 */
function DownloadItem({ download, queuePosition, onPause, onResume, onCancel }) {
  const { id, title, author, status, progress, bytesDownloaded, totalBytes, error, coverUrl } = download;

  const progressPercent = Math.round((progress || 0) * 100);
  const downloadedFormatted = formatBytes(bytesDownloaded || 0);
  const totalFormatted = totalBytes ? formatBytes(totalBytes) : 'Unknown';

  return (
    <div className="download-item">
      <div className="download-cover">
        <img
          src={coverUrl || getCoverUrl(id)}
          alt={title}
          onError={(e) => { e.target.style.display = 'none'; }}
        />
        <div className="download-cover-placeholder">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
            <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
          </svg>
        </div>
      </div>

      <div className="download-info">
        <h4 className="download-title">{title}</h4>
        <p className="download-author">{author}</p>

        {status === 'downloading' && (
          <div className="download-progress">
            <div className="progress-bar">
              <div className="progress-fill" style={{ width: `${progressPercent}%` }}></div>
            </div>
            <span className="progress-text">{progressPercent}% - {downloadedFormatted} / {totalFormatted}</span>
          </div>
        )}

        {status === 'paused' && (
          <div className="download-progress paused">
            <div className="progress-bar">
              <div className="progress-fill" style={{ width: `${progressPercent}%` }}></div>
            </div>
            <span className="progress-text">Paused - {downloadedFormatted} / {totalFormatted}</span>
          </div>
        )}

        {status === 'queued' && (
          <div className="download-status queued">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
            <span>In queue{queuePosition ? ` (#${queuePosition})` : ''}</span>
          </div>
        )}

        {status === 'error' && (
          <div className="download-status error">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <span>{error || 'Download failed'}</span>
          </div>
        )}
      </div>

      <div className="download-actions">
        {status === 'downloading' && onPause && (
          <button className="action-btn pause" onClick={onPause} title="Pause">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="6" y="4" width="4" height="16" />
              <rect x="14" y="4" width="4" height="16" />
            </svg>
          </button>
        )}

        {status === 'paused' && onResume && (
          <button className="action-btn resume" onClick={onResume} title="Resume">
            <svg viewBox="0 0 24 24" fill="currentColor">
              <polygon points="5 3 19 12 5 21 5 3" />
            </svg>
          </button>
        )}

        {onCancel && (
          <button className="action-btn cancel" onClick={onCancel} title="Cancel">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Completed Download Item (Grid)
 */
function CompletedItem({ download, onDelete, onClick }) {
  const { id, title, author, bytesDownloaded, coverUrl } = download;

  const sizeFormatted = formatBytes(bytesDownloaded || 0);

  return (
    <div className="completed-item" onClick={onClick}>
      <div className="completed-cover">
        <img
          src={coverUrl || getCoverUrl(id)}
          alt={title}
          onError={(e) => { e.target.style.display = 'none'; }}
        />
        <div className="completed-cover-placeholder">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
            <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
          </svg>
        </div>
        <div className="offline-badge">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
            <polyline points="22 4 12 14.01 9 11.01" />
          </svg>
        </div>
        <button
          className="delete-btn"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          title="Delete download"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
          </svg>
        </button>
      </div>
      <div className="completed-info">
        <h4 className="completed-title">{title}</h4>
        <p className="completed-author">{author}</p>
        <span className="completed-size">{sizeFormatted}</span>
      </div>
    </div>
  );
}
