import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getAudiobook, getCoverUrl, getProgress, getDownloadUrl, deleteAudiobook, markFinished, clearProgress } from '../api';
import './AudiobookDetail.css';

export default function AudiobookDetail({ onPlay }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const [audiobook, setAudiobook] = useState(null);
  const [progress, setProgress] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadAudiobook();
  }, [id]);

  const loadAudiobook = async () => {
    try {
      const [bookResponse, progressResponse] = await Promise.all([
        getAudiobook(id),
        getProgress(id)
      ]);
      setAudiobook(bookResponse.data);
      setProgress(progressResponse.data);
    } catch (error) {
      console.error('Error loading audiobook:', error);
    } finally {
      setLoading(false);
    }
  };

  const formatDuration = (seconds) => {
    if (!seconds) return 'Unknown';
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return `${hours}h ${minutes}m`;
  };

  const formatLastListened = (timestamp) => {
    if (!timestamp) return 'Never';
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    // Handle timestamps in the future or just now
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins} minute${diffMins !== 1 ? 's' : ''} ago`;
    if (diffHours < 24) return `${diffHours} hour${diffHours !== 1 ? 's' : ''} ago`;
    if (diffDays < 7) return `${diffDays} day${diffDays !== 1 ? 's' : ''} ago`;
    return date.toLocaleDateString();
  };

  const cleanDescription = (description) => {
    if (!description) return '';

    // Remove various chapter listing patterns from the beginning
    let cleaned = description;

    // Pattern 1: "CHAPTER ONE CHAPTER TWO CHAPTER THREE..." (word-based)
    cleaned = cleaned.replace(/^(\s*CHAPTER\s+[A-Z]+(\s+[A-Z]+)*\s*)+/i, '');

    // Pattern 2: "CHAPTER 1 CHAPTER 2 CHAPTER 3..." (number-based)
    cleaned = cleaned.replace(/^(\s*CHAPTER\s+\d+\s*)+/i, '');

    // Pattern 3: "Chapter One, Chapter Two, Chapter Three..." (comma-separated)
    cleaned = cleaned.replace(/^(\s*Chapter\s+[A-Za-z]+(\s+[A-Za-z]+)?,?\s*)+/i, '');

    // Pattern 4: "Ch. 1, Ch. 2, Ch. 3..." (abbreviated)
    cleaned = cleaned.replace(/^(\s*Ch\.\s*\d+,?\s*)+/i, '');

    // Pattern 5: Just numbers separated by spaces/commas at the start
    cleaned = cleaned.replace(/^(\s*\d+[,\s]+)+/, '');

    return cleaned.trim();
  };

  const getProgressPercentage = () => {
    if (!progress || !audiobook || !audiobook.duration) return 0;
    return Math.round((progress.position / audiobook.duration) * 100);
  };

  const handleDownload = () => {
    window.location.href = getDownloadUrl(audiobook.id);
  };

  const handleDelete = async () => {
    if (!confirm(`Delete "${audiobook.title}"? This action cannot be undone.`)) return;

    try {
      await deleteAudiobook(audiobook.id);
      alert('Audiobook deleted successfully');
      navigate('/');
    } catch (error) {
      alert('Failed to delete audiobook');
      console.error('Error deleting audiobook:', error);
    }
  };

  const handleMarkFinished = async () => {
    try {
      await markFinished(audiobook.id);
      await loadAudiobook(); // Reload to show updated progress
    } catch (error) {
      alert('Failed to mark as finished');
      console.error('Error marking as finished:', error);
    }
  };

  const handleClearProgress = async () => {
    if (!confirm('Clear all progress for this audiobook?')) return;

    try {
      await clearProgress(audiobook.id);
      await loadAudiobook(); // Reload to show updated progress
    } catch (error) {
      alert('Failed to clear progress');
      console.error('Error clearing progress:', error);
    }
  };

  if (loading) {
    return <div className="loading">Loading audiobook...</div>;
  }

  if (!audiobook) {
    return <div className="error">Audiobook not found</div>;
  }

  return (
    <div className="audiobook-detail container">
      <button className="back-button-modern" onClick={() => navigate(-1)}>
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M19 12H5M12 19l-7-7 7-7"/>
        </svg>
        Back
      </button>

      <div className="detail-content">
        <div className="detail-cover-container">
          <div className="detail-cover" onClick={() => onPlay(audiobook, progress)}>
            {audiobook.cover_image ? (
              <img
                src={getCoverUrl(audiobook.id)}
                alt={audiobook.title}
                onError={(e) => e.target.src = '/placeholder-cover.png'}
              />
            ) : (
              <div className="cover-placeholder">
                <h3>{audiobook.title}</h3>
              </div>
            )}
            <div className="cover-play-overlay">
              <div className="cover-play-button">
                <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="currentColor" stroke="none">
                  <polygon points="6 3 20 12 6 21 6 3"></polygon>
                </svg>
              </div>
            </div>
            {progress && progress.position > 0 && (
              <div className="cover-progress-overlay">
                <div
                  className="cover-progress-fill"
                  style={{ width: `${getProgressPercentage()}%` }}
                ></div>
              </div>
            )}
          </div>
        </div>

        <div className="detail-info">
          <h1 className="detail-title">{audiobook.title}</h1>

          <div className="detail-actions">
            {progress && progress.position > 0 && !progress.completed && (
              <>
                <button
                  className="btn btn-success"
                  onClick={handleMarkFinished}
                >
                  Mark Finished
                </button>
                <button
                  className="btn btn-warning"
                  onClick={handleClearProgress}
                >
                  Clear Progress
                </button>
              </>
            )}
            <button
              className="btn btn-secondary"
              onClick={handleDownload}
            >
              Download
            </button>
            <button
              className="btn btn-danger"
              onClick={handleDelete}
            >
              Delete
            </button>
          </div>

          <div className="detail-metadata">
            {audiobook.author && (
              <div className="meta-item">
                <span className="meta-label">Author</span>
                <span
                  className="meta-value author-link"
                  onClick={() => navigate(`/author/${encodeURIComponent(audiobook.author)}`)}
                >
                  {audiobook.author}
                </span>
              </div>
            )}

            {audiobook.narrator && (
              <div className="meta-item">
                <span className="meta-label">Narrator</span>
                <span className="meta-value">{audiobook.narrator}</span>
              </div>
            )}

            {audiobook.series && (
              <div className="meta-item">
                <span className="meta-label">Series</span>
                <span
                  className="meta-value series-link"
                  onClick={() => navigate(`/series/${encodeURIComponent(audiobook.series)}`)}
                >
                  {audiobook.series}
                  {audiobook.series_position && ` #${audiobook.series_position}`}
                </span>
              </div>
            )}

            {audiobook.genre && (
              <div className="meta-item">
                <span className="meta-label">Genre</span>
                <span className="meta-value">{audiobook.genre}</span>
              </div>
            )}

            {audiobook.published_year && (
              <div className="meta-item">
                <span className="meta-label">Published</span>
                <span className="meta-value">{audiobook.published_year}</span>
              </div>
            )}

            <div className="meta-item">
              <span className="meta-label">Duration</span>
              <span className="meta-value">{formatDuration(audiobook.duration)}</span>
            </div>

            {progress && progress.position > 0 && (
              <>
                <div className="meta-item">
                  <span className="meta-label">Progress</span>
                  <span className="meta-value">
                    {formatDuration(progress.position)} / {formatDuration(audiobook.duration)} ({getProgressPercentage()}%)
                  </span>
                </div>
                <div className="meta-item">
                  <span className="meta-label">Last Listened</span>
                  <span className="meta-value">{formatLastListened(progress.updated_at)}</span>
                </div>
              </>
            )}
          </div>

          {audiobook.description && cleanDescription(audiobook.description) && (
            <div className="detail-description">
              <h3>About</h3>
              <p>{cleanDescription(audiobook.description)}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
