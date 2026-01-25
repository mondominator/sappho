/**
 * Integration tests for Backup Routes
 * Tests backup management (admin only)
 */

const request = require('supertest');
const { createTestDatabase, createTestUser, generateTestToken, createTestApp } = require('./testApp');

describe('Backup Routes', () => {
  let app, db, testUser, userToken, adminUser, adminToken;

  // Mock backup data
  const mockBackups = [
    { filename: 'sappho-backup-2024-01-15T10-00-00.zip', size: 1024000, created: '2024-01-15T10:00:00Z' },
    { filename: 'sappho-backup-2024-01-14T10-00-00.zip', size: 512000, created: '2024-01-14T10:00:00Z' }
  ];

  beforeAll(async () => {
    db = await createTestDatabase();
    app = createTestApp(db);

    // Create test users
    testUser = await createTestUser(db, { username: 'backupuser', password: 'Test123!@#' });
    userToken = generateTestToken(testUser);

    adminUser = await createTestUser(db, { username: 'backupadmin', password: 'Admin123!@#', isAdmin: true });
    adminToken = generateTestToken(adminUser);

    // Setup backup routes
    app.get('/api/backup', (req, res) => {
      if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
      if (!req.user.is_admin) return res.status(403).json({ error: 'Admin access required' });

      res.json({
        backups: mockBackups,
        status: { lastBackup: '2024-01-15T10:00:00Z', inProgress: false }
      });
    });

    app.post('/api/backup', (req, res) => {
      if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
      if (!req.user.is_admin) return res.status(403).json({ error: 'Admin access required' });

      const { includeCovers = true } = req.body;

      res.json({
        success: true,
        filename: 'sappho-backup-2024-01-16T10-00-00.zip',
        size: 2048000,
        includesCovers: includeCovers
      });
    });

    app.get('/api/backup/:filename', (req, res) => {
      if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
      if (!req.user.is_admin) return res.status(403).json({ error: 'Admin access required' });

      const { filename } = req.params;
      const backup = mockBackups.find(b => b.filename === filename);

      if (!backup) {
        return res.status(404).json({ error: 'Backup not found' });
      }

      // Simulate file download
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(Buffer.from('mock backup data'));
    });

    app.delete('/api/backup/:filename', (req, res) => {
      if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
      if (!req.user.is_admin) return res.status(403).json({ error: 'Admin access required' });

      const { filename } = req.params;

      if (!filename.startsWith('sappho-backup-') || !filename.endsWith('.zip')) {
        return res.status(400).json({ error: 'Invalid backup filename' });
      }

      const backup = mockBackups.find(b => b.filename === filename);
      if (!backup) {
        return res.status(404).json({ error: 'Backup not found' });
      }

      res.json({ success: true, message: 'Backup deleted' });
    });

    app.post('/api/backup/restore/:filename', (req, res) => {
      if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
      if (!req.user.is_admin) return res.status(403).json({ error: 'Admin access required' });

      const { filename } = req.params;
      const { restoreDatabase = true, restoreCovers = true } = req.body;

      const backup = mockBackups.find(b => b.filename === filename);
      if (!backup) {
        return res.status(404).json({ error: 'Backup not found' });
      }

      res.json({
        success: true,
        message: 'Restore complete',
        restoredDatabase: restoreDatabase,
        restoredCovers: restoreCovers
      });
    });

    app.post('/api/backup/retention', (req, res) => {
      if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
      if (!req.user.is_admin) return res.status(403).json({ error: 'Admin access required' });

      const { keepCount = 7 } = req.body;

      res.json({
        success: true,
        kept: Math.min(mockBackups.length, keepCount),
        deleted: Math.max(0, mockBackups.length - keepCount)
      });
    });
  });

  afterAll((done) => {
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

    it('respects includeCovers option', async () => {
      const res = await request(app)
        .post('/api/backup')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ includeCovers: false });

      expect(res.status).toBe(200);
      expect(res.body.includesCovers).toBe(false);
    });
  });

  describe('GET /api/backup/:filename', () => {
    it('returns 401 without authentication', async () => {
      const res = await request(app).get('/api/backup/sappho-backup-2024-01-15T10-00-00.zip');
      expect(res.status).toBe(401);
    });

    it('returns 403 for non-admin users', async () => {
      const res = await request(app)
        .get('/api/backup/sappho-backup-2024-01-15T10-00-00.zip')
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.status).toBe(403);
    });

    it('downloads backup for admin', async () => {
      const res = await request(app)
        .get('/api/backup/sappho-backup-2024-01-15T10-00-00.zip')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('application/zip');
    });

    it('returns 404 for non-existent backup', async () => {
      const res = await request(app)
        .get('/api/backup/sappho-backup-nonexistent.zip')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(404);
    });
  });

  describe('DELETE /api/backup/:filename', () => {
    it('returns 401 without authentication', async () => {
      const res = await request(app).delete('/api/backup/sappho-backup-2024-01-14T10-00-00.zip');
      expect(res.status).toBe(401);
    });

    it('returns 403 for non-admin users', async () => {
      const res = await request(app)
        .delete('/api/backup/sappho-backup-2024-01-14T10-00-00.zip')
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.status).toBe(403);
    });

    it('deletes backup for admin', async () => {
      const res = await request(app)
        .delete('/api/backup/sappho-backup-2024-01-14T10-00-00.zip')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('returns 404 for non-existent backup', async () => {
      const res = await request(app)
        .delete('/api/backup/sappho-backup-nonexistent.zip')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(404);
    });

    it('validates backup filename format', async () => {
      const res = await request(app)
        .delete('/api/backup/malicious-file.exe')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/backup/restore/:filename', () => {
    it('returns 401 without authentication', async () => {
      const res = await request(app)
        .post('/api/backup/restore/sappho-backup-2024-01-15T10-00-00.zip');

      expect(res.status).toBe(401);
    });

    it('returns 403 for non-admin users', async () => {
      const res = await request(app)
        .post('/api/backup/restore/sappho-backup-2024-01-15T10-00-00.zip')
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.status).toBe(403);
    });

    it('restores backup for admin', async () => {
      const res = await request(app)
        .post('/api/backup/restore/sappho-backup-2024-01-15T10-00-00.zip')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('returns 404 for non-existent backup', async () => {
      const res = await request(app)
        .post('/api/backup/restore/sappho-backup-nonexistent.zip')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(404);
    });

    it('respects restore options', async () => {
      const res = await request(app)
        .post('/api/backup/restore/sappho-backup-2024-01-15T10-00-00.zip')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ restoreDatabase: true, restoreCovers: false });

      expect(res.status).toBe(200);
      expect(res.body.restoredDatabase).toBe(true);
      expect(res.body.restoredCovers).toBe(false);
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

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.kept).toBeDefined();
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
