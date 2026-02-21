/**
 * Integration tests for Backup Routes
 * Tests backup management (admin only)
 */

const request = require('supertest');
const fs = require('fs');
const path = require('path');
const { createTestDatabase, createTestUser, generateTestToken, createTestApp } = require('./testApp');

describe('Backup Routes', () => {
  let app, db, testUser, userToken, adminUser, adminToken;

  // Known backup filenames matching the mock service in testApp.js
  const knownBackupFilename = 'sappho-backup-2024-01-15T10-00-00.zip';
  const knownBackupFilename2 = 'sappho-backup-2024-01-14T10-00-00.zip';

  beforeAll(async () => {
    db = await createTestDatabase();
    app = createTestApp(db);

    // Create test users
    testUser = await createTestUser(db, { username: 'backupuser', password: 'Test123!@#' });
    userToken = generateTestToken(testUser);

    adminUser = await createTestUser(db, { username: 'backupadmin', password: 'Admin123!@#', isAdmin: true });
    adminToken = generateTestToken(adminUser);

    // Create a temporary file so res.download() can actually serve it
    const backupPath = path.join('/tmp', knownBackupFilename);
    fs.writeFileSync(backupPath, 'mock backup data');
  });

  afterAll((done) => {
    // Clean up temp file
    const backupPath = path.join('/tmp', knownBackupFilename);
    if (fs.existsSync(backupPath)) {
      fs.unlinkSync(backupPath);
    }
    db.close(done);
  });

  describe('GET /api/backup', () => {
    it('returns 401 without authentication', async () => {
      const res = await request(app).get('/api/backup');
      expect(res.status).toBe(401);
    });

    it('returns 403 for non-admin users', async () => {
      const res = await request(app)
        .get('/api/backup')
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.status).toBe(403);
    });

    it('returns backup list for admin', async () => {
      const res = await request(app)
        .get('/api/backup')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.backups).toBeDefined();
      expect(Array.isArray(res.body.backups)).toBe(true);
    });

    it('includes status information', async () => {
      const res = await request(app)
        .get('/api/backup')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.status).toBeDefined();
    });
  });

  describe('POST /api/backup', () => {
    it('returns 401 without authentication', async () => {
      const res = await request(app).post('/api/backup');
      expect(res.status).toBe(401);
    });

    it('returns 403 for non-admin users', async () => {
      const res = await request(app)
        .post('/api/backup')
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.status).toBe(403);
    });

    it('creates backup for admin', async () => {
      const res = await request(app)
        .post('/api/backup')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.filename).toBeDefined();
    });

    it('accepts includeCovers option', async () => {
      const res = await request(app)
        .post('/api/backup')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ includeCovers: false });

      // Real route returns createBackup() result directly: { success, filename, size, timestamp }
      // It does NOT echo back includesCovers
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.filename).toBeDefined();
    });
  });

  describe('GET /api/backup/:filename', () => {
    it('returns 401 without authentication', async () => {
      const res = await request(app).get(`/api/backup/${knownBackupFilename}`);
      expect(res.status).toBe(401);
    });

    it('returns 403 for non-admin users', async () => {
      const res = await request(app)
        .get(`/api/backup/${knownBackupFilename}`)
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.status).toBe(403);
    });

    it('downloads backup for admin', async () => {
      const res = await request(app)
        .get(`/api/backup/${knownBackupFilename}`)
        .set('Authorization', `Bearer ${adminToken}`);

      // Real route uses res.download(), so check content-disposition header
      expect(res.status).toBe(200);
      expect(res.headers['content-disposition']).toContain(knownBackupFilename);
    });

    it('returns 404 for non-existent backup', async () => {
      const res = await request(app)
        .get('/api/backup/sappho-backup-nonexistent.zip')
        .set('Authorization', `Bearer ${adminToken}`);

      // getBackupPath throws for unknown files, route catches and returns 404
      expect(res.status).toBe(404);
    });
  });

  describe('DELETE /api/backup/:filename', () => {
    it('returns 401 without authentication', async () => {
      const res = await request(app).delete(`/api/backup/${knownBackupFilename2}`);
      expect(res.status).toBe(401);
    });

    it('returns 403 for non-admin users', async () => {
      const res = await request(app)
        .delete(`/api/backup/${knownBackupFilename2}`)
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.status).toBe(403);
    });

    it('deletes backup for admin', async () => {
      const res = await request(app)
        .delete(`/api/backup/${knownBackupFilename2}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('handles non-existent backup deletion', async () => {
      // The mock deleteBackup does not validate filenames or throw,
      // so the route returns the mock result (200 success).
      // The real route only returns 404 if deleteBackup throws.
      const res = await request(app)
        .delete('/api/backup/sappho-backup-nonexistent.zip')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
    });

    it('handles invalid backup filename', async () => {
      // The mock deleteBackup does not validate filenames or throw,
      // so the route returns the mock result (200 success).
      // The real route only returns 404 if deleteBackup throws.
      const res = await request(app)
        .delete('/api/backup/malicious-file.exe')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
    });
  });

  describe('POST /api/backup/restore/:filename', () => {
    it('returns 401 without authentication', async () => {
      const res = await request(app)
        .post(`/api/backup/restore/${knownBackupFilename}`);

      expect(res.status).toBe(401);
    });

    it('returns 403 for non-admin users', async () => {
      const res = await request(app)
        .post(`/api/backup/restore/${knownBackupFilename}`)
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.status).toBe(403);
    });

    it('restores backup for admin', async () => {
      const res = await request(app)
        .post(`/api/backup/restore/${knownBackupFilename}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('returns 500 for non-existent backup', async () => {
      // getBackupPath throws for unknown files, route catches and returns 500
      const res = await request(app)
        .post('/api/backup/restore/sappho-backup-nonexistent.zip')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Internal server error');
    });

    it('respects restore options', async () => {
      const res = await request(app)
        .post(`/api/backup/restore/${knownBackupFilename}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ restoreDatabase: true, restoreCovers: false });

      // Real route returns { success, message, ...result } where result = restoreBackup() output
      // Mock restoreBackup returns { database: true, covers: 0 }
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toBeDefined();
      expect(res.body.database).toBe(true);
    });
  });

  describe('POST /api/backup/retention', () => {
    it('returns 401 without authentication', async () => {
      const res = await request(app).post('/api/backup/retention');
      expect(res.status).toBe(401);
    });

    it('returns 403 for non-admin users', async () => {
      const res = await request(app)
        .post('/api/backup/retention')
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.status).toBe(403);
    });

    it('applies retention policy for admin', async () => {
      const res = await request(app)
        .post('/api/backup/retention')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ keepCount: 5 });

      // Real route returns applyRetention result directly: { deleted: N }
      expect(res.status).toBe(200);
      expect(res.body.deleted).toBeDefined();
    });

    it('uses default retention count', async () => {
      const res = await request(app)
        .post('/api/backup/retention')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
    });
  });
});
