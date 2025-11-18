import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getAudiobook, getCoverUrl, getProgress, getDownloadUrl, deleteAudiobook, markFinished, clearProgress, getChapters } from '../api';
import './AudiobookDetail.css';

export default function AudiobookDetail({ onPlay }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const [audiobook, setAudiobook] = useState(null);
  const [progress, setProgress] = useState(null);
  const [chapters, setChapters] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showChapters, setShowChapters] = useState(false);

  useEffect(() => {
    loadAudiobook();
  }, [id]);

  const loadAudiobook = async () => {
    try {
      const [bookResponse, progressResponse, chaptersResponse] = await Promise.all([
        getAudiobook(id),
        getProgress(id),
        getChapters(id).catch(() => ({ data: [] })) // Chapters might not exist
      ]);
      setAudiobook(bookResponse.data);
      setProgress(progressResponse.data);
      setChapters(chaptersResponse.data || []);
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

    let cleaned = description;

    // Remove Opening Credits / End Credits
    cleaned = cleaned.replace(/^(\s*(Opening|End)\s+Credits\s*)+/i, '');
    cleaned = cleaned.replace(/(\s*(Opening|End)\s+Credits\s*)+$/i, '');

    // Pattern 1: "Chapter One Chapter Two..." or "Chapter Twenty-One..." (word-based with optional hyphens)
    cleaned = cleaned.replace(/^(\s*Chapter\s+([A-Z][a-z]+(-[A-Z][a-z]+)*)\s*)+/i, '');

    // Pattern 2: "CHAPTER ONE CHAPTER TWO CHAPTER THREE..." (all caps word-based)
    cleaned = cleaned.replace(/^(\s*CHAPTER\s+[A-Z]+(\s+[A-Z]+)*\s*)+/i, '');

    // Pattern 3: "CHAPTER 1 CHAPTER 2 CHAPTER 3..." (number-based)
    cleaned = cleaned.replace(/^(\s*CHAPTER\s+\d+\s*)+/i, '');

    // Pattern 4: "Chapter One, Chapter Two, Chapter Three..." (comma-separated)
    cleaned = cleaned.replace(/^(\s*Chapter\s+[A-Za-z]+(\s+[A-Za-z]+)?,?\s*)+/i, '');

    // Pattern 5: "Ch. 1, Ch. 2, Ch. 3..." (abbreviated)
    cleaned = cleaned.replace(/^(\s*Ch\.\s*\d+,?\s*)+/i, '');

    // Pattern 6: Just numbers separated by spaces/commas at the start
    cleaned = cleaned.replace(/^(\s*\d+[,\s]+)+/, '');

    // Clean up any remaining Opening/End Credits
    cleaned = cleaned.replace(/^(\s*(Opening|End)\s+Credits\s*)+/i, '');
    cleaned = cleaned.replace(/(\s*(Opening|End)\s+Credits\s*)+$/i, '');

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
            {progress && progress.position > 0 && (
              <>
                {!progress.completed && (
                  <button
                    className="btn btn-success"
                    onClick={handleMarkFinished}
                  >
                    Mark Finished
                  </button>
                )}
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

            {audiobook.file_path && (
              <div className="meta-item">
                <span className="meta-label">Filename</span>
                <span className="meta-value file-path" title={audiobook.file_path}>
                  {audiobook.file_path.split('/').pop()}
                </span>
              </div>
            )}

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

          {chapters && chapters.length > 0 && (() => {
            // Separate chapters from audio tracks
            const audioTracks = chapters.filter(ch => ch.file_path);
            const embeddedChapters = chapters.filter(ch => !ch.file_path);
            const totalChapters = audioTracks.length + embeddedChapters.length;

            return (
              <div className="detail-chapters-container">
                <button
                  className="chapters-toggle-btn"
                  onClick={() => setShowChapters(!showChapters)}
                >
                  <div className="chapters-toggle-content">
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="8" y1="6" x2="21" y2="6"></line>
                      <line x1="8" y1="12" x2="21" y2="12"></line>
                      <line x1="8" y1="18" x2="21" y2="18"></line>
                      <line x1="3" y1="6" x2="3.01" y2="6"></line>
                      <line x1="3" y1="12" x2="3.01" y2="12"></line>
                      <line x1="3" y1="18" x2="3.01" y2="18"></line>
                    </svg>
                    <span>
                      {audioTracks.length > 0 && embeddedChapters.length > 0
                        ? `${totalChapters} Tracks & Chapters`
                        : audioTracks.length > 0
                          ? `${audioTracks.length} Audio Track${audioTracks.length !== 1 ? 's' : ''}`
                          : `${embeddedChapters.length} Chapter${embeddedChapters.length !== 1 ? 's' : ''}`
                      }
                    </span>
                  </div>
                  <svg
                    className={`chapters-toggle-icon ${showChapters ? 'open' : ''}`}
                    xmlns="http://www.w3.org/2000/svg"
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polyline points="6 9 12 15 18 9"></polyline>
                  </svg>
                </button>

                {showChapters && (
                  <>
                    {audioTracks.length > 0 && (
                      <div className="detail-chapters">
                        <h3>Audio Tracks</h3>
                    <div className="chapters-list">
                      {audioTracks.map((track, index) => (
                        <div
                          key={track.id || index}
                          className="chapter-item clickable"
                          onClick={(e) => {
                            e.stopPropagation();
                            console.log('Track clicked:', track.title, 'Index:', index);
                            if (!onPlay) {
                              console.error('onPlay function not available');
                              return;
                            }
                            // Calculate start time based on previous track durations
                            let startTime = 0;
                            for (let i = 0; i < index; i++) {
                              startTime += audioTracks[i].duration || 0;
                            }
                            console.log('Starting playback at:', startTime);
                            // Create a modified progress object with the chapter start time
                            const chapterProgress = { ...progress, position: startTime };
                            onPlay(audiobook, chapterProgress);
                          }}
                        >
                          <div className="chapter-info">
                            <div className="chapter-title">{track.title || `Track ${index + 1}`}</div>
                            <div className="chapter-meta">
                              {track.duration && (
                                <span className="chapter-duration">{formatDuration(track.duration)}</span>
                              )}
                              {track.file_path && track.duration && <span className="meta-separator">•</span>}
                              {track.file_path && (
                                <span className="chapter-filename">{track.file_path.split('/').pop()}</span>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                      </div>
                    )}

                    {embeddedChapters.length > 0 && (
                      <div className="detail-chapters">
                        <h3>Chapters</h3>
                        <div className="chapters-list">
                          {embeddedChapters.map((chapter, index) => (
                            <div
                              key={chapter.id || index}
                              className="chapter-item clickable"
                              onClick={(e) => {
                                e.stopPropagation();
                                console.log('Chapter clicked:', chapter.title, 'Index:', index);
                                if (!onPlay) {
                                  console.error('onPlay function not available');
                                  return;
                                }
                                // If chapter has start_time, use it; otherwise calculate from durations
                                let startTime = chapter.start_time || 0;
                                if (!chapter.start_time) {
                                  // Calculate based on previous chapter durations
                                  for (let i = 0; i < index; i++) {
                                    startTime += embeddedChapters[i].duration || 0;
                                  }
                                }
                                console.log('Starting playback at:', startTime);
                                // Create a modified progress object with the chapter start time
                                const chapterProgress = { ...progress, position: startTime };
                                onPlay(audiobook, chapterProgress);
                              }}
                            >
                              <div className="chapter-info">
                                <div className="chapter-title">{chapter.title || `Chapter ${index + 1}`}</div>
                                {chapter.duration && (
                                  <div className="chapter-meta">
                                    <span className="chapter-duration">{formatDuration(chapter.duration)}</span>
                                  </div>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            );
          })()}
        </div>
      </div>
    </div>
  );
}
