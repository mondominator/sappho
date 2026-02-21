/**
 * API Integration Tests
 * Tests API endpoints with in-memory database
 */

const request = require('supertest');
const { createTestDatabase, createTestUser, generateTestToken, createTestApp } = require('./testApp');

describe('API Integration Tests', () => {
  let app;
  let db;
  let testUser;
  let adminUser;
  let userToken;
  let adminToken;

  beforeAll(async () => {
    db = await createTestDatabase();
    app = createTestApp(db);

    // Create test users
    testUser = await createTestUser(db, { username: 'testuser', password: 'TestPass123!' });
    adminUser = await createTestUser(db, { username: 'admin', password: 'AdminPass123!', isAdmin: true });

    userToken = generateTestToken(testUser);
    adminToken = generateTestToken(adminUser);
  });

  afterAll((done) => {
    db.close(done);
  });

  describe('Health Check', () => {
    test('GET /health returns ok status', async () => {
      const response = await request(app)
        .get('/health')
        .expect(200);

      expect(response.body.status).toBe('ok');
    });
  });

  describe('Authentication', () => {
    test('POST /api/auth/login with valid credentials returns token', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({ username: 'testuser', password: 'TestPass123!' })
        .expect(200);

      expect(response.body.token).toBeDefined();
      expect(response.body.user.username).toBe('testuser');
    });

    test('POST /api/auth/login with invalid password returns 401', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({ username: 'testuser', password: 'wrongpassword' })
        .expect(401);

      expect(response.body.error).toBe('Invalid username or password');
    });

    test('POST /api/auth/login with non-existent user returns 401', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({ username: 'nonexistent', password: 'password' })
        .expect(401);

      expect(response.body.error).toBe('Invalid username or password');
    });

    test('POST /api/auth/login without credentials returns 400', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({})
        .expect(400);

      expect(response.body.error).toBe('Username and password are required');
    });
  });

  describe('Profile', () => {
    test('GET /api/profile with valid token returns user data', async () => {
      const response = await request(app)
        .get('/api/profile')
        .set('Authorization', `Bearer ${userToken}`)
        .expect(200);

      expect(response.body.username).toBe('testuser');
      expect(response.body.is_admin).toBe(0);
    });

    test('GET /api/profile with admin token returns admin data', async () => {
      const response = await request(app)
        .get('/api/profile')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.username).toBe('admin');
      expect(response.body.is_admin).toBe(1);
    });

    test('GET /api/profile without token returns 401', async () => {
      const response = await request(app)
        .get('/api/profile')
        .expect(401);

      expect(response.body.error).toBe('Access token required');
    });

    test('GET /api/profile with invalid token returns 401', async () => {
      const response = await request(app)
        .get('/api/profile')
        .set('Authorization', 'Bearer invalid-token')
        .expect(401);

      expect(response.body.error).toBe('Invalid or expired token');
    });
  });

  describe('Audiobooks', () => {
    test('GET /api/audiobooks with valid token returns paginated response', async () => {
      const response = await request(app)
        .get('/api/audiobooks')
        .set('Authorization', `Bearer ${userToken}`)
        .expect(200);

      // Response is now paginated { audiobooks, total, limit, offset }
      expect(response.body).toHaveProperty('audiobooks');
      expect(Array.isArray(response.body.audiobooks)).toBe(true);
      expect(response.body).toHaveProperty('total');
    });

    test('GET /api/audiobooks without token returns 401', async () => {
      const response = await request(app)
        .get('/api/audiobooks')
        .expect(401);

      expect(response.body.error).toBe('Access token required');
    });
  });
});
