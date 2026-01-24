/**
 * Integration tests for Profile Routes
 * Tests: Get profile, update profile, stats, password change, avatar
 */

const request = require('supertest');
const {
  createTestDatabase,
  createTestUser,
  generateTestToken,
  createTestApp,
  createTestAudiobook
} = require('./testApp');

describe('Profile Routes', () => {
  let db;
  let app;
  let user1, adminUser;
  let user1Token, adminToken;

  beforeAll(async () => {
    db = await createTestDatabase();
    app = createTestApp(db);

    // Create test users
    user1 = await createTestUser(db, { username: 'profileuser', password: 'ProfilePass123!' });
    adminUser = await createTestUser(db, { username: 'profileadmin', password: 'AdminPass123!', isAdmin: true });

    user1Token = generateTestToken(user1);
    adminToken = generateTestToken(adminUser);
  });

  afterAll((done) => {
    db.close(done);
  });

  describe('GET /api/profile', () => {
    describe('Authentication', () => {
      it('returns 401 without authentication', async () => {
        const res = await request(app)
          .get('/api/profile')
          .expect(401);

        expect(res.body.error).toBe('Unauthorized');
      });

      it('returns profile with valid token', async () => {
        const res = await request(app)
          .get('/api/profile')
          .set('Authorization', `Bearer ${user1Token}`)
          .expect(200);

        expect(res.body.username).toBe('profileuser');
      });
    });

    describe('Response data', () => {
      it('includes user fields', async () => {
        const res = await request(app)
          .get('/api/profile')
          .set('Authorization', `Bearer ${user1Token}`)
          .expect(200);

        expect(res.body).toHaveProperty('id');
        expect(res.body).toHaveProperty('username');
        expect(res.body).toHaveProperty('email');
        expect(res.body).toHaveProperty('display_name');
        expect(res.body).toHaveProperty('avatar');
        expect(res.body).toHaveProperty('is_admin');
        expect(res.body).toHaveProperty('must_change_password');
        expect(res.body).toHaveProperty('created_at');
      });

      it('does not include password hash', async () => {
        const res = await request(app)
          .get('/api/profile')
          .set('Authorization', `Bearer ${user1Token}`)
          .expect(200);

        expect(res.body).not.toHaveProperty('password_hash');
      });

      it('shows correct admin status for regular user', async () => {
        const res = await request(app)
          .get('/api/profile')
          .set('Authorization', `Bearer ${user1Token}`)
          .expect(200);

        expect(res.body.is_admin).toBe(0);
      });

      it('shows correct admin status for admin user', async () => {
        const res = await request(app)
          .get('/api/profile')
          .set('Authorization', `Bearer ${adminToken}`)
          .expect(200);

        expect(res.body.is_admin).toBe(1);
      });

      it('must_change_password is boolean', async () => {
        const res = await request(app)
          .get('/api/profile')
          .set('Authorization', `Bearer ${user1Token}`)
          .expect(200);

        expect(typeof res.body.must_change_password).toBe('boolean');
      });
    });
  });

  describe('GET /api/profile/stats', () => {
    describe('Authentication', () => {
      it('returns 401 without authentication', async () => {
        const res = await request(app)
          .get('/api/profile/stats')
          .expect(401);

        expect(res.body.error).toBe('Unauthorized');
      });

      it('returns stats with valid token', async () => {
        const res = await request(app)
          .get('/api/profile/stats')
          .set('Authorization', `Bearer ${user1Token}`)
          .expect(200);

        expect(res.body).toHaveProperty('totalListenTime');
        expect(res.body).toHaveProperty('booksStarted');
        expect(res.body).toHaveProperty('booksCompleted');
      });
    });

    describe('Stats calculation', () => {
      let book1, book2;

      beforeAll(async () => {
        // Create audiobooks and progress for stats testing
        book1 = await createTestAudiobook(db, { title: 'Stats Book 1', author: 'Author', duration: 3600 });
        book2 = await createTestAudiobook(db, { title: 'Stats Book 2', author: 'Author', duration: 7200 });

        // Add progress records
        await new Promise((resolve, reject) => {
          db.run(
            'INSERT INTO playback_progress (user_id, audiobook_id, position, completed) VALUES (?, ?, ?, ?)',
            [user1.id, book1.id, 1800, 1], // 50% through, completed
            (err) => err ? reject(err) : resolve()
          );
        });

        await new Promise((resolve, reject) => {
          db.run(
            'INSERT INTO playback_progress (user_id, audiobook_id, position, completed) VALUES (?, ?, ?, ?)',
            [user1.id, book2.id, 3600, 0], // 50% through, not completed
            (err) => err ? reject(err) : resolve()
          );
        });
      });

      it('counts books started', async () => {
        const res = await request(app)
          .get('/api/profile/stats')
          .set('Authorization', `Bearer ${user1Token}`)
          .expect(200);

        expect(res.body.booksStarted).toBeGreaterThanOrEqual(2);
      });

      it('counts books completed', async () => {
        const res = await request(app)
          .get('/api/profile/stats')
          .set('Authorization', `Bearer ${user1Token}`)
          .expect(200);

        expect(res.body.booksCompleted).toBeGreaterThanOrEqual(1);
      });

      it('calculates total listen time from completed books', async () => {
        const res = await request(app)
          .get('/api/profile/stats')
          .set('Authorization', `Bearer ${user1Token}`)
          .expect(200);

        expect(res.body.totalListenTime).toBeGreaterThanOrEqual(3600); // At least book1 duration
      });
    });
  });

  describe('PUT /api/profile', () => {
    describe('Authentication', () => {
      it('returns 401 without authentication', async () => {
        const res = await request(app)
          .put('/api/profile')
          .send({ displayName: 'New Name' })
          .expect(401);

        expect(res.body.error).toBe('Unauthorized');
      });
    });

    describe('Validation', () => {
      it('returns 400 with no fields to update', async () => {
        const res = await request(app)
          .put('/api/profile')
          .set('Authorization', `Bearer ${user1Token}`)
          .send({})
          .expect(400);

        expect(res.body.error).toBe('No fields to update');
      });

      it('returns 400 with empty display name', async () => {
        const res = await request(app)
          .put('/api/profile')
          .set('Authorization', `Bearer ${user1Token}`)
          .send({ displayName: '' })
          .expect(400);

        expect(res.body.error).toBe('Display name cannot be empty or whitespace-only');
      });

      it('returns 400 with whitespace-only display name', async () => {
        const res = await request(app)
          .put('/api/profile')
          .set('Authorization', `Bearer ${user1Token}`)
          .send({ displayName: '   ' })
          .expect(400);

        expect(res.body.error).toBe('Display name cannot be empty or whitespace-only');
      });

      it('returns 400 with display name over 100 characters', async () => {
        const res = await request(app)
          .put('/api/profile')
          .set('Authorization', `Bearer ${user1Token}`)
          .send({ displayName: 'a'.repeat(101) })
          .expect(400);

        expect(res.body.error).toBe('Display name must be 100 characters or less');
      });
    });

    describe('Success', () => {
      it('updates display name', async () => {
        const res = await request(app)
          .put('/api/profile')
          .set('Authorization', `Bearer ${user1Token}`)
          .send({ displayName: 'Updated Display Name' })
          .expect(200);

        expect(res.body.display_name).toBe('Updated Display Name');
      });

      it('trims whitespace from display name', async () => {
        const res = await request(app)
          .put('/api/profile')
          .set('Authorization', `Bearer ${user1Token}`)
          .send({ displayName: '  Trimmed Name  ' })
          .expect(200);

        expect(res.body.display_name).toBe('Trimmed Name');
      });

      it('updates email', async () => {
        const res = await request(app)
          .put('/api/profile')
          .set('Authorization', `Bearer ${user1Token}`)
          .send({ displayName: 'Name With Email', email: 'test@example.com' })
          .expect(200);

        expect(res.body.email).toBe('test@example.com');
      });

      it('allows null email', async () => {
        const res = await request(app)
          .put('/api/profile')
          .set('Authorization', `Bearer ${user1Token}`)
          .send({ displayName: 'Name Only', email: null })
          .expect(200);

        expect(res.body.email).toBeNull();
      });

      it('returns updated user object', async () => {
        const res = await request(app)
          .put('/api/profile')
          .set('Authorization', `Bearer ${user1Token}`)
          .send({ displayName: 'Check Response' })
          .expect(200);

        expect(res.body).toHaveProperty('id');
        expect(res.body).toHaveProperty('username');
        expect(res.body).toHaveProperty('display_name');
        expect(res.body).toHaveProperty('is_admin');
      });
    });
  });

  describe('DELETE /api/profile/avatar', () => {
    describe('Authentication', () => {
      it('returns 401 without authentication', async () => {
        const res = await request(app)
          .delete('/api/profile/avatar')
          .expect(401);

        expect(res.body.error).toBe('Unauthorized');
      });
    });

    describe('Success', () => {
      it('removes avatar successfully', async () => {
        const res = await request(app)
          .delete('/api/profile/avatar')
          .set('Authorization', `Bearer ${user1Token}`)
          .expect(200);

        expect(res.body.message).toBe('Avatar removed successfully');
      });

      it('avatar is null after removal', async () => {
        await request(app)
          .delete('/api/profile/avatar')
          .set('Authorization', `Bearer ${user1Token}`)
          .expect(200);

        const profile = await request(app)
          .get('/api/profile')
          .set('Authorization', `Bearer ${user1Token}`)
          .expect(200);

        expect(profile.body.avatar).toBeNull();
      });
    });
  });

  describe('PUT /api/profile/password', () => {
    let passwordTestUser;
    let passwordTestToken;

    beforeEach(async () => {
      // Create fresh user for each password test
      passwordTestUser = await createTestUser(db, {
        username: `pwduser${Date.now()}`,
        password: 'OldPassword123!'
      });
      passwordTestToken = generateTestToken(passwordTestUser);
    });

    describe('Authentication', () => {
      it('returns 401 without authentication', async () => {
        const res = await request(app)
          .put('/api/profile/password')
          .send({ currentPassword: 'old', newPassword: 'new' })
          .expect(401);

        expect(res.body.error).toBe('Unauthorized');
      });
    });

    describe('Validation', () => {
      it('returns 400 without current password', async () => {
        const res = await request(app)
          .put('/api/profile/password')
          .set('Authorization', `Bearer ${passwordTestToken}`)
          .send({ newPassword: 'NewPassword123!' })
          .expect(400);

        expect(res.body.error).toBe('Current password and new password are required');
      });

      it('returns 400 without new password', async () => {
        const res = await request(app)
          .put('/api/profile/password')
          .set('Authorization', `Bearer ${passwordTestToken}`)
          .send({ currentPassword: 'OldPassword123!' })
          .expect(400);

        expect(res.body.error).toBe('Current password and new password are required');
      });

      it('returns 400 with short new password', async () => {
        const res = await request(app)
          .put('/api/profile/password')
          .set('Authorization', `Bearer ${passwordTestToken}`)
          .send({ currentPassword: 'OldPassword123!', newPassword: '12345' })
          .expect(400);

        expect(res.body.error).toBe('Password must be at least 6 characters');
      });

      it('returns 401 with wrong current password', async () => {
        const res = await request(app)
          .put('/api/profile/password')
          .set('Authorization', `Bearer ${passwordTestToken}`)
          .send({ currentPassword: 'WrongPassword', newPassword: 'NewPassword123!' })
          .expect(401);

        expect(res.body.error).toBe('Current password is incorrect');
      });
    });

    describe('Success', () => {
      it('changes password with correct credentials', async () => {
        const res = await request(app)
          .put('/api/profile/password')
          .set('Authorization', `Bearer ${passwordTestToken}`)
          .send({ currentPassword: 'OldPassword123!', newPassword: 'NewPassword123!' })
          .expect(200);

        expect(res.body.message).toBe('Password updated successfully. Please log in again on all devices.');
      });
    });
  });

  describe('Security', () => {
    it('users can only access their own profile', async () => {
      const res = await request(app)
        .get('/api/profile')
        .set('Authorization', `Bearer ${user1Token}`)
        .expect(200);

      expect(res.body.username).toBe('profileuser');
      expect(res.body.username).not.toBe('profileadmin');
    });

    it('users can only update their own profile', async () => {
      const res = await request(app)
        .put('/api/profile')
        .set('Authorization', `Bearer ${user1Token}`)
        .send({ displayName: 'My Name Only' })
        .expect(200);

      // Verify admin profile wasn't affected
      const adminProfile = await request(app)
        .get('/api/profile')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(adminProfile.body.display_name).not.toBe('My Name Only');
    });

    it('XSS in display name is stored safely', async () => {
      const res = await request(app)
        .put('/api/profile')
        .set('Authorization', `Bearer ${user1Token}`)
        .send({ displayName: '<script>alert("xss")</script>' })
        .expect(200);

      expect(res.body.display_name).toBe('<script>alert("xss")</script>');
    });

    it('SQL injection in display name is safe', async () => {
      const res = await request(app)
        .put('/api/profile')
        .set('Authorization', `Bearer ${user1Token}`)
        .send({ displayName: "'; DROP TABLE users; --" })
        .expect(200);

      expect(res.body.display_name).toBe("'; DROP TABLE users; --");

      // Verify table still exists
      const profile = await request(app)
        .get('/api/profile')
        .set('Authorization', `Bearer ${user1Token}`)
        .expect(200);

      expect(profile.body.username).toBe('profileuser');
    });
  });
});
