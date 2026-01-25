/**
 * Integration tests for Users Routes
 * Tests user management (admin only)
 */

const request = require('supertest');
const bcrypt = require('bcryptjs');
const { createTestDatabase, createTestUser, generateTestToken, createTestApp } = require('./testApp');

describe('Users Routes', () => {
  let app, db, testUser, userToken, adminUser, adminToken;

  beforeAll(async () => {
    db = await createTestDatabase();
    app = createTestApp(db);

    // Create test users
    testUser = await createTestUser(db, { username: 'usersuser', password: 'Test123!@#' });
    userToken = generateTestToken(testUser);

    adminUser = await createTestUser(db, { username: 'usersadmin', password: 'Admin123!@#', isAdmin: true });
    adminToken = generateTestToken(adminUser);
  });

  afterAll((done) => {
    db.close(done);
  });

  describe('GET /api/users', () => {
    it('returns 401 without authentication', async () => {
      const res = await request(app).get('/api/users');
      expect(res.status).toBe(401);
    });

    it('returns 403 for non-admin users', async () => {
      const res = await request(app)
        .get('/api/users')
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.status).toBe(403);
    });

    it('returns user list for admin', async () => {
      const res = await request(app)
        .get('/api/users')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThanOrEqual(2);
    });

    it('includes required user fields', async () => {
      const res = await request(app)
        .get('/api/users')
        .set('Authorization', `Bearer ${adminToken}`);

      const user = res.body[0];
      expect(user).toHaveProperty('id');
      expect(user).toHaveProperty('username');
      expect(user).toHaveProperty('is_admin');
      expect(user).toHaveProperty('created_at');
    });

    it('does not include password hash', async () => {
      const res = await request(app)
        .get('/api/users')
        .set('Authorization', `Bearer ${adminToken}`);

      const user = res.body[0];
      expect(user.password_hash).toBeUndefined();
      expect(user.password).toBeUndefined();
    });
  });

  describe('GET /api/users/:id', () => {
    it('returns 401 without authentication', async () => {
      const res = await request(app).get(`/api/users/${testUser.id}`);
      expect(res.status).toBe(401);
    });

    it('returns 403 for non-admin users', async () => {
      const res = await request(app)
        .get(`/api/users/${testUser.id}`)
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.status).toBe(403);
    });

    it('returns user for admin', async () => {
      const res = await request(app)
        .get(`/api/users/${testUser.id}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(testUser.id);
      expect(res.body.username).toBe('usersuser');
    });

    it('returns 404 for non-existent user', async () => {
      const res = await request(app)
        .get('/api/users/99999')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(404);
    });
  });

  describe('POST /api/users', () => {
    it('returns 401 without authentication', async () => {
      const res = await request(app)
        .post('/api/users')
        .send({ username: 'newuser', password: 'Test123!@#' });

      expect(res.status).toBe(401);
    });

    it('returns 403 for non-admin users', async () => {
      const res = await request(app)
        .post('/api/users')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ username: 'newuser', password: 'Test123!@#' });

      expect(res.status).toBe(403);
    });

    it('returns 400 without username', async () => {
      const res = await request(app)
        .post('/api/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ password: 'Test123!@#' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('required');
    });

    it('returns 400 without password', async () => {
      const res = await request(app)
        .post('/api/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ username: 'newuser' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('required');
    });

    it('creates user successfully', async () => {
      const res = await request(app)
        .post('/api/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ username: 'createduser', password: 'Create123!@#' });

      expect(res.status).toBe(201);
      expect(res.body.user).toBeDefined();
      expect(res.body.user.username).toBe('createduser');
    });

    it('creates admin user when is_admin is true', async () => {
      const res = await request(app)
        .post('/api/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ username: 'newadmin', password: 'Admin123!@#', is_admin: true });

      expect(res.status).toBe(201);
      expect(res.body.user.is_admin).toBe(1);
    });

    it('returns 400 for duplicate username', async () => {
      const res = await request(app)
        .post('/api/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ username: 'usersuser', password: 'Duplicate123!@#' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('exists');
    });

    it('validates password complexity', async () => {
      const res = await request(app)
        .post('/api/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ username: 'weakpw', password: 'weak' });

      expect(res.status).toBe(400);
    });
  });

  describe('PUT /api/users/:id', () => {
    let updateUser;

    beforeAll(async () => {
      updateUser = await createTestUser(db, { username: 'updatetarget', password: 'Update123!@#' });
    });

    it('returns 401 without authentication', async () => {
      const res = await request(app)
        .put(`/api/users/${updateUser.id}`)
        .send({ username: 'updated' });

      expect(res.status).toBe(401);
    });

    it('returns 403 for non-admin users', async () => {
      const res = await request(app)
        .put(`/api/users/${updateUser.id}`)
        .set('Authorization', `Bearer ${userToken}`)
        .send({ username: 'updated' });

      expect(res.status).toBe(403);
    });

    it('updates username', async () => {
      const res = await request(app)
        .put(`/api/users/${updateUser.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ username: 'updatedname' });

      expect(res.status).toBe(200);
      expect(res.body.message).toContain('updated');
    });

    it('updates email', async () => {
      const res = await request(app)
        .put(`/api/users/${updateUser.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ email: 'new@example.com' });

      expect(res.status).toBe(200);
    });

    it('updates admin status', async () => {
      const res = await request(app)
        .put(`/api/users/${updateUser.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ is_admin: true });

      expect(res.status).toBe(200);
    });

    it('returns 400 with no fields to update', async () => {
      const res = await request(app)
        .put(`/api/users/${updateUser.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({});

      expect(res.status).toBe(400);
    });

    it('returns 404 for non-existent user', async () => {
      const res = await request(app)
        .put('/api/users/99999')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ username: 'ghost' });

      expect(res.status).toBe(404);
    });
  });

  describe('DELETE /api/users/:id', () => {
    let deleteUser;

    beforeEach(async () => {
      deleteUser = await createTestUser(db, {
        username: `deleteuser${Date.now()}`,
        password: 'Delete123!@#'
      });
    });

    it('returns 401 without authentication', async () => {
      const res = await request(app).delete(`/api/users/${deleteUser.id}`);
      expect(res.status).toBe(401);
    });

    it('returns 403 for non-admin users', async () => {
      const res = await request(app)
        .delete(`/api/users/${deleteUser.id}`)
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.status).toBe(403);
    });

    it('deletes user successfully', async () => {
      const res = await request(app)
        .delete(`/api/users/${deleteUser.id}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.message).toContain('deleted');
    });

    it('returns 400 when deleting own account', async () => {
      const res = await request(app)
        .delete(`/api/users/${adminUser.id}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('own account');
    });

    it('returns 404 for non-existent user', async () => {
      const res = await request(app)
        .delete('/api/users/99999')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(404);
    });

    it('cleans up related data on delete', async () => {
      // Add progress for the user
      await new Promise((resolve) => {
        db.run(
          'INSERT INTO playback_progress (user_id, audiobook_id, position) VALUES (?, 1, 100)',
          [deleteUser.id],
          resolve
        );
      });

      const res = await request(app)
        .delete(`/api/users/${deleteUser.id}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);

      // Verify progress was deleted
      const progress = await new Promise((resolve) => {
        db.get(
          'SELECT * FROM playback_progress WHERE user_id = ?',
          [deleteUser.id],
          (_, row) => resolve(row)
        );
      });
      expect(progress).toBeUndefined();
    });
  });

  describe('User with Email', () => {
    it('creates user with email', async () => {
      const res = await request(app)
        .post('/api/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          username: 'emailuser',
          password: 'Email123!@#',
          email: 'test@example.com'
        });

      expect(res.status).toBe(201);
      expect(res.body.user.email).toBe('test@example.com');
    });

    it('allows null email', async () => {
      const res = await request(app)
        .post('/api/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          username: 'noemailuser',
          password: 'NoEmail123!@#'
        });

      expect(res.status).toBe(201);
    });
  });
});
