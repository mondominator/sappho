import axios from 'axios';

const API_BASE = '/api';
const BUILD_ID = 'v20251112171700';

const api = axios.create({
  baseURL: API_BASE,
  headers: {
    'X-Build-Version': BUILD_ID
  }
});

// Add auth token to requests
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Handle 401/403 responses and redirect to login
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response && (error.response.status === 401 || error.response.status === 403)) {
      // Clear local storage
      localStorage.removeItem('token');
      localStorage.removeItem('currentAudiobook');
      localStorage.removeItem('currentProgress');
      localStorage.removeItem('playerPlaying');

      // Redirect to login by navigating to root (App will detect no token and show login)
      window.location.href = '/';
    }
    return Promise.reject(error);
  }
);

export const login = (username, password) =>
  api.post('/auth/login', { username, password });

export const register = (username, password, email) =>
  api.post('/auth/register', { username, password, email });

export const getProfile = () =>
  api.get('/profile');

export const getAudiobooks = (params) =>
  api.get('/audiobooks', { params });

export const getAudiobook = (id) =>
  api.get(`/audiobooks/${id}`);

export const deleteAudiobook = (id) =>
  api.delete(`/audiobooks/${id}`);

export const updateAudiobook = (id, metadata) =>
  api.put(`/audiobooks/${id}`, metadata);

export const embedMetadata = (id) =>
  api.post(`/audiobooks/${id}/embed-metadata`);

export const convertToM4B = (id) =>
  api.post(`/audiobooks/${id}/convert-to-m4b`);

// Conversion Jobs
export const getConversionJobs = () =>
  api.get('/audiobooks/jobs/conversion');

export const cancelConversionJob = (jobId) =>
  api.delete(`/audiobooks/jobs/conversion/${jobId}`);

export const searchMetadata = (id, params) =>
  api.get(`/audiobooks/${id}/search-metadata`, { params });

export const uploadAudiobook = (file, metadata, { onProgress, cancelToken } = {}) => {
  const formData = new FormData();
  formData.append('audiobook', file);
  if (metadata) {
    Object.keys(metadata).forEach(key => {
      formData.append(key, metadata[key]);
    });
  }
  return api.post('/upload', formData, {
    headers: {
      'Content-Type': 'multipart/form-data',
    },
    onUploadProgress: onProgress,
    cancelToken,
  });
};

export const uploadMultiFileAudiobook = (files, bookName = null, { onProgress, cancelToken } = {}) => {
  const formData = new FormData();
  // Sort files by name to maintain order
  const sortedFiles = [...files].sort((a, b) =>
    (a.webkitRelativePath || a.name).localeCompare(
      b.webkitRelativePath || b.name,
      undefined,
      { numeric: true, sensitivity: 'base' }
    )
  );
  sortedFiles.forEach(file => {
    // Use webkitRelativePath to preserve folder structure info
    formData.append('audiobooks', file, file.webkitRelativePath || file.name);
  });
  if (bookName) {
    formData.append('bookName', bookName);
  }
  return api.post('/upload/multifile', formData, {
    headers: {
      'Content-Type': 'multipart/form-data',
    },
    onUploadProgress: onProgress,
    cancelToken,
  });
};

export const getStreamUrl = (id) => {
  const token = localStorage.getItem('token');
  return `${API_BASE}/audiobooks/${id}/stream?token=${encodeURIComponent(token)}`;
};

export const getDownloadUrl = (id) => {
  const token = localStorage.getItem('token');
  return `${API_BASE}/audiobooks/${id}/download?token=${encodeURIComponent(token)}`;
};

export const getCoverUrl = (id, cacheBust = null) => {
  const token = localStorage.getItem('token');
  let url = `${API_BASE}/audiobooks/${id}/cover?token=${encodeURIComponent(token)}`;
  if (cacheBust) {
    url += `&t=${encodeURIComponent(cacheBust)}`;
  }
  return url;
};

export const updateProgress = (id, position, completed = 0, state = 'playing', clientInfo = {}) =>
  api.post(`/audiobooks/${id}/progress`, { position, completed, state, clientInfo });

export const getProgress = (id) =>
  api.get(`/audiobooks/${id}/progress`);

export const markFinished = (id) =>
  api.post(`/audiobooks/${id}/progress`, { position: 0, completed: 1, state: 'stopped' });

export const clearProgress = (id) =>
  api.delete(`/audiobooks/${id}/progress`);

export const getChapters = (id) =>
  api.get(`/audiobooks/${id}/chapters`);

export const updateChapters = (id, chapters) =>
  api.put(`/audiobooks/${id}/chapters`, { chapters });

export const fetchChaptersFromAudnexus = (id, asin) =>
  api.post(`/audiobooks/${id}/fetch-chapters`, { asin });

export const searchAudnexus = (id, params) =>
  api.get(`/audiobooks/${id}/search-audnexus`, { params });

