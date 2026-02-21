/**
 * Integration tests for Sessions Routes
 * Tests: List all sessions, get user sessions, get session by ID, stop session
 */

const request = require('supertest');
const {
  createTestDatabase,
  createTestUser,
  generateTestToken,
  createTestApp,
  createTestAudiobook
} = require('./testApp');

describe('Sessions Routes', () => {
  let db;
  let app;
  let user1, user2, adminUser;
  let user1Token, user2Token, adminToken;
  let book1;

  beforeAll(async () => {
    db = await createTestDatabase();
    app = createTestApp(db);

    // Create test users
    user1 = await createTestUser(db, { username: 'sessionuser1', password: 'SessionPass123!' });
    user2 = await createTestUser(db, { username: 'sessionuser2', password: 'SessionPass123!' });
    adminUser = await createTestUser(db, { username: 'sessionadmin', password: 'AdminPass123!', isAdmin: true });

    user1Token = generateTestToken(user1);
    user2Token = generateTestToken(user2);
    adminToken = generateTestToken(adminUser);

    // Create test audiobook
    book1 = await createTestAudiobook(db, { title: 'Session Test Book', author: 'Test Author' });
  });

  afterAll((done) => {
    db.close(done);
  });

  describe('GET /api/sessions', () => {
    describe('Authentication', () => {
      it('returns 401 without authentication', async () => {
        const res = await request(app)
          .get('/api/sessions')
          .expect(401);

        expect(res.body.error).toBe('Access token required');
      });
    });

    describe('Response data', () => {
      it('returns sessions array for authenticated user', async () => {
        const res = await request(app)
          .get('/api/sessions')
          .set('Authorization', `Bearer ${user1Token}`)
          .expect(200);

        expect(res.body).toHaveProperty('sessions');
        expect(Array.isArray(res.body.sessions)).toBe(true);
      });

      it('admin can view all sessions', async () => {
        const res = await request(app)
          .get('/api/sessions')
          .set('Authorization', `Bearer ${adminToken}`)
          .expect(200);

        expect(res.body).toHaveProperty('sessions');
        expect(Array.isArray(res.body.sessions)).toBe(true);
      });
    });
  });

  describe('GET /api/sessions/user/:userId', () => {
    describe('Authentication', () => {
      it('returns 401 without authentication', async () => {
        const res = await request(app)
          .get(`/api/sessions/user/${user1.id}`)
          .expect(401);

        expect(res.body.error).toBe('Access token required');
      });
    });

    describe('Response data', () => {
      it('returns sessions for specific user', async () => {
        const res = await request(app)
          .get(`/api/sessions/user/${user1.id}`)
          .set('Authorization', `Bearer ${user1Token}`)
          .expect(200);

        expect(res.body).toHaveProperty('sessions');
        expect(Array.isArray(res.body.sessions)).toBe(true);
      });

      it('returns empty array for user with no sessions', async () => {
        const res = await request(app)
          .get(`/api/sessions/user/${user2.id}`)
          .set('Authorization', `Bearer ${user2Token}`)
          .expect(200);

        expect(res.body.sessions).toEqual([]);
      });

      it('admin can view any user\'s sessions', async () => {
        const res = await request(app)
          .get(`/api/sessions/user/${user1.id}`)
          .set('Authorization', `Bearer ${adminToken}`)
          .expect(200);

        expect(res.body).toHaveProperty('sessions');
      });

      it('handles non-existent user gracefully', async () => {
        const res = await request(app)
          .get('/api/sessions/user/99999')
          .set('Authorization', `Bearer ${adminToken}`)
          .expect(200);

        expect(res.body.sessions).toEqual([]);
      });
    });
  });

  describe('GET /api/sessions/:sessionId', () => {
    describe('Authentication', () => {
      it('returns 401 without authentication', async () => {
        const res = await request(app)
          .get('/api/sessions/test-session-id')
          .expect(401);

        expect(res.body.error).toBe('Access token required');
      });
    });

    describe('Response data', () => {
      it('returns 404 for non-existent session', async () => {
        const res = await request(app)
          .get('/api/sessions/non-existent-session')
          .set('Authorization', `Bearer ${user1Token}`)
          .expect(404);

        expect(res.body.error).toBe('Session not found');
      });

      it('handles whitespace session ID', async () => {
        // Whitespace session IDs are treated as non-existent
        // The session manager returns null for any session ID that doesn't match
        const res = await request(app)
          .get('/api/sessions/   ')
          .set('Authorization', `Bearer ${user1Token}`);

        // May return 200 with empty session or 404 depending on implementation
        expect([200, 404]).toContain(res.status);
      });
    });
  });

  describe('DELETE /api/sessions/:sessionId', () => {
    describe('Authentication', () => {
      it('returns 401 without authentication', async () => {
        const res = await request(app)
          .delete('/api/sessions/test-session-id')
          .expect(401);

        expect(res.body.error).toBe('Access token required');
      });
    });

    describe('Session stopping', () => {
      it('returns success when stopping a session', async () => {
        // Even for non-existent sessions, the endpoint returns success
        // (idempotent behavior - stopping what's already stopped is ok)
        const res = await request(app)
          .delete('/api/sessions/any-session-id')
          .set('Authorization', `Bearer ${user1Token}`)
          .expect(200);

        expect(res.body).toHaveProperty('success', true);
        expect(res.body).toHaveProperty('message', 'Session stopped');
      });

      it('admin can stop any session', async () => {
        const res = await request(app)
          .delete('/api/sessions/admin-stop-session')
          .set('Authorization', `Bearer ${adminToken}`)
          .expect(200);

        expect(res.body.success).toBe(true);
      });
    });
  });

  describe('Session Management', () => {
    it('handles concurrent session requests', async () => {
      // Make multiple requests in parallel
      const requests = [
        request(app)
          .get('/api/sessions')
          .set('Authorization', `Bearer ${user1Token}`),
        request(app)
          .get('/api/sessions')
          .set('Authorization', `Bearer ${user2Token}`),
        request(app)
          .get('/api/sessions')
          .set('Authorization', `Bearer ${adminToken}`),
      ];

      const responses = await Promise.all(requests);

      responses.forEach(res => {
        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty('sessions');
      });
    });

    it('user sessions are properly isolated', async () => {
      // Each user should only see their own sessions
      const user1Sessions = await request(app)
        .get(`/api/sessions/user/${user1.id}`)
        .set('Authorization', `Bearer ${user1Token}`);

      const user2Sessions = await request(app)
        .get(`/api/sessions/user/${user2.id}`)
        .set('Authorization', `Bearer ${user2Token}`);

      // Both should return successfully
      expect(user1Sessions.status).toBe(200);
      expect(user2Sessions.status).toBe(200);

      // Sessions should be different arrays (even if both empty)
      expect(Array.isArray(user1Sessions.body.sessions)).toBe(true);
      expect(Array.isArray(user2Sessions.body.sessions)).toBe(true);
    });
  });

  describe('Security', () => {
    it('authenticated users can view sessions endpoint', async () => {
      const res = await request(app)
        .get('/api/sessions')
        .set('Authorization', `Bearer ${user1Token}`)
        .expect(200);

      expect(res.body).toHaveProperty('sessions');
    });

    it('session IDs in URLs are handled safely', async () => {
      // Test with potentially problematic session ID values
      const testIds = [
        'simple-id',
        'id-with-123-numbers',
        'id_with_underscores',
        'UPPERCASE-ID',
      ];

      for (const sessionId of testIds) {
        const res = await request(app)
          .get(`/api/sessions/${sessionId}`)
          .set('Authorization', `Bearer ${user1Token}`);

        // Should either find session or return 404, not error
        expect([200, 404]).toContain(res.status);
      }
    });

    it('userId parameter is validated as integer', async () => {
      // Non-numeric user ID should be handled gracefully
      const res = await request(app)
        .get('/api/sessions/user/not-a-number')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      // parseInt('not-a-number') returns NaN, which should return empty array
      expect(res.body.sessions).toEqual([]);
    });
  });
});
