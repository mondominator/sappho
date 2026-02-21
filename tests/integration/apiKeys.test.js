/**
 * Integration tests for API Keys Routes
 * Tests: List, create, update, delete API keys
 */

const request = require('supertest');
const {
  createTestDatabase,
  createTestUser,
  generateTestToken,
  createTestApp
} = require('./testApp');

describe('API Keys Routes', () => {
  let db;
  let app;
  let user1, user2, adminUser;
  let user1Token, user2Token, adminToken;

  beforeAll(async () => {
    db = await createTestDatabase();
    app = createTestApp(db);

    // Create test users
    user1 = await createTestUser(db, { username: 'apiuser1', password: 'ApiPass123!' });
    user2 = await createTestUser(db, { username: 'apiuser2', password: 'ApiPass123!' });
    adminUser = await createTestUser(db, { username: 'apiadmin', password: 'AdminPass123!', isAdmin: true });

    user1Token = generateTestToken(user1);
    user2Token = generateTestToken(user2);
    adminToken = generateTestToken(adminUser);
  });

  afterAll((done) => {
    db.close(done);
  });

  describe('GET /api/api-keys', () => {
    describe('Authentication', () => {
      it('returns 401 without authentication', async () => {
        const res = await request(app)
          .get('/api/api-keys')
          .expect(401);

        expect(res.body.error).toBe('Access token required');
      });

      it('returns empty array for user with no API keys', async () => {
        const res = await request(app)
          .get('/api/api-keys')
          .set('Authorization', `Bearer ${user1Token}`)
          .expect(200);

        expect(Array.isArray(res.body)).toBe(true);
        expect(res.body.length).toBe(0);
      });
    });

    describe('Response data', () => {
      let createdKeyId;

      beforeAll(async () => {
        // Create an API key first
        const res = await request(app)
          .post('/api/api-keys')
          .set('Authorization', `Bearer ${user1Token}`)
          .send({ name: 'Test Key', permissions: 'read' });
        createdKeyId = res.body.id;
      });

      it('returns API keys for authenticated user', async () => {
        const res = await request(app)
          .get('/api/api-keys')
          .set('Authorization', `Bearer ${user1Token}`)
          .expect(200);

        expect(res.body.length).toBeGreaterThanOrEqual(1);
        expect(res.body[0]).toHaveProperty('id');
        expect(res.body[0]).toHaveProperty('name');
        expect(res.body[0]).toHaveProperty('key_prefix');
        expect(res.body[0]).toHaveProperty('permissions');
        expect(res.body[0]).toHaveProperty('expires_at');
        expect(res.body[0]).toHaveProperty('is_active');
        expect(res.body[0]).toHaveProperty('created_at');
      });

      it('does not include key_hash in response', async () => {
        const res = await request(app)
          .get('/api/api-keys')
          .set('Authorization', `Bearer ${user1Token}`)
          .expect(200);

        expect(res.body[0]).not.toHaveProperty('key_hash');
      });

      it('users only see their own API keys', async () => {
        const res = await request(app)
          .get('/api/api-keys')
          .set('Authorization', `Bearer ${user2Token}`)
          .expect(200);

        // user2 should not see user1's keys
        expect(res.body.length).toBe(0);
      });
    });
  });

  describe('POST /api/api-keys', () => {
    describe('Authentication', () => {
      it('returns 401 without authentication', async () => {
        const res = await request(app)
          .post('/api/api-keys')
          .send({ name: 'Test Key' })
          .expect(401);

        expect(res.body.error).toBe('Access token required');
      });
    });

    describe('Validation', () => {
      it('returns 400 without name', async () => {
        const res = await request(app)
          .post('/api/api-keys')
          .set('Authorization', `Bearer ${user1Token}`)
          .send({})
          .expect(400);

        expect(res.body.error).toBe('Name is required');
      });

      it('returns 400 with empty name', async () => {
        const res = await request(app)
          .post('/api/api-keys')
          .set('Authorization', `Bearer ${user1Token}`)
          .send({ name: '' })
          .expect(400);

        expect(res.body.error).toBe('Name is required');
      });

      it('returns 400 with whitespace-only name', async () => {
        const res = await request(app)
          .post('/api/api-keys')
          .set('Authorization', `Bearer ${user1Token}`)
          .send({ name: '   ' })
          .expect(400);

        expect(res.body.error).toBe('Name is required');
      });
    });

    describe('Success', () => {
      it('creates API key with required fields', async () => {
        const res = await request(app)
          .post('/api/api-keys')
          .set('Authorization', `Bearer ${user1Token}`)
          .send({ name: 'My New Key' })
          .expect(200);

        expect(res.body).toHaveProperty('id');
        expect(res.body).toHaveProperty('key');
        expect(res.body).toHaveProperty('key_prefix');
        expect(res.body.name).toBe('My New Key');
        expect(res.body.key).toMatch(/^sapho_/);
        expect(res.body.key_prefix).toMatch(/^sapho_/);
        expect(res.body.message).toBe('Save this key securely - it will not be shown again!');
      });

      it('defaults permissions to read', async () => {
        const res = await request(app)
          .post('/api/api-keys')
          .set('Authorization', `Bearer ${user1Token}`)
          .send({ name: 'Read Only Key' })
          .expect(200);

        expect(res.body.permissions).toBe('read');
      });

      it('accepts custom permissions', async () => {
        const res = await request(app)
          .post('/api/api-keys')
          .set('Authorization', `Bearer ${user1Token}`)
          .send({ name: 'Full Access Key', permissions: 'read,write' })
          .expect(200);

        expect(res.body.permissions).toBe('read,write');
      });

      it('sets expiration date', async () => {
        const res = await request(app)
          .post('/api/api-keys')
          .set('Authorization', `Bearer ${user1Token}`)
          .send({ name: 'Expiring Key' })
          .expect(200);

        expect(res.body).toHaveProperty('expires_at');
        expect(new Date(res.body.expires_at).getTime()).toBeGreaterThan(Date.now());
      });

      it('accepts custom expiration in days', async () => {
        const res = await request(app)
          .post('/api/api-keys')
          .set('Authorization', `Bearer ${user1Token}`)
          .send({ name: 'Short Lived Key', expires_in_days: 30 })
          .expect(200);

        const expiresAt = new Date(res.body.expires_at);
        const thirtyDaysFromNow = new Date();
        thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);

        // Should be approximately 30 days from now (within a minute)
        expect(Math.abs(expiresAt.getTime() - thirtyDaysFromNow.getTime())).toBeLessThan(60000);
      });

      it('limits expiration to 365 days maximum', async () => {
        const res = await request(app)
          .post('/api/api-keys')
          .set('Authorization', `Bearer ${user1Token}`)
          .send({ name: 'Max Expiry Key', expires_in_days: 1000 })
          .expect(200);

        const expiresAt = new Date(res.body.expires_at);
        const maxDaysFromNow = new Date();
        maxDaysFromNow.setDate(maxDaysFromNow.getDate() + 365);

        // Should be approximately 365 days from now (within a minute)
        expect(Math.abs(expiresAt.getTime() - maxDaysFromNow.getTime())).toBeLessThan(60000);
      });

      it('uses default expiration when 0 is passed (0 is falsy)', async () => {
        // When expires_in_days is 0, it's treated as falsy and uses the default (90 days)
        const res = await request(app)
          .post('/api/api-keys')
          .set('Authorization', `Bearer ${user1Token}`)
          .send({ name: 'Zero Expiry Key', expires_in_days: 0 })
          .expect(200);

        const expiresAt = new Date(res.body.expires_at);
        const ninetyDaysFromNow = new Date();
        ninetyDaysFromNow.setDate(ninetyDaysFromNow.getDate() + 90);

        // Should be approximately 90 days from now (the default)
        expect(Math.abs(expiresAt.getTime() - ninetyDaysFromNow.getTime())).toBeLessThan(60000);
      });
    });
  });

  describe('PUT /api/api-keys/:id', () => {
    let testKeyId;

    beforeEach(async () => {
      // Create a fresh API key for update tests
      const res = await request(app)
        .post('/api/api-keys')
        .set('Authorization', `Bearer ${user1Token}`)
        .send({ name: 'Key to Update' });
      testKeyId = res.body.id;
    });

    describe('Authentication', () => {
      it('returns 401 without authentication', async () => {
        const res = await request(app)
          .put(`/api/api-keys/${testKeyId}`)
          .send({ name: 'New Name' })
          .expect(401);

        expect(res.body.error).toBe('Access token required');
      });
    });

    describe('Validation', () => {
      it('returns 400 with no fields to update', async () => {
        const res = await request(app)
          .put(`/api/api-keys/${testKeyId}`)
          .set('Authorization', `Bearer ${user1Token}`)
          .send({})
          .expect(400);

        expect(res.body.error).toBe('No fields to update');
      });

      it('returns 404 for non-existent key', async () => {
        const res = await request(app)
          .put('/api/api-keys/99999')
          .set('Authorization', `Bearer ${user1Token}`)
          .send({ name: 'New Name' })
          .expect(404);

        expect(res.body.error).toBe('API key not found');
      });

      it('returns 404 when updating another user\'s key', async () => {
        const res = await request(app)
          .put(`/api/api-keys/${testKeyId}`)
          .set('Authorization', `Bearer ${user2Token}`)
          .send({ name: 'Hacked Name' })
          .expect(404);

        expect(res.body.error).toBe('API key not found');
      });
    });

    describe('Success', () => {
      it('updates name successfully', async () => {
        const res = await request(app)
          .put(`/api/api-keys/${testKeyId}`)
          .set('Authorization', `Bearer ${user1Token}`)
          .send({ name: 'Updated Key Name' })
          .expect(200);

        expect(res.body.message).toBe('API key updated successfully');

        // Verify the update
        const listRes = await request(app)
          .get('/api/api-keys')
          .set('Authorization', `Bearer ${user1Token}`);

        const updatedKey = listRes.body.find(k => k.id === testKeyId);
        expect(updatedKey.name).toBe('Updated Key Name');
      });

      it('updates permissions successfully', async () => {
        await request(app)
          .put(`/api/api-keys/${testKeyId}`)
          .set('Authorization', `Bearer ${user1Token}`)
          .send({ permissions: 'read,write,admin' })
          .expect(200);

        const listRes = await request(app)
          .get('/api/api-keys')
          .set('Authorization', `Bearer ${user1Token}`);

        const updatedKey = listRes.body.find(k => k.id === testKeyId);
        expect(updatedKey.permissions).toBe('read,write,admin');
      });

      it('deactivates API key', async () => {
        await request(app)
          .put(`/api/api-keys/${testKeyId}`)
          .set('Authorization', `Bearer ${user1Token}`)
          .send({ is_active: false })
          .expect(200);

        const listRes = await request(app)
          .get('/api/api-keys')
          .set('Authorization', `Bearer ${user1Token}`);

        const updatedKey = listRes.body.find(k => k.id === testKeyId);
        expect(updatedKey.is_active).toBe(0);
      });

      it('reactivates API key', async () => {
        // First deactivate
        await request(app)
          .put(`/api/api-keys/${testKeyId}`)
          .set('Authorization', `Bearer ${user1Token}`)
          .send({ is_active: false });

        // Then reactivate
        await request(app)
          .put(`/api/api-keys/${testKeyId}`)
          .set('Authorization', `Bearer ${user1Token}`)
          .send({ is_active: true })
          .expect(200);

        const listRes = await request(app)
          .get('/api/api-keys')
          .set('Authorization', `Bearer ${user1Token}`);

        const updatedKey = listRes.body.find(k => k.id === testKeyId);
        expect(updatedKey.is_active).toBe(1);
      });

      it('updates multiple fields at once', async () => {
        await request(app)
          .put(`/api/api-keys/${testKeyId}`)
          .set('Authorization', `Bearer ${user1Token}`)
          .send({
            name: 'Multi Update Key',
            permissions: 'full',
            is_active: false
          })
          .expect(200);

        const listRes = await request(app)
          .get('/api/api-keys')
          .set('Authorization', `Bearer ${user1Token}`);

        const updatedKey = listRes.body.find(k => k.id === testKeyId);
        expect(updatedKey.name).toBe('Multi Update Key');
        expect(updatedKey.permissions).toBe('full');
        expect(updatedKey.is_active).toBe(0);
      });
    });
  });

  describe('DELETE /api/api-keys/:id', () => {
    let testKeyId;

    beforeEach(async () => {
      // Create a fresh API key for delete tests
      const res = await request(app)
        .post('/api/api-keys')
        .set('Authorization', `Bearer ${user1Token}`)
        .send({ name: 'Key to Delete' });
      testKeyId = res.body.id;
    });

    describe('Authentication', () => {
      it('returns 401 without authentication', async () => {
        const res = await request(app)
          .delete(`/api/api-keys/${testKeyId}`)
          .expect(401);

        expect(res.body.error).toBe('Access token required');
      });
    });

    describe('Validation', () => {
      it('returns 404 for non-existent key', async () => {
        const res = await request(app)
          .delete('/api/api-keys/99999')
          .set('Authorization', `Bearer ${user1Token}`)
          .expect(404);

        expect(res.body.error).toBe('API key not found');
      });

      it('returns 404 when deleting another user\'s key', async () => {
        const res = await request(app)
          .delete(`/api/api-keys/${testKeyId}`)
          .set('Authorization', `Bearer ${user2Token}`)
          .expect(404);

        expect(res.body.error).toBe('API key not found');
      });
    });

    describe('Success', () => {
      it('deletes API key successfully', async () => {
        const res = await request(app)
          .delete(`/api/api-keys/${testKeyId}`)
          .set('Authorization', `Bearer ${user1Token}`)
          .expect(200);

        expect(res.body.message).toBe('API key deleted successfully');

        // Verify the deletion
        const listRes = await request(app)
          .get('/api/api-keys')
          .set('Authorization', `Bearer ${user1Token}`);

        const deletedKey = listRes.body.find(k => k.id === testKeyId);
        expect(deletedKey).toBeUndefined();
      });
    });
  });

  describe('Security', () => {
    it('users can only manage their own API keys', async () => {
      // Create key as user1
      const createRes = await request(app)
        .post('/api/api-keys')
        .set('Authorization', `Bearer ${user1Token}`)
        .send({ name: 'User1 Secret Key' });

      const keyId = createRes.body.id;

      // User2 cannot see it
      const listRes = await request(app)
        .get('/api/api-keys')
        .set('Authorization', `Bearer ${user2Token}`);

      expect(listRes.body.find(k => k.id === keyId)).toBeUndefined();

      // User2 cannot update it
      await request(app)
        .put(`/api/api-keys/${keyId}`)
        .set('Authorization', `Bearer ${user2Token}`)
        .send({ name: 'Hacked' })
        .expect(404);

      // User2 cannot delete it
      await request(app)
        .delete(`/api/api-keys/${keyId}`)
        .set('Authorization', `Bearer ${user2Token}`)
        .expect(404);
    });

    it('API key full value is only returned once on creation', async () => {
      const createRes = await request(app)
        .post('/api/api-keys')
        .set('Authorization', `Bearer ${user1Token}`)
        .send({ name: 'One Time Key' });

      // Key is returned on creation
      expect(createRes.body.key).toBeDefined();
      expect(createRes.body.key.length).toBeGreaterThan(50);

      const keyId = createRes.body.id;

      // Key is NOT returned on list
      const listRes = await request(app)
        .get('/api/api-keys')
        .set('Authorization', `Bearer ${user1Token}`);

      const listedKey = listRes.body.find(k => k.id === keyId);
      expect(listedKey.key).toBeUndefined();
      expect(listedKey.key_hash).toBeUndefined();
    });

    it('key_prefix is safe to display', async () => {
      const createRes = await request(app)
        .post('/api/api-keys')
        .set('Authorization', `Bearer ${user1Token}`)
        .send({ name: 'Prefix Test Key' });

      // Prefix is returned on creation
      expect(createRes.body.key_prefix).toBeDefined();
      expect(createRes.body.key_prefix).toMatch(/^sapho_[a-f0-9]{8}$/);

      // Prefix is also returned on list (safe to display)
      const listRes = await request(app)
        .get('/api/api-keys')
        .set('Authorization', `Bearer ${user1Token}`);

      const listedKey = listRes.body.find(k => k.id === createRes.body.id);
      expect(listedKey.key_prefix).toBe(createRes.body.key_prefix);
    });
  });
});