export const refreshMetadata = (id) =>
  api.post(`/audiobooks/${id}/refresh-metadata`);

export const getDirectoryFiles = (id) =>
  api.get(`/audiobooks/${id}/directory-files`);

export const getSeries = () =>
  api.get('/audiobooks/meta/series');

export const getAuthors = () =>
  api.get('/audiobooks/meta/authors');

export const getGenres = () =>
  api.get('/audiobooks/meta/genres');

export const getGenreMappings = () =>
  api.get('/audiobooks/meta/genre-mappings');

export const getRecentlyAdded = (limit = 10) =>
  api.get('/audiobooks/meta/recent', { params: { limit } });

export const getInProgress = (limit = 10) =>
  api.get('/audiobooks/meta/in-progress', { params: { limit } });

export const getUpNext = (limit = 10) =>
  api.get('/audiobooks/meta/up-next', { params: { limit } });

export const getFinished = (limit = 10) =>
  api.get('/audiobooks/meta/finished', { params: { limit } });

// API Keys
export const getApiKeys = () =>
  api.get('/api-keys');

export const createApiKey = (name, permissions = 'read', expires_in_days = null) =>
  api.post('/api-keys', { name, permissions, expires_in_days });

export const updateApiKey = (id, updates) =>
  api.put(`/api-keys/${id}`, updates);

export const deleteApiKey = (id) =>
  api.delete(`/api-keys/${id}`);

// Users (admin only)
export const getUsers = () =>
  api.get('/users');

export const getUser = (id) =>
  api.get(`/users/${id}`);

export const createUser = (username, password, email, is_admin) =>
  api.post('/users', { username, password, email, is_admin });

export const updateUser = (id, updates) =>
  api.put(`/users/${id}`, updates);

export const deleteUser = (id) =>
  api.delete(`/users/${id}`);

export const unlockUser = (id) =>
  api.post(`/users/${id}/unlock`);

export const getUserDetails = (id) =>
  api.get(`/users/${id}/details`);

export const disableUser = (id, reason = null) =>
  api.post(`/users/${id}/disable`, { reason });

export const enableUser = (id) =>
  api.post(`/users/${id}/enable`);

export const getLockedAccounts = () =>
  api.get('/users/locked/list');

// Account unlock (public)
export const requestUnlock = (email) =>
  api.post('/auth/request-unlock', { email });

export const unlockAccount = (token) =>
  api.post('/auth/unlock', { token });

export const checkLockout = (username) =>
  api.post('/auth/check-lockout', { username });

// Maintenance (admin only)
export const consolidateMultiFile = () =>
  api.post('/maintenance/consolidate-multifile');

export const clearLibrary = () =>
  api.post('/maintenance/clear-library');

export const scanLibrary = (refreshMetadata = false) =>
  api.post('/maintenance/scan-library', { refreshMetadata });

export const forceRescan = () =>
  api.post('/maintenance/force-rescan');

export const getServerLogs = (limit = 100) =>
  api.get('/maintenance/logs', { params: { limit } });

export const getBackgroundJobs = () =>
  api.get('/maintenance/jobs');

export const getLibraryStatistics = () =>
  api.get('/maintenance/statistics');

// Server Settings
export const getServerSettings = () =>
  api.get('/settings/server');

export const updateServerSettings = (settings) =>
  api.put('/settings/server', settings);

// Backup (admin only)
export const getBackups = () =>
  api.get('/backup');

export const createBackup = (includeCovers = true) =>
  api.post('/backup', { includeCovers });

export const downloadBackup = (filename) => {
  const token = localStorage.getItem('token');
  return `${API_BASE}/backup/${encodeURIComponent(filename)}?token=${encodeURIComponent(token)}`;
};

export const deleteBackup = (filename) =>
  api.delete(`/backup/${encodeURIComponent(filename)}`);

export const restoreBackup = (filename, options = {}) =>
  api.post(`/backup/restore/${encodeURIComponent(filename)}`, options);

export const uploadAndRestoreBackup = (file, options = {}) => {
  const formData = new FormData();
  formData.append('backup', file);
  formData.append('restoreDatabase', options.restoreDatabase ?? true);
  formData.append('restoreCovers', options.restoreCovers ?? true);
  return api.post('/backup/upload', formData, {
    headers: {
      'Content-Type': 'multipart/form-data',
    },
  });
};

export const applyBackupRetention = (keepCount = 7) =>
  api.post('/backup/retention', { keepCount });

// Favorites
export const getFavorites = () =>
  api.get('/audiobooks/favorites');

export const toggleFavorite = (id) =>
  api.post(`/audiobooks/${id}/favorite/toggle`);

export const addFavorite = (id) =>
  api.post(`/audiobooks/${id}/favorite`);

export const removeFavorite = (id) =>
  api.delete(`/audiobooks/${id}/favorite`);

// Duplicates
export const getDuplicates = () =>
  api.get('/maintenance/duplicates');

