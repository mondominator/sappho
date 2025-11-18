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

export const uploadAudiobook = (file, metadata) => {
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

export const getCoverUrl = (id) => {
  const token = localStorage.getItem('token');
  return `${API_BASE}/audiobooks/${id}/cover?token=${encodeURIComponent(token)}`;
};

export const updateProgress = (id, position, completed = 0, state = 'playing', clientInfo = {}) =>
  api.post(`/audiobooks/${id}/progress`, { position, completed, state, clientInfo });

export const getProgress = (id) =>
  api.get(`/audiobooks/${id}/progress`);

export const markFinished = (id) =>
  api.post(`/audiobooks/${id}/progress`, { position: 0, completed: 1, state: 'stopped' });

export const clearProgress = (id) =>
  api.post(`/audiobooks/${id}/progress`, { position: 0, completed: 0, state: 'stopped' });

export const getChapters = (id) =>
  api.get(`/audiobooks/${id}/chapters`);

export const getSeries = () =>
  api.get('/audiobooks/meta/series');

export const getAuthors = () =>
  api.get('/audiobooks/meta/authors');

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

// Maintenance (admin only)
export const consolidateMultiFile = () =>
  api.post('/maintenance/consolidate-multifile');

export const clearLibrary = () =>
  api.post('/maintenance/clear-library');

export const scanLibrary = () =>
  api.post('/maintenance/scan-library');

export const forceRescan = () =>
  api.post('/maintenance/force-rescan');

export default api;
