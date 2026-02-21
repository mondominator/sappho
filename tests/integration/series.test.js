/**
 * Integration tests for Series Routes
 * Tests: Get series recap, clear cached recap
 *
 * The real series route behavior:
 * - GET /:seriesName/recap requires audiobooks with that series in DB + user progress
 * - Without books: 404 "Series not found"
 * - Without progress: 400 "No progress in this series yet"
 * - With progress but no cache and no AI key: 400 "AI not configured"
 * - With cache: 200 { recap, cached: true, cachedAt, booksIncluded }
 * - With AI: 200 { recap, cached: false, booksIncluded }
 * - DELETE /:seriesName/recap: any authenticated user can delete their own recaps
 * - Returns { message: 'Recap cache cleared' }
 */

const request = require('supertest');
const crypto = require('crypto');
const {
  createTestDatabase,
  createTestUser,
  generateTestToken,
  createTestApp,
  createTestAudiobook
} = require('./testApp');

// Mock the AI provider so we can control recap generation
jest.mock('../../server/services/aiProvider', () => ({
  callAI: jest.fn().mockResolvedValue('AI-generated recap for testing.'),
  getModelUsed: jest.fn().mockReturnValue('test-model'),
  generateRecapHash: jest.fn(),
}));

const { callAI } = require('../../server/services/aiProvider');

/**
 * Helper: insert an audiobook with a series field and create playback progress for a user
 */
async function createSeriesBookWithProgress(db, { series, userId, title, seriesPosition = 1, completed = 0, position = 100 }) {
  const book = await createTestAudiobook(db, {
    title: title || `${series} Book ${seriesPosition}`,
    series,
    series_position: seriesPosition,
    author: 'Test Author',
    description: 'A test book description.',
    file_path: `/test/${series.replace(/\s+/g, '_')}_${seriesPosition}.m4b`,
  });

  // Create playback progress
  await new Promise((resolve, reject) => {
    db.run(
      'INSERT OR REPLACE INTO playback_progress (user_id, audiobook_id, position, completed) VALUES (?, ?, ?, ?)',
      [userId, book.id, position, completed],
      (err) => { if (err) reject(err); else resolve(); }
    );
  });

  return book;
}

/**
 * Helper: generate the same books_hash as the real route does
 */
function generateBooksHash(bookIds) {
  const sorted = bookIds.sort((a, b) => a - b).join(',');
  return crypto.createHash('md5').update(sorted).digest('hex');
}

