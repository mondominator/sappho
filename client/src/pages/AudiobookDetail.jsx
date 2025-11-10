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
      <button className="btn btn-secondary back-button" onClick={() => navigate(-1)}>
        ← Back to Library
      </button>

      <div className="detail-content">
        <div className="detail-cover-container">
          <div className="detail-cover">
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
          </div>

          {audiobook.description && (
            <div className="detail-description">
              <h3>About</h3>
              <p>{audiobook.description}</p>
            </div>
          )}

          <div className="detail-actions">
            <button
              className="btn btn-primary btn-large"
              onClick={() => onPlay(audiobook, progress)}
            >
              {progress && progress.position > 0 ? 'Resume' : 'Play'}
            </button>
            <button
              className="btn btn-secondary"
              onClick={handleDownload}
            >
              Download
            </button>
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
              className="btn btn-danger"
              onClick={handleDelete}
            >
              Delete
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
