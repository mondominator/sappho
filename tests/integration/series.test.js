/**
 * Integration tests for Series Routes
 * Tests: Get series recap, clear cached recap
 */

const request = require('supertest');
const {
  createTestDatabase,
  createTestUser,
  generateTestToken,
  createTestApp
} = require('./testApp');

describe('Series Routes', () => {
  let db;
  let app;
  let user1, user2, adminUser;
  let user1Token, user2Token, adminToken;

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
    db.close(done);
  });

  describe('GET /api/series/:seriesName/recap', () => {
    describe('Authentication', () => {
      it('returns 401 without authentication', async () => {
        const res = await request(app)
          .get('/api/series/TestSeries/recap')
          .expect(401);

        expect(res.body.error).toBe('Unauthorized');
      });
    });

    describe('Response data', () => {
      it('returns recap for a series', async () => {
        const res = await request(app)
          .get('/api/series/TestSeries/recap')
          .set('Authorization', `Bearer ${user1Token}`)
          .expect(200);

        expect(res.body).toHaveProperty('seriesName', 'TestSeries');
        expect(res.body).toHaveProperty('recap');
        expect(res.body).toHaveProperty('generatedAt');
      });

      it('returns mock data when no cache exists', async () => {
        const res = await request(app)
          .get('/api/series/NewSeries/recap')
          .set('Authorization', `Bearer ${user1Token}`)
          .expect(200);

        expect(res.body).toHaveProperty('cached', false);
        expect(res.body.recap).toContain('Mock series recap');
      });

      it('handles URL-encoded series names', async () => {
        const seriesName = 'Harry Potter & The Sorcerer\'s Stone';
        const encodedName = encodeURIComponent(seriesName);

        const res = await request(app)
          .get(`/api/series/${encodedName}/recap`)
          .set('Authorization', `Bearer ${user1Token}`)
          .expect(200);

        expect(res.body.seriesName).toBe(seriesName);
      });

      it('handles series names with spaces', async () => {
        const seriesName = 'Lord of the Rings';
        const encodedName = encodeURIComponent(seriesName);

        const res = await request(app)
          .get(`/api/series/${encodedName}/recap`)
          .set('Authorization', `Bearer ${user1Token}`)
          .expect(200);

        expect(res.body.seriesName).toBe(seriesName);
      });

      it('handles series names with special characters', async () => {
        const seriesName = 'Series: The Beginning!';
        const encodedName = encodeURIComponent(seriesName);

        const res = await request(app)
          .get(`/api/series/${encodedName}/recap`)
          .set('Authorization', `Bearer ${user1Token}`)
          .expect(200);

        expect(res.body.seriesName).toBe(seriesName);
      });
    });

    describe('Caching behavior', () => {
      beforeEach(async () => {
        // Insert a cached recap into the database
        await new Promise((resolve, reject) => {
          db.run(
            'INSERT OR REPLACE INTO series_recaps (series_name, recap, created_at) VALUES (?, ?, ?)',
            ['CachedSeries', 'This is a cached recap.', new Date().toISOString()],
            (err) => {
              if (err) reject(err);
              else resolve();
            }
          );
        });
      });

      afterEach(async () => {
        // Clean up
        await new Promise((resolve) => {
          db.run('DELETE FROM series_recaps WHERE series_name = ?', ['CachedSeries'], resolve);
        });
      });

      it('returns cached recap when available', async () => {
        const res = await request(app)
          .get('/api/series/CachedSeries/recap')
          .set('Authorization', `Bearer ${user1Token}`)
          .expect(200);

        expect(res.body).toHaveProperty('cached', true);
        expect(res.body.recap).toBe('This is a cached recap.');
      });

      it('includes generatedAt for cached recaps', async () => {
        const res = await request(app)
          .get('/api/series/CachedSeries/recap')
          .set('Authorization', `Bearer ${user1Token}`)
          .expect(200);

        expect(res.body).toHaveProperty('generatedAt');
      });
    });
  });

  describe('DELETE /api/series/:seriesName/recap', () => {
    describe('Authentication', () => {
      it('returns 401 without authentication', async () => {
        const res = await request(app)
          .delete('/api/series/TestSeries/recap')
          .expect(401);

        expect(res.body.error).toBe('Unauthorized');
      });

      it('returns 403 for non-admin users', async () => {
        const res = await request(app)
          .delete('/api/series/TestSeries/recap')
          .set('Authorization', `Bearer ${user1Token}`)
          .expect(403);

        expect(res.body.error).toBe('Admin access required');
      });
    });

    describe('Success cases', () => {
      beforeEach(async () => {
        // Insert a recap to delete
        await new Promise((resolve, reject) => {
          db.run(
            'INSERT OR REPLACE INTO series_recaps (series_name, recap) VALUES (?, ?)',
            ['DeleteMe', 'Recap to be deleted'],
            (err) => {
              if (err) reject(err);
              else resolve();
            }
          );
        });
      });

      it('admin can delete cached recap', async () => {
        const res = await request(app)
          .delete('/api/series/DeleteMe/recap')
          .set('Authorization', `Bearer ${adminToken}`)
          .expect(200);

        expect(res.body).toHaveProperty('success', true);
        expect(res.body).toHaveProperty('deleted', true);
      });

      it('returns deleted: false for non-existent recap', async () => {
        const res = await request(app)
          .delete('/api/series/NonExistent/recap')
          .set('Authorization', `Bearer ${adminToken}`)
          .expect(200);

        expect(res.body).toHaveProperty('success', true);
        expect(res.body).toHaveProperty('deleted', false);
      });

      it('handles URL-encoded series names on delete', async () => {
        // Insert with special characters
        await new Promise((resolve) => {
          db.run(
            'INSERT OR REPLACE INTO series_recaps (series_name, recap) VALUES (?, ?)',
            ['Series & More!', 'Special recap'],
            resolve
          );
        });

        const encodedName = encodeURIComponent('Series & More!');
        const res = await request(app)
          .delete(`/api/series/${encodedName}/recap`)
          .set('Authorization', `Bearer ${adminToken}`)
          .expect(200);

        expect(res.body.success).toBe(true);
      });
    });

    describe('Cache clearing verification', () => {
      it('cleared recap returns uncached data on next request', async () => {
        // Insert a cached recap
        await new Promise((resolve) => {
          db.run(
            'INSERT INTO series_recaps (series_name, recap) VALUES (?, ?)',
            ['ClearTest', 'Original cached recap'],
            resolve
          );
        });

        // Verify it's cached
        const cachedRes = await request(app)
          .get('/api/series/ClearTest/recap')
          .set('Authorization', `Bearer ${user1Token}`)
          .expect(200);

        expect(cachedRes.body.cached).toBe(true);

        // Clear the cache
        await request(app)
          .delete('/api/series/ClearTest/recap')
          .set('Authorization', `Bearer ${adminToken}`)
          .expect(200);

        // Verify it's no longer cached
        const uncachedRes = await request(app)
          .get('/api/series/ClearTest/recap')
          .set('Authorization', `Bearer ${user1Token}`)
          .expect(200);

        expect(uncachedRes.body.cached).toBe(false);
      });
    });
  });

  describe('Security', () => {
    it('regular users can read recaps', async () => {
      const res = await request(app)
        .get('/api/series/SecurityTest/recap')
        .set('Authorization', `Bearer ${user1Token}`)
        .expect(200);

      expect(res.body).toHaveProperty('seriesName');
    });

    it('regular users cannot delete recaps', async () => {
      await request(app)
        .delete('/api/series/SecurityTest/recap')
        .set('Authorization', `Bearer ${user1Token}`)
        .expect(403);
    });

    it('admin can both read and delete recaps', async () => {
      // Read
      const readRes = await request(app)
        .get('/api/series/AdminTest/recap')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(readRes.body).toHaveProperty('seriesName');

      // Delete
      const deleteRes = await request(app)
        .delete('/api/series/AdminTest/recap')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(deleteRes.body).toHaveProperty('success', true);
    });
  });

  describe('Edge cases', () => {
    it('handles empty series name', async () => {
      // Empty series name would not match the route pattern
      // so this tests that the route handles edge cases
      const res = await request(app)
        .get('/api/series/%20/recap')
        .set('Authorization', `Bearer ${user1Token}`)
        .expect(200);

      // Space is a valid series name, just unusual
      expect(res.body).toHaveProperty('seriesName', ' ');
    });

    it('handles very long series names', async () => {
      const longName = 'A'.repeat(200);
      const encodedName = encodeURIComponent(longName);

      const res = await request(app)
        .get(`/api/series/${encodedName}/recap`)
        .set('Authorization', `Bearer ${user1Token}`)
        .expect(200);

      expect(res.body.seriesName).toBe(longName);
    });

    it('handles unicode series names', async () => {
      const unicodeName = '日本語シリーズ';
      const encodedName = encodeURIComponent(unicodeName);

      const res = await request(app)
        .get(`/api/series/${encodedName}/recap`)
        .set('Authorization', `Bearer ${user1Token}`)
        .expect(200);

      expect(res.body.seriesName).toBe(unicodeName);
    });

    it('handles series names with only numbers', async () => {
      const res = await request(app)
        .get('/api/series/12345/recap')
        .set('Authorization', `Bearer ${user1Token}`)
        .expect(200);

      expect(res.body.seriesName).toBe('12345');
    });
  });
});