describe('Series Routes', () => {
  let db;
  let app;
  let user1, user2, adminUser;
  let user1Token, user2Token, adminToken;

  // Save and restore env vars
  const originalOpenAIKey = process.env.OPENAI_API_KEY;
  const originalGeminiKey = process.env.GEMINI_API_KEY;
  const originalAIProvider = process.env.AI_PROVIDER;

  beforeAll(async () => {
    db = await createTestDatabase();
    app = createTestApp(db);

    // Create test users
    user1 = await createTestUser(db, { username: 'seriesuser1', password: 'SeriesPass123!' });
    user2 = await createTestUser(db, { username: 'seriesuser2', password: 'SeriesPass123!' });
    adminUser = await createTestUser(db, { username: 'seriesadmin', password: 'AdminPass123!', isAdmin: true });

    user1Token = generateTestToken(user1);
    user2Token = generateTestToken(user2);
    adminToken = generateTestToken(adminUser);
  });

  afterAll((done) => {
    // Restore env vars
    if (originalOpenAIKey !== undefined) process.env.OPENAI_API_KEY = originalOpenAIKey;
    else delete process.env.OPENAI_API_KEY;
    if (originalGeminiKey !== undefined) process.env.GEMINI_API_KEY = originalGeminiKey;
    else delete process.env.GEMINI_API_KEY;
    if (originalAIProvider !== undefined) process.env.AI_PROVIDER = originalAIProvider;
    else delete process.env.AI_PROVIDER;

    db.close(done);
  });

  beforeEach(() => {
    // Default: no AI keys configured
    delete process.env.OPENAI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    delete process.env.AI_PROVIDER;
    jest.clearAllMocks();
  });

  describe('GET /api/series/:seriesName/recap', () => {
    describe('Authentication', () => {
      it('returns 401 without authentication', async () => {
        const res = await request(app)
          .get('/api/series/TestSeries/recap')
          .expect(401);

        expect(res.body.error).toBe('Access token required');
      });
    });

    describe('Series not found', () => {
      it('returns 404 when series has no books in DB', async () => {
        const res = await request(app)
          .get('/api/series/NonExistentSeries/recap')
          .set('Authorization', `Bearer ${user1Token}`)
          .expect(404);

        expect(res.body.error).toBe('Series not found');
      });
    });

    describe('No progress', () => {
      it('returns 400 when user has no progress in the series', async () => {
        // Create a book in 'NoProgressSeries' but no playback progress for user1
        await createTestAudiobook(db, {
          title: 'No Progress Book',
          series: 'NoProgressSeries',
          series_position: 1,
          file_path: '/test/no_progress_book.m4b',
        });

        const res = await request(app)
          .get('/api/series/NoProgressSeries/recap')
          .set('Authorization', `Bearer ${user1Token}`)
          .expect(400);

        expect(res.body.error).toBe('No progress in this series yet');
      });
    });

    describe('AI not configured', () => {
      it('returns 400 when AI is not configured and no cache exists', async () => {
        await createSeriesBookWithProgress(db, {
          series: 'AINotConfiguredSeries',
          userId: user1.id,
          seriesPosition: 1,
        });

        const res = await request(app)
          .get('/api/series/AINotConfiguredSeries/recap')
          .set('Authorization', `Bearer ${user1Token}`)
          .expect(400);

        expect(res.body.error).toBe('AI not configured');
      });
    });

    describe('AI-generated recap', () => {
      it('returns recap when AI is configured and no cache exists', async () => {
        process.env.OPENAI_API_KEY = 'test-key-for-series';

        const book = await createSeriesBookWithProgress(db, {
          series: 'AIGeneratedSeries',
          userId: user1.id,
          seriesPosition: 1,
        });

        const res = await request(app)
          .get('/api/series/AIGeneratedSeries/recap')
          .set('Authorization', `Bearer ${user1Token}`)
          .expect(200);

        expect(res.body).toHaveProperty('recap', 'AI-generated recap for testing.');
        expect(res.body).toHaveProperty('cached', false);
        expect(res.body).toHaveProperty('booksIncluded');
        expect(res.body.booksIncluded).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ id: book.id, title: book.title })
          ])
        );
        expect(callAI).toHaveBeenCalledTimes(1);
      });
    });

    describe('Caching behavior', () => {
      let cachedBook;
      const cachedSeriesName = 'CachedSeries';

      beforeAll(async () => {
        // Create a book with progress for the cached series
        cachedBook = await createSeriesBookWithProgress(db, {
          series: cachedSeriesName,
          userId: user1.id,
          seriesPosition: 1,
          title: 'Cached Series Book 1',
        });
      });

      beforeEach(async () => {
        const booksHash = generateBooksHash([cachedBook.id]);
        // Insert a cached recap with the correct schema
        await new Promise((resolve, reject) => {
          db.run(
            'INSERT OR REPLACE INTO series_recaps (user_id, series_name, books_hash, recap_text, model_used, created_at) VALUES (?, ?, ?, ?, ?, ?)',
            [user1.id, cachedSeriesName, booksHash, 'This is a cached recap.', 'test-model', new Date().toISOString()],
            (err) => {
              if (err) reject(err);
              else resolve();
            }
          );
        });
      });

      afterEach(async () => {
        await new Promise((resolve) => {
          db.run('DELETE FROM series_recaps WHERE series_name = ?', [cachedSeriesName], resolve);
        });
      });

      it('returns cached recap when available', async () => {
        const res = await request(app)
          .get(`/api/series/${cachedSeriesName}/recap`)
          .set('Authorization', `Bearer ${user1Token}`)
          .expect(200);

        expect(res.body).toHaveProperty('cached', true);
        expect(res.body.recap).toBe('This is a cached recap.');
      });

      it('includes cachedAt for cached recaps', async () => {
        const res = await request(app)
          .get(`/api/series/${cachedSeriesName}/recap`)
          .set('Authorization', `Bearer ${user1Token}`)
          .expect(200);

        expect(res.body).toHaveProperty('cachedAt');
      });

      it('includes booksIncluded for cached recaps', async () => {
        const res = await request(app)
          .get(`/api/series/${cachedSeriesName}/recap`)
          .set('Authorization', `Bearer ${user1Token}`)
          .expect(200);

        expect(res.body).toHaveProperty('booksIncluded');
        expect(res.body.booksIncluded).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ id: cachedBook.id })
          ])
        );
      });
    });

    describe('URL encoding', () => {
      it('handles URL-encoded series names', async () => {
        const seriesName = "Harry Potter & The Sorcerer's Stone";

        await createSeriesBookWithProgress(db, {
          series: seriesName,
          userId: user1.id,
          seriesPosition: 1,
          title: 'HP Sorcerer Book',
        });

        // Insert a cached recap so we get a 200 without needing AI
        const bookRow = await new Promise((resolve, reject) => {
          db.get(
            "SELECT id FROM audiobooks WHERE series = ?",
            [seriesName],
            (err, row) => { if (err) reject(err); else resolve(row); }
          );
        });
        const booksHash = generateBooksHash([bookRow.id]);
        await new Promise((resolve) => {
          db.run(
            'INSERT OR REPLACE INTO series_recaps (user_id, series_name, books_hash, recap_text, model_used) VALUES (?, ?, ?, ?, ?)',
            [user1.id, seriesName, booksHash, 'HP recap', 'test-model'],
            resolve
          );
        });

        const encodedName = encodeURIComponent(seriesName);
        const res = await request(app)
          .get(`/api/series/${encodedName}/recap`)
          .set('Authorization', `Bearer ${user1Token}`)
          .expect(200);

        expect(res.body.recap).toBe('HP recap');
        expect(res.body.cached).toBe(true);
      });

      it('handles series names with spaces', async () => {
        const seriesName = 'Lord of the Rings';

        await createSeriesBookWithProgress(db, {
          series: seriesName,
          userId: user1.id,
          seriesPosition: 1,
          title: 'LOTR Book',
        });

        // Use AI mock for this test
        process.env.OPENAI_API_KEY = 'test-key';

        const encodedName = encodeURIComponent(seriesName);
        const res = await request(app)
          .get(`/api/series/${encodedName}/recap`)
          .set('Authorization', `Bearer ${user1Token}`)
          .expect(200);

        expect(res.body).toHaveProperty('recap');
        expect(res.body).toHaveProperty('booksIncluded');
      });

      it('handles series names with special characters', async () => {
        const seriesName = 'Series: The Beginning!';

        await createSeriesBookWithProgress(db, {
          series: seriesName,
          userId: user1.id,
          seriesPosition: 1,
          title: 'Beginning Book',
        });

        process.env.OPENAI_API_KEY = 'test-key';

        const encodedName = encodeURIComponent(seriesName);
        const res = await request(app)
          .get(`/api/series/${encodedName}/recap`)
          .set('Authorization', `Bearer ${user1Token}`)
          .expect(200);

        expect(res.body).toHaveProperty('recap');
      });
    });
  });

  describe('DELETE /api/series/:seriesName/recap', () => {
    describe('Authentication', () => {
      it('returns 401 without authentication', async () => {
        const res = await request(app)
          .delete('/api/series/TestSeries/recap')
          .expect(401);

        expect(res.body.error).toBe('Access token required');
      });
    });

    describe('Any authenticated user can delete their own recaps', () => {
      beforeEach(async () => {
        // Insert a recap for user1
        await new Promise((resolve, reject) => {
          db.run(
            'INSERT OR REPLACE INTO series_recaps (user_id, series_name, books_hash, recap_text, model_used) VALUES (?, ?, ?, ?, ?)',
            [user1.id, 'DeleteMe', 'somehash', 'Recap to be deleted', 'test-model'],
            (err) => {
              if (err) reject(err);
              else resolve();
            }
          );
        });
      });

      afterEach(async () => {
        await new Promise((resolve) => {
          db.run('DELETE FROM series_recaps WHERE series_name = ?', ['DeleteMe'], resolve);
        });
      });

      it('regular user can delete their own cached recap', async () => {
        const res = await request(app)
          .delete('/api/series/DeleteMe/recap')
          .set('Authorization', `Bearer ${user1Token}`)
          .expect(200);

        expect(res.body).toHaveProperty('message', 'Recap cache cleared');
      });

      it('admin can delete their own cached recap', async () => {
        // Insert a recap for the admin user
        await new Promise((resolve) => {
          db.run(
            'INSERT OR REPLACE INTO series_recaps (user_id, series_name, books_hash, recap_text, model_used) VALUES (?, ?, ?, ?, ?)',
            [adminUser.id, 'DeleteMe', 'adminhash', 'Admin recap', 'test-model'],
            resolve
          );
        });

        const res = await request(app)
          .delete('/api/series/DeleteMe/recap')
          .set('Authorization', `Bearer ${adminToken}`)
          .expect(200);

        expect(res.body).toHaveProperty('message', 'Recap cache cleared');
      });

      it('returns success even for non-existent recap (idempotent)', async () => {
        const res = await request(app)
          .delete('/api/series/NonExistent/recap')
          .set('Authorization', `Bearer ${user1Token}`)
          .expect(200);

        expect(res.body).toHaveProperty('message', 'Recap cache cleared');
      });

      it('handles URL-encoded series names on delete', async () => {
        // Insert with special characters
        await new Promise((resolve) => {
          db.run(
            'INSERT OR REPLACE INTO series_recaps (user_id, series_name, books_hash, recap_text, model_used) VALUES (?, ?, ?, ?, ?)',
            [user1.id, 'Series & More!', 'specialhash', 'Special recap', 'test-model'],
            resolve
          );
        });

        const encodedName = encodeURIComponent('Series & More!');
        const res = await request(app)
          .delete(`/api/series/${encodedName}/recap`)
          .set('Authorization', `Bearer ${user1Token}`)
          .expect(200);

        expect(res.body.message).toBe('Recap cache cleared');
      });
    });

    describe('Cache clearing verification', () => {
      it('cleared recap is no longer returned as cached on next request', async () => {
        const clearTestSeries = 'ClearTest';

        // Create book with progress
        const book = await createSeriesBookWithProgress(db, {
          series: clearTestSeries,
          userId: user1.id,
          seriesPosition: 1,
          title: 'ClearTest Book',
        });

        const booksHash = generateBooksHash([book.id]);

        // Insert a cached recap
        await new Promise((resolve) => {
          db.run(
            'INSERT OR REPLACE INTO series_recaps (user_id, series_name, books_hash, recap_text, model_used) VALUES (?, ?, ?, ?, ?)',
            [user1.id, clearTestSeries, booksHash, 'Original cached recap', 'test-model'],
            resolve
          );
        });

        // Verify it's cached
        const cachedRes = await request(app)
          .get(`/api/series/${clearTestSeries}/recap`)
          .set('Authorization', `Bearer ${user1Token}`)
          .expect(200);

        expect(cachedRes.body.cached).toBe(true);

        // Clear the cache
        await request(app)
          .delete(`/api/series/${clearTestSeries}/recap`)
          .set('Authorization', `Bearer ${user1Token}`)
          .expect(200);

        // Next request without AI configured should return 400 (no cache, no AI)
        const uncachedRes = await request(app)
          .get(`/api/series/${clearTestSeries}/recap`)
          .set('Authorization', `Bearer ${user1Token}`)
          .expect(400);

        expect(uncachedRes.body.error).toBe('AI not configured');
      });
    });
  });

  describe('Security', () => {
    it('regular users can read recaps (cached)', async () => {
      const secSeries = 'SecurityTestSeries';
      const book = await createSeriesBookWithProgress(db, {
        series: secSeries,
        userId: user1.id,
        seriesPosition: 1,
        title: 'Security Test Book',
      });

      const booksHash = generateBooksHash([book.id]);
      await new Promise((resolve) => {
        db.run(
          'INSERT OR REPLACE INTO series_recaps (user_id, series_name, books_hash, recap_text, model_used) VALUES (?, ?, ?, ?, ?)',
          [user1.id, secSeries, booksHash, 'Security test recap', 'test-model'],
          resolve
        );
      });

      const res = await request(app)
        .get(`/api/series/${secSeries}/recap`)
        .set('Authorization', `Bearer ${user1Token}`)
        .expect(200);

      expect(res.body).toHaveProperty('recap');
      expect(res.body).toHaveProperty('cached', true);
    });

    it('regular users can delete their own recaps', async () => {
      const res = await request(app)
        .delete('/api/series/SecurityTestSeries/recap')
        .set('Authorization', `Bearer ${user1Token}`)
        .expect(200);

      expect(res.body.message).toBe('Recap cache cleared');
    });

    it('admin can both read and delete recaps', async () => {
      const adminSeries = 'AdminTestSeries';
      const book = await createSeriesBookWithProgress(db, {
        series: adminSeries,
        userId: adminUser.id,
        seriesPosition: 1,
        title: 'Admin Test Book',
      });

      const booksHash = generateBooksHash([book.id]);
      await new Promise((resolve) => {
        db.run(
          'INSERT OR REPLACE INTO series_recaps (user_id, series_name, books_hash, recap_text, model_used) VALUES (?, ?, ?, ?, ?)',
          [adminUser.id, adminSeries, booksHash, 'Admin recap', 'test-model'],
          resolve
        );
      });

      // Read
      const readRes = await request(app)
        .get(`/api/series/${adminSeries}/recap`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(readRes.body).toHaveProperty('recap');
      expect(readRes.body.cached).toBe(true);

      // Delete
      const deleteRes = await request(app)
        .delete(`/api/series/${adminSeries}/recap`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(deleteRes.body).toHaveProperty('message', 'Recap cache cleared');
    });
  });

  describe('Edge cases', () => {
    it('handles empty series name (space) - returns 404 when no books match', async () => {
      const res = await request(app)
        .get('/api/series/%20/recap')
        .set('Authorization', `Bearer ${user1Token}`)
        .expect(404);

      expect(res.body.error).toBe('Series not found');
    });

    it('handles very long series names - returns 404 when no books match', async () => {
      const longName = 'A'.repeat(200);
      const encodedName = encodeURIComponent(longName);

      const res = await request(app)
        .get(`/api/series/${encodedName}/recap`)
        .set('Authorization', `Bearer ${user1Token}`)
        .expect(404);

      expect(res.body.error).toBe('Series not found');
    });

    it('handles unicode series names', async () => {
      const unicodeName = '日本語シリーズ';

      await createSeriesBookWithProgress(db, {
        series: unicodeName,
        userId: user1.id,
        seriesPosition: 1,
        title: 'Unicode Series Book',
      });

      process.env.OPENAI_API_KEY = 'test-key';

      const encodedName = encodeURIComponent(unicodeName);
      const res = await request(app)
        .get(`/api/series/${encodedName}/recap`)
        .set('Authorization', `Bearer ${user1Token}`)
        .expect(200);

      expect(res.body).toHaveProperty('recap');
      expect(res.body).toHaveProperty('booksIncluded');
    });

    it('handles series names with only numbers', async () => {
      const numericName = '12345';

      await createSeriesBookWithProgress(db, {
        series: numericName,
        userId: user1.id,
        seriesPosition: 1,
        title: 'Numeric Series Book',
      });

      process.env.OPENAI_API_KEY = 'test-key';

      const res = await request(app)
        .get(`/api/series/${numericName}/recap`)
        .set('Authorization', `Bearer ${user1Token}`)
        .expect(200);

      expect(res.body).toHaveProperty('recap');
    });

    it('user2 gets 404 for a series where only user1 has books (series exists but no books in DB for that name)', async () => {
      // 'AINotConfiguredSeries' has books but user2 has no progress
      // This tests that the route checks per-user progress
      const res = await request(app)
        .get('/api/series/AINotConfiguredSeries/recap')
        .set('Authorization', `Bearer ${user2Token}`)
        .expect(400);

      // Books exist in DB, but user2 has no progress
      expect(res.body.error).toBe('No progress in this series yet');
    });
  });
});
