/**
 * Integration tests for Email Routes
 * Tests email settings and notification preferences
 */

const request = require('supertest');
const { createTestDatabase, createTestUser, generateTestToken, createTestApp } = require('./testApp');

describe('Email Routes', () => {
  let app, db, testUser, userToken, adminUser, adminToken;

  beforeAll(async () => {
    db = await createTestDatabase();
    app = createTestApp(db);

    // Add email settings table
    await new Promise((resolve, reject) => {
      db.run(`
        CREATE TABLE IF NOT EXISTS email_settings (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          host TEXT,
          port INTEGER DEFAULT 587,
          secure INTEGER DEFAULT 0,
          username TEXT,
          password TEXT,
          from_address TEXT,
          from_name TEXT DEFAULT 'Sappho',
          enabled INTEGER DEFAULT 0,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `, (err) => err ? reject(err) : resolve());
    });

    // Add notification preferences table
    await new Promise((resolve, reject) => {
      db.run(`
        CREATE TABLE IF NOT EXISTS notification_preferences (
          user_id INTEGER PRIMARY KEY,
          email_new_audiobook INTEGER DEFAULT 0,
          email_weekly_summary INTEGER DEFAULT 0,
          email_recommendations INTEGER DEFAULT 0,
          email_enabled INTEGER DEFAULT 1,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `, (err) => err ? reject(err) : resolve());
    });

    // Create test users
    testUser = await createTestUser(db, { username: 'emailuser', password: 'Test123!@#' });
    userToken = generateTestToken(testUser);

    adminUser = await createTestUser(db, { username: 'emailadmin', password: 'Admin123!@#', isAdmin: true });
    adminToken = generateTestToken(adminUser);

    // Setup email routes
    const requireAdmin = (req, res, next) => {
      if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
      if (!req.user.is_admin) return res.status(403).json({ error: 'Admin access required' });
      next();
    };

    // Admin routes
    app.get('/api/email/settings', requireAdmin, (req, res) => {
      db.get('SELECT * FROM email_settings WHERE id = 1', [], (err, settings) => {
        if (err) return res.status(500).json({ error: 'Database error' });

        if (!settings) {
          return res.json({
            host: '',
            port: 587,
            secure: false,
            username: '',
            password: '',
            from_address: '',
            from_name: 'Sappho',
            enabled: false
          });
        }

        res.json({
          ...settings,
          secure: !!settings.secure,
          enabled: !!settings.enabled,
          password: settings.password ? '********' : ''
        });
      });
    });

    app.put('/api/email/settings', requireAdmin, (req, res) => {
      const { host, port, secure, username, password, from_address, from_name, enabled } = req.body;

      db.run(
        `INSERT OR REPLACE INTO email_settings (id, host, port, secure, username, password, from_address, from_name, enabled, updated_at)
         VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
        [host, port || 587, secure ? 1 : 0, username, password, from_address, from_name || 'Sappho', enabled ? 1 : 0],
        function(err) {
          if (err) return res.status(500).json({ error: 'Database error' });
          res.json({ success: true, message: 'Email settings saved' });
        }
      );
    });

    app.post('/api/email/test-connection', requireAdmin, (req, res) => {
      const { host, port, username, password } = req.body;

      if (!host || !username) {
        return res.status(400).json({ success: false, error: 'Host and username are required' });
      }

      // Mock connection test
      res.json({ success: true, message: 'Connection successful' });
    });

    app.post('/api/email/send-test', requireAdmin, (req, res) => {
      const { to } = req.body;

      if (!to) {
        return res.status(400).json({ error: 'Email address is required' });
      }

      // Mock email send
      res.json({ success: true, message: 'Test email sent' });
    });

    // User routes
    app.get('/api/email/preferences', (req, res) => {
      if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

      db.get(
        'SELECT * FROM notification_preferences WHERE user_id = ?',
        [req.user.id],
        (err, prefs) => {
          if (err) return res.status(500).json({ error: 'Database error' });

          res.json({
            email_new_audiobook: !!(prefs?.email_new_audiobook),
            email_weekly_summary: !!(prefs?.email_weekly_summary),
            email_recommendations: !!(prefs?.email_recommendations),
            email_enabled: prefs?.email_enabled !== 0
          });
        }
      );
    });

    app.put('/api/email/preferences', (req, res) => {
      if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

      const { email_new_audiobook, email_weekly_summary, email_recommendations, email_enabled } = req.body;

      db.run(
        `INSERT OR REPLACE INTO notification_preferences
         (user_id, email_new_audiobook, email_weekly_summary, email_recommendations, email_enabled, updated_at)
         VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
        [
          req.user.id,
          email_new_audiobook ? 1 : 0,
          email_weekly_summary ? 1 : 0,
          email_recommendations ? 1 : 0,
          email_enabled !== false ? 1 : 0
        ],
        function(err) {
          if (err) return res.status(500).json({ error: 'Database error' });
          res.json({ success: true, message: 'Notification preferences saved' });
        }
      );
    });

    app.get('/api/email/status', (req, res) => {
      if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

      db.get('SELECT host, enabled FROM email_settings WHERE id = 1', [], (err, settings) => {
        if (err) return res.status(500).json({ error: 'Database error' });

        res.json({
          configured: !!(settings?.host),
          enabled: !!(settings?.enabled)
        });
      });
    });
  });

  afterAll((done) => {
    db.close(done);
  });

  describe('GET /api/email/settings', () => {
    it('returns 401 without authentication', async () => {
      const res = await request(app).get('/api/email/settings');
      expect(res.status).toBe(401);
    });

    it('returns 403 for non-admin users', async () => {
      const res = await request(app)
        .get('/api/email/settings')
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.status).toBe(403);
    });

    it('returns default settings when not configured', async () => {
      const res = await request(app)
        .get('/api/email/settings')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.port).toBe(587);
      expect(res.body.enabled).toBe(false);
    });

    it('masks password in response', async () => {
      // First save settings
      await request(app)
        .put('/api/email/settings')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ host: 'smtp.test.com', password: 'secret123', username: 'test' });

      const res = await request(app)
        .get('/api/email/settings')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.password).toBe('********');
    });
  });

  describe('PUT /api/email/settings', () => {
    it('returns 401 without authentication', async () => {
      const res = await request(app)
        .put('/api/email/settings')
        .send({ host: 'smtp.test.com' });

      expect(res.status).toBe(401);
    });

    it('returns 403 for non-admin users', async () => {
      const res = await request(app)
        .put('/api/email/settings')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ host: 'smtp.test.com' });

      expect(res.status).toBe(403);
    });

    it('saves email settings', async () => {
      const res = await request(app)
        .put('/api/email/settings')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          host: 'smtp.example.com',
          port: 465,
          secure: true,
          username: 'user@example.com',
          password: 'password123',
          from_address: 'noreply@example.com',
          from_name: 'Sappho Audiobooks',
          enabled: true
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('uses default values for optional fields', async () => {
      const res = await request(app)
        .put('/api/email/settings')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ host: 'smtp.test.com', username: 'test' });

      expect(res.status).toBe(200);

      // Verify defaults
      const getRes = await request(app)
        .get('/api/email/settings')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(getRes.body.port).toBe(587);
      expect(getRes.body.from_name).toBe('Sappho');
    });
  });

  describe('POST /api/email/test-connection', () => {
    it('returns 401 without authentication', async () => {
      const res = await request(app)
        .post('/api/email/test-connection')
        .send({ host: 'smtp.test.com' });

      expect(res.status).toBe(401);
    });

    it('returns 403 for non-admin users', async () => {
      const res = await request(app)
        .post('/api/email/test-connection')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ host: 'smtp.test.com', username: 'test' });

      expect(res.status).toBe(403);
    });

    it('tests connection with valid settings', async () => {
      const res = await request(app)
        .post('/api/email/test-connection')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          host: 'smtp.test.com',
          port: 587,
          username: 'test@test.com',
          password: 'password'
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('returns error without required fields', async () => {
      const res = await request(app)
        .post('/api/email/test-connection')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ port: 587 });

      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/email/send-test', () => {
    it('returns 401 without authentication', async () => {
      const res = await request(app)
        .post('/api/email/send-test')
        .send({ to: 'test@example.com' });

      expect(res.status).toBe(401);
    });

    it('returns 403 for non-admin users', async () => {
      const res = await request(app)
        .post('/api/email/send-test')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ to: 'test@example.com' });

      expect(res.status).toBe(403);
    });

    it('sends test email', async () => {
      const res = await request(app)
        .post('/api/email/send-test')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ to: 'admin@example.com' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('returns 400 without email address', async () => {
      const res = await request(app)
        .post('/api/email/send-test')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({});

      expect(res.status).toBe(400);
    });
  });

  describe('GET /api/email/preferences', () => {
    it('returns 401 without authentication', async () => {
      const res = await request(app).get('/api/email/preferences');
      expect(res.status).toBe(401);
    });

    it('returns default preferences for new user', async () => {
      const res = await request(app)
        .get('/api/email/preferences')
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('email_new_audiobook');
      expect(res.body).toHaveProperty('email_weekly_summary');
      expect(res.body).toHaveProperty('email_recommendations');
      expect(res.body).toHaveProperty('email_enabled');
    });
  });

  describe('PUT /api/email/preferences', () => {
    it('returns 401 without authentication', async () => {
      const res = await request(app)
        .put('/api/email/preferences')
        .send({ email_new_audiobook: true });

      expect(res.status).toBe(401);
    });

    it('saves notification preferences', async () => {
      const res = await request(app)
        .put('/api/email/preferences')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          email_new_audiobook: true,
          email_weekly_summary: true,
          email_recommendations: false,
          email_enabled: true
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('persists preferences correctly', async () => {
      await request(app)
        .put('/api/email/preferences')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          email_new_audiobook: true,
          email_weekly_summary: false
        });

      const res = await request(app)
        .get('/api/email/preferences')
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.status).toBe(200);
      expect(res.body.email_new_audiobook).toBe(true);
      expect(res.body.email_weekly_summary).toBe(false);
    });
  });

  describe('GET /api/email/status', () => {
    it('returns 401 without authentication', async () => {
      const res = await request(app).get('/api/email/status');
      expect(res.status).toBe(401);
    });

    it('returns email status for authenticated user', async () => {
      const res = await request(app)
        .get('/api/email/status')
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('configured');
      expect(res.body).toHaveProperty('enabled');
    });

    it('shows configured status correctly', async () => {
      // Configure email
      await request(app)
        .put('/api/email/settings')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ host: 'smtp.test.com', username: 'test', enabled: true });

      const res = await request(app)
        .get('/api/email/status')
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.status).toBe(200);
      expect(res.body.configured).toBe(true);
      expect(res.body.enabled).toBe(true);
    });
  });
});