export const mergeDuplicates = (keepId, deleteIds, deleteFiles = false) =>
  api.post('/maintenance/duplicates/merge', { keepId, deleteIds, deleteFiles });

// Orphan Directories
export const getOrphanDirectories = () =>
  api.get('/maintenance/orphan-directories');

export const deleteOrphanDirectories = (paths) =>
  api.delete('/maintenance/orphan-directories', { data: { paths } });

// Library Organization
export const getOrganizationPreview = () =>
  api.get('/maintenance/organize/preview');

export const organizeLibrary = () =>
  api.post('/maintenance/organize');

// Collections
export const getCollections = () =>
  api.get('/collections');

export const createCollection = (name, description, is_public = false) =>
  api.post('/collections', { name, description, is_public });

export const getCollection = (id) =>
  api.get(`/collections/${id}`);

export const updateCollection = (id, name, description, is_public = false) =>
  api.put(`/collections/${id}`, { name, description, is_public });

export const deleteCollection = (id) =>
  api.delete(`/collections/${id}`);

export const addToCollection = (collectionId, audiobookId) =>
  api.post(`/collections/${collectionId}/items`, { audiobook_id: audiobookId });

export const removeFromCollection = (collectionId, audiobookId) =>
  api.delete(`/collections/${collectionId}/items/${audiobookId}`);

export const reorderCollection = (collectionId, order) =>
  api.put(`/collections/${collectionId}/items/reorder`, { order });

export const getCollectionsForBook = (bookId) =>
  api.get(`/collections/for-book/${bookId}`);

// Ratings
export const getRating = (audiobookId) =>
  api.get(`/ratings/audiobook/${audiobookId}`);

export const getAllRatings = (audiobookId) =>
  api.get(`/ratings/audiobook/${audiobookId}/all`);

export const getAverageRating = (audiobookId) =>
  api.get(`/ratings/audiobook/${audiobookId}/average`);

export const setRating = (audiobookId, rating, review) =>
  api.post(`/ratings/audiobook/${audiobookId}`, { rating, review });

export const deleteRating = (audiobookId) =>
  api.delete(`/ratings/audiobook/${audiobookId}`);

export const getMyRatings = () =>
  api.get('/ratings/my-ratings');

// Batch Actions
export const batchMarkFinished = (audiobookIds) =>
  api.post('/audiobooks/batch/mark-finished', { audiobook_ids: audiobookIds });

export const batchClearProgress = (audiobookIds) =>
  api.post('/audiobooks/batch/clear-progress', { audiobook_ids: audiobookIds });

export const batchAddToReadingList = (audiobookIds) =>
  api.post('/audiobooks/batch/add-to-reading-list', { audiobook_ids: audiobookIds });

export const batchRemoveFromReadingList = (audiobookIds) =>
  api.post('/audiobooks/batch/remove-from-reading-list', { audiobook_ids: audiobookIds });

export const batchAddToCollection = (audiobookIds, collectionId) =>
  api.post('/audiobooks/batch/add-to-collection', { audiobook_ids: audiobookIds, collection_id: collectionId });

export const batchDelete = (audiobookIds, deleteFiles = false) =>
  api.post('/audiobooks/batch/delete', { audiobook_ids: audiobookIds, delete_files: deleteFiles });

// Activity Feed
export const getActivityFeed = (params) =>
  api.get('/activity/feed', { params });

export const getPersonalActivity = (params) =>
  api.get('/activity/personal', { params });

export const getServerActivity = (params) =>
  api.get('/activity/server', { params });

export const getActivityPrivacy = () =>
  api.get('/activity/privacy');

export const updateActivityPrivacy = (settings) =>
  api.put('/activity/privacy', settings);

// MFA (Multi-Factor Authentication)
export const getMFAStatus = () =>
  api.get('/mfa/status');

export const setupMFA = () =>
  api.post('/mfa/setup');

export const verifyMFASetup = (secret, token) =>
  api.post('/mfa/verify-setup', { secret, token });

export const disableMFA = (token, password) =>
  api.post('/mfa/disable', { token, password });

export const regenerateBackupCodes = (token) =>
  api.post('/mfa/regenerate-codes', { token });

export const verifyMFA = (mfa_token, token) =>
  api.post('/auth/verify-mfa', { mfa_token, token });

// Email notifications
export const getEmailSettings = () =>
  api.get('/email/settings');

export const updateEmailSettings = (settings) =>
  api.put('/email/settings', settings);

export const testEmailConnection = (settings) =>
  api.post('/email/test-connection', settings);

export const sendTestEmail = (to) =>
  api.post('/email/send-test', { to });

export const getEmailStatus = () =>
  api.get('/email/status');

export const getNotificationPreferences = () =>
  api.get('/email/preferences');

export const updateNotificationPreferences = (prefs) =>
  api.put('/email/preferences', prefs);

export default api;
