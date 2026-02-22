import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { getAudiobooks, getSeries, getAuthors, getFavorites, getCollections, createCollection, deleteCollection, getCoverUrl, getProfile } from '../api';
import { useWebSocket } from '../contexts/WebSocketContext';
import UploadModal from '../components/UploadModal';
import { LibrarySkeleton } from '../components/Skeleton';
import { formatDurationParts } from '../utils/formatting';
import './Library.css';

// Component for rotating collection covers
function RotatingCover({ bookIds, collectionName }) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [imageError, setImageError] = useState(false);

  useEffect(() => {
    if (!bookIds || bookIds.length <= 1) return;

    const interval = setInterval(() => {
      setCurrentIndex(prev => (prev + 1) % bookIds.length);
      setImageError(false);
    }, 4000);

    return () => clearInterval(interval);
  }, [bookIds]);

  if (!bookIds || bookIds.length === 0 || imageError) {
    return (
      <div className="collection-placeholder">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path>
          <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path>
          <line x1="12" y1="6" x2="12" y2="10"></line>
          <line x1="10" y1="8" x2="14" y2="8"></line>
        </svg>
        <span>{collectionName.charAt(0).toUpperCase()}</span>
      </div>
    );
  }

  return (
    <div className="cover-single">
      <img
        src={getCoverUrl(bookIds[currentIndex], null, 300)}
        alt={collectionName}
        loading="lazy"
        onError={() => setImageError(true)}
      />
    </div>
  );
}

