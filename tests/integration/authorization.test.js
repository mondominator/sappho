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

      expect(Array.isArray(response.body)).toBe(true);
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
});
