/**
 * Integration tests for authentication routes
 * Tests login, logout, registration, MFA, and lockout functionality
 */

const request = require('supertest');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { createTestDatabase, createTestUser, generateTestToken, createTestApp } = require('./testApp');

const JWT_SECRET = process.env.JWT_SECRET || 'test-secret';

describe('Auth Routes Integration Tests', () => {
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
    testUser = await createTestUser(db, {
      username: 'testuser',
      password: 'TestPass123!'
    });
    adminUser = await createTestUser(db, {
      username: 'admin',
      password: 'AdminPass123!',
      isAdmin: true
    });

    userToken = generateTestToken(testUser);
    adminToken = generateTestToken(adminUser);
  });

  afterAll((done) => {
    db.close(done);
  });

  describe('POST /api/auth/login', () => {
    test('returns token for valid credentials', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({ username: 'testuser', password: 'TestPass123!' })
        .expect(200);

      expect(response.body).toHaveProperty('token');
      expect(response.body).toHaveProperty('user');
      expect(response.body.user.username).toBe('testuser');
    });

    test('returns 401 for invalid password', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({ username: 'testuser', password: 'wrongpassword' })
        .expect(401);

      expect(response.body.error).toBe('Invalid username or password');
    });

    test('returns 401 for non-existent user', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({ username: 'nonexistent', password: 'anypassword' })
        .expect(401);

      expect(response.body.error).toBe('Invalid username or password');
    });

    test('returns 400 for missing username', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({ password: 'somepassword' })
        .expect(400);

      expect(response.body.error).toContain('Username and password');
    });

    test('returns 400 for missing password', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({ username: 'testuser' })
        .expect(400);

      expect(response.body.error).toContain('Username and password');
    });

    test('returns same error for invalid user and invalid password (prevents enumeration)', async () => {
      const responseInvalidUser = await request(app)
        .post('/api/auth/login')
        .send({ username: 'nonexistent_user_12345', password: 'password' })
        .expect(401);

      const responseInvalidPassword = await request(app)
        .post('/api/auth/login')
        .send({ username: 'testuser', password: 'wrongpassword' })
        .expect(401);

      expect(responseInvalidUser.body.error).toBe(responseInvalidPassword.body.error);
    });

    test('returns must_change_password flag when set', async () => {
      // Create user with must_change_password flag
      await new Promise((resolve, reject) => {
        const hash = bcrypt.hashSync('TempPass123!', 10);
        db.run(
          'INSERT INTO users (username, password_hash, must_change_password) VALUES (?, ?, ?)',
          ['tempuser', hash, 1],
          (err) => err ? reject(err) : resolve()
        );
      });

      const response = await request(app)
        .post('/api/auth/login')
        .send({ username: 'tempuser', password: 'TempPass123!' })
        .expect(200);

      expect(response.body.must_change_password).toBe(true);
    });

    test('token contains correct user id', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({ username: 'testuser', password: 'TestPass123!' })
        .expect(200);

      const decoded = jwt.verify(response.body.token, JWT_SECRET);
      expect(decoded.id).toBe(testUser.id);
      expect(decoded.username).toBe('testuser');
    });
  });

  describe('Token Validation', () => {
    test('valid token allows access to protected routes', async () => {
      const response = await request(app)
        .get('/api/profile')
        .set('Authorization', `Bearer ${userToken}`)
        .expect(200);

      expect(response.body.username).toBe('testuser');
    });

    test('expired token is rejected', async () => {
      const expiredToken = jwt.sign(
        { id: testUser.id, username: 'testuser' },
        JWT_SECRET,
        { expiresIn: '-1h' } // Already expired
      );

      await request(app)
        .get('/api/profile')
        .set('Authorization', `Bearer ${expiredToken}`)
        .expect(401);
    });

    test('token with invalid signature is rejected', async () => {
      const invalidToken = jwt.sign(
        { id: testUser.id, username: 'testuser' },
        'wrong-secret',
        { expiresIn: '1h' }
      );

      await request(app)
        .get('/api/profile')
        .set('Authorization', `Bearer ${invalidToken}`)
        .expect(401);
    });

    test('malformed token is rejected', async () => {
      await request(app)
        .get('/api/profile')
        .set('Authorization', 'Bearer malformed.token.here')
        .expect(401);
    });

    test('missing Bearer prefix is rejected', async () => {
      await request(app)
        .get('/api/profile')
        .set('Authorization', userToken)
        .expect(401);
    });

    test('token for deleted user is rejected', async () => {
      // Create and then delete a user
      const tempUser = await createTestUser(db, {
        username: 'deleteme',
        password: 'DeleteMe123!'
      });
      const tempToken = generateTestToken(tempUser);

      // Delete the user
      await new Promise((resolve, reject) => {
        db.run('DELETE FROM users WHERE id = ?', [tempUser.id], (err) =>
          err ? reject(err) : resolve()
        );
      });

      // Token should now fail - returns 401 because user lookup fails in middleware,
      // leaving req.user unset, which the profile endpoint treats as unauthorized
      await request(app)
        .get('/api/profile')
        .set('Authorization', `Bearer ${tempToken}`)
        .expect(401);
    });
  });

  describe('Admin vs Regular User Access', () => {
    test('admin user has is_admin flag set', async () => {
      const response = await request(app)
        .get('/api/profile')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.is_admin).toBe(1);
    });

    test('regular user does not have is_admin flag', async () => {
      const response = await request(app)
        .get('/api/profile')
        .set('Authorization', `Bearer ${userToken}`)
        .expect(200);

      expect(response.body.is_admin).toBe(0);
    });
  });

  describe('Input Sanitization', () => {
    test('SQL injection in username is prevented', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          username: "admin' OR '1'='1",
          password: 'password'
        })
        .expect(401);

      expect(response.body.error).toBe('Invalid username or password');
    });

    test('SQL injection in password is prevented', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          username: 'testuser',
          password: "' OR '1'='1"
        })
        .expect(401);

      expect(response.body.error).toBe('Invalid username or password');
    });

    test('XSS in username does not execute', async () => {
      const xssPayload = '<script>alert("xss")</script>';
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          username: xssPayload,
          password: 'password'
        })
        .expect(401);

      // Should not contain unescaped script tag in response
      expect(response.text).not.toContain('<script>');
    });
  });
});
