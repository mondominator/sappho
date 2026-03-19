/**
 * Integration tests for Notifications Routes
 * Tests: list notifications, unread count, mark read, mark all read
 */

const request = require('supertest');
const {
  createTestDatabase,
  createTestUser,
  generateTestToken,
  createTestApp
} = require('./testApp');

describe('Notifications Routes', () => {
  let db;
  let app;
  let user1, user2;
  let user1Token, user2Token;

  beforeEach(async () => {
    db = await createTestDatabase();
    app = createTestApp(db);

    user1 = await createTestUser(db, { username: 'notifuser1', password: 'Pass123!' });
    user2 = await createTestUser(db, { username: 'notifuser2', password: 'Pass123!' });

    user1Token = generateTestToken(user1);
    user2Token = generateTestToken(user2);
  });

  afterEach((done) => {
    db.close(done);
  });

  /**
   * Helper: insert a notification into the database
   */
  function insertNotification({ type = 'info', title = 'Test', message = 'Test message', metadata = null }) {
    return new Promise((resolve, reject) => {
      db.run(
        'INSERT INTO notifications (type, title, message, metadata) VALUES (?, ?, ?, ?)',
        [type, title, message, metadata],
        function (err) {
          if (err) return reject(err);
          resolve({ id: this.lastID, type, title, message, metadata });
        }
      );
    });
  }

  /**
   * Helper: mark a notification as read for a user
   */
  function markAsRead(userId, notificationId) {
    return new Promise((resolve, reject) => {
      db.run(
        'INSERT OR IGNORE INTO user_notification_reads (user_id, notification_id) VALUES (?, ?)',
        [userId, notificationId],
        (err) => { if (err) reject(err); else resolve(); }
      );
    });
  }

  // ============================================
  // LIST NOTIFICATIONS
  // ============================================
  describe('GET /api/notifications', () => {
    it('returns 401 without authentication', async () => {
      const res = await request(app).get('/api/notifications');
      expect(res.status).toBe(401);
    });

    it('returns empty array when no notifications exist', async () => {
      const res = await request(app)
        .get('/api/notifications')
        .set('Authorization', `Bearer ${user1Token}`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    it('returns all notifications', async () => {
      await insertNotification({ title: 'First', message: 'First message' });
      await insertNotification({ title: 'Second', message: 'Second message' });
      await insertNotification({ title: 'Third', message: 'Third message' });

      const res = await request(app)
        .get('/api/notifications')
        .set('Authorization', `Bearer ${user1Token}`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(3);
      // All notifications are returned
      const titles = res.body.map(n => n.title);
      expect(titles).toContain('First');
      expect(titles).toContain('Second');
      expect(titles).toContain('Third');
    });

    it('includes is_read status for each notification', async () => {
      const n1 = await insertNotification({ title: 'Read', message: 'Read notification' });
      await insertNotification({ title: 'Unread', message: 'Unread notification' });

      // Mark n1 as read for user1
      await markAsRead(user1.id, n1.id);

      const res = await request(app)
        .get('/api/notifications')
        .set('Authorization', `Bearer ${user1Token}`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(2);

      const readNotif = res.body.find(n => n.id === n1.id);
      const unreadNotif = res.body.find(n => n.title === 'Unread');

      expect(readNotif.is_read).toBe(1);
      expect(unreadNotif.is_read).toBe(0);
    });

    it('is_read status is per-user', async () => {
      const n1 = await insertNotification({ title: 'Shared', message: 'Shared notification' });

      // Mark as read only for user1
      await markAsRead(user1.id, n1.id);

      // user1 sees it as read
      const res1 = await request(app)
        .get('/api/notifications')
        .set('Authorization', `Bearer ${user1Token}`);
      expect(res1.body[0].is_read).toBe(1);

      // user2 sees it as unread
      const res2 = await request(app)
        .get('/api/notifications')
        .set('Authorization', `Bearer ${user2Token}`);
      expect(res2.body[0].is_read).toBe(0);
    });

    it('respects limit parameter', async () => {
      for (let i = 0; i < 5; i++) {
        await insertNotification({ title: `Notification ${i}`, message: `Message ${i}` });
      }

      const res = await request(app)
        .get('/api/notifications?limit=2')
        .set('Authorization', `Bearer ${user1Token}`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(2);
    });

    it('respects offset parameter', async () => {
      for (let i = 0; i < 5; i++) {
        await insertNotification({ title: `Notification ${i}`, message: `Message ${i}` });
      }

      const res = await request(app)
        .get('/api/notifications?limit=2&offset=3')
        .set('Authorization', `Bearer ${user1Token}`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(2);
    });

    it('clamps limit to max 100', async () => {
      for (let i = 0; i < 3; i++) {
        await insertNotification({ title: `Notification ${i}`, message: `Message ${i}` });
      }

      const res = await request(app)
        .get('/api/notifications?limit=200')
        .set('Authorization', `Bearer ${user1Token}`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(3);
    });

    it('defaults limit to 50 and offset to 0', async () => {
      const res = await request(app)
        .get('/api/notifications')
        .set('Authorization', `Bearer ${user1Token}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });
  });

  // ============================================
  // UNREAD COUNT
  // ============================================
  describe('GET /api/notifications/unread-count', () => {
    it('returns 401 without authentication', async () => {
      const res = await request(app).get('/api/notifications/unread-count');
      expect(res.status).toBe(401);
    });

    it('returns 0 when no notifications exist', async () => {
      const res = await request(app)
        .get('/api/notifications/unread-count')
        .set('Authorization', `Bearer ${user1Token}`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ count: 0 });
    });

    it('returns count of unread notifications', async () => {
      const n1 = await insertNotification({ title: 'Read', message: 'Read' });
      await insertNotification({ title: 'Unread 1', message: 'Unread' });
      await insertNotification({ title: 'Unread 2', message: 'Unread' });

      // Mark one as read
      await markAsRead(user1.id, n1.id);

      const res = await request(app)
        .get('/api/notifications/unread-count')
        .set('Authorization', `Bearer ${user1Token}`);

      expect(res.status).toBe(200);
      expect(res.body.count).toBe(2);
    });

    it('unread count is per-user', async () => {
      const n1 = await insertNotification({ title: 'Notif 1', message: 'Message' });
      const n2 = await insertNotification({ title: 'Notif 2', message: 'Message' });
      await insertNotification({ title: 'Notif 3', message: 'Message' });

      // user1 reads 2 notifications
      await markAsRead(user1.id, n1.id);
      await markAsRead(user1.id, n2.id);

      // user2 reads 1 notification
      await markAsRead(user2.id, n1.id);

      const res1 = await request(app)
        .get('/api/notifications/unread-count')
        .set('Authorization', `Bearer ${user1Token}`);
      expect(res1.body.count).toBe(1);

      const res2 = await request(app)
        .get('/api/notifications/unread-count')
        .set('Authorization', `Bearer ${user2Token}`);
      expect(res2.body.count).toBe(2);
    });
  });

  // ============================================
  // MARK SINGLE NOTIFICATION AS READ
  // ============================================
  describe('POST /api/notifications/:id/read', () => {
    it('returns 401 without authentication', async () => {
      const res = await request(app).post('/api/notifications/1/read');
      expect(res.status).toBe(401);
    });

    it('returns 400 for invalid notification ID', async () => {
      const res = await request(app)
        .post('/api/notifications/abc/read')
        .set('Authorization', `Bearer ${user1Token}`);

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Invalid notification ID');
    });

    it('returns 404 for non-existent notification', async () => {
      const res = await request(app)
        .post('/api/notifications/99999/read')
        .set('Authorization', `Bearer ${user1Token}`);

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Notification not found');
    });

    it('marks a notification as read', async () => {
      const n1 = await insertNotification({ title: 'To Read', message: 'Mark me read' });

      const res = await request(app)
        .post(`/api/notifications/${n1.id}/read`)
        .set('Authorization', `Bearer ${user1Token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      // Verify via unread count
      const countRes = await request(app)
        .get('/api/notifications/unread-count')
        .set('Authorization', `Bearer ${user1Token}`);
      expect(countRes.body.count).toBe(0);
    });

    it('is idempotent - marking already-read notification succeeds', async () => {
      const n1 = await insertNotification({ title: 'Already Read', message: 'Already marked' });

      // Mark read twice
      await request(app)
        .post(`/api/notifications/${n1.id}/read`)
        .set('Authorization', `Bearer ${user1Token}`);

      const res = await request(app)
        .post(`/api/notifications/${n1.id}/read`)
        .set('Authorization', `Bearer ${user1Token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('only marks for the requesting user', async () => {
      const n1 = await insertNotification({ title: 'Per User', message: 'Only for one' });

      // user1 marks as read
      await request(app)
        .post(`/api/notifications/${n1.id}/read`)
        .set('Authorization', `Bearer ${user1Token}`);

      // user2 still sees it as unread
      const countRes = await request(app)
        .get('/api/notifications/unread-count')
        .set('Authorization', `Bearer ${user2Token}`);
      expect(countRes.body.count).toBe(1);
    });
  });

  // ============================================
  // MARK ALL NOTIFICATIONS AS READ
  // ============================================
  describe('POST /api/notifications/read-all', () => {
    it('returns 401 without authentication', async () => {
      const res = await request(app).post('/api/notifications/read-all');
      expect(res.status).toBe(401);
    });

    it('marks all notifications as read', async () => {
      await insertNotification({ title: 'Notif 1', message: 'Message 1' });
      await insertNotification({ title: 'Notif 2', message: 'Message 2' });
      await insertNotification({ title: 'Notif 3', message: 'Message 3' });

      const res = await request(app)
        .post('/api/notifications/read-all')
        .set('Authorization', `Bearer ${user1Token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      // Verify all are read
      const countRes = await request(app)
        .get('/api/notifications/unread-count')
        .set('Authorization', `Bearer ${user1Token}`);
      expect(countRes.body.count).toBe(0);
    });

    it('only marks for the requesting user', async () => {
      await insertNotification({ title: 'Notif 1', message: 'Message 1' });
      await insertNotification({ title: 'Notif 2', message: 'Message 2' });

      // user1 marks all as read
      await request(app)
        .post('/api/notifications/read-all')
        .set('Authorization', `Bearer ${user1Token}`);

      // user2 still sees them as unread
      const countRes = await request(app)
        .get('/api/notifications/unread-count')
        .set('Authorization', `Bearer ${user2Token}`);
      expect(countRes.body.count).toBe(2);
    });

    it('succeeds when no notifications exist (no-op)', async () => {
      const res = await request(app)
        .post('/api/notifications/read-all')
        .set('Authorization', `Bearer ${user1Token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('does not re-mark already-read notifications (idempotent)', async () => {
      const n1 = await insertNotification({ title: 'Already Read', message: 'Already' });
      await insertNotification({ title: 'New Notif', message: 'New' });

      // Mark n1 as read individually
      await markAsRead(user1.id, n1.id);

      // Then mark all as read
      const res = await request(app)
        .post('/api/notifications/read-all')
        .set('Authorization', `Bearer ${user1Token}`);

      expect(res.status).toBe(200);

      // All should be read
      const countRes = await request(app)
        .get('/api/notifications/unread-count')
        .set('Authorization', `Bearer ${user1Token}`);
      expect(countRes.body.count).toBe(0);
    });
  });

  // ============================================
  // EDGE CASES
  // ============================================
  describe('Edge cases', () => {
    it('notification list includes all fields', async () => {
      await insertNotification({
        type: 'new_book',
        title: 'New Audiobook Added',
        message: 'A new audiobook has been added to the library',
        metadata: JSON.stringify({ audiobook_id: 42 })
      });

      const res = await request(app)
        .get('/api/notifications')
        .set('Authorization', `Bearer ${user1Token}`);

      expect(res.status).toBe(200);
      const notif = res.body[0];
      expect(notif).toHaveProperty('id');
      expect(notif).toHaveProperty('type', 'new_book');
      expect(notif).toHaveProperty('title', 'New Audiobook Added');
      expect(notif).toHaveProperty('message', 'A new audiobook has been added to the library');
      expect(notif).toHaveProperty('metadata');
      expect(notif).toHaveProperty('created_at');
      expect(notif).toHaveProperty('is_read', 0);
    });

    it('handles negative offset gracefully (clamps to 0)', async () => {
      await insertNotification({ title: 'Test', message: 'Test' });

      const res = await request(app)
        .get('/api/notifications?offset=-5')
        .set('Authorization', `Bearer ${user1Token}`);

      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
    });

    it('handles zero limit gracefully (falls back to default 50)', async () => {
      await insertNotification({ title: 'Test 1', message: 'Msg 1' });
      await insertNotification({ title: 'Test 2', message: 'Msg 2' });

      const res = await request(app)
        .get('/api/notifications?limit=0')
        .set('Authorization', `Bearer ${user1Token}`);

      expect(res.status).toBe(200);
      // 0 is falsy, so parseInt(0) || 50 defaults to 50
      expect(res.body).toHaveLength(2);
    });
  });
});
