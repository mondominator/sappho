/**
 * Integration tests for MFA (Multi-Factor Authentication) routes
 * Tests MFA setup, verification, disable, and backup code management
 */

const request = require('supertest');
const { authenticator } = require('otplib');
const { createTestDatabase, createTestUser, generateTestToken, createTestApp } = require('./testApp');

describe('MFA Routes Integration Tests', () => {
  let app;
  let db;
  let testUser;
  let userToken;

  beforeAll(async () => {
    db = await createTestDatabase();
    app = createTestApp(db);

    // Create test user
    testUser = await createTestUser(db, {
      username: 'mfauser',
      password: 'MfaPass123!'
    });

    userToken = generateTestToken(testUser);
  });

  afterAll((done) => {
    db.close(done);
  });

  describe('GET /api/mfa/status', () => {
    test('returns 401 when not authenticated', async () => {
      await request(app)
        .get('/api/mfa/status')
        .expect(401);
    });

    test('returns disabled status for user without MFA', async () => {
      const response = await request(app)
        .get('/api/mfa/status')
        .set('Authorization', `Bearer ${userToken}`)
        .expect(200);

      expect(response.body.enabled).toBe(false);
    });

    test('returns enabled status with backup code count for MFA-enabled user', async () => {
      // First enable MFA for a test user
      const mfaUser = await createTestUser(db, {
        username: 'mfaenableduser',
        password: 'MfaEnabled123!'
      });
      const mfaUserToken = generateTestToken(mfaUser);

      // Enable MFA directly in database
      const backupCodes = JSON.stringify(['hash1', 'hash2', 'hash3', null, null]);
      await new Promise((resolve, reject) => {
        db.run(
          `UPDATE users SET mfa_enabled = 1, mfa_secret = 'testsecret', mfa_backup_codes = ?, mfa_enabled_at = CURRENT_TIMESTAMP WHERE id = ?`,
          [backupCodes, mfaUser.id],
          (err) => err ? reject(err) : resolve()
        );
      });

      const response = await request(app)
        .get('/api/mfa/status')
        .set('Authorization', `Bearer ${mfaUserToken}`)
        .expect(200);

      expect(response.body.enabled).toBe(true);
      expect(response.body.remainingBackupCodes).toBe(3);
      expect(response.body.enabledAt).toBeDefined();
    });
  });

  describe('POST /api/mfa/setup', () => {
    test('returns 401 when not authenticated', async () => {
      await request(app)
        .post('/api/mfa/setup')
        .expect(401);
    });

    test('returns secret and QR code for new setup', async () => {
      const setupUser = await createTestUser(db, {
        username: 'setupuser',
        password: 'SetupPass123!'
      });
      const setupToken = generateTestToken(setupUser);

      const response = await request(app)
        .post('/api/mfa/setup')
        .set('Authorization', `Bearer ${setupToken}`)
        .expect(200);

      expect(response.body.secret).toBeDefined();
      expect(response.body.secret.length).toBeGreaterThan(10);
      expect(response.body.qrCode).toBeDefined();
      expect(response.body.qrCode).toMatch(/^data:image\/png;base64,/);
      expect(response.body.message).toContain('Scan the QR code');
    });

    test('returns 400 if MFA is already enabled', async () => {
      const alreadyEnabledUser = await createTestUser(db, {
        username: 'alreadyenabled',
        password: 'AlreadyEnabled123!'
      });
      const alreadyEnabledToken = generateTestToken(alreadyEnabledUser);

      // Enable MFA in database
      await new Promise((resolve, reject) => {
        db.run(
          'UPDATE users SET mfa_enabled = 1, mfa_secret = ? WHERE id = ?',
          ['somesecret', alreadyEnabledUser.id],
          (err) => err ? reject(err) : resolve()
        );
      });

      const response = await request(app)
        .post('/api/mfa/setup')
        .set('Authorization', `Bearer ${alreadyEnabledToken}`)
        .expect(400);

      expect(response.body.error).toBe('MFA is already enabled');
    });
  });

  describe('POST /api/mfa/verify-setup', () => {
    test('returns 401 when not authenticated', async () => {
      await request(app)
        .post('/api/mfa/verify-setup')
        .send({ secret: 'test', token: '123456' })
        .expect(401);
    });

    test('returns 400 for missing secret', async () => {
      const response = await request(app)
        .post('/api/mfa/verify-setup')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ token: '123456' })
        .expect(400);

      expect(response.body.error).toBe('Secret and token are required');
    });

    test('returns 400 for missing token', async () => {
      const response = await request(app)
        .post('/api/mfa/verify-setup')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ secret: 'testsecret' })
        .expect(400);

      expect(response.body.error).toBe('Secret and token are required');
    });

    test('returns 400 for invalid verification code', async () => {
      const secret = authenticator.generateSecret();

      const response = await request(app)
        .post('/api/mfa/verify-setup')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ secret, token: '000000' })
        .expect(400);

      expect(response.body.error).toBe('Invalid verification code');
    });

    test('successfully enables MFA with valid token', async () => {
      const verifyUser = await createTestUser(db, {
        username: 'verifyuser',
        password: 'VerifyPass123!'
      });
      const verifyToken = generateTestToken(verifyUser);

      // Use '123456' which the mock verifyToken accepts
      const secret = authenticator.generateSecret();

      const response = await request(app)
        .post('/api/mfa/verify-setup')
        .set('Authorization', `Bearer ${verifyToken}`)
        .send({ secret, token: '123456' })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.message).toBe('MFA enabled successfully');
      expect(response.body.backupCodes).toBeDefined();
      expect(response.body.backupCodes.length).toBe(3);
      expect(response.body.warning).toContain('Save these backup codes');

      // Verify MFA is now enabled
      const statusResponse = await request(app)
        .get('/api/mfa/status')
        .set('Authorization', `Bearer ${verifyToken}`)
        .expect(200);

      expect(statusResponse.body.enabled).toBe(true);
    });
  });

  describe('POST /api/mfa/disable', () => {
    test('returns 401 when not authenticated', async () => {
      await request(app)
        .post('/api/mfa/disable')
        .send({ token: '123456' })
        .expect(401);
    });

    test('returns 400 when MFA is not enabled', async () => {
      const noMfaUser = await createTestUser(db, {
        username: 'nomfauser',
        password: 'NoMfaPass123!'
      });
      const noMfaToken = generateTestToken(noMfaUser);

      const response = await request(app)
        .post('/api/mfa/disable')
        .set('Authorization', `Bearer ${noMfaToken}`)
        .send({ token: '123456' })
        .expect(400);

      expect(response.body.error).toBe('MFA is not enabled');
    });

    test('returns 400 when no token or password provided', async () => {
      // Create and enable MFA for user
      const disableUser = await createTestUser(db, {
        username: 'disableuser1',
        password: 'DisablePass123!'
      });
      const disableToken = generateTestToken(disableUser);

      await new Promise((resolve, reject) => {
        db.run(
          'UPDATE users SET mfa_enabled = 1, mfa_secret = ? WHERE id = ?',
          ['testsecret', disableUser.id],
          (err) => err ? reject(err) : resolve()
        );
      });

      const response = await request(app)
        .post('/api/mfa/disable')
        .set('Authorization', `Bearer ${disableToken}`)
        .send({})
        .expect(400);

      expect(response.body.error).toBe('Token or password required to disable MFA');
    });

    test('returns 400 for invalid token', async () => {
      const disableUser = await createTestUser(db, {
        username: 'disableuser2',
        password: 'DisablePass123!'
      });
      const disableToken = generateTestToken(disableUser);

      const secret = authenticator.generateSecret();
      await new Promise((resolve, reject) => {
        db.run(
          'UPDATE users SET mfa_enabled = 1, mfa_secret = ? WHERE id = ?',
          [secret, disableUser.id],
          (err) => err ? reject(err) : resolve()
        );
      });

      const response = await request(app)
        .post('/api/mfa/disable')
        .set('Authorization', `Bearer ${disableToken}`)
        .send({ token: '000000' })
        .expect(400);

      expect(response.body.error).toBe('Invalid verification code');
    });

    test('returns 400 for invalid password', async () => {
      const disableUser = await createTestUser(db, {
        username: 'disableuser3',
        password: 'DisablePass123!'
      });
      const disableToken = generateTestToken(disableUser);

      await new Promise((resolve, reject) => {
        db.run(
          'UPDATE users SET mfa_enabled = 1, mfa_secret = ? WHERE id = ?',
          ['testsecret', disableUser.id],
          (err) => err ? reject(err) : resolve()
        );
      });

      const response = await request(app)
        .post('/api/mfa/disable')
        .set('Authorization', `Bearer ${disableToken}`)
        .send({ password: 'wrongpassword' })
        .expect(400);

      expect(response.body.error).toBe('Invalid password');
    });

    test('successfully disables MFA with valid token', async () => {
      const disableUser = await createTestUser(db, {
        username: 'disableuser4',
        password: 'DisablePass123!'
      });
      const disableToken = generateTestToken(disableUser);

      const secret = authenticator.generateSecret();
      await new Promise((resolve, reject) => {
        db.run(
          'UPDATE users SET mfa_enabled = 1, mfa_secret = ? WHERE id = ?',
          [secret, disableUser.id],
          (err) => err ? reject(err) : resolve()
        );
      });

      // Use '123456' which the mock verifyToken accepts
      const response = await request(app)
        .post('/api/mfa/disable')
        .set('Authorization', `Bearer ${disableToken}`)
        .send({ token: '123456' })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.message).toBe('MFA disabled successfully');

      // Verify MFA is disabled
      const statusResponse = await request(app)
        .get('/api/mfa/status')
        .set('Authorization', `Bearer ${disableToken}`)
        .expect(200);

      expect(statusResponse.body.enabled).toBe(false);
    });

    test('successfully disables MFA with valid password', async () => {
      const disableUser = await createTestUser(db, {
        username: 'disableuser5',
        password: 'DisablePass123!'
      });
      const disableToken = generateTestToken(disableUser);

      await new Promise((resolve, reject) => {
        db.run(
          'UPDATE users SET mfa_enabled = 1, mfa_secret = ? WHERE id = ?',
          ['testsecret', disableUser.id],
          (err) => err ? reject(err) : resolve()
        );
      });

      const response = await request(app)
        .post('/api/mfa/disable')
        .set('Authorization', `Bearer ${disableToken}`)
        .send({ password: 'DisablePass123!' })
        .expect(200);

      expect(response.body.success).toBe(true);
    });
  });

  describe('POST /api/mfa/regenerate-codes', () => {
    test('returns 401 when not authenticated', async () => {
      await request(app)
        .post('/api/mfa/regenerate-codes')
        .send({ token: '123456' })
        .expect(401);
    });

    test('returns 400 for missing token', async () => {
      const response = await request(app)
        .post('/api/mfa/regenerate-codes')
        .set('Authorization', `Bearer ${userToken}`)
        .send({})
        .expect(400);

      expect(response.body.error).toBe('MFA token required');
    });

    test('returns 400 when MFA is not enabled', async () => {
      const noMfaUser = await createTestUser(db, {
        username: 'nomfaregen',
        password: 'NoMfaRegen123!'
      });
      const noMfaToken = generateTestToken(noMfaUser);

      const response = await request(app)
        .post('/api/mfa/regenerate-codes')
        .set('Authorization', `Bearer ${noMfaToken}`)
        .send({ token: '123456' })
        .expect(400);

      expect(response.body.error).toBe('MFA is not enabled');
    });

    test('returns 400 for invalid verification code', async () => {
      const regenUser = await createTestUser(db, {
        username: 'regenuser1',
        password: 'RegenPass123!'
      });
      const regenToken = generateTestToken(regenUser);

      const secret = authenticator.generateSecret();
      await new Promise((resolve, reject) => {
        db.run(
          'UPDATE users SET mfa_enabled = 1, mfa_secret = ? WHERE id = ?',
          [secret, regenUser.id],
          (err) => err ? reject(err) : resolve()
        );
      });

      const response = await request(app)
        .post('/api/mfa/regenerate-codes')
        .set('Authorization', `Bearer ${regenToken}`)
        .send({ token: '000000' })
        .expect(400);

      expect(response.body.error).toBe('Invalid verification code');
    });

    test('successfully regenerates backup codes with valid token', async () => {
      const regenUser = await createTestUser(db, {
        username: 'regenuser2',
        password: 'RegenPass123!'
      });
      const regenToken = generateTestToken(regenUser);

      const secret = authenticator.generateSecret();
      const oldCodes = JSON.stringify(['oldhash1', 'oldhash2']);
      await new Promise((resolve, reject) => {
        db.run(
          'UPDATE users SET mfa_enabled = 1, mfa_secret = ?, mfa_backup_codes = ? WHERE id = ?',
          [secret, oldCodes, regenUser.id],
          (err) => err ? reject(err) : resolve()
        );
      });

      // Use '123456' which the mock verifyToken accepts
      const response = await request(app)
        .post('/api/mfa/regenerate-codes')
        .set('Authorization', `Bearer ${regenToken}`)
        .send({ token: '123456' })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.backupCodes).toBeDefined();
      expect(response.body.backupCodes.length).toBe(3);
      expect(response.body.warning).toContain('Old codes are now invalid');

      // Verify backup codes were updated (count should be 3 now, matching mock)
      const statusResponse = await request(app)
        .get('/api/mfa/status')
        .set('Authorization', `Bearer ${regenToken}`)
        .expect(200);

      expect(statusResponse.body.remainingBackupCodes).toBe(3);
    });
  });

  describe('Backup Code Usage', () => {
    test('backup code can be used to disable MFA', async () => {
      const backupUser = await createTestUser(db, {
        username: 'backupuser',
        password: 'BackupPass123!'
      });
      const backupToken = generateTestToken(backupUser);

      const secret = authenticator.generateSecret();
      const bcrypt = require('bcryptjs');

      // Create a known backup code
      const backupCode = 'TESTCODE';
      const hashedCode = bcrypt.hashSync(backupCode, 10);
      const backupCodes = JSON.stringify([hashedCode, null, null]);

      await new Promise((resolve, reject) => {
        db.run(
          'UPDATE users SET mfa_enabled = 1, mfa_secret = ?, mfa_backup_codes = ? WHERE id = ?',
          [secret, backupCodes, backupUser.id],
          (err) => err ? reject(err) : resolve()
        );
      });

      // Use backup code to disable MFA
      const response = await request(app)
        .post('/api/mfa/disable')
        .set('Authorization', `Bearer ${backupToken}`)
        .send({ token: backupCode })
        .expect(200);

      expect(response.body.success).toBe(true);
    });
  });
});
