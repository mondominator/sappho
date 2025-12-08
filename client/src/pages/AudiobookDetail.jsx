import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import axios from 'axios';
import { getAudiobook, getCoverUrl, getProgress, getDownloadUrl, deleteAudiobook, markFinished, clearProgress, getChapters, getDirectoryFiles, getProfile, toggleFavorite, getRating, setRating, getAverageRating, refreshMetadata } from '../api';
import EditMetadataModal from '../components/EditMetadataModal';
import AddToCollectionModal from '../components/AddToCollectionModal';
import StarRating from '../components/StarRating';
import './AudiobookDetail.css';

export default function AudiobookDetail({ onPlay }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const [audiobook, setAudiobook] = useState(null);
  const [progress, setProgress] = useState(null);
  const [chapters, setChapters] = useState([]);
  const [directoryFiles, setDirectoryFiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showChapters, setShowChapters] = useState(false);
  const [showFiles, setShowFiles] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isFavorite, setIsFavorite] = useState(false);
  const [showCollectionModal, setShowCollectionModal] = useState(false);
  const [userRating, setUserRating] = useState(null);
  const [averageRating, setAverageRating] = useState(null);
  const [recap, setRecap] = useState(null);
  const [recapLoading, setRecapLoading] = useState(false);
  const [recapError, setRecapError] = useState(null);
  const [recapExpanded, setRecapExpanded] = useState(false);
  const [aiConfigured, setAiConfigured] = useState(false);
  const [refreshingMetadata, setRefreshingMetadata] = useState(false);

  useEffect(() => {
    const checkAdminStatus = async () => {
      try {
        const response = await getProfile();
        setIsAdmin(!!response.data.is_admin);
      } catch (error) {
        console.error('Error checking admin status:', error);
      }
    };
    checkAdminStatus();
  }, []);

  useEffect(() => {
    loadAudiobook();
    checkAiStatus();
    // Reset recap state when book changes
    setRecap(null);
    setRecapExpanded(false);
    setRecapError(null);
  }, [id]);

  const checkAiStatus = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await axios.get('/api/settings/ai/status', {
        headers: { Authorization: `Bearer ${token}` }
      });
      setAiConfigured(response.data.configured);
    } catch (error) {
      console.error('Error checking AI status:', error);
      setAiConfigured(false);
    }
  };

  const loadAudiobook = async () => {
    try {
      const [bookResponse, progressResponse, chaptersResponse, filesResponse, ratingResponse, avgRatingResponse] = await Promise.all([
        getAudiobook(id),
        getProgress(id),
        getChapters(id).catch(() => ({ data: [] })),
        getDirectoryFiles(id).catch(() => ({ data: [] })),
        getRating(id).catch(() => ({ data: null })),
        getAverageRating(id).catch(() => ({ data: null }))
      ]);
      setAudiobook(bookResponse.data);
      setProgress(progressResponse.data);
      setChapters(chaptersResponse.data || []);
      setDirectoryFiles(filesResponse.data || []);
      setIsFavorite(!!bookResponse.data.is_favorite);
      setUserRating(ratingResponse.data?.rating || null);
      setAverageRating(avgRatingResponse.data);
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

  const formatFileSize = (bytes) => {
    if (!bytes) return 'Unknown';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  };

  const cleanDescription = (description) => {
    if (!description) return '';
    let cleaned = description;
    cleaned = cleaned.replace(/^(\s*(Opening|End)\s+Credits\s*)+/i, '');
    cleaned = cleaned.replace(/(\s*(Opening|End)\s+Credits\s*)+$/i, '');
    cleaned = cleaned.replace(/^(\s*Chapter\s+([A-Z][a-z]+(-[A-Z][a-z]+)*)\s*)+/i, '');
    cleaned = cleaned.replace(/^(\s*CHAPTER\s+[A-Z]+(\s+[A-Z]+)*\s*)+/i, '');
    cleaned = cleaned.replace(/^(\s*CHAPTER\s+\d+\s*)+/i, '');
    cleaned = cleaned.replace(/^(\s*Chapter\s+[A-Za-z]+(\s+[A-Za-z]+)?,?\s*)+/i, '');
    cleaned = cleaned.replace(/^(\s*Ch\.\s*\d+,?\s*)+/i, '');
    cleaned = cleaned.replace(/^(\s*\d+[,\s]+)+/, '');
    cleaned = cleaned.replace(/^(\s*-\d+-?\s*)+/, '');
    cleaned = cleaned.replace(/^(\s*\d+[.)]\s*)+/, '');
    cleaned = cleaned.replace(/^(\s*(Track\s+)?\d+(\s*-\s*|\s+))+/i, '');
    return cleaned.trim();
  };

  const getProgressPercentage = () => {
    if (!progress || !audiobook || !audiobook.duration) return 0;
    return Math.round((progress.position / audiobook.duration) * 100);
  };

  const getCurrentChapter = () => {
    if (!chapters.length || !progress || progress.completed === 1) return null;
    for (let i = chapters.length - 1; i >= 0; i--) {
      const chapter = chapters[i];
      const startTime = chapter.start_time !== undefined ? chapter.start_time :
        chapters.slice(0, i).reduce((sum, ch) => sum + (ch.duration || 0), 0);
      if (progress.position >= startTime) {
        return { chapter, index: i };
      }
    }
    return { chapter: chapters[0], index: 0 };
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
    }
  };

  const handleMarkFinished = async () => {
    try {
      await markFinished(audiobook.id);
      await loadAudiobook();
    } catch (error) {
      alert('Failed to mark as finished');
    }
  };

  const handleClearProgress = async () => {
    if (!confirm('Clear all progress for this audiobook?')) return;
    try {
      await clearProgress(audiobook.id);
      await loadAudiobook();
    } catch (error) {
      alert('Failed to clear progress');
    }
  };

  const handlePlay = () => {
    const isMobile = window.innerWidth <= 768;
    onPlay(audiobook, progress, isMobile);
  };

  const handleChapterClick = (chapter, index) => {
    const startTime = chapter.start_time !== undefined ? chapter.start_time :
      chapters.slice(0, index).reduce((sum, ch) => sum + (ch.duration || 0), 0);
    const chapterProgress = { ...progress, position: startTime };
    onPlay(audiobook, chapterProgress);
  };

  const handleToggleFavorite = async () => {
    try {
      const response = await toggleFavorite(audiobook.id);
      setIsFavorite(response.data.is_favorite);
    } catch (error) {
      console.error('Error toggling favorite:', error);
    }
  };

  const handleRatingChange = async (newRating) => {
    try {
      await setRating(audiobook.id, newRating, null);
      setUserRating(newRating);
      // Refresh average rating after user rates
      const avgResponse = await getAverageRating(audiobook.id);
      setAverageRating(avgResponse.data);
    } catch (error) {
      console.error('Error setting rating:', error);
    }
  };

  const handleRefreshMetadata = async () => {
    if (refreshingMetadata) return;
    setRefreshingMetadata(true);
    try {
      await refreshMetadata(audiobook.id);
      await loadAudiobook();
    } catch (error) {
      console.error('Error refreshing metadata:', error);
      alert('Failed to refresh metadata');
    } finally {
      setRefreshingMetadata(false);
    }
  };

  const loadRecap = async () => {
    setRecapLoading(true);
    setRecapError(null);

    try {
      const token = localStorage.getItem('token');
      const response = await axios.get(`/api/audiobooks/${id}/recap`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setRecap(response.data);
      setRecapExpanded(true);
    } catch (error) {
      console.error('Error loading recap:', error);
      setRecapError(error.response?.data?.message || error.response?.data?.error || 'Failed to generate recap');
    } finally {
      setRecapLoading(false);
    }
  };

  const clearRecapCache = async () => {
    try {
      const token = localStorage.getItem('token');
      await axios.delete(`/api/audiobooks/${id}/recap`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setRecap(null);
      loadRecap();
    } catch (error) {
      console.error('Error clearing recap cache:', error);
    }
  };

  if (loading) {
    return <div className="loading">Loading audiobook...</div>;
  }

  if (!audiobook) {
    return <div className="error">Audiobook not found</div>;
  }

  const hasProgress = progress && (progress.position > 0 || progress.completed === 1);
  const isCompleted = progress?.completed === 1;
  const currentChapterInfo = getCurrentChapter();

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
          <div className="detail-cover" onClick={handlePlay}>
            {audiobook.cover_image ? (
              <img
                src={getCoverUrl(audiobook.id, audiobook.updated_at)}
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
            {hasProgress && (
              <div className="cover-progress-overlay">
                <div
                  className={`cover-progress-fill ${isCompleted ? 'completed' : ''}`}
                  style={{ width: isCompleted ? '100%' : `${getProgressPercentage()}%` }}
                ></div>
              </div>
            )}
          </div>

          {/* Rating Section - Under Cover */}
          <div className="detail-rating-section">
            <StarRating
              rating={userRating}
              onRate={handleRatingChange}
              size="medium"
              showLabel={false}
            />
            <div className="rating-info">
              {userRating ? (
                <span className="your-rating-label">Your rating</span>
              ) : (
                <span className="tap-to-rate">Tap to rate</span>
              )}
              {averageRating && averageRating.count > 0 && (
                <>
                  <span className="rating-separator"> · </span>
                  <span className="average-rating">
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="#fbbf24" stroke="none">
                      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
                    </svg>
                    {averageRating.average?.toFixed(1)} ({averageRating.count})
                  </span>
                </>
              )}
            </div>
          </div>

          {/* Mobile Play Button */}
          <button className="detail-play-button" onClick={handlePlay}>
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="currentColor" stroke="none">
              <polygon points="6 3 20 12 6 21 6 3"></polygon>
            </svg>
            {progress?.position > 0 && !isCompleted ? 'Continue' : 'Play'}
          </button>

          {/* Chapters dropdown */}
          {chapters.length > 0 && (
            <div className="detail-chapters-container">
              <button className="chapters-toggle-btn" onClick={() => setShowChapters(!showChapters)}>
                <div className="chapters-toggle-content">
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="8" y1="6" x2="21" y2="6"></line>
                    <line x1="8" y1="12" x2="21" y2="12"></line>
                    <line x1="8" y1="18" x2="21" y2="18"></line>
                    <line x1="3" y1="6" x2="3.01" y2="6"></line>
                    <line x1="3" y1="12" x2="3.01" y2="12"></line>
                    <line x1="3" y1="18" x2="3.01" y2="18"></line>
                  </svg>
                  <span>{chapters.length} Chapter{chapters.length !== 1 ? 's' : ''}</span>
                </div>
                <svg className={`chapters-toggle-icon ${showChapters ? 'open' : ''}`} xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="6 9 12 15 18 9"></polyline>
                </svg>
              </button>

              {showChapters && (
                <div className="detail-chapters">
                  <div className="chapters-list">
                    {chapters.map((chapter, index) => (
                      <div key={chapter.id || index} className="chapter-item clickable" onClick={() => handleChapterClick(chapter, index)}>
                        <div className="chapter-info">
                          <div className="chapter-title">{chapter.title || `Chapter ${index + 1}`}</div>
                          <div className="chapter-meta">
                            {chapter.duration && <span className="chapter-duration">{formatDuration(chapter.duration)}</span>}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Files dropdown */}
          {directoryFiles.length > 0 && (
            <div className="detail-chapters-container">
              <button className="chapters-toggle-btn" onClick={() => setShowFiles(!showFiles)}>
                <div className="chapters-toggle-content">
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"></path>
                    <polyline points="13 2 13 9 20 9"></polyline>
                  </svg>
                  <span>{directoryFiles.length} File{directoryFiles.length !== 1 ? 's' : ''}</span>
                </div>
                <svg className={`chapters-toggle-icon ${showFiles ? 'open' : ''}`} xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="6 9 12 15 18 9"></polyline>
                </svg>
              </button>

              {showFiles && (
                <div className="detail-chapters">
                  <div className="chapters-list">
                    {directoryFiles.map((file, index) => (
                      <div key={index} className="chapter-item">
                        <div className="chapter-info">
                          <div className="chapter-title">{file.name}</div>
                          <div className="chapter-meta">
                            <span className="chapter-duration">{formatFileSize(file.size)}</span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Mobile Progress Section */}
          {hasProgress && (
            <div className="mobile-progress-section">
              <h3 className="mobile-section-title">Progress</h3>
              <div className="mobile-progress-card">
                <div className="mobile-progress-header">
                  <div className="mobile-progress-info">
                    {isCompleted ? (
                      <span className="mobile-progress-completed">Completed</span>
                    ) : (
                      <>
                        <span className="mobile-progress-time">{formatDuration(progress.position)} listened</span>
                        <span className="mobile-progress-total">of {formatDuration(audiobook.duration)} total</span>
                      </>
                    )}
                  </div>
                  {!isCompleted && <span className="mobile-progress-percent">{getProgressPercentage()}%</span>}
                </div>
                {!isCompleted && (
                  <div className="mobile-progress-bar">
                    <div className="mobile-progress-fill" style={{ width: `${getProgressPercentage()}%` }} />
                  </div>
                )}
                {currentChapterInfo && !isCompleted && (
                  <div className="mobile-current-chapter">
                    <div className="mobile-chapter-info">
                      <span className="mobile-chapter-label">Current Chapter</span>
                      <span className="mobile-chapter-title">{currentChapterInfo.chapter.title || `Chapter ${currentChapterInfo.index + 1}`}</span>
                    </div>
                    <span className="mobile-chapter-position">{currentChapterInfo.index + 1} of {chapters.length}</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Catch Me Up Section */}
          {aiConfigured && hasProgress && (
            <div className="catch-me-up-section">
              {!recap && !recapLoading && !recapError && (
                <button className="catch-me-up-button" onClick={loadRecap}>
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/>
                    <polyline points="14 2 14 8 20 8"/>
                    <line x1="16" y1="13" x2="8" y2="13"/>
                    <line x1="16" y1="17" x2="8" y2="17"/>
                    <line x1="10" y1="9" x2="8" y2="9"/>
                  </svg>
                  Catch Me Up
                </button>
              )}

              {recapLoading && (
                <div className="recap-loading">
                  <div className="recap-spinner"></div>
                  <span>Generating your personalized recap...</span>
                </div>
              )}

              {recapError && (
                <div className="recap-error">
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10"/>
                    <line x1="12" y1="8" x2="12" y2="12"/>
                    <line x1="12" y1="16" x2="12.01" y2="16"/>
                  </svg>
                  <span>{recapError}</span>
                  <button className="retry-button" onClick={loadRecap}>Try Again</button>
                </div>
              )}

              {recap && (
                <div className={`recap-container ${recapExpanded ? 'expanded' : ''}`}>
                  <div className="recap-header" onClick={() => setRecapExpanded(!recapExpanded)}>
                    <div className="recap-header-left">
                      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/>
                        <polyline points="14 2 14 8 20 8"/>
                        <line x1="16" y1="13" x2="8" y2="13"/>
                        <line x1="16" y1="17" x2="8" y2="17"/>
                        <line x1="10" y1="9" x2="8" y2="9"/>
                      </svg>
                      <span>Book Recap</span>
                      {recap.cached && (
                        <span className="cached-badge">Cached</span>
                      )}
                    </div>
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="20"
                      height="20"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className={`expand-icon ${recapExpanded ? 'expanded' : ''}`}
                    >
                      <polyline points="6 9 12 15 18 9"/>
                    </svg>
                  </div>

                  {recapExpanded && (
                    <div className="recap-content">
                      {recap.priorBooks && recap.priorBooks.length > 0 && (
                        <div className="recap-books-included">
                          <span>Based on prior books: </span>
                          {recap.priorBooks.map((book, i) => (
                            <span key={book.id} className="book-tag">
                              {book.position ? `#${book.position} ` : ''}{book.title}
                              {i < recap.priorBooks.length - 1 && ', '}
                            </span>
                          ))}
                        </div>
                      )}
                      <div className="recap-text">
                        {recap.recap.split('\n\n').map((paragraph, i) => (
                          <p key={i}>{paragraph}</p>
                        ))}
                      </div>
                      <div className="recap-actions">
                        <button className="recap-action-btn" onClick={clearRecapCache}>
                          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M21 2v6h-6M3 12a9 9 0 0 1 15-6.7L21 8M3 22v-6h6M21 12a9 9 0 0 1-15 6.7L3 16"/>
                          </svg>
                          Regenerate
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="detail-info">
          <div className="detail-title-row">
            <h1 className="detail-title">{audiobook.title}</h1>
            {/* Catch Me Up Button - Desktop only, next to title */}
            {aiConfigured && hasProgress && !recap && !recapLoading && !recapError && (
              <button className="catch-me-up-inline" onClick={loadRecap}>
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/>
                  <polyline points="14 2 14 8 20 8"/>
                  <line x1="16" y1="13" x2="8" y2="13"/>
                  <line x1="16" y1="17" x2="8" y2="17"/>
                  <line x1="10" y1="9" x2="8" y2="9"/>
                </svg>
                Catch Me Up
              </button>
            )}
            {aiConfigured && recapLoading && (
              <div className="catch-me-up-inline loading">
                <div className="recap-spinner-small"></div>
                <span>Generating...</span>
              </div>
            )}
          </div>

          {/* Desktop Recap Container - Shown inline after title when expanded */}
          {aiConfigured && (recap || recapError) && (
            <div className="desktop-recap-section">
              {recapError && (
                <div className="recap-error">
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10"/>
                    <line x1="12" y1="8" x2="12" y2="12"/>
                    <line x1="12" y1="16" x2="12.01" y2="16"/>
                  </svg>
                  <span>{recapError}</span>
                  <button className="retry-button" onClick={loadRecap}>Try Again</button>
                </div>
              )}

              {recap && (
                <div className={`recap-container ${recapExpanded ? 'expanded' : ''}`}>
                  <div className="recap-header" onClick={() => setRecapExpanded(!recapExpanded)}>
                    <div className="recap-header-left">
                      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/>
                        <polyline points="14 2 14 8 20 8"/>
                        <line x1="16" y1="13" x2="8" y2="13"/>
                        <line x1="16" y1="17" x2="8" y2="17"/>
                        <line x1="10" y1="9" x2="8" y2="9"/>
                      </svg>
                      <span>Book Recap</span>
                      {recap.cached && (
                        <span className="cached-badge">Cached</span>
                      )}
                    </div>
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="20"
                      height="20"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className={`expand-icon ${recapExpanded ? 'expanded' : ''}`}
                    >
                      <polyline points="6 9 12 15 18 9"/>
                    </svg>
                  </div>

                  {recapExpanded && (
                    <div className="recap-content">
                      {recap.priorBooks && recap.priorBooks.length > 0 && (
                        <div className="recap-books-included">
                          <span>Based on prior books: </span>
                          {recap.priorBooks.map((book, i) => (
                            <span key={book.id} className="book-tag">
                              {book.position ? `#${book.position} ` : ''}{book.title}
                              {i < recap.priorBooks.length - 1 && ', '}
                            </span>
                          ))}
                        </div>
                      )}
                      <div className="recap-text">
                        {recap.recap.split('\n\n').map((paragraph, i) => (
                          <p key={i}>{paragraph}</p>
                        ))}
                      </div>
                      <div className="recap-actions">
                        <button className="recap-action-btn" onClick={clearRecapCache}>
                          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M21 2v6h-6M3 12a9 9 0 0 1 15-6.7L21 8M3 22v-6h6M21 12a9 9 0 0 1-15 6.7L3 16"/>
                          </svg>
                          Regenerate
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          <div className="detail-actions">
            <button
              className={`btn btn-favorite ${isFavorite ? 'active' : ''}`}
              onClick={handleToggleFavorite}
              title={isFavorite ? 'Remove from reading list' : 'Add to reading list'}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"></path>
                <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"></path>
              </svg>
              {isFavorite ? 'On List' : 'Read Later'}
            </button>
            <button
              className="btn btn-collection"
              onClick={() => setShowCollectionModal(true)}
              title="Add to collection"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
                <line x1="12" y1="11" x2="12" y2="17"></line>
                <line x1="9" y1="14" x2="15" y2="14"></line>
              </svg>
              Collection
            </button>
            {isAdmin && (
              <button className="btn btn-primary" onClick={() => setShowEditModal(true)}>Edit</button>
            )}
            <button className="btn btn-success" onClick={handleMarkFinished}>Mark Finished</button>
            {hasProgress && (
              <button className="btn btn-warning" onClick={handleClearProgress}>Clear Progress</button>
            )}
            <button className="btn btn-secondary" onClick={handleDownload}>Download</button>
            <button
              className={`btn btn-refresh ${refreshingMetadata ? 'loading' : ''}`}
              onClick={handleRefreshMetadata}
              disabled={refreshingMetadata}
              title="Re-scan file and update metadata"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={refreshingMetadata ? 'spinning' : ''}>
                <path d="M21 2v6h-6M3 12a9 9 0 0 1 15-6.7L21 8M3 22v-6h6M21 12a9 9 0 0 1-15 6.7L3 16"/>
              </svg>
              {refreshingMetadata ? 'Refreshing...' : 'Refresh'}
            </button>
            <button className="btn btn-danger" onClick={handleDelete}>Delete</button>
          </div>

          <div className="detail-metadata">
            {audiobook.author && (
              <div className="meta-item">
                <span className="meta-label">Author</span>
                <span className="meta-value author-link" onClick={() => navigate(`/author/${encodeURIComponent(audiobook.author)}`)}>{audiobook.author}</span>
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
                <span className="meta-value series-link" onClick={() => navigate(`/series/${encodeURIComponent(audiobook.series)}`)}>
                  {audiobook.series}{audiobook.series_position && ` #${audiobook.series_position}`}
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
                <span className="meta-label">Format</span>
                <span className="meta-value">{audiobook.file_path.split('.').pop().toUpperCase()}</span>
              </div>
            )}
            {progress && progress.position > 0 && (
              <div className="meta-item">
                <span className="meta-label">Progress</span>
                <span className="meta-value">{formatDuration(progress.position)} / {formatDuration(audiobook.duration)} ({getProgressPercentage()}%)</span>
              </div>
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

      <EditMetadataModal
        isOpen={showEditModal}
        onClose={() => setShowEditModal(false)}
        audiobook={audiobook}
        onSave={loadAudiobook}
      />

      <AddToCollectionModal
        isOpen={showCollectionModal}
        onClose={() => setShowCollectionModal(false)}
        audiobookId={audiobook.id}
        audiobookTitle={audiobook.title}
      />
    </div>
  );
}
