/**
 * Tests for client API module (api.js)
 * Tests axios interceptors, URL builders, and API function calls
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';

// Mock axios before importing api module
vi.mock('axios', () => {
  const mockAxiosInstance = {
    get: vi.fn().mockResolvedValue({ data: {} }),
    post: vi.fn().mockResolvedValue({ data: {} }),
    put: vi.fn().mockResolvedValue({ data: {} }),
    delete: vi.fn().mockResolvedValue({ data: {} }),
    interceptors: {
      request: { use: vi.fn() },
      response: { use: vi.fn() },
    },
  };

  return {
    default: {
      create: vi.fn(() => mockAxiosInstance),
    },
  };
});

let api;
let login, getProfile, getAudiobooks, getAudiobook, deleteAudiobook;
let getStreamUrl, getCoverUrl, getDownloadUrl;
let updateProgress, getProgress, markFinished, clearProgress;
let getSeries, getAuthors, getGenres, getRecentlyAdded;
let getApiKeys, createApiKey;
let scanLibrary;

let axiosInstance;
let requestInterceptor;
let responseErrorInterceptor;

beforeEach(async () => {
  vi.resetModules();

  const axiosMod = await import('axios');
  const apiMod = await import('../api.js');

  api = apiMod.default;
  login = apiMod.login;
  getProfile = apiMod.getProfile;
  getAudiobooks = apiMod.getAudiobooks;
  getAudiobook = apiMod.getAudiobook;
  deleteAudiobook = apiMod.deleteAudiobook;
  getStreamUrl = apiMod.getStreamUrl;
  getCoverUrl = apiMod.getCoverUrl;
  getDownloadUrl = apiMod.getDownloadUrl;
  updateProgress = apiMod.updateProgress;
  getProgress = apiMod.getProgress;
  markFinished = apiMod.markFinished;
  clearProgress = apiMod.clearProgress;
  getSeries = apiMod.getSeries;
  getAuthors = apiMod.getAuthors;
  getGenres = apiMod.getGenres;
  getRecentlyAdded = apiMod.getRecentlyAdded;
  getApiKeys = apiMod.getApiKeys;
  createApiKey = apiMod.createApiKey;
  scanLibrary = apiMod.scanLibrary;

  axiosInstance = axiosMod.default.create();

  // Extract the interceptor callbacks that were registered
  requestInterceptor = axiosInstance.interceptors.request.use.mock.calls[0]?.[0];
  const responseArgs = axiosInstance.interceptors.response.use.mock.calls[0];
  responseErrorInterceptor = responseArgs?.[1];
});

describe('API Module', () => {
  describe('Axios instance creation', () => {
    it('creates axios instance with correct base URL', async () => {
      const axios = (await import('axios')).default;
      expect(axios.create).toHaveBeenCalledWith(
        expect.objectContaining({
          baseURL: '/api',
        })
      );
    });

    it('registers request interceptor', () => {
      expect(axiosInstance.interceptors.request.use).toHaveBeenCalled();
    });

    it('registers response interceptor', () => {
      expect(axiosInstance.interceptors.response.use).toHaveBeenCalled();
    });
  });

  describe('Request interceptor', () => {
    it('adds Authorization header when token exists', () => {
      localStorage.setItem('token', 'test-jwt-token');

      const config = { headers: {} };
      const result = requestInterceptor(config);

      expect(result.headers.Authorization).toBe('Bearer test-jwt-token');
    });

    it('does not add Authorization header when no token', () => {
      const config = { headers: {} };
      const result = requestInterceptor(config);

      expect(result.headers.Authorization).toBeUndefined();
    });
  });

  describe('Response interceptor (error handling)', () => {
    it('clears localStorage on 401 response', async () => {
      localStorage.setItem('token', 'some-token');
      localStorage.setItem('currentAudiobook', '123');
      localStorage.setItem('currentProgress', '50');
      localStorage.setItem('playerPlaying', 'true');

      const error = { response: { status: 401 } };

      await expect(responseErrorInterceptor(error)).rejects.toEqual(error);

      expect(localStorage.removeItem).toHaveBeenCalledWith('token');
      expect(localStorage.removeItem).toHaveBeenCalledWith('currentAudiobook');
      expect(localStorage.removeItem).toHaveBeenCalledWith('currentProgress');
      expect(localStorage.removeItem).toHaveBeenCalledWith('playerPlaying');
    });

    it('clears localStorage on 403 response', async () => {
      localStorage.setItem('token', 'some-token');

      const error = { response: { status: 403 } };
      await expect(responseErrorInterceptor(error)).rejects.toEqual(error);

      expect(localStorage.removeItem).toHaveBeenCalledWith('token');
    });

    it('redirects to root on auth error', async () => {
      const error = { response: { status: 401 } };
      await expect(responseErrorInterceptor(error)).rejects.toEqual(error);

      expect(window.location.href).toBe('/');
    });

    it('does not clear localStorage on other errors', async () => {
      // Clear any previous calls from other tests
      localStorage.removeItem.mockClear();

      const error = { response: { status: 500 } };
      await expect(responseErrorInterceptor(error)).rejects.toEqual(error);

      expect(localStorage.removeItem).not.toHaveBeenCalled();
    });
  });

  describe('URL builders', () => {
    it('getStreamUrl includes token as query param', () => {
      localStorage.setItem('token', 'my-token');

      const url = getStreamUrl(42);
      expect(url).toBe('/api/audiobooks/42/stream?token=my-token');
    });

    it('getCoverUrl includes token as query param', () => {
      localStorage.setItem('token', 'my-token');

      const url = getCoverUrl(42);
      expect(url).toBe('/api/audiobooks/42/cover?token=my-token');
    });

    it('getCoverUrl includes width parameter when provided', () => {
      localStorage.setItem('token', 'my-token');

      const url = getCoverUrl(42, null, 200);
      expect(url).toBe('/api/audiobooks/42/cover?token=my-token&width=200');
    });

    it('getCoverUrl includes cache bust parameter when provided', () => {
      localStorage.setItem('token', 'my-token');

      const url = getCoverUrl(42, 'bust123');
      expect(url).toBe('/api/audiobooks/42/cover?token=my-token&t=bust123');
    });

    it('getDownloadUrl includes token as query param', () => {
      localStorage.setItem('token', 'my-token');

      const url = getDownloadUrl(42);
      expect(url).toBe('/api/audiobooks/42/download?token=my-token');
    });

    it('URL encodes token in stream URL', () => {
      localStorage.setItem('token', 'token with spaces+special');

      const url = getStreamUrl(1);
      expect(url).toContain(encodeURIComponent('token with spaces+special'));
    });
  });

  describe('API function calls', () => {
    it('login calls POST /auth/login', async () => {
      await login('user', 'pass');
      expect(axiosInstance.post).toHaveBeenCalledWith('/auth/login', { username: 'user', password: 'pass' });
    });

    it('getProfile calls GET /profile', async () => {
      await getProfile();
      expect(axiosInstance.get).toHaveBeenCalledWith('/profile');
    });

    it('getAudiobooks calls GET /audiobooks with params', async () => {
      await getAudiobooks({ search: 'test' });
      expect(axiosInstance.get).toHaveBeenCalledWith('/audiobooks', { params: { search: 'test' } });
    });

    it('getAudiobook calls GET /audiobooks/:id', async () => {
      await getAudiobook(42);
      expect(axiosInstance.get).toHaveBeenCalledWith('/audiobooks/42');
    });

    it('deleteAudiobook calls DELETE /audiobooks/:id', async () => {
      await deleteAudiobook(42);
      expect(axiosInstance.delete).toHaveBeenCalledWith('/audiobooks/42');
    });

    it('updateProgress calls POST /audiobooks/:id/progress', async () => {
      await updateProgress(42, 1800, 0, 'playing', {});
      expect(axiosInstance.post).toHaveBeenCalledWith(
        '/audiobooks/42/progress',
        { position: 1800, completed: 0, state: 'playing', clientInfo: {} },
        expect.any(Object)
      );
    });

    it('markFinished calls POST /audiobooks/:id/progress with completed=1', async () => {
      await markFinished(42);
      expect(axiosInstance.post).toHaveBeenCalledWith(
        '/audiobooks/42/progress',
        { position: 0, completed: 1, state: 'stopped' }
      );
    });

    it('clearProgress calls DELETE /audiobooks/:id/progress', async () => {
      await clearProgress(42);
      expect(axiosInstance.delete).toHaveBeenCalledWith('/audiobooks/42/progress');
    });

    it('getSeries calls GET /audiobooks/meta/series', async () => {
      await getSeries();
      expect(axiosInstance.get).toHaveBeenCalledWith('/audiobooks/meta/series');
    });

    it('getAuthors calls GET /audiobooks/meta/authors', async () => {
      await getAuthors();
      expect(axiosInstance.get).toHaveBeenCalledWith('/audiobooks/meta/authors');
    });

    it('getRecentlyAdded calls GET /audiobooks/meta/recent with limit', async () => {
      await getRecentlyAdded(5);
      expect(axiosInstance.get).toHaveBeenCalledWith('/audiobooks/meta/recent', { params: { limit: 5 } });
    });

    it('createApiKey calls POST /api-keys', async () => {
      await createApiKey('test-key', 'read', 30);
      expect(axiosInstance.post).toHaveBeenCalledWith('/api-keys', {
        name: 'test-key',
        permissions: 'read',
        expires_in_days: 30,
      });
    });

    it('scanLibrary calls POST /maintenance/scan-library', async () => {
      await scanLibrary(true);
      expect(axiosInstance.post).toHaveBeenCalledWith('/maintenance/scan-library', { refreshMetadata: true });
    });
  });
});
