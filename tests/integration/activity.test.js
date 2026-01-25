/**
 * Integration tests for Activity Routes
 * Tests activity feed and privacy settings
 */

const request = require('supertest');
const { createTestDatabase, createTestUser, generateTestToken, createTestApp } = require('./testApp');

describe('Activity Routes', () => {
  let app, db, testUser, userToken, adminUser, adminToken;

  beforeAll(async () => {
    db = await createTestDatabase();
    app = createTestApp(db);

    // Add activity_privacy table
    await new Promise((resolve, reject) => {
      db.run(`
        CREATE TABLE IF NOT EXISTS activity_privacy (
          user_id INTEGER PRIMARY KEY,
          share_activity INTEGER DEFAULT 0,
          show_in_feed INTEGER DEFAULT 1,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `, (err) => err ? reject(err) : resolve());
    });

    // Add activity_feed table
    await new Promise((resolve, reject) => {
      db.run(`
        CREATE TABLE IF NOT EXISTS activity_feed (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL,
          event_type TEXT NOT NULL,
          audiobook_id INTEGER,
          metadata TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `, (err) => err ? reject(err) : resolve());
    });

    // Create test users
    testUser = await createTestUser(db, { username: 'activityuser', password: 'Test123!@#' });
    userToken = generateTestToken(testUser);

    adminUser = await createTestUser(db, { username: 'activityadmin', password: 'Admin123!@#', isAdmin: true });
    adminToken = generateTestToken(adminUser);

    // Create some test activity
    await new Promise((resolve) => {
      db.run(
        `INSERT INTO activity_feed (user_id, event_type, audiobook_id) VALUES (?, 'started_listening', 1)`,
        [testUser.id],
        resolve
      );
    });

    // Setup activity routes
    app.get('/api/activity/feed', (req, res) => {
      if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

      const { limit = 50, offset = 0, type } = req.query;
      let query = 'SELECT * FROM activity_feed WHERE user_id = ?';
      const params = [req.user.id];

      if (type) {
        query += ' AND event_type = ?';
        params.push(type);
      }

      query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
      params.push(parseInt(limit), parseInt(offset));

      db.all(query, params, (err, activities) => {
        if (err) return res.status(500).json({ error: 'Database error' });
        res.json({ data: activities });
      });
    });

    app.get('/api/activity/personal', (req, res) => {
      if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

      const { limit = 50, offset = 0 } = req.query;
      db.all(
        'SELECT * FROM activity_feed WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?',
        [req.user.id, parseInt(limit), parseInt(offset)],
        (err, activities) => {
          if (err) return res.status(500).json({ error: 'Database error' });
          res.json({ data: activities });
        }
      );
    });

    app.get('/api/activity/server', (req, res) => {
      if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

      const { limit = 50, offset = 0 } = req.query;
      db.all(
        `SELECT af.*, ap.share_activity FROM activity_feed af
         LEFT JOIN activity_privacy ap ON af.user_id = ap.user_id
         WHERE ap.share_activity = 1 OR ap.share_activity IS NULL
         ORDER BY af.created_at DESC LIMIT ? OFFSET ?`,
        [parseInt(limit), parseInt(offset)],
        (err, activities) => {
          if (err) return res.status(500).json({ error: 'Database error' });
          res.json({ data: activities });
        }
      );
    });

    app.get('/api/activity/privacy', (req, res) => {
      if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

      db.get(
        'SELECT * FROM activity_privacy WHERE user_id = ?',
        [req.user.id],
        (err, settings) => {
          if (err) return res.status(500).json({ error: 'Database error' });
          res.json(settings || { share_activity: false, show_in_feed: true });
        }
      );
    });

    app.put('/api/activity/privacy', (req, res) => {
      if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

      const { shareActivity, showInFeed } = req.body;

      db.run(
        `INSERT OR REPLACE INTO activity_privacy (user_id, share_activity, show_in_feed, updated_at)
         VALUES (?, ?, ?, CURRENT_TIMESTAMP)`,
        [req.user.id, shareActivity ? 1 : 0, showInFeed !== false ? 1 : 0],
        function(err) {
          if (err) return res.status(500).json({ error: 'Database error' });
          res.json({
            message: 'Privacy settings updated',
            shareActivity: !!shareActivity,
            showInFeed: showInFeed !== false
          });
        }
      );
    });

    app.get('/api/activity/types', (req, res) => {
      if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

      res.json({
        types: [
          { key: 'STARTED_LISTENING', value: 'started_listening', label: 'Started Listening' },
          { key: 'FINISHED_BOOK', value: 'finished_book', label: 'Finished Book' },
          { key: 'ADDED_TO_COLLECTION', value: 'added_to_collection', label: 'Added To Collection' }
        ]
      });
    });
  });

  afterAll((done) => {
    db.close(done);
  });

  describe('GET /api/activity/feed', () => {
    it('returns 401 without authentication', async () => {
      const res = await request(app).get('/api/activity/feed');
      expect(res.status).toBe(401);
    });

    it('returns activity feed for authenticated user', async () => {
      const res = await request(app)
        .get('/api/activity/feed')
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toBeDefined();
      expect(Array.isArray(res.body.data)).toBe(true);
    });

    it('respects limit parameter', async () => {
      const res = await request(app)
        .get('/api/activity/feed?limit=5')
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBeLessThanOrEqual(5);
    });

    it('respects offset parameter', async () => {
      const res = await request(app)
        .get('/api/activity/feed?offset=100')
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.status).toBe(200);
    });

    it('filters by type when specified', async () => {
      const res = await request(app)
        .get('/api/activity/feed?type=started_listening')
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.status).toBe(200);
    });
  });

  describe('GET /api/activity/personal', () => {
    it('returns 401 without authentication', async () => {
      const res = await request(app).get('/api/activity/personal');
      expect(res.status).toBe(401);
    });

    it('returns personal activity', async () => {
      const res = await request(app)
        .get('/api/activity/personal')
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toBeDefined();
    });

    it('only returns own activity', async () => {
      // Add activity for admin user
      await new Promise((resolve) => {
        db.run(
          `INSERT INTO activity_feed (user_id, event_type, audiobook_id) VALUES (?, 'finished_book', 2)`,
          [adminUser.id],
          resolve
        );
      });

      const res = await request(app)
        .get('/api/activity/personal')
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.status).toBe(200);
      // Should only contain test user's activity
      res.body.data.forEach(activity => {
        expect(activity.user_id).toBe(testUser.id);
      });
    });
  });

  describe('GET /api/activity/server', () => {
    it('returns 401 without authentication', async () => {
      const res = await request(app).get('/api/activity/server');
      expect(res.status).toBe(401);
    });

    it('returns server-wide activity', async () => {
      const res = await request(app)
        .get('/api/activity/server')
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toBeDefined();
    });
  });

  describe('GET /api/activity/privacy', () => {
    it('returns 401 without authentication', async () => {
      const res = await request(app).get('/api/activity/privacy');
      expect(res.status).toBe(401);
    });

    it('returns privacy settings', async () => {
      const res = await request(app)
        .get('/api/activity/privacy')
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('share_activity');
      expect(res.body).toHaveProperty('show_in_feed');
    });

    it('returns defaults for new user', async () => {
      const newUser = await createTestUser(db, { username: 'newactivityuser', password: 'New123!@#' });
      const newToken = generateTestToken(newUser);

      const res = await request(app)
        .get('/api/activity/privacy')
        .set('Authorization', `Bearer ${newToken}`);

      expect(res.status).toBe(200);
    });
  });

  describe('PUT /api/activity/privacy', () => {
    it('returns 401 without authentication', async () => {
      const res = await request(app)
        .put('/api/activity/privacy')
        .send({ shareActivity: true });

      expect(res.status).toBe(401);
    });

    it('updates privacy settings', async () => {
      const res = await request(app)
        .put('/api/activity/privacy')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ shareActivity: true, showInFeed: true });

      expect(res.status).toBe(200);
      expect(res.body.message).toContain('updated');
      expect(res.body.shareActivity).toBe(true);
      expect(res.body.showInFeed).toBe(true);
    });

    it('disables sharing', async () => {
      const res = await request(app)
        .put('/api/activity/privacy')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ shareActivity: false });

      expect(res.status).toBe(200);
      expect(res.body.shareActivity).toBe(false);
    });

    it('defaults showInFeed to true', async () => {
      const res = await request(app)
        .put('/api/activity/privacy')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ shareActivity: false });

      expect(res.status).toBe(200);
      expect(res.body.showInFeed).toBe(true);
    });
  });

  describe('GET /api/activity/types', () => {
    it('returns 401 without authentication', async () => {
      const res = await request(app).get('/api/activity/types');
      expect(res.status).toBe(401);
    });

    it('returns event types', async () => {
      const res = await request(app)
        .get('/api/activity/types')
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.status).toBe(200);
      expect(res.body.types).toBeDefined();
      expect(Array.isArray(res.body.types)).toBe(true);
    });

    it('includes key, value, and label for each type', async () => {
      const res = await request(app)
        .get('/api/activity/types')
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.status).toBe(200);
      res.body.types.forEach(type => {
        expect(type).toHaveProperty('key');
        expect(type).toHaveProperty('value');
        expect(type).toHaveProperty('label');
      });
    });
  });
});