export default function Library({ onPlay }) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState(searchParams.get('tab') || 'browse');
  const [isAdmin, setIsAdmin] = useState(false);
  const [stats, setStats] = useState({
    totalBooks: 0,
    totalSeries: 0,
    totalAuthors: 0,
    totalDuration: 0,
    totalFavorites: 0,
    totalCollections: 0
  });

  // Reading List state
  const [favorites, setFavorites] = useState([]);
  const [loadingFavorites, setLoadingFavorites] = useState(false);

  // Collections state
  const [collections, setCollections] = useState([]);
  const [loadingCollections, setLoadingCollections] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [newIsPublic, setNewIsPublic] = useState(false);
  const [creating, setCreating] = useState(false);

  // Upload modal state
  const [showUploadModal, setShowUploadModal] = useState(false);

  const { subscribe } = useWebSocket();

  // Check if user is admin
  useEffect(() => {
    getProfile()
      .then(res => setIsAdmin(res.data.is_admin === 1))
      .catch(() => setIsAdmin(false));
  }, []);

  // Update URL when tab changes
  useEffect(() => {
    if (activeTab !== 'browse') {
      setSearchParams({ tab: activeTab });
    } else {
      setSearchParams({});
    }
  }, [activeTab, setSearchParams]);

  const loadStats = useCallback(async () => {
    try {
      const [seriesRes, authorsRes, audiobooksRes, favoritesRes, collectionsRes] = await Promise.all([
        getSeries(),
        getAuthors(),
        getAudiobooks({ limit: 10000 }),
        getFavorites().catch(() => ({ data: [] })),
        getCollections().catch(() => ({ data: [] }))
      ]);

      const totalDuration = audiobooksRes.data.audiobooks.reduce(
        (sum, book) => sum + (book.duration || 0), 0
      );

      setStats({
        totalBooks: audiobooksRes.data.audiobooks.length,
        totalSeries: seriesRes.data.length,
        totalAuthors: authorsRes.data.length,
        totalDuration,
        totalFavorites: favoritesRes.data.length,
        totalCollections: collectionsRes.data.length
      });
    } catch (error) {
      console.error('Error loading stats:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStats();
  }, [loadStats]);

  // Subscribe to real-time updates
  useEffect(() => {
    const unsubAdd = subscribe('library.add', loadStats);
    const unsubDelete = subscribe('library.delete', loadStats);
    return () => { unsubAdd(); unsubDelete(); };
  }, [subscribe, loadStats]);

  // Load reading list when tab is active
  useEffect(() => {
    if (activeTab === 'reading-list' && favorites.length === 0) {
      loadFavorites();
    }
  }, [activeTab]);

  // Load collections when tab is active
  useEffect(() => {
    if (activeTab === 'collections' && collections.length === 0) {
      loadCollections();
    }
  }, [activeTab]);

  const loadFavorites = async () => {
    setLoadingFavorites(true);
    try {
      const response = await getFavorites();
      setFavorites(response.data);
    } catch (error) {
      console.error('Error loading favorites:', error);
    } finally {
      setLoadingFavorites(false);
    }
  };

  const loadCollections = async () => {
    setLoadingCollections(true);
    try {
      const response = await getCollections();
      setCollections(response.data);
    } catch (error) {
      console.error('Error loading collections:', error);
    } finally {
      setLoadingCollections(false);
    }
  };

  const handleCreateCollection = async (e) => {
    e.preventDefault();
    if (!newName.trim() || creating) return;

    setCreating(true);
    try {
      const response = await createCollection(newName.trim(), newDescription.trim(), newIsPublic);
      setCollections([response.data, ...collections]);
      setShowCreateModal(false);
      setNewName('');
      setNewDescription('');
      setNewIsPublic(false);
      navigate(`/collections/${response.data.id}`);
    } catch (error) {
      console.error('Error creating collection:', error);
      alert('Failed to create collection');
    } finally {
      setCreating(false);
    }
  };

  const handleDeleteCollection = async (e, collection) => {
    e.stopPropagation();
    if (!collection.is_owner) {
      alert("You can only delete collections you created.");
      return;
    }
    if (!confirm(`Delete "${collection.name}"? This cannot be undone.`)) return;

    try {
      await deleteCollection(collection.id);
      setCollections(collections.filter(c => c.id !== collection.id));
    } catch (error) {
      console.error('Error deleting collection:', error);
      alert('Failed to delete collection');
    }
  };


  if (loading) {
    return <LibrarySkeleton />;
  }

  const tabs = [
    { id: 'browse', label: 'Browse', count: stats.totalBooks },
  ];

  if (isAdmin) {
    tabs.push({ id: 'upload', label: 'Upload', icon: true });
  }

  return (
    <div className="library-page">
      {/* Stats Bar */}
      <div className="library-stats-bar">
        <div className="stat-item">
          <span className="stat-value">{stats.totalBooks}</span>
          <span className="stat-label">Books</span>
        </div>
        <div className="stat-divider"></div>
        <div className="stat-item">
          <span className="stat-value">{stats.totalAuthors}</span>
          <span className="stat-label">Authors</span>
        </div>
        <div className="stat-divider"></div>
        <div className="stat-item">
          <span className="stat-value">{stats.totalSeries}</span>
          <span className="stat-label">Series</span>
        </div>
        <div className="stat-divider"></div>
        <div className="stat-item">
          <span className="stat-value">
            {formatDurationParts(stats.totalDuration).hours}<span className="stat-unit">h</span>{' '}
            {formatDurationParts(stats.totalDuration).minutes}<span className="stat-unit">m</span>
          </span>
          <span className="stat-label">Total</span>
        </div>
      </div>

      {/* Tab Bar */}
      <div className="library-tabs">
        {tabs.map(tab => (
          <button
            key={tab.id}
            className={`library-tab ${activeTab === tab.id ? 'active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.icon && (
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="5" x2="12" y2="19"></line>
                <line x1="5" y1="12" x2="19" y2="12"></line>
              </svg>
            )}
            {tab.label}
            {tab.count !== undefined && <span className="tab-count">{tab.count}</span>}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="library-tab-content">
        {/* Browse Tab */}
        {activeTab === 'browse' && (
          <div className="library-categories">
            {/* Reading List Card */}
            <div
              className="category-card"
              onClick={() => { setActiveTab('reading-list'); loadFavorites(); }}
            >
              <div className="category-card-bg">
                <svg viewBox="0 0 200 200" className="category-bg-pattern">
                  <defs>
                    <linearGradient id="grad-reading-top" x1="0%" y1="0%" x2="100%" y2="100%">
                      <stop offset="0%" stopColor="#f59e0b" stopOpacity="0.3" />
                      <stop offset="100%" stopColor="#fbbf24" stopOpacity="0.1" />
                    </linearGradient>
                  </defs>
                  <circle cx="160" cy="40" r="70" fill="url(#grad-reading-top)" />
                </svg>
              </div>
              <div className="category-card-content">
                <div className="category-icon-wrapper reading-list">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
                  </svg>
                </div>
                <div className="category-text">
                  <h3>Reading List</h3>
                  <p>{stats.totalFavorites} saved</p>
                </div>
                <div className="category-arrow">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M5 12h14M12 5l7 7-7 7" />
                  </svg>
                </div>
              </div>
            </div>

            {/* Collections Card */}
            <div
              className="category-card"
              onClick={() => { setActiveTab('collections'); loadCollections(); }}
            >
              <div className="category-card-bg">
                <svg viewBox="0 0 200 200" className="category-bg-pattern">
                  <defs>
                    <linearGradient id="grad-collections-top" x1="0%" y1="0%" x2="100%" y2="100%">
                      <stop offset="0%" stopColor="#8b5cf6" stopOpacity="0.3" />
                      <stop offset="100%" stopColor="#a855f7" stopOpacity="0.1" />
                    </linearGradient>
                  </defs>
                  <circle cx="150" cy="50" r="65" fill="url(#grad-collections-top)" />
                </svg>
              </div>
              <div className="category-card-content">
                <div className="category-icon-wrapper collections">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                  </svg>
                </div>
                <div className="category-text">
                  <h3>Collections</h3>
                  <p>{stats.totalCollections} collections</p>
                </div>
                <div className="category-arrow">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M5 12h14M12 5l7 7-7 7" />
                  </svg>
                </div>
              </div>
            </div>

            {/* All Books - Featured Card */}
            <div
              className="category-card featured"
              onClick={() => navigate('/all-books')}
            >
              <div className="category-card-bg">
                <svg viewBox="0 0 200 200" className="category-bg-pattern">
                  <defs>
                    <linearGradient id="grad-all" x1="0%" y1="0%" x2="100%" y2="100%">
                      <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.3" />
                      <stop offset="100%" stopColor="#8b5cf6" stopOpacity="0.1" />
                    </linearGradient>
                  </defs>
                  <circle cx="150" cy="50" r="80" fill="url(#grad-all)" />
                  <circle cx="50" cy="150" r="60" fill="url(#grad-all)" />
                </svg>
              </div>
              <div className="category-card-content">
                <div className="category-icon-wrapper all-books">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <rect x="3" y="3" width="7" height="7" rx="1" />
                    <rect x="14" y="3" width="7" height="7" rx="1" />
                    <rect x="3" y="14" width="7" height="7" rx="1" />
                    <rect x="14" y="14" width="7" height="7" rx="1" />
                  </svg>
                </div>
                <div className="category-text">
                  <h3>All Books</h3>
                  <p>{stats.totalBooks} audiobooks</p>
                </div>
                <div className="category-arrow">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M5 12h14M12 5l7 7-7 7" />
                  </svg>
                </div>
              </div>
            </div>

            {/* Series Card */}
            <div
              className="category-card"
              onClick={() => navigate('/series')}
            >
              <div className="category-card-bg">
                <svg viewBox="0 0 200 200" className="category-bg-pattern">
                  <defs>
                    <linearGradient id="grad-series" x1="0%" y1="0%" x2="100%" y2="100%">
                      <stop offset="0%" stopColor="#10b981" stopOpacity="0.3" />
                      <stop offset="100%" stopColor="#06b6d4" stopOpacity="0.1" />
                    </linearGradient>
                  </defs>
                  <circle cx="160" cy="40" r="70" fill="url(#grad-series)" />
                </svg>
              </div>
              <div className="category-card-content">
                <div className="category-icon-wrapper series">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H19a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H6.5a1 1 0 0 1 0-5H20" />
                    <path d="M8 2v5" />
                  </svg>
                </div>
                <div className="category-text">
                  <h3>Series</h3>
                  <p>{stats.totalSeries} collections</p>
                </div>
                <div className="category-arrow">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M5 12h14M12 5l7 7-7 7" />
                  </svg>
                </div>
              </div>
            </div>

            {/* Authors Card */}
            <div
              className="category-card"
              onClick={() => navigate('/authors')}
            >
              <div className="category-card-bg">
                <svg viewBox="0 0 200 200" className="category-bg-pattern">
                  <defs>
                    <linearGradient id="grad-authors" x1="0%" y1="0%" x2="100%" y2="100%">
                      <stop offset="0%" stopColor="#f59e0b" stopOpacity="0.3" />
                      <stop offset="100%" stopColor="#ef4444" stopOpacity="0.1" />
                    </linearGradient>
                  </defs>
                  <circle cx="170" cy="30" r="60" fill="url(#grad-authors)" />
                </svg>
              </div>
              <div className="category-card-content">
                <div className="category-icon-wrapper authors">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <circle cx="12" cy="8" r="4" />
                    <path d="M20 21a8 8 0 1 0-16 0" />
                  </svg>
                </div>
                <div className="category-text">
                  <h3>Authors</h3>
                  <p>{stats.totalAuthors} writers</p>
                </div>
                <div className="category-arrow">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M5 12h14M12 5l7 7-7 7" />
                  </svg>
                </div>
              </div>
            </div>

            {/* Genres Card */}
            <div
              className="category-card"
              onClick={() => navigate('/genres')}
            >
              <div className="category-card-bg">
                <svg viewBox="0 0 200 200" className="category-bg-pattern">
                  <defs>
                    <linearGradient id="grad-genres" x1="0%" y1="0%" x2="100%" y2="100%">
                      <stop offset="0%" stopColor="#ec4899" stopOpacity="0.3" />
                      <stop offset="100%" stopColor="#8b5cf6" stopOpacity="0.1" />
                    </linearGradient>
                  </defs>
                  <circle cx="150" cy="50" r="65" fill="url(#grad-genres)" />
                </svg>
              </div>
              <div className="category-card-content">
                <div className="category-icon-wrapper genres">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                    <path d="M22 6l-10 7L2 6" />
                  </svg>
                </div>
                <div className="category-text">
                  <h3>Genres</h3>
                  <p>Browse by category</p>
                </div>
                <div className="category-arrow">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M5 12h14M12 5l7 7-7 7" />
                  </svg>
                </div>
              </div>
            </div>

          </div>
        )}

        {/* Reading List Tab */}
        {activeTab === 'reading-list' && (
          <div className="reading-list-content">
            <div className="section-header-with-back">
              <button className="back-btn" onClick={() => setActiveTab('browse')}>
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M19 12H5M12 19l-7-7 7-7" />
                </svg>
                Library
              </button>
              <h2>Reading List</h2>
            </div>
            {loadingFavorites ? (
              <div className="loading">Loading your reading list...</div>
            ) : favorites.length === 0 ? (
              <div className="empty-state">
                <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"></path>
                  <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"></path>
                </svg>
                <p>Your reading list is empty</p>
                <p className="empty-state-hint">Add books to your reading list by clicking the bookmark icon on any audiobook.</p>
              </div>
            ) : (
              <div className="favorites-grid">
                {favorites.map((book) => (
                  <div
                    key={book.id}
                    className="book-card"
                    onClick={() => navigate(`/audiobook/${book.id}`)}
                  >
                    <div className="book-cover">
                      <img
                        src={getCoverUrl(book.id, null, 300)}
                        alt={book.title}
                        loading="lazy"
                        onError={(e) => {
                          e.target.style.display = 'none';
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Collections Tab */}
        {activeTab === 'collections' && (
          <div className="collections-content">
            <div className="section-header-with-back">
              <button className="back-btn" onClick={() => setActiveTab('browse')}>
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M19 12H5M12 19l-7-7 7-7" />
                </svg>
                Library
              </button>
              <h2>Collections</h2>
              <button className="btn btn-primary btn-new-collection" onClick={() => setShowCreateModal(true)}>
                + New
              </button>
            </div>

            {loadingCollections ? (
              <div className="loading">Loading collections...</div>
            ) : collections.length === 0 ? (
              <div className="empty-state">
                <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
                </svg>
                <p>No collections yet</p>
                <p className="empty-state-hint">Create a collection to organize your audiobooks.</p>
              </div>
            ) : (
              <div className="collections-grid">
                {collections.map((collection) => {
                  const hours = Math.floor((collection.total_duration || 0) / 3600);
                  return (
                    <div
                      key={collection.id}
                      className="collection-card"
                      onClick={() => navigate(`/collections/${collection.id}`)}
                    >
                      <div className="collection-cover-area">
                        <RotatingCover bookIds={collection.book_ids} collectionName={collection.name} />
                      </div>
                      <div className="collection-details">
                        <h3 className="collection-title">{collection.name}</h3>
                        <div className="collection-meta-row">
                          <span className="collection-stat">{collection.book_count || 0} books</span>
                          <span className="collection-stat-divider">·</span>
                          <span className="collection-stat">{hours}h</span>
                          {collection.is_public === 1 && (
                            <span className="public-badge">Public</span>
                          )}
                        </div>
                        <div className="collection-creator">
                          by {collection.creator_username}
                        </div>
                      </div>
                      {collection.is_owner === 1 && (
                        <button
                          className="delete-btn"
                          onClick={(e) => handleDeleteCollection(e, collection)}
                          title="Delete collection"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <line x1="18" y1="6" x2="6" y2="18"></line>
                            <line x1="6" y1="6" x2="18" y2="18"></line>
                          </svg>
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Upload Tab (Admin only) */}
        {activeTab === 'upload' && isAdmin && (
          <div className="upload-content">
            <div className="upload-container-inline">
              <h2>Upload Audiobooks</h2>
              <p className="upload-description">
                Upload single files or entire folders containing multi-part audiobooks.
              </p>

              <button
                className="btn btn-primary btn-large"
                onClick={() => setShowUploadModal(true)}
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                  <polyline points="17 8 12 3 7 8"></polyline>
                  <line x1="12" y1="3" x2="12" y2="15"></line>
                </svg>
                Select Files or Folder
              </button>

              <div className="upload-info">
                <h3>Alternative Upload Methods</h3>
                <p>You can also add audiobooks by placing them in the watch directory:</p>
                <code>/app/data/watch</code>
                <p className="note">Files will be automatically imported and organized.</p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Create Collection Modal */}
      {showCreateModal && (
        <div className="modal-overlay" onClick={() => setShowCreateModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Create Collection</h3>
            <form onSubmit={handleCreateCollection}>
              <div className="form-group">
                <label htmlFor="collection-name">Name</label>
                <input
                  id="collection-name"
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="e.g., Road Trip, Bedtime Stories"
                  autoFocus
                />
              </div>
              <div className="form-group">
                <label htmlFor="collection-description">Description (optional)</label>
                <textarea
                  id="collection-description"
                  value={newDescription}
                  onChange={(e) => setNewDescription(e.target.value)}
                  placeholder="What's this collection for?"
                  rows={3}
                />
              </div>
              <div className="form-group visibility-toggle">
                <label className="toggle-label">
                  <input
                    type="checkbox"
                    checked={newIsPublic}
                    onChange={(e) => setNewIsPublic(e.target.checked)}
                  />
                  <span className="toggle-text">Make this collection public</span>
                </label>
                <p className="toggle-hint">
                  {newIsPublic
                    ? 'All users will be able to view and edit this collection'
                    : 'Only you can see this collection'}
                </p>
              </div>
              <div className="modal-actions">
                <button type="button" className="btn btn-secondary" onClick={() => setShowCreateModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={!newName.trim() || creating}>
                  {creating ? 'Creating...' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Upload Modal */}
      <UploadModal
        isOpen={showUploadModal}
        onClose={() => setShowUploadModal(false)}
      />
    </div>
  );
}
