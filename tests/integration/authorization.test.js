/**
 * Authorization Integration Tests
 * Tests that admin-only endpoints are properly protected
 */

const request = require('supertest');
const { createTestDatabase, createTestUser, generateTestToken, createTestApp } = require('./testApp');

describe('Authorization Tests', () => {
  let app;
  let db;
  let regularUser;
  let adminUser;
  let userToken;
  let adminToken;

  beforeAll(async () => {
    db = await createTestDatabase();
    app = createTestApp(db);

    // Create test users
    regularUser = await createTestUser(db, { username: 'regular', password: 'RegularPass123!' });
    adminUser = await createTestUser(db, { username: 'adminuser', password: 'AdminPass123!', isAdmin: true });

    userToken = generateTestToken(regularUser);
    adminToken = generateTestToken(adminUser);
  });

  afterAll((done) => {
    db.close(done);
  });

  describe('Token Security', () => {
    test('rejects requests without Authorization header', async () => {
      const response = await request(app)
        .get('/api/audiobooks')
        .expect(401);

      expect(response.body.error).toBe('Unauthorized');
    });

    test('rejects requests with invalid token format', async () => {
      const response = await request(app)
        .get('/api/audiobooks')
        .set('Authorization', 'InvalidFormat')
        .expect(401);

      expect(response.body.error).toBe('Unauthorized');
    });

    test('rejects requests with malformed Bearer token', async () => {
      const response = await request(app)
        .get('/api/audiobooks')
        .set('Authorization', 'Bearer not-a-valid-jwt')
        .expect(401);

      expect(response.body.error).toBe('Unauthorized');
    });

    test('accepts requests with valid Bearer token', async () => {
      const response = await request(app)
        .get('/api/audiobooks')
        .set('Authorization', `Bearer ${userToken}`)
        .expect(200);

      // Response is now paginated { audiobooks, total, limit, offset }
      expect(response.body).toHaveProperty('audiobooks');
      expect(Array.isArray(response.body.audiobooks)).toBe(true);
    });
  });

  describe('User Isolation', () => {
    test('users can only access their own profile', async () => {
      const response = await request(app)
        .get('/api/profile')
        .set('Authorization', `Bearer ${userToken}`)
        .expect(200);

      expect(response.body.username).toBe('regular');
      expect(response.body.username).not.toBe('adminuser');
    });

    test('admin users have admin flag set', async () => {
      const response = await request(app)
        .get('/api/profile')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.is_admin).toBe(1);
    });

    test('regular users do not have admin flag', async () => {
      const response = await request(app)
        .get('/api/profile')
        .set('Authorization', `Bearer ${userToken}`)
        .expect(200);

      expect(response.body.is_admin).toBe(0);
    });
  });

  describe('Authentication Error Messages', () => {
    test('login failure does not reveal if username exists', async () => {
      // Test with non-existent user
      const response1 = await request(app)
        .post('/api/auth/login')
        .send({ username: 'nonexistent', password: 'wrongpass' })
        .expect(401);

      // Test with existing user, wrong password
      const response2 = await request(app)
        .post('/api/auth/login')
        .send({ username: 'regular', password: 'wrongpass' })
        .expect(401);

      // Both should return the same generic error message
      expect(response1.body.error).toBe('Invalid username or password');
      expect(response2.body.error).toBe('Invalid username or password');
    });
  });

  describe('Admin-Only Endpoints', () => {
    test('non-admin users cannot delete audiobooks', async () => {
      const response = await request(app)
        .delete('/api/audiobooks/1')
        .set('Authorization', `Bearer ${userToken}`)
        .expect(403);

      expect(response.body.error).toBe('Admin access required');
    });

    test('admin users can access delete audiobook endpoint', async () => {
      // This will return 404 since audiobook doesn't exist, but proves admin access works
      const response = await request(app)
        .delete('/api/audiobooks/999')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(404);

      expect(response.body.error).toBe('Audiobook not found');
    });

    test('non-admin users cannot delete audiobook files', async () => {
      const response = await request(app)
        .delete('/api/audiobooks/1/files')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ file_path: '/some/path' })
        .expect(403);

      expect(response.body.error).toBe('Admin access required');
    });

    test('admin users can access delete files endpoint', async () => {
      // This will return 404 since audiobook doesn't exist, but proves admin access works
      const response = await request(app)
        .delete('/api/audiobooks/999/files')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ file_path: '/some/path' })
        .expect(404);

      expect(response.body.error).toBe('Audiobook not found');
    });
  });
});
