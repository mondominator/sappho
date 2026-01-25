/**
 * Integration tests for Auth Routes
 * Tests login, logout, registration, and account security
 */

const request = require('supertest');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { createTestDatabase, createTestUser, generateTestToken, createTestApp } = require('./testApp');

const JWT_SECRET = process.env.JWT_SECRET || 'test-secret';

describe('Auth Routes', () => {
  let app, db, testUser, userToken, adminUser, adminToken;

  beforeAll(async () => {
    db = await createTestDatabase();
    app = createTestApp(db);

    // Create test users
    testUser = await createTestUser(db, { username: 'authuser', password: 'Test123!@#' });
    userToken = generateTestToken(testUser);

    adminUser = await createTestUser(db, { username: 'authadmin', password: 'Admin123!@#', isAdmin: true });
    adminToken = generateTestToken(adminUser);
  });

  afterAll((done) => {
    db.close(done);
  });

  describe('POST /api/auth/login', () => {
    it('returns 400 without username', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ password: 'Test123!@#' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('required');
    });

    it('returns 400 without password', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ username: 'authuser' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('required');
    });

    it('returns 401 for invalid username', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ username: 'nonexistent', password: 'Test123!@#' });

      expect(res.status).toBe(401);
      expect(res.body.error).toContain('Invalid');
    });

    it('returns 401 for invalid password', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ username: 'authuser', password: 'wrongpassword' });

      expect(res.status).toBe(401);
      expect(res.body.error).toContain('Invalid');
    });

    it('returns token on successful login', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ username: 'authuser', password: 'Test123!@#' });

      expect(res.status).toBe(200);
      expect(res.body.token).toBeDefined();
      expect(res.body.user).toBeDefined();
      expect(res.body.user.username).toBe('authuser');
    });

    it('returns must_change_password flag when set', async () => {
      // Create user with must_change_password
      await new Promise((resolve, reject) => {
        const hash = bcrypt.hashSync('Temp123!@#', 10);
        db.run(
          'INSERT INTO users (username, password_hash, must_change_password) VALUES (?, ?, 1)',
          ['tempuser', hash],
          function(err) {
            if (err) reject(err);
            else resolve();
          }
        );
      });

      const res = await request(app)
        .post('/api/auth/login')
        .send({ username: 'tempuser', password: 'Temp123!@#' });

      expect(res.status).toBe(200);
      expect(res.body.must_change_password).toBe(true);
    });
  });

  describe('Token Authentication', () => {
    it('accepts valid bearer token', async () => {
      const res = await request(app)
        .get('/api/audiobooks')
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.status).toBe(200);
    });

    it('returns 401 without token', async () => {
      const res = await request(app)
        .get('/api/audiobooks');

      expect(res.status).toBe(401);
    });

    it('returns 401 for invalid token', async () => {
      const res = await request(app)
        .get('/api/audiobooks')
        .set('Authorization', 'Bearer invalid-token');

      expect(res.status).toBe(401);
    });

    it('returns 401 for expired token', async () => {
      const expiredToken = jwt.sign(
        { id: testUser.id, username: testUser.username },
        JWT_SECRET,
        { expiresIn: '-1h' }
      );

      const res = await request(app)
        .get('/api/audiobooks')
        .set('Authorization', `Bearer ${expiredToken}`);

      expect(res.status).toBe(401);
    });

    it('returns 401 for malformed authorization header', async () => {
      const res = await request(app)
        .get('/api/audiobooks')
        .set('Authorization', 'InvalidFormat token');

      expect(res.status).toBe(401);
    });
  });

  describe('Admin Authorization', () => {
    it('allows admin access to admin endpoints', async () => {
      const res = await request(app)
        .get('/api/users')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
    });

    it('denies non-admin access to admin endpoints', async () => {
      const res = await request(app)
        .get('/api/users')
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.status).toBe(403);
    });
  });

  describe('Password Validation', () => {
    it('rejects password shorter than 6 characters', async () => {
      const res = await request(app)
        .post('/api/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ username: 'shortpw', password: 'Aa1!' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('6 characters');
    });

    it('rejects password without uppercase', async () => {
      const res = await request(app)
        .post('/api/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ username: 'nouppercase', password: 'test123!@#' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('uppercase');
    });

    it('rejects password without lowercase', async () => {
      const res = await request(app)
        .post('/api/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ username: 'nolowercase', password: 'TEST123!@#' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('lowercase');
    });

    it('rejects password without number', async () => {
      const res = await request(app)
        .post('/api/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ username: 'nonumber', password: 'TestTest!@#' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('number');
    });

    it('rejects password without special character', async () => {
      const res = await request(app)
        .post('/api/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ username: 'nospecial', password: 'TestTest123' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('special');
    });

    it('accepts valid password', async () => {
      const res = await request(app)
        .post('/api/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ username: 'validpw', password: 'ValidPass123!@#' });

      expect(res.status).toBe(201);
    });
  });

  describe('Session Security', () => {
    it('different users have different tokens', async () => {
      const token1 = generateTestToken(testUser);
      const token2 = generateTestToken(adminUser);

      expect(token1).not.toBe(token2);

      // Both tokens should work
      const res1 = await request(app)
        .get('/api/audiobooks')
        .set('Authorization', `Bearer ${token1}`);
      expect(res1.status).toBe(200);

      const res2 = await request(app)
        .get('/api/audiobooks')
        .set('Authorization', `Bearer ${token2}`);
      expect(res2.status).toBe(200);
    });

    it('token contains user id and username', () => {
      const decoded = jwt.verify(userToken, JWT_SECRET);

      expect(decoded.id).toBe(testUser.id);
      expect(decoded.username).toBe(testUser.username);
    });
  });
});
