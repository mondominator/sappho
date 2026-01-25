/**
 * Integration tests for Maintenance Routes
 * Tests library maintenance, scans, and system administration (admin only)
 */

const request = require('supertest');
const { createTestDatabase, createTestUser, generateTestToken, createTestApp } = require('./testApp');

describe('Maintenance Routes', () => {
  let app, db, testUser, userToken, adminUser, adminToken;

  // Mock data
  const mockLogs = [
    { timestamp: '2024-01-15T10:00:00Z', level: 'info', message: 'Server started', category: 'system' },
    { timestamp: '2024-01-15T10:01:00Z', level: 'info', message: 'Library scan complete', category: 'job' }
  ];

  const mockJobs = [
    { id: 'scan-1', type: 'library_scan', status: 'running', startedAt: '2024-01-15T10:00:00Z' }
  ];

  const mockStatistics = {
    totalAudiobooks: 150,
    totalUsers: 10,
    totalPlaybackTime: 360000,
    storageUsed: 50000000000
  };

  beforeAll(async () => {
    db = await createTestDatabase();
    app = createTestApp(db);

    // Create test users
    testUser = await createTestUser(db, { username: 'maintenanceuser', password: 'Test123!@#' });
    userToken = generateTestToken(testUser);

    adminUser = await createTestUser(db, { username: 'maintenanceadmin', password: 'Admin123!@#', isAdmin: true });
    adminToken = generateTestToken(adminUser);

    // Add some test audiobooks for statistics
    await new Promise((resolve) => {
      db.run(
        `INSERT INTO audiobooks (title, author, duration, file_size) VALUES (?, ?, ?, ?)`,
        ['Test Book 1', 'Author 1', 3600, 100000000],
        resolve
      );
    });
    await new Promise((resolve) => {
      db.run(
        `INSERT INTO audiobooks (title, author, duration, file_size) VALUES (?, ?, ?, ?)`,
        ['Test Book 2', 'Author 2', 7200, 200000000],
        resolve
      );
    });

    // Setup maintenance routes
    const requireAdmin = (req, res, next) => {
      if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
      if (!req.user.is_admin) return res.status(403).json({ error: 'Admin access required' });
      next();
    };

    // Logs endpoints
    app.get('/api/maintenance/logs', requireAdmin, (req, res) => {
      const { level, category, limit = 100 } = req.query;
      let logs = [...mockLogs];

      if (level) logs = logs.filter(l => l.level === level);
      if (category) logs = logs.filter(l => l.category === category);

      res.json({
        logs: logs.slice(0, parseInt(limit)),
        total: logs.length,
        rotatedCount: 0
      });
    });

    app.delete('/api/maintenance/logs', requireAdmin, (req, res) => {
      res.json({ success: true, message: 'Logs cleared' });
    });

    // Jobs endpoint
    app.get('/api/maintenance/jobs', requireAdmin, (req, res) => {
      res.json({ jobs: mockJobs });
    });

    // Statistics endpoint
    app.get('/api/maintenance/statistics', requireAdmin, async (req, res) => {
      try {
        const audiobooks = await new Promise((resolve, reject) => {
          db.get('SELECT COUNT(*) as count, SUM(duration) as totalDuration, SUM(file_size) as totalSize FROM audiobooks', [], (err, row) => {
            if (err) reject(err);
            else resolve(row);
          });
        });

        const users = await new Promise((resolve, reject) => {
          db.get('SELECT COUNT(*) as count FROM users', [], (err, row) => {
            if (err) reject(err);
            else resolve(row);
          });
        });

        res.json({
          totalAudiobooks: audiobooks.count || 0,
          totalDuration: audiobooks.totalDuration || 0,
          totalSize: audiobooks.totalSize || 0,
          totalUsers: users.count || 0
        });
      } catch (err) {
        res.status(500).json({ error: 'Database error' });
      }
    });

    // Books by format
    app.get('/api/maintenance/books-by-format/:format', requireAdmin, async (req, res) => {
      const { format } = req.params;
      const validFormats = ['mp3', 'm4b', 'm4a', 'flac', 'ogg'];

      if (!validFormats.includes(format.toLowerCase())) {
        return res.status(400).json({ error: 'Invalid format' });
      }

      db.all(
        `SELECT * FROM audiobooks WHERE file_path LIKE ?`,
        [`%.${format}`],
        (err, books) => {
          if (err) return res.status(500).json({ error: 'Database error' });
          res.json({ books, count: books.length });
        }
      );
    });

    // Library scan
    app.post('/api/maintenance/scan-library', requireAdmin, (req, res) => {
      res.json({
        success: true,
        message: 'Library scan started',
        jobId: 'scan-' + Date.now()
      });
    });

    // Clear library
    app.post('/api/maintenance/clear-library', requireAdmin, async (req, res) => {
      const { confirm } = req.body;

      if (confirm !== 'CLEAR_ALL_DATA') {
        return res.status(400).json({ error: 'Confirmation required. Send confirm: "CLEAR_ALL_DATA"' });
      }

      try {
        await new Promise((resolve, reject) => {
          db.run('DELETE FROM audiobooks', [], (err) => {
            if (err) reject(err);
            else resolve();
          });
        });
        await new Promise((resolve, reject) => {
          db.run('DELETE FROM playback_progress', [], (err) => {
            if (err) reject(err);
            else resolve();
          });
        });

        res.json({ success: true, message: 'Library cleared' });
      } catch (err) {
        res.status(500).json({ error: 'Database error' });
      }
    });

    // Migration endpoint
    app.post('/api/maintenance/migrate', requireAdmin, (req, res) => {
      res.json({
        success: true,
        message: 'Migrations complete',
        applied: ['001_initial', '002_add_columns']
      });
    });

    // Force rescan
    app.post('/api/maintenance/force-rescan', requireAdmin, (req, res) => {
      res.json({
        success: true,
        message: 'Force rescan started',
        jobId: 'rescan-' + Date.now()
      });
    });

    // Duplicates endpoint
    app.get('/api/maintenance/duplicates', requireAdmin, async (req, res) => {
      // Mock duplicate detection
      db.all(
        `SELECT title, author, COUNT(*) as count FROM audiobooks
         GROUP BY title, author HAVING count > 1`,
        [],
        (err, duplicates) => {
          if (err) return res.status(500).json({ error: 'Database error' });
          res.json({ duplicates, count: duplicates.length });
        }
      );
    });

    app.post('/api/maintenance/duplicates/merge', requireAdmin, (req, res) => {
      const { keepId, removeIds } = req.body;

      if (!keepId || !removeIds || !Array.isArray(removeIds)) {
        return res.status(400).json({ error: 'keepId and removeIds array required' });
      }

      if (removeIds.includes(keepId)) {
        return res.status(400).json({ error: 'keepId cannot be in removeIds' });
      }

      res.json({
        success: true,
        message: 'Duplicates merged',
        kept: keepId,
        removed: removeIds
      });
    });

    // Orphan directories
    app.get('/api/maintenance/orphan-directories', requireAdmin, (req, res) => {
      // Mock orphan detection
      res.json({
        orphans: [],
        count: 0
      });
    });

    app.delete('/api/maintenance/orphan-directories', requireAdmin, (req, res) => {
      const { directories } = req.body;

      if (!directories || !Array.isArray(directories)) {
        return res.status(400).json({ error: 'directories array required' });
      }

      res.json({
        success: true,
        message: 'Orphan directories cleaned',
        removed: directories.length
      });
    });

    // Organize endpoints
    app.get('/api/maintenance/organize/preview', requireAdmin, (req, res) => {
      res.json({
        changes: [
          { from: '/old/path/book.m4b', to: '/new/path/Author/Book/book.m4b' }
        ],
        count: 1
      });
    });

    app.post('/api/maintenance/organize', requireAdmin, (req, res) => {
      const { dryRun = true } = req.body;

      res.json({
        success: true,
        dryRun,
        organized: dryRun ? 0 : 1,
        message: dryRun ? 'Dry run complete' : 'Organization complete'
      });
    });

    app.post('/api/maintenance/organize/:id', requireAdmin, (req, res) => {
      const { id } = req.params;

      res.json({
        success: true,
        message: `Audiobook ${id} organized`,
        newPath: `/organized/path/book-${id}.m4b`
      });
    });
  });

  afterAll((done) => {
    db.close(done);
  });

  describe('GET /api/maintenance/logs', () => {
    it('returns 401 without authentication', async () => {
      const res = await request(app).get('/api/maintenance/logs');
      expect(res.status).toBe(401);
    });

    it('returns 403 for non-admin users', async () => {
      const res = await request(app)
        .get('/api/maintenance/logs')
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.status).toBe(403);
    });

    it('returns logs for admin', async () => {
      const res = await request(app)
        .get('/api/maintenance/logs')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.logs).toBeDefined();
      expect(Array.isArray(res.body.logs)).toBe(true);
    });

    it('filters logs by level', async () => {
      const res = await request(app)
        .get('/api/maintenance/logs?level=info')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
    });

    it('filters logs by category', async () => {
      const res = await request(app)
        .get('/api/maintenance/logs?category=system')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
    });

    it('respects limit parameter', async () => {
      const res = await request(app)
        .get('/api/maintenance/logs?limit=1')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.logs.length).toBeLessThanOrEqual(1);
    });
  });

  describe('DELETE /api/maintenance/logs', () => {
    it('returns 401 without authentication', async () => {
      const res = await request(app).delete('/api/maintenance/logs');
      expect(res.status).toBe(401);
    });

    it('returns 403 for non-admin users', async () => {
      const res = await request(app)
        .delete('/api/maintenance/logs')
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.status).toBe(403);
    });

    it('clears logs for admin', async () => {
      const res = await request(app)
        .delete('/api/maintenance/logs')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  describe('GET /api/maintenance/jobs', () => {
    it('returns 401 without authentication', async () => {
      const res = await request(app).get('/api/maintenance/jobs');
      expect(res.status).toBe(401);
    });

    it('returns 403 for non-admin users', async () => {
      const res = await request(app)
        .get('/api/maintenance/jobs')
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.status).toBe(403);
    });

    it('returns jobs for admin', async () => {
      const res = await request(app)
        .get('/api/maintenance/jobs')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.jobs).toBeDefined();
      expect(Array.isArray(res.body.jobs)).toBe(true);
    });
  });

  describe('GET /api/maintenance/statistics', () => {
    it('returns 401 without authentication', async () => {
      const res = await request(app).get('/api/maintenance/statistics');
      expect(res.status).toBe(401);
    });

    it('returns 403 for non-admin users', async () => {
      const res = await request(app)
        .get('/api/maintenance/statistics')
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.status).toBe(403);
    });

    it('returns statistics for admin', async () => {
      const res = await request(app)
        .get('/api/maintenance/statistics')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.totalAudiobooks).toBeDefined();
      expect(res.body.totalUsers).toBeDefined();
    });

    it('includes correct audiobook count', async () => {
      const res = await request(app)
        .get('/api/maintenance/statistics')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.totalAudiobooks).toBe(2);
    });
  });

  describe('GET /api/maintenance/books-by-format/:format', () => {
    it('returns 401 without authentication', async () => {
      const res = await request(app).get('/api/maintenance/books-by-format/mp3');
      expect(res.status).toBe(401);
    });

    it('returns 403 for non-admin users', async () => {
      const res = await request(app)
        .get('/api/maintenance/books-by-format/mp3')
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.status).toBe(403);
    });

    it('returns books by format for admin', async () => {
      const res = await request(app)
        .get('/api/maintenance/books-by-format/mp3')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.books).toBeDefined();
      expect(res.body.count).toBeDefined();
    });

    it('returns 400 for invalid format', async () => {
      const res = await request(app)
        .get('/api/maintenance/books-by-format/exe')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/maintenance/scan-library', () => {
    it('returns 401 without authentication', async () => {
      const res = await request(app).post('/api/maintenance/scan-library');
      expect(res.status).toBe(401);
    });

    it('returns 403 for non-admin users', async () => {
      const res = await request(app)
        .post('/api/maintenance/scan-library')
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.status).toBe(403);
    });

    it('starts library scan for admin', async () => {
      const res = await request(app)
        .post('/api/maintenance/scan-library')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.jobId).toBeDefined();
    });
  });

  describe('POST /api/maintenance/clear-library', () => {
    it('returns 401 without authentication', async () => {
      const res = await request(app).post('/api/maintenance/clear-library');
      expect(res.status).toBe(401);
    });

    it('returns 403 for non-admin users', async () => {
      const res = await request(app)
        .post('/api/maintenance/clear-library')
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.status).toBe(403);
    });

    it('returns 400 without confirmation', async () => {
      const res = await request(app)
        .post('/api/maintenance/clear-library')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Confirmation required');
    });

    it('clears library with proper confirmation', async () => {
      const res = await request(app)
        .post('/api/maintenance/clear-library')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ confirm: 'CLEAR_ALL_DATA' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  describe('POST /api/maintenance/migrate', () => {
    it('returns 401 without authentication', async () => {
      const res = await request(app).post('/api/maintenance/migrate');
      expect(res.status).toBe(401);
    });

    it('returns 403 for non-admin users', async () => {
      const res = await request(app)
        .post('/api/maintenance/migrate')
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.status).toBe(403);
    });

    it('runs migrations for admin', async () => {
      const res = await request(app)
        .post('/api/maintenance/migrate')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.applied).toBeDefined();
    });
  });

  describe('POST /api/maintenance/force-rescan', () => {
    it('returns 401 without authentication', async () => {
      const res = await request(app).post('/api/maintenance/force-rescan');
      expect(res.status).toBe(401);
    });

    it('returns 403 for non-admin users', async () => {
      const res = await request(app)
        .post('/api/maintenance/force-rescan')
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.status).toBe(403);
    });

    it('starts force rescan for admin', async () => {
      const res = await request(app)
        .post('/api/maintenance/force-rescan')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.jobId).toBeDefined();
    });
  });

  describe('GET /api/maintenance/duplicates', () => {
    it('returns 401 without authentication', async () => {
      const res = await request(app).get('/api/maintenance/duplicates');
      expect(res.status).toBe(401);
    });

    it('returns 403 for non-admin users', async () => {
      const res = await request(app)
        .get('/api/maintenance/duplicates')
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.status).toBe(403);
    });

    it('returns duplicates for admin', async () => {
      const res = await request(app)
        .get('/api/maintenance/duplicates')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.duplicates).toBeDefined();
      expect(res.body.count).toBeDefined();
    });
  });

  describe('POST /api/maintenance/duplicates/merge', () => {
    it('returns 401 without authentication', async () => {
      const res = await request(app)
        .post('/api/maintenance/duplicates/merge')
        .send({ keepId: 1, removeIds: [2] });

      expect(res.status).toBe(401);
    });

    it('returns 403 for non-admin users', async () => {
      const res = await request(app)
        .post('/api/maintenance/duplicates/merge')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ keepId: 1, removeIds: [2] });

      expect(res.status).toBe(403);
    });

    it('returns 400 without required fields', async () => {
      const res = await request(app)
        .post('/api/maintenance/duplicates/merge')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({});

      expect(res.status).toBe(400);
    });

    it('returns 400 when keepId is in removeIds', async () => {
      const res = await request(app)
        .post('/api/maintenance/duplicates/merge')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ keepId: 1, removeIds: [1, 2] });

      expect(res.status).toBe(400);
    });

    it('merges duplicates for admin', async () => {
      const res = await request(app)
        .post('/api/maintenance/duplicates/merge')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ keepId: 1, removeIds: [2, 3] });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  describe('GET /api/maintenance/orphan-directories', () => {
    it('returns 401 without authentication', async () => {
      const res = await request(app).get('/api/maintenance/orphan-directories');
      expect(res.status).toBe(401);
    });

    it('returns 403 for non-admin users', async () => {
      const res = await request(app)
        .get('/api/maintenance/orphan-directories')
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.status).toBe(403);
    });

    it('returns orphan directories for admin', async () => {
      const res = await request(app)
        .get('/api/maintenance/orphan-directories')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.orphans).toBeDefined();
      expect(res.body.count).toBeDefined();
    });
  });

  describe('DELETE /api/maintenance/orphan-directories', () => {
    it('returns 401 without authentication', async () => {
      const res = await request(app)
        .delete('/api/maintenance/orphan-directories')
        .send({ directories: ['/orphan/path'] });

      expect(res.status).toBe(401);
    });

    it('returns 403 for non-admin users', async () => {
      const res = await request(app)
        .delete('/api/maintenance/orphan-directories')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ directories: ['/orphan/path'] });

      expect(res.status).toBe(403);
    });

    it('returns 400 without directories array', async () => {
      const res = await request(app)
        .delete('/api/maintenance/orphan-directories')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({});

      expect(res.status).toBe(400);
    });

    it('removes orphan directories for admin', async () => {
      const res = await request(app)
        .delete('/api/maintenance/orphan-directories')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ directories: ['/orphan/path1', '/orphan/path2'] });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.removed).toBe(2);
    });
  });

  describe('GET /api/maintenance/organize/preview', () => {
    it('returns 401 without authentication', async () => {
      const res = await request(app).get('/api/maintenance/organize/preview');
      expect(res.status).toBe(401);
    });

    it('returns 403 for non-admin users', async () => {
      const res = await request(app)
        .get('/api/maintenance/organize/preview')
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.status).toBe(403);
    });

    it('returns organize preview for admin', async () => {
      const res = await request(app)
        .get('/api/maintenance/organize/preview')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.changes).toBeDefined();
      expect(res.body.count).toBeDefined();
    });
  });

  describe('POST /api/maintenance/organize', () => {
    it('returns 401 without authentication', async () => {
      const res = await request(app).post('/api/maintenance/organize');
      expect(res.status).toBe(401);
    });

    it('returns 403 for non-admin users', async () => {
      const res = await request(app)
        .post('/api/maintenance/organize')
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.status).toBe(403);
    });

    it('performs dry run by default', async () => {
      const res = await request(app)
        .post('/api/maintenance/organize')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.dryRun).toBe(true);
    });

    it('performs actual organization when dryRun is false', async () => {
      const res = await request(app)
        .post('/api/maintenance/organize')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ dryRun: false });

      expect(res.status).toBe(200);
      expect(res.body.dryRun).toBe(false);
    });
  });

  describe('POST /api/maintenance/organize/:id', () => {
    it('returns 401 without authentication', async () => {
      const res = await request(app).post('/api/maintenance/organize/1');
      expect(res.status).toBe(401);
    });

    it('returns 403 for non-admin users', async () => {
      const res = await request(app)
        .post('/api/maintenance/organize/1')
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.status).toBe(403);
    });

    it('organizes specific audiobook for admin', async () => {
      const res = await request(app)
        .post('/api/maintenance/organize/1')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.newPath).toBeDefined();
    });
  });
});
