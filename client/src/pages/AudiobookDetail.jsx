import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import axios from 'axios';
import { getAudiobook, getCoverUrl, getProgress, getDownloadUrl, deleteAudiobook, markFinished, clearProgress, getChapters, getDirectoryFiles, getProfile, toggleFavorite, refreshMetadata, convertToM4B } from '../api';
import EditMetadataModal from '../components/EditMetadataModal';
import AddToCollectionModal from '../components/AddToCollectionModal';
import RatingSection from '../components/RatingSection';
import { useRecap, RecapTrigger, RecapContent } from '../components/RecapSection';
import { AudiobookDetailSkeleton } from '../components/Skeleton';
import { formatDuration, formatFileSize, cleanDescription } from '../utils/formatting';
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
  const [aiConfigured, setAiConfigured] = useState(false);
  const [refreshingMetadata, setRefreshingMetadata] = useState(false);
  const [converting, setConverting] = useState(false);
  const [narratorIndex, setNarratorIndex] = useState(0);
  const [showMenu, setShowMenu] = useState(false);
  const [descriptionExpanded, setDescriptionExpanded] = useState(false);
  const [isDescriptionTruncated, setIsDescriptionTruncated] = useState(false);
  const descriptionRef = useRef(null);
  const chaptersModalRef = useRef(null);

  const recapState = useRecap({ audiobookId: id, aiConfigured, progress });

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
    // Reset state when book changes
    setNarratorIndex(0);
    setDescriptionExpanded(false);
  }, [id]);

  // Auto-cycle through narrators
  useEffect(() => {
    if (!audiobook?.narrator) return;
    const narrators = audiobook.narrator.split(/,\s*(?=(?:[^"]*"[^"]*")*[^"]*$)/).map(n => n.trim()).filter(n => n);
    if (narrators.length <= 1) return;

    const interval = setInterval(() => {
      setNarratorIndex((prev) => (prev + 1) % narrators.length);
    }, 3000); // Change every 3 seconds

    return () => clearInterval(interval);
  }, [audiobook?.narrator]);

  // Check if description text is truncated (needs Show more button)
  useEffect(() => {
    if (descriptionRef.current) {
      const el = descriptionRef.current;
      setIsDescriptionTruncated(el.scrollHeight > el.clientHeight + 1);
    }
  }, [audiobook?.description, descriptionExpanded]);

  // Focus trap for chapters modal
  useEffect(() => {
    if (!showChapters || !chaptersModalRef.current) return;

    const modal = chaptersModalRef.current;
    const focusableSelector = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        setShowChapters(false);
        return;
      }
      if (e.key !== 'Tab') return;

      const focusable = modal.querySelectorAll(focusableSelector);
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    // Focus the close button when modal opens
    const closeBtn = modal.querySelector('.chapters-modal-close');
    if (closeBtn) closeBtn.focus();

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [showChapters]);

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
      const [bookResponse, progressResponse, chaptersResponse, filesResponse] = await Promise.all([
        getAudiobook(id),
        getProgress(id),
        getChapters(id).catch(() => ({ data: [] })),
        getDirectoryFiles(id).catch(() => ({ data: [] }))
      ]);
      setAudiobook(bookResponse.data);
      setProgress(progressResponse.data);
      setChapters(chaptersResponse.data || []);
      setDirectoryFiles(filesResponse.data || []);
      setIsFavorite(!!bookResponse.data.is_favorite);
    } catch (error) {
      console.error('Error loading audiobook:', error);
    } finally {
      setLoading(false);
    }
  };

  const formatDurationOrUnknown = (seconds) => {
    return formatDuration(seconds) || 'Unknown';
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

  const handleRefreshMetadata = async () => {
    if (refreshingMetadata) return;
    setRefreshingMetadata(true);
    try {
      const response = await refreshMetadata(audiobook.id);
      await loadAudiobook();
      // Show success message with what was updated
      const updatedFields = response.data?.updated_fields || [];
      if (updatedFields.length > 0) {
        alert(`Metadata refreshed! Updated: ${updatedFields.join(', ')}`);
      } else {
        alert('Metadata refreshed from file');
      }
    } catch (error) {
      console.error('Error refreshing metadata:', error);
      alert('Failed to refresh metadata: ' + (error.response?.data?.error || error.message));
    } finally {
      setRefreshingMetadata(false);
    }
  };

  const handleConvertToM4B = async () => {
    const ext = audiobook.file_path?.split('.').pop()?.toUpperCase() || 'audio';
    if (!confirm(`Convert this ${ext} file to M4B format? This will replace the original file.`)) return;
    setConverting(true);
    try {
      await convertToM4B(audiobook.id);
      await loadAudiobook();
      alert('Converted to M4B successfully!');
    } catch (err) {
      alert('Failed to convert: ' + (err.response?.data?.error || err.message));
    } finally {
      setConverting(false);
    }
  };

  if (loading) {
    return <AudiobookDetailSkeleton />;
  }

  if (!audiobook) {
    return <div className="error">Audiobook not found</div>;
  }

  const hasProgress = progress && (progress.position > 0 || progress.completed === 1);
  const isCompleted = progress?.completed === 1;
  const currentChapterInfo = getCurrentChapter();

  return (
    <div className="audiobook-detail container">
      <div className="detail-top-bar">
        <button className="back-button-modern" onClick={() => navigate(-1)}>
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 12H5M12 19l-7-7 7-7"/>
          </svg>
          Back
        </button>
        {isAdmin && (
          <button className="edit-button-top" onClick={() => setShowEditModal(true)}>
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
            </svg>
            Edit
          </button>
        )}
      </div>

      <div className="detail-content">
        <div className="detail-cover-container">
          <div className="detail-cover" onClick={handlePlay}>
            {audiobook.cover_image ? (
              <img
                src={getCoverUrl(audiobook.id, audiobook.updated_at, 600)}
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
            {/* Reading list button in top right of cover */}
            <button
              className={`cover-favorite-btn ${isFavorite ? 'active' : ''}`}
              onClick={(e) => {
                e.stopPropagation();
                handleToggleFavorite();
              }}
              title={isFavorite ? 'Remove from reading list' : 'Add to reading list'}
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill={isFavorite ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"></path>
              </svg>
            </button>
          </div>

          {/* Rating Section - Under Cover */}
          <RatingSection audiobookId={audiobook.id} />

          {/* Desktop Chapters and Files - Under Rating */}
          <div className="desktop-cover-buttons">
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
          </div>

          {/* Play Button row with overflow menu */}
          <div className="play-button-row">
            <button className="detail-play-button" onClick={handlePlay}>
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="currentColor" stroke="none">
                <polygon points="6 3 20 12 6 21 6 3"></polygon>
              </svg>
              {progress?.position > 0 && !isCompleted ? 'Continue' : 'Play'}
            </button>
            <div className="more-menu-container">
              <button
                className="more-menu-button"
                onClick={() => setShowMenu(!showMenu)}
                title="More options"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="currentColor" stroke="none">
                  <circle cx="12" cy="5" r="2"></circle>
                  <circle cx="12" cy="12" r="2"></circle>
                  <circle cx="12" cy="19" r="2"></circle>
                </svg>
              </button>
              {showMenu && (
                <>
                  <div className="more-menu-backdrop" onClick={() => setShowMenu(false)} />
                  <div className="more-menu-dropdown">
                    {chapters.length > 0 && (
                      <button onClick={() => { setShowChapters(true); setShowMenu(false); }}>
                        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <line x1="8" y1="6" x2="21" y2="6"></line>
                          <line x1="8" y1="12" x2="21" y2="12"></line>
                          <line x1="8" y1="18" x2="21" y2="18"></line>
                          <line x1="3" y1="6" x2="3.01" y2="6"></line>
                          <line x1="3" y1="12" x2="3.01" y2="12"></line>
                          <line x1="3" y1="18" x2="3.01" y2="18"></line>
                        </svg>
                        <span>{chapters.length} Chapter{chapters.length !== 1 ? 's' : ''}</span>
                      </button>
                    )}
                    <button onClick={() => { setShowCollectionModal(true); setShowMenu(false); }}>
                      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
                        <line x1="12" y1="11" x2="12" y2="17"></line>
                        <line x1="9" y1="14" x2="15" y2="14"></line>
                      </svg>
                      <span>Add to Collection</span>
                    </button>
                    <button onClick={() => { handleMarkFinished(); setShowMenu(false); }}>
                      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
                        <polyline points="22 4 12 14.01 9 11.01"></polyline>
                      </svg>
                      <span>Mark Finished</span>
                    </button>
                    {hasProgress && (
                      <button onClick={() => { handleClearProgress(); setShowMenu(false); }}>
                        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="1 4 1 10 7 10"></polyline>
                          <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"></path>
                        </svg>
                        <span>Clear Progress</span>
                      </button>
                    )}
                    <button onClick={() => { handleDownload(); setShowMenu(false); }}>
                      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                        <polyline points="7 10 12 15 17 10"></polyline>
                        <line x1="12" y1="15" x2="12" y2="3"></line>
                      </svg>
                      <span>Export File</span>
                    </button>
                    {isAdmin && (
                      <>
                        <div className="menu-divider" />
                        <button onClick={() => { handleRefreshMetadata(); setShowMenu(false); }} disabled={refreshingMetadata}>
                          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={refreshingMetadata ? 'spinning' : ''}>
                            <path d="M21 2v6h-6M3 12a9 9 0 0 1 15-6.7L21 8M3 22v-6h6M21 12a9 9 0 0 1-15 6.7L3 16"/>
                          </svg>
                          <span>{refreshingMetadata ? 'Refreshing...' : 'Refresh Metadata'}</span>
                        </button>
                        {audiobook?.file_path && !audiobook.file_path.toLowerCase().endsWith('.m4b') && (
                          <button onClick={() => { handleConvertToM4B(); setShowMenu(false); }} disabled={converting}>
                            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={converting ? 'spinning' : ''}>
                              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                              <polyline points="17 8 12 3 7 8"/>
                              <line x1="12" y1="3" x2="12" y2="15"/>
                            </svg>
                            <span>{converting ? 'Converting...' : 'Convert to M4B'}</span>
                          </button>
                        )}
                        <button className="menu-danger" onClick={() => { handleDelete(); setShowMenu(false); }}>
                          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="3 6 5 6 21 6"></polyline>
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                          </svg>
                          <span>Delete</span>
                        </button>
                      </>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Chapters modal (mobile) */}
          {chapters.length > 0 && showChapters && (
            <div className="chapters-modal-overlay" onClick={() => setShowChapters(false)}>
              <div className="chapters-modal" ref={chaptersModalRef} role="dialog" aria-label="Chapters" onClick={e => e.stopPropagation()}>
                <div className="chapters-modal-header">
                  <h3>{chapters.length} Chapter{chapters.length !== 1 ? 's' : ''}</h3>
                  <button className="chapters-modal-close" onClick={() => setShowChapters(false)}>
                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="18" y1="6" x2="6" y2="18"></line>
                      <line x1="6" y1="6" x2="18" y2="18"></line>
                    </svg>
                  </button>
                </div>
                <div className="chapters-modal-list">
                  {chapters.map((chapter, index) => (
                    <div key={chapter.id || index} className="chapter-item clickable" onClick={() => { handleChapterClick(chapter, index); setShowChapters(false); }}>
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

        </div>

        <div className="detail-info">
          <div className="detail-title-row">
            <h1 className="detail-title">{audiobook.title}</h1>
          </div>

          <div className="detail-metadata">
            {audiobook.author && (
              <div className="meta-item">
                <span className="meta-label">Author</span>
                <span className="meta-value author-link" onClick={() => navigate(`/author/${encodeURIComponent(audiobook.author)}`)}>{audiobook.author}</span>
              </div>
            )}
            {audiobook.narrator && (() => {
              const narrators = audiobook.narrator.split(/,\s*(?=(?:[^"]*"[^"]*")*[^"]*$)/).map(n => n.trim()).filter(n => n);
              if (narrators.length <= 1) {
                return (
                  <div className="meta-item">
                    <span className="meta-label">Narrator</span>
                    <span className="meta-value">{audiobook.narrator}</span>
                  </div>
                );
              }
              return (
                <div className="meta-item narrator-carousel">
                  <span className="meta-label">Narrators</span>
                  <div className="narrator-carousel-content">
                    <button
                      className="narrator-nav narrator-prev"
                      onClick={() => setNarratorIndex((prev) => (prev - 1 + narrators.length) % narrators.length)}
                      aria-label="Previous narrator"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="15 18 9 12 15 6"></polyline>
                      </svg>
                    </button>
                    <span className="meta-value narrator-name">{narrators[narratorIndex]}</span>
                    <button
                      className="narrator-nav narrator-next"
                      onClick={() => setNarratorIndex((prev) => (prev + 1) % narrators.length)}
                      aria-label="Next narrator"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="9 18 15 12 9 6"></polyline>
                      </svg>
                    </button>
                    <span className="narrator-count">{narratorIndex + 1}/{narrators.length}</span>
                  </div>
                </div>
              );
            })()}
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
              <span className="meta-value">{formatDurationOrUnknown(audiobook.duration)}</span>
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
                <span className="meta-value">{formatDurationOrUnknown(progress.position)} / {formatDurationOrUnknown(audiobook.duration)} ({getProgressPercentage()}%)</span>
              </div>
            )}
          </div>

          {audiobook.description && cleanDescription(audiobook.description) && (
            <div className="detail-description">
              <div className="about-header">
                <h3>About</h3>
                <RecapTrigger {...recapState} />
              </div>
              <div className="description-text-wrapper">
                <p
                  ref={descriptionRef}
                  className={`description-text ${descriptionExpanded ? 'expanded' : ''}`}
                >
                  {cleanDescription(audiobook.description)}
                </p>
                {!descriptionExpanded && isDescriptionTruncated && (
                  <div className="description-fade" />
                )}
              </div>
              {isDescriptionTruncated && (
                <button
                  className={`description-toggle ${descriptionExpanded ? 'expanded' : ''}`}
                  onClick={() => setDescriptionExpanded(!descriptionExpanded)}
                >
                  {descriptionExpanded ? 'Show less' : 'Show more'}
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="6 9 12 15 18 9"></polyline>
                  </svg>
                </button>
              )}

              <RecapContent {...recapState} />
            </div>
          )}

          {/* Desktop Action Buttons - hidden on mobile where overflow menu is used */}
          <div className="desktop-actions">
            <button className="desktop-action-btn" onClick={() => setShowCollectionModal(true)}>
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
                <line x1="12" y1="11" x2="12" y2="17"></line>
                <line x1="9" y1="14" x2="15" y2="14"></line>
              </svg>
              Add to Collection
            </button>
            <button className="desktop-action-btn" onClick={handleMarkFinished}>
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
                <polyline points="22 4 12 14.01 9 11.01"></polyline>
              </svg>
              Mark Finished
            </button>
            {hasProgress && (
              <button className="desktop-action-btn" onClick={handleClearProgress}>
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="1 4 1 10 7 10"></polyline>
                  <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"></path>
                </svg>
                Clear Progress
              </button>
            )}
            <button className="desktop-action-btn" onClick={handleDownload}>
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                <polyline points="7 10 12 15 17 10"></polyline>
                <line x1="12" y1="15" x2="12" y2="3"></line>
              </svg>
              Export File
            </button>
            {isAdmin && (
              <>
                <button className="desktop-action-btn" onClick={handleRefreshMetadata} disabled={refreshingMetadata}>
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={refreshingMetadata ? 'spinning' : ''}>
                    <path d="M21 2v6h-6M3 12a9 9 0 0 1 15-6.7L21 8M3 22v-6h6M21 12a9 9 0 0 1-15 6.7L3 16"/>
                  </svg>
                  {refreshingMetadata ? 'Refreshing...' : 'Refresh Metadata'}
                </button>
                {audiobook?.file_path && !audiobook.file_path.toLowerCase().endsWith('.m4b') && (
                  <button className="desktop-action-btn" onClick={handleConvertToM4B} disabled={converting}>
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={converting ? 'spinning' : ''}>
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                      <polyline points="17 8 12 3 7 8"/>
                      <line x1="12" y1="3" x2="12" y2="15"/>
                    </svg>
                    {converting ? 'Converting...' : 'Convert to M4B'}
                  </button>
                )}
                <button className="desktop-action-btn danger" onClick={handleDelete}>
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="3 6 5 6 21 6"></polyline>
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                  </svg>
                  Delete
                </button>
              </>
            )}
          </div>

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
