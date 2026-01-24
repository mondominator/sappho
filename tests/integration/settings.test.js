/**
 * Integration tests for Settings Routes
 * Tests: Server settings, library settings, AI settings (all admin-only)
 */

const request = require('supertest');
const {
  createTestDatabase,
  createTestUser,
  generateTestToken,
  createTestApp
} = require('./testApp');

describe('Settings Routes', () => {
  let db;
  let app;
  let regularUser, adminUser;
  let userToken, adminToken;

  beforeAll(async () => {
    db = await createTestDatabase();
    app = createTestApp(db);

    // Create test users
    regularUser = await createTestUser(db, { username: 'settingsuser', password: 'UserPass123!' });
    adminUser = await createTestUser(db, { username: 'settingsadmin', password: 'AdminPass123!', isAdmin: true });

    userToken = generateTestToken(regularUser);
    adminToken = generateTestToken(adminUser);
  });

  afterAll((done) => {
    db.close(done);
  });

  describe('GET /api/settings/all', () => {
    describe('Authorization', () => {
      it('returns 401 without authentication', async () => {
        const res = await request(app)
          .get('/api/settings/all')
          .expect(401);

        expect(res.body.error).toBe('Unauthorized');
      });

      it('returns 403 for non-admin users', async () => {
        const res = await request(app)
          .get('/api/settings/all')
          .set('Authorization', `Bearer ${userToken}`)
          .expect(403);

        expect(res.body.error).toBe('Admin access required');
      });

      it('returns settings for admin users', async () => {
        const res = await request(app)
          .get('/api/settings/all')
          .set('Authorization', `Bearer ${adminToken}`)
          .expect(200);

        expect(res.body).toHaveProperty('settings');
      });
    });

    describe('Response data', () => {
      it('includes all settings fields', async () => {
        const res = await request(app)
          .get('/api/settings/all')
          .set('Authorization', `Bearer ${adminToken}`)
          .expect(200);

        const { settings } = res.body;
        expect(settings).toHaveProperty('port');
        expect(settings).toHaveProperty('nodeEnv');
        expect(settings).toHaveProperty('databasePath');
        expect(settings).toHaveProperty('dataDir');
        expect(settings).toHaveProperty('audiobooksDir');
        expect(settings).toHaveProperty('uploadDir');
        expect(settings).toHaveProperty('libraryScanInterval');
        expect(settings).toHaveProperty('autoBackupInterval');
        expect(settings).toHaveProperty('backupRetention');
        expect(settings).toHaveProperty('logBufferSize');
      });

      it('includes lockedFields array', async () => {
        const res = await request(app)
          .get('/api/settings/all')
          .set('Authorization', `Bearer ${adminToken}`)
          .expect(200);

        expect(res.body).toHaveProperty('lockedFields');
        expect(Array.isArray(res.body.lockedFields)).toBe(true);
      });
    });
  });

  describe('PUT /api/settings/all', () => {
    describe('Authorization', () => {
      it('returns 401 without authentication', async () => {
        const res = await request(app)
          .put('/api/settings/all')
          .send({ port: 3002 })
          .expect(401);

        expect(res.body.error).toBe('Unauthorized');
      });

      it('returns 403 for non-admin users', async () => {
        const res = await request(app)
          .put('/api/settings/all')
          .set('Authorization', `Bearer ${userToken}`)
          .send({ port: 3002 })
          .expect(403);

        expect(res.body.error).toBe('Admin access required');
      });
    });

    describe('Validation', () => {
      it('returns 400 for invalid port (too low)', async () => {
        const res = await request(app)
          .put('/api/settings/all')
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ port: 0 })
          .expect(400);

        expect(res.body.errors).toContain('Port must be between 1 and 65535');
      });

      it('returns 400 for invalid port (too high)', async () => {
        const res = await request(app)
          .put('/api/settings/all')
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ port: 70000 })
          .expect(400);

        expect(res.body.errors).toContain('Port must be between 1 and 65535');
      });

      it('returns 400 for invalid node environment', async () => {
        const res = await request(app)
          .put('/api/settings/all')
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ nodeEnv: 'invalid' })
          .expect(400);

        expect(res.body.errors).toContain('Environment must be "development" or "production"');
      });

      it('returns 400 for invalid scan interval (too low)', async () => {
        const res = await request(app)
          .put('/api/settings/all')
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ libraryScanInterval: 0 })
          .expect(400);

        expect(res.body.errors).toContain('Scan interval must be between 1 and 1440 minutes');
      });

      it('returns 400 for invalid scan interval (too high)', async () => {
        const res = await request(app)
          .put('/api/settings/all')
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ libraryScanInterval: 1500 })
          .expect(400);

        expect(res.body.errors).toContain('Scan interval must be between 1 and 1440 minutes');
      });
    });

    describe('Success', () => {
      it('updates valid settings', async () => {
        const res = await request(app)
          .put('/api/settings/all')
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ port: 3002 })
          .expect(200);

        expect(res.body.message).toBe('Settings updated successfully.');
        expect(res.body.updated).toContain('PORT');
      });

      it('returns requiresRestart for port and nodeEnv changes', async () => {
        const res = await request(app)
          .put('/api/settings/all')
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ port: 3002, nodeEnv: 'production' })
          .expect(200);

        expect(res.body.requiresRestart).toContain('PORT');
        expect(res.body.requiresRestart).toContain('NODE_ENV');
      });

      it('updates scan interval without restart', async () => {
        const res = await request(app)
          .put('/api/settings/all')
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ libraryScanInterval: 10 })
          .expect(200);

        expect(res.body.updated).toContain('LIBRARY_SCAN_INTERVAL');
        expect(res.body.requiresRestart).not.toContain('LIBRARY_SCAN_INTERVAL');
      });
    });
  });

  describe('GET /api/settings/library', () => {
    describe('Authorization', () => {
      it('returns 403 for non-admin users', async () => {
        const res = await request(app)
          .get('/api/settings/library')
          .set('Authorization', `Bearer ${userToken}`)
          .expect(403);

        expect(res.body.error).toBe('Admin access required');
      });

      it('returns library settings for admin', async () => {
        const res = await request(app)
          .get('/api/settings/library')
          .set('Authorization', `Bearer ${adminToken}`)
          .expect(200);

        expect(res.body).toHaveProperty('libraryPath');
        expect(res.body).toHaveProperty('uploadPath');
      });
    });
  });

  describe('PUT /api/settings/library', () => {
    describe('Authorization', () => {
      it('returns 403 for non-admin users', async () => {
        const res = await request(app)
          .put('/api/settings/library')
          .set('Authorization', `Bearer ${userToken}`)
          .send({ libraryPath: '/path', uploadPath: '/path' })
          .expect(403);

        expect(res.body.error).toBe('Admin access required');
      });
    });

    describe('Validation', () => {
      it('returns 400 without libraryPath', async () => {
        const res = await request(app)
          .put('/api/settings/library')
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ uploadPath: '/path' })
          .expect(400);

        expect(res.body.error).toBe('All paths are required');
      });

      it('returns 400 without uploadPath', async () => {
        const res = await request(app)
          .put('/api/settings/library')
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ libraryPath: '/path' })
          .expect(400);

        expect(res.body.error).toBe('All paths are required');
      });
    });

    describe('Success', () => {
      it('updates library settings', async () => {
        const res = await request(app)
          .put('/api/settings/library')
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ libraryPath: '/app/data/audiobooks', uploadPath: '/app/data/uploads' })
          .expect(200);

        expect(res.body.message).toBe('Library settings updated successfully.');
      });
    });
  });

  describe('GET /api/settings/server', () => {
    describe('Authorization', () => {
      it('returns 403 for non-admin users', async () => {
        const res = await request(app)
          .get('/api/settings/server')
          .set('Authorization', `Bearer ${userToken}`)
          .expect(403);

        expect(res.body.error).toBe('Admin access required');
      });

      it('returns server settings for admin', async () => {
        const res = await request(app)
          .get('/api/settings/server')
          .set('Authorization', `Bearer ${adminToken}`)
          .expect(200);

        expect(res.body).toHaveProperty('settings');
        expect(res.body.settings).toHaveProperty('port');
        expect(res.body.settings).toHaveProperty('nodeEnv');
      });
    });
  });

  describe('PUT /api/settings/server', () => {
    describe('Authorization', () => {
      it('returns 403 for non-admin users', async () => {
        const res = await request(app)
          .put('/api/settings/server')
          .set('Authorization', `Bearer ${userToken}`)
          .send({ port: 3002 })
          .expect(403);

        expect(res.body.error).toBe('Admin access required');
      });
    });

    describe('Success', () => {
      it('updates server settings (same as /all)', async () => {
        const res = await request(app)
          .put('/api/settings/server')
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ port: 3003 })
          .expect(200);

        expect(res.body.message).toBe('Settings updated successfully.');
        expect(res.body.updated).toContain('PORT');
      });
    });
  });

  describe('GET /api/settings/ai', () => {
    describe('Authorization', () => {
      it('returns 403 for non-admin users', async () => {
        const res = await request(app)
          .get('/api/settings/ai')
          .set('Authorization', `Bearer ${userToken}`)
          .expect(403);

        expect(res.body.error).toBe('Admin access required');
      });

      it('returns AI settings for admin', async () => {
        const res = await request(app)
          .get('/api/settings/ai')
          .set('Authorization', `Bearer ${adminToken}`)
          .expect(200);

        expect(res.body).toHaveProperty('settings');
        expect(res.body.settings).toHaveProperty('aiProvider');
        expect(res.body.settings).toHaveProperty('openaiModel');
        expect(res.body.settings).toHaveProperty('geminiModel');
      });
    });

    describe('Security', () => {
      it('masks API keys in response', async () => {
        const res = await request(app)
          .get('/api/settings/ai')
          .set('Authorization', `Bearer ${adminToken}`)
          .expect(200);

        const { settings } = res.body;
        // If API key is set, it should be masked
        if (settings.openaiApiKey) {
          expect(settings.openaiApiKey).toBe('••••••••');
        }
        if (settings.geminiApiKey) {
          expect(settings.geminiApiKey).toBe('••••••••');
        }
      });
    });
  });

  describe('GET /api/settings/ai/status', () => {
    describe('Authorization', () => {
      it('returns 401 without authentication', async () => {
        const res = await request(app)
          .get('/api/settings/ai/status')
          .expect(401);

        expect(res.body.error).toBe('Unauthorized');
      });

      it('allows regular users to check AI status', async () => {
        const res = await request(app)
          .get('/api/settings/ai/status')
          .set('Authorization', `Bearer ${userToken}`)
          .expect(200);

        expect(res.body).toHaveProperty('configured');
        expect(res.body).toHaveProperty('provider');
      });

      it('allows admin users to check AI status', async () => {
        const res = await request(app)
          .get('/api/settings/ai/status')
          .set('Authorization', `Bearer ${adminToken}`)
          .expect(200);

        expect(res.body).toHaveProperty('configured');
        expect(res.body).toHaveProperty('provider');
      });
    });

    describe('Response data', () => {
      it('returns boolean configured status', async () => {
        const res = await request(app)
          .get('/api/settings/ai/status')
          .set('Authorization', `Bearer ${userToken}`)
          .expect(200);

        expect(typeof res.body.configured).toBe('boolean');
      });

      it('returns string provider', async () => {
        const res = await request(app)
          .get('/api/settings/ai/status')
          .set('Authorization', `Bearer ${userToken}`)
          .expect(200);

        expect(typeof res.body.provider).toBe('string');
        expect(['openai', 'gemini']).toContain(res.body.provider);
      });
    });
  });

  describe('PUT /api/settings/ai', () => {
    describe('Authorization', () => {
      it('returns 403 for non-admin users', async () => {
        const res = await request(app)
          .put('/api/settings/ai')
          .set('Authorization', `Bearer ${userToken}`)
          .send({ aiProvider: 'openai' })
          .expect(403);

        expect(res.body.error).toBe('Admin access required');
      });
    });

    describe('Validation', () => {
      it('returns 400 for invalid AI provider', async () => {
        const res = await request(app)
          .put('/api/settings/ai')
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ aiProvider: 'invalid' })
          .expect(400);

        expect(res.body.error).toBe('Invalid AI provider');
      });

      it('returns 400 for invalid OpenAI model', async () => {
        const res = await request(app)
          .put('/api/settings/ai')
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ openaiModel: 'invalid-model' })
          .expect(400);

        expect(res.body.error).toBe('Invalid OpenAI model selected');
      });

      it('returns 400 for invalid Gemini model', async () => {
        const res = await request(app)
          .put('/api/settings/ai')
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ geminiModel: 'invalid-model' })
          .expect(400);

        expect(res.body.error).toBe('Invalid Gemini model selected');
      });
    });

    describe('Success', () => {
      it('updates AI provider', async () => {
        const res = await request(app)
          .put('/api/settings/ai')
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ aiProvider: 'gemini' })
          .expect(200);

        expect(res.body.message).toBe('AI settings updated successfully');
      });

      it('accepts valid OpenAI models', async () => {
        const validModels = ['gpt-4o-mini', 'gpt-4o', 'gpt-4-turbo', 'gpt-3.5-turbo'];

        for (const model of validModels) {
          const res = await request(app)
            .put('/api/settings/ai')
            .set('Authorization', `Bearer ${adminToken}`)
            .send({ openaiModel: model })
            .expect(200);

          expect(res.body.message).toBe('AI settings updated successfully');
        }
      });

      it('accepts valid Gemini models', async () => {
        const validModels = ['gemini-1.5-flash', 'gemini-1.5-pro', 'gemini-1.0-pro'];

        for (const model of validModels) {
          const res = await request(app)
            .put('/api/settings/ai')
            .set('Authorization', `Bearer ${adminToken}`)
            .send({ geminiModel: model })
            .expect(200);

          expect(res.body.message).toBe('AI settings updated successfully');
        }
      });
    });
  });

  describe('Security', () => {
    it('non-admin cannot access any settings endpoint', async () => {
      const endpoints = [
        { method: 'get', path: '/api/settings/all' },
        { method: 'put', path: '/api/settings/all' },
        { method: 'get', path: '/api/settings/library' },
        { method: 'put', path: '/api/settings/library' },
        { method: 'get', path: '/api/settings/server' },
        { method: 'put', path: '/api/settings/server' },
        { method: 'get', path: '/api/settings/ai' },
        { method: 'put', path: '/api/settings/ai' }
      ];

      for (const endpoint of endpoints) {
        const res = await request(app)
          [endpoint.method](endpoint.path)
          .set('Authorization', `Bearer ${userToken}`)
          .send({})
          .expect(403);

        expect(res.body.error).toBe('Admin access required');
      }
    });
  });
});
