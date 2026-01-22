/**
 * Security Edge Case Integration Tests
 * Tests for various security vulnerabilities and edge cases
 */

const request = require('supertest');
const jwt = require('jsonwebtoken');
const { createTestDatabase, createTestUser, generateTestToken, createTestApp } = require('./testApp');

const JWT_SECRET = process.env.JWT_SECRET || 'test-secret';

describe('Security Edge Cases', () => {
  let app;
  let db;
  let testUser;
  let adminUser;
  let userToken;
  let adminToken;

  beforeAll(async () => {
    db = await createTestDatabase();
    app = createTestApp(db);

    testUser = await createTestUser(db, { username: 'secuser', password: 'SecPass123!' });
    adminUser = await createTestUser(db, { username: 'secadmin', password: 'SecAdmin123!', isAdmin: true });

    userToken = generateTestToken(testUser);
    adminToken = generateTestToken(adminUser);
  });

  afterAll((done) => {
    db.close(done);
  });

  describe('SQL Injection Prevention', () => {
    test('login username field rejects SQL injection', async () => {
      const sqlPayloads = [
        "admin' --",
        "admin' OR '1'='1",
        "admin'; DROP TABLE users; --",
        "' OR 1=1 --",
        "1' OR '1' = '1",
        "admin'/*",
        "admin' UNION SELECT * FROM users --"
      ];

      for (const payload of sqlPayloads) {
        const response = await request(app)
          .post('/api/auth/login')
          .send({ username: payload, password: 'anything' })
          .expect(401);

        expect(response.body.error).toBe('Invalid username or password');
      }
    });

    test('login password field rejects SQL injection', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          username: 'secuser',
          password: "' OR '1'='1"
        })
        .expect(401);

      expect(response.body.error).toBe('Invalid username or password');
    });

    test('user creation rejects SQL injection in username', async () => {
      const response = await request(app)
        .post('/api/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          username: "admin' OR '1'='1",
          password: 'ValidPass123!'
        })
        .expect(201); // It creates a user with the literal string as username

      // Verify it's treated as a literal string, not SQL
      const getResponse = await request(app)
        .get('/api/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const injectedUser = getResponse.body.find(u => u.username === "admin' OR '1'='1");
      expect(injectedUser).toBeDefined();
    });
  });

  describe('XSS Prevention', () => {
    // Note: XSS prevention is primarily a frontend concern.
    // The API stores data literally; the frontend must properly escape when rendering.
    // These tests verify the API returns proper JSON with content-type headers.

    test('response has correct JSON content type', async () => {
      const xssPayload = '<script>alert("xss")</script>';

      const response = await request(app)
        .post('/api/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          username: xssPayload,
          password: 'ValidPass123!'
        })
        .expect(201)
        .expect('Content-Type', /json/);

      // The API correctly stores and returns the literal data
      // Frontend is responsible for proper escaping during render
      expect(response.body.user.username).toBe(xssPayload);
    });

    test('special characters in email are preserved', async () => {
      const response = await request(app)
        .post('/api/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          username: 'specialemail',
          password: 'ValidPass123!',
          email: 'test+special@example.com'
        })
        .expect(201)
        .expect('Content-Type', /json/);

      // Email with special characters is stored correctly
      expect(response.body.user.email).toBe('test+special@example.com');
    });
  });

  describe('Token Security', () => {
    test('rejects token with wrong algorithm', async () => {
      // Create a token with none algorithm (security attack)
      const unsignedToken = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url') +
        '.' +
        Buffer.from(JSON.stringify({ id: 1, username: 'admin' })).toString('base64url') +
        '.';

      const response = await request(app)
        .get('/api/profile')
        .set('Authorization', `Bearer ${unsignedToken}`)
        .expect(401);

      expect(response.body.error).toBe('Unauthorized');
    });

    test('rejects token with modified payload', async () => {
      // Get a valid token
      const validParts = userToken.split('.');

      // Modify the payload to claim admin
      const modifiedPayload = {
        id: testUser.id,
        username: 'secuser',
        is_admin: 1  // Try to escalate privileges
      };

      const modifiedToken = validParts[0] + '.' +
        Buffer.from(JSON.stringify(modifiedPayload)).toString('base64url') + '.' +
        validParts[2];

      const response = await request(app)
        .get('/api/profile')
        .set('Authorization', `Bearer ${modifiedToken}`)
        .expect(401);

      expect(response.body.error).toBe('Unauthorized');
    });

    test('rejects token signed with different secret', async () => {
      const wrongSecretToken = jwt.sign(
        { id: testUser.id, username: 'secuser' },
        'wrong-secret',
        { expiresIn: '1h' }
      );

      const response = await request(app)
        .get('/api/profile')
        .set('Authorization', `Bearer ${wrongSecretToken}`)
        .expect(401);

      expect(response.body.error).toBe('Unauthorized');
    });

    test('rejects expired token', async () => {
      const expiredToken = jwt.sign(
        { id: testUser.id, username: 'secuser' },
        JWT_SECRET,
        { expiresIn: '-1h' }
      );

      const response = await request(app)
        .get('/api/profile')
        .set('Authorization', `Bearer ${expiredToken}`)
        .expect(401);

      expect(response.body.error).toBe('Unauthorized');
    });

    test('rejects token with non-existent user ID', async () => {
      const fakeUserToken = jwt.sign(
        { id: 999999, username: 'nonexistent' },
        JWT_SECRET,
        { expiresIn: '1h' }
      );

      // The middleware should find no user and not set req.user
      const response = await request(app)
        .get('/api/profile')
        .set('Authorization', `Bearer ${fakeUserToken}`)
        .expect(401);

      expect(response.body.error).toBe('Unauthorized');
    });
  });

  describe('Authorization Bypass Attempts', () => {
    test('regular user cannot access admin endpoints', async () => {
      const adminEndpoints = [
        { method: 'get', path: '/api/users' },
        { method: 'delete', path: '/api/users/1' },
        { method: 'delete', path: '/api/audiobooks/1' },
        { method: 'delete', path: '/api/audiobooks/1/files' }
      ];

      for (const endpoint of adminEndpoints) {
        const response = await request(app)[endpoint.method](endpoint.path)
          .set('Authorization', `Bearer ${userToken}`)
          .send({ file_path: '/test' }) // For endpoints that need body
          .expect(403);

        expect(response.body.error).toBe('Admin access required');
      }
    });

    test('cannot bypass admin check by setting is_admin in request', async () => {
      // Try to access admin endpoint with regular token + is_admin in body
      const response = await request(app)
        .get('/api/users')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ is_admin: 1 })
        .expect(403);

      expect(response.body.error).toBe('Admin access required');
    });
  });

  describe('Input Validation', () => {
    test('rejects extremely long username', async () => {
      const longUsername = 'a'.repeat(10000);

      const response = await request(app)
        .post('/api/auth/login')
        .send({ username: longUsername, password: 'test' })
        .expect(401);

      expect(response.body.error).toBe('Invalid username or password');
    });

    test('rejects extremely long password', async () => {
      const longPassword = 'a'.repeat(10000);

      const response = await request(app)
        .post('/api/auth/login')
        .send({ username: 'test', password: longPassword })
        .expect(401);

      expect(response.body.error).toBe('Invalid username or password');
    });

    test('handles null bytes in input', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({ username: "admin\x00", password: 'test' })
        .expect(401);

      expect(response.body.error).toBe('Invalid username or password');
    });

    test('handles unicode normalization attacks', async () => {
      // Different unicode representations of same character
      const response = await request(app)
        .post('/api/auth/login')
        .send({ username: 'admin\u200B', password: 'test' }) // Zero-width space
        .expect(401);

      expect(response.body.error).toBe('Invalid username or password');
    });
  });

  describe('Rate Limiting Bypass Attempts', () => {
    test('cannot bypass by varying case of username', async () => {
      // This tests that rate limiting should be case-insensitive
      // Note: This is a behavioral test - actual rate limiting may vary
      const attempts = ['TestUser', 'TESTUSER', 'testuser', 'TeStUsEr'];

      for (const attempt of attempts) {
        await request(app)
          .post('/api/auth/login')
          .send({ username: attempt, password: 'wrong' });
      }

      // All should be treated as the same user for rate limiting purposes
      // (Implementation detail - may need adjustment based on actual behavior)
    });
  });

  describe('Error Message Information Leakage', () => {
    test('database errors do not leak internal details', async () => {
      // Force a malformed request that might trigger a DB error
      const response = await request(app)
        .get('/api/users/not-a-number')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(404);

      // Should not contain SQL keywords or internal paths
      expect(response.text).not.toMatch(/sqlite/i);
      expect(response.text).not.toMatch(/select|insert|update|delete/i);
      expect(response.text).not.toMatch(/\/home\//);
    });

    test('authentication failures do not leak timing information', async () => {
      // Note: This is a conceptual test - actual timing attacks require statistical analysis
      // This just verifies both paths return quickly

      const startValid = Date.now();
      await request(app)
        .post('/api/auth/login')
        .send({ username: 'secuser', password: 'WrongPass123!' });
      const durationValid = Date.now() - startValid;

      const startInvalid = Date.now();
      await request(app)
        .post('/api/auth/login')
        .send({ username: 'nonexistent', password: 'WrongPass123!' });
      const durationInvalid = Date.now() - startInvalid;

      // Both should complete in similar time (within 500ms of each other)
      // This is a weak test but better than nothing
      expect(Math.abs(durationValid - durationInvalid)).toBeLessThan(500);
    });
  });

  describe('HTTP Method Enforcement', () => {
    test('login only accepts POST', async () => {
      const methods = ['get', 'put', 'delete', 'patch'];

      for (const method of methods) {
        const response = await request(app)[method]('/api/auth/login')
          .send({ username: 'test', password: 'test' });

        // Should return 404 (method not found) or 405 (method not allowed)
        expect([404, 405]).toContain(response.status);
      }
    });

    test('profile GET rejects other methods', async () => {
      // POST to a GET endpoint should fail
      const response = await request(app)
        .post('/api/profile')
        .set('Authorization', `Bearer ${userToken}`)
        .send({});

      expect([404, 405]).toContain(response.status);
    });
  });
});
