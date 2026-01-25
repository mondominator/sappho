/**
 * Integration tests for MFA Routes
 * Tests multi-factor authentication setup and management
 * Uses real MFA routes from testApp.js with otplib for token generation
 */

const request = require('supertest');
const { authenticator } = require('otplib');
const { createTestDatabase, createTestUser, generateTestToken, createTestApp } = require('./testApp');

describe('MFA Routes', () => {
  let app, db, testUser, userToken, mfaUser, mfaToken, mfaSecret;

  beforeAll(async () => {
    db = await createTestDatabase();
    app = createTestApp(db);

    // Create test users
    testUser = await createTestUser(db, { username: 'mfauser', password: 'Test123!@#' });
    userToken = generateTestToken(testUser);

    // Create user with MFA enabled
    mfaUser = await createTestUser(db, { username: 'mfaenabled', password: 'MFA123!@#' });
    mfaToken = generateTestToken(mfaUser);

    // Generate a real secret and enable MFA for mfaUser
    mfaSecret = authenticator.generateSecret();
    await new Promise((resolve) => {
      db.run(
        `UPDATE users SET mfa_enabled = 1, mfa_secret = ? WHERE id = ?`,
        [mfaSecret, mfaUser.id],
        resolve
      );
    });
  });

  afterAll((done) => {
    db.close(done);
  });

  describe('GET /api/mfa/status', () => {
    it('returns 401 without authentication', async () => {
      const res = await request(app).get('/api/mfa/status');
      expect(res.status).toBe(401);
    });

    it('returns MFA status for user without MFA', async () => {
      const res = await request(app)
        .get('/api/mfa/status')
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.status).toBe(200);
      expect(res.body.enabled).toBe(false);
    });

    it('returns MFA status for user with MFA', async () => {
      const res = await request(app)
        .get('/api/mfa/status')
        .set('Authorization', `Bearer ${mfaToken}`);

      expect(res.status).toBe(200);
      expect(res.body.enabled).toBe(true);
    });
  });

  describe('POST /api/mfa/setup', () => {
    it('returns 401 without authentication', async () => {
      const res = await request(app).post('/api/mfa/setup');
      expect(res.status).toBe(401);
    });

    it('returns secret and QR code for setup', async () => {
      const res = await request(app)
        .post('/api/mfa/setup')
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.status).toBe(200);
      expect(res.body.secret).toBeDefined();
      expect(res.body.qrCode).toBeDefined();
    });

    it('returns 400 if MFA already enabled', async () => {
      const res = await request(app)
        .post('/api/mfa/setup')
        .set('Authorization', `Bearer ${mfaToken}`);

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('already enabled');
    });
  });

  describe('POST /api/mfa/verify-setup', () => {
    it('returns 401 without authentication', async () => {
      const res = await request(app)
        .post('/api/mfa/verify-setup')
        .send({ secret: 'test', token: '123456' });

      expect(res.status).toBe(401);
    });

    it('returns 400 without secret', async () => {
      const res = await request(app)
        .post('/api/mfa/verify-setup')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ token: '123456' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('required');
    });

    it('returns 400 without token', async () => {
      const res = await request(app)
        .post('/api/mfa/verify-setup')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ secret: authenticator.generateSecret() });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('required');
    });

    it('returns 400 for invalid token', async () => {
      const res = await request(app)
        .post('/api/mfa/verify-setup')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ secret: authenticator.generateSecret(), token: '000000' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Invalid');
    });

    it('enables MFA with valid token', async () => {
      const newUser = await createTestUser(db, { username: `setupmfa_${Date.now()}`, password: 'Setup123!@#' });
      const newToken = generateTestToken(newUser);

      // Generate a new secret and valid TOTP token
      const secret = authenticator.generateSecret();
      const token = authenticator.generate(secret);

      const res = await request(app)
        .post('/api/mfa/verify-setup')
        .set('Authorization', `Bearer ${newToken}`)
        .send({ secret, token });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.backupCodes).toBeDefined();
      expect(Array.isArray(res.body.backupCodes)).toBe(true);
    });
  });

  describe('POST /api/mfa/disable', () => {
    it('returns 401 without authentication', async () => {
      const res = await request(app)
        .post('/api/mfa/disable')
        .send({ token: '123456' });

      expect(res.status).toBe(401);
    });

    it('returns 400 if MFA not enabled', async () => {
      const res = await request(app)
        .post('/api/mfa/disable')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ token: '123456' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('not enabled');
    });

    it('returns 400 without token or password', async () => {
      // Create fresh user with MFA enabled for this test
      const disableUser = await createTestUser(db, {
        username: `disablemfa1_${Date.now()}`,
        password: 'Disable123!@#'
      });
      const disableToken = generateTestToken(disableUser);
      const disableSecret = authenticator.generateSecret();
      await new Promise((resolve) => {
        db.run(
          `UPDATE users SET mfa_enabled = 1, mfa_secret = ? WHERE id = ?`,
          [disableSecret, disableUser.id],
          resolve
        );
      });

      const res = await request(app)
        .post('/api/mfa/disable')
        .set('Authorization', `Bearer ${disableToken}`)
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('required');
    });

    it('disables MFA with valid token', async () => {
      // Create fresh user with MFA enabled for this test
      const disableUser = await createTestUser(db, {
        username: `disablemfa2_${Date.now()}`,
        password: 'Disable123!@#'
      });
      const disableToken = generateTestToken(disableUser);
      const disableSecret = authenticator.generateSecret();
      await new Promise((resolve) => {
        db.run(
          `UPDATE users SET mfa_enabled = 1, mfa_secret = ? WHERE id = ?`,
          [disableSecret, disableUser.id],
          resolve
        );
      });

      // Generate a valid TOTP token
      const token = authenticator.generate(disableSecret);

      const res = await request(app)
        .post('/api/mfa/disable')
        .set('Authorization', `Bearer ${disableToken}`)
        .send({ token });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('disables MFA with valid password', async () => {
      // Create fresh user with MFA enabled for this test
      const disableUser = await createTestUser(db, {
        username: `disablemfa3_${Date.now()}`,
        password: 'Disable123!@#'
      });
      const disableToken = generateTestToken(disableUser);
      const disableSecret = authenticator.generateSecret();
      await new Promise((resolve) => {
        db.run(
          `UPDATE users SET mfa_enabled = 1, mfa_secret = ? WHERE id = ?`,
          [disableSecret, disableUser.id],
          resolve
        );
      });

      const res = await request(app)
        .post('/api/mfa/disable')
        .set('Authorization', `Bearer ${disableToken}`)
        .send({ password: 'Disable123!@#' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('returns 400 for invalid token', async () => {
      // Create fresh user with MFA enabled for this test
      const disableUser = await createTestUser(db, {
        username: `disablemfa4_${Date.now()}`,
        password: 'Disable123!@#'
      });
      const disableToken = generateTestToken(disableUser);
      const disableSecret = authenticator.generateSecret();
      await new Promise((resolve) => {
        db.run(
          `UPDATE users SET mfa_enabled = 1, mfa_secret = ? WHERE id = ?`,
          [disableSecret, disableUser.id],
          resolve
        );
      });

      const res = await request(app)
        .post('/api/mfa/disable')
        .set('Authorization', `Bearer ${disableToken}`)
        .send({ token: '000000' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Invalid');
    });

    it('returns 400 for invalid password', async () => {
      // Create fresh user with MFA enabled for this test
      const disableUser = await createTestUser(db, {
        username: `disablemfa5_${Date.now()}`,
        password: 'Disable123!@#'
      });
      const disableToken = generateTestToken(disableUser);
      const disableSecret = authenticator.generateSecret();
      await new Promise((resolve) => {
        db.run(
          `UPDATE users SET mfa_enabled = 1, mfa_secret = ? WHERE id = ?`,
          [disableSecret, disableUser.id],
          resolve
        );
      });

      const res = await request(app)
        .post('/api/mfa/disable')
        .set('Authorization', `Bearer ${disableToken}`)
        .send({ password: 'wrongpassword' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Invalid');
    });
  });

  describe('POST /api/mfa/regenerate-codes', () => {
    it('returns 401 without authentication', async () => {
      const res = await request(app)
        .post('/api/mfa/regenerate-codes')
        .send({ token: '123456' });

      expect(res.status).toBe(401);
    });

    it('returns 400 without token', async () => {
      const res = await request(app)
        .post('/api/mfa/regenerate-codes')
        .set('Authorization', `Bearer ${mfaToken}`)
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('required');
    });

    it('returns 400 if MFA not enabled', async () => {
      const res = await request(app)
        .post('/api/mfa/regenerate-codes')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ token: '123456' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('not enabled');
    });

    it('returns 400 for invalid token', async () => {
      const res = await request(app)
        .post('/api/mfa/regenerate-codes')
        .set('Authorization', `Bearer ${mfaToken}`)
        .send({ token: '000000' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Invalid');
    });

    it('generates new backup codes with valid token', async () => {
      // Create fresh user with MFA enabled for this test
      const regenUser = await createTestUser(db, {
        username: `regenmfa_${Date.now()}`,
        password: 'Regen123!@#'
      });
      const regenToken = generateTestToken(regenUser);
      const regenSecret = authenticator.generateSecret();
      await new Promise((resolve) => {
        db.run(
          `UPDATE users SET mfa_enabled = 1, mfa_secret = ? WHERE id = ?`,
          [regenSecret, regenUser.id],
          resolve
        );
      });

      // Generate a valid TOTP token
      const token = authenticator.generate(regenSecret);

      const res = await request(app)
        .post('/api/mfa/regenerate-codes')
        .set('Authorization', `Bearer ${regenToken}`)
        .send({ token });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.backupCodes).toBeDefined();
      expect(Array.isArray(res.body.backupCodes)).toBe(true);
    });
  });
});
