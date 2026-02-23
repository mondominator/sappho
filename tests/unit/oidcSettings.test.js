const express = require('express');
const supertest = require('supertest');

// Mock JWT_SECRET before any imports that might use it
process.env.JWT_SECRET = 'a'.repeat(32);

describe('OIDC Settings Routes', () => {
  /**
   * Helper: create an Express app with the OIDC settings router,
   * injecting mock db and auth middleware.
   */
  function setupApp(dbOverrides = {}) {
    const { createOidcSettingsRouter } = require('../../server/routes/oidcSettings');
    const app = express();
    app.use(express.json());

    const mockDb = {
      get: jest.fn((sql, params, cb) => cb(null, null)),
      run: jest.fn(function (sql, params, cb) {
        cb.call({ lastID: 1, changes: 1 }, null);
      }),
      ...dbOverrides,
    };

    const mockAuth = (req, res, next) => {
      req.user = { id: 1, is_admin: 1 };
      next();
    };
    const mockAdmin = (req, res, next) => next();

    app.use(
      '/',
      createOidcSettingsRouter({
        db: mockDb,
        authenticateToken: mockAuth,
        requireAdmin: mockAdmin,
      })
    );

    return { app, mockDb };
  }

  const validConfig = {
    provider_name: 'Authentik',
    issuer_url: 'https://auth.example.com',
    client_id: 'my-client',
    client_secret: 'my-secret',
  };

  // --- GET / ---

  test('GET returns configured:false when no config exists', async () => {
    const { app } = setupApp();
    const res = await supertest(app).get('/');
    expect(res.status).toBe(200);
    expect(res.body.configured).toBe(false);
  });

  test('GET returns masked config when config exists', async () => {
    const row = {
      id: 1,
      provider_name: 'Authentik',
      issuer_url: 'https://auth.example.com',
      client_id: 'my-client',
      client_secret: 'encrypted-value',
      auto_provision: 1,
      default_admin: 0,
      enabled: 1,
      created_at: '2025-01-01T00:00:00Z',
    };
    const { app } = setupApp({
      get: jest.fn((sql, params, cb) => cb(null, row)),
    });

    const res = await supertest(app).get('/');
    expect(res.status).toBe(200);
    expect(res.body.configured).toBe(true);
    expect(res.body.config.client_secret_set).toBe(true);
    expect(res.body.config.client_secret).toBeUndefined();
    expect(res.body.config.provider_name).toBe('Authentik');
    expect(res.body.config.client_id).toBe('my-client');
  });

  test('GET returns 500 on database error', async () => {
    const { app } = setupApp({
      get: jest.fn((sql, params, cb) => cb(new Error('DB error'))),
    });

    const res = await supertest(app).get('/');
    expect(res.status).toBe(500);
    expect(res.body.error).toContain('Failed to read');
  });

  // --- POST / ---

  test('POST saves new OIDC config', async () => {
    const { app, mockDb } = setupApp();
    const res = await supertest(app).post('/').send(validConfig);
    expect(res.status).toBe(200);
    expect(res.body.message).toContain('saved');
    // Verify db.run was called for DELETE and INSERT
    expect(mockDb.run).toHaveBeenCalledTimes(2);
  });

  test('POST validates required fields', async () => {
    const { app } = setupApp();
    const res = await supertest(app).post('/').send({ provider_name: 'Authentik' });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Missing required fields');
    expect(res.body.error).toContain('issuer_url');
    expect(res.body.error).toContain('client_id');
    expect(res.body.error).toContain('client_secret');
  });

  test('POST rejects empty body', async () => {
    const { app } = setupApp();
    const res = await supertest(app).post('/').send({});
    expect(res.status).toBe(400);
  });

  test('POST validates issuer_url format', async () => {
    const { app } = setupApp();
    const res = await supertest(app).post('/').send({
      ...validConfig,
      issuer_url: 'not-a-url',
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Invalid issuer_url');
  });

  test('POST returns 500 on delete failure', async () => {
    const { app } = setupApp({
      run: jest.fn(function (sql, params, cb) {
        cb.call({ lastID: 0, changes: 0 }, new Error('DB error'));
      }),
    });

    const res = await supertest(app).post('/').send(validConfig);
    expect(res.status).toBe(500);
  });

  test('POST returns 500 on insert failure', async () => {
    let callCount = 0;
    const { app } = setupApp({
      run: jest.fn(function (sql, params, cb) {
        callCount++;
        if (callCount === 1) {
          // DELETE succeeds
          cb.call({ lastID: 0, changes: 0 }, null);
        } else {
          // INSERT fails
          cb.call({ lastID: 0, changes: 0 }, new Error('Insert failed'));
        }
      }),
    });

    const res = await supertest(app).post('/').send(validConfig);
    expect(res.status).toBe(500);
  });

  test('POST saves optional fields with defaults', async () => {
    const { app, mockDb } = setupApp();
    const res = await supertest(app).post('/').send(validConfig);
    expect(res.status).toBe(200);

    // Second run call is the INSERT
    const insertCall = mockDb.run.mock.calls[1];
    const params = insertCall[1];
    // auto_provision defaults to 1
    expect(params[4]).toBe(1);
    // default_admin defaults to 0
    expect(params[5]).toBe(0);
    // enabled defaults to 1
    expect(params[6]).toBe(1);
  });

  test('POST respects explicit optional field values', async () => {
    const { app, mockDb } = setupApp();
    const res = await supertest(app).post('/').send({
      ...validConfig,
      auto_provision: false,
      default_admin: true,
      enabled: false,
    });
    expect(res.status).toBe(200);

    const insertCall = mockDb.run.mock.calls[1];
    const params = insertCall[1];
    expect(params[4]).toBe(0); // auto_provision
    expect(params[5]).toBe(1); // default_admin
    expect(params[6]).toBe(0); // enabled
  });

  test('POST normalizes trailing slashes on issuer_url', async () => {
    const { app, mockDb } = setupApp();
    const res = await supertest(app).post('/').send({
      ...validConfig,
      issuer_url: 'https://auth.example.com///',
    });
    expect(res.status).toBe(200);

    const insertCall = mockDb.run.mock.calls[1];
    const params = insertCall[1];
    expect(params[1]).toBe('https://auth.example.com');
  });

  test('POST encrypts client_secret before storing', async () => {
    const { app, mockDb } = setupApp();
    await supertest(app).post('/').send(validConfig);

    const insertCall = mockDb.run.mock.calls[1];
    const storedSecret = insertCall[1][3];
    // Encrypted value should not equal the plaintext
    expect(storedSecret).not.toBe('my-secret');
    // Should be base64-encoded
    expect(() => Buffer.from(storedSecret, 'base64')).not.toThrow();
  });

  // --- POST /test ---

  test('POST /test returns 400 when issuer_url is missing', async () => {
    const { app } = setupApp();
    const res = await supertest(app).post('/test').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('issuer_url is required');
  });

  test('POST /test returns 400 for invalid URL', async () => {
    const { app } = setupApp();
    const res = await supertest(app).post('/test').send({ issuer_url: 'bad-url' });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Invalid issuer_url');
  });

  // --- DELETE / ---

  test('DELETE removes OIDC config', async () => {
    const { app } = setupApp();
    const res = await supertest(app).delete('/');
    expect(res.status).toBe(200);
    expect(res.body.message).toContain('removed');
    expect(res.body.removed).toBe(true);
  });

  test('DELETE returns removed:false when no config existed', async () => {
    const { app } = setupApp({
      run: jest.fn(function (sql, params, cb) {
        cb.call({ lastID: 0, changes: 0 }, null);
      }),
    });

    const res = await supertest(app).delete('/');
    expect(res.status).toBe(200);
    expect(res.body.removed).toBe(false);
  });

  test('DELETE returns 500 on database error', async () => {
    const { app } = setupApp({
      run: jest.fn(function (sql, params, cb) {
        cb.call({ lastID: 0, changes: 0 }, new Error('DB error'));
      }),
    });

    const res = await supertest(app).delete('/');
    expect(res.status).toBe(500);
    expect(res.body.error).toContain('Failed to remove');
  });
});
