const express = require('express');
const supertest = require('supertest');
const jwt = require('jsonwebtoken');

// Set JWT_SECRET before requiring the route module
process.env.JWT_SECRET = 'test-secret-that-is-at-least-32-characters-long';

/**
 * Helper: create a mock database that responds to sqlite3 callback-style queries.
 * Each call to mockDb.get(sql, params, cb) calls the handler registered for that query.
 */
function createMockDb(handlers = {}) {
  return {
    get: jest.fn((sql, params, cb) => {
      if (typeof params === 'function') { cb = params; params = []; }
      const handler = handlers.get;
      if (handler) {
        const result = handler(sql, params);
        if (result instanceof Error) return cb(result);
        return cb(null, result);
      }
      cb(null, null);
    }),
    run: jest.fn(function(sql, params, cb) {
      if (typeof params === 'function') { cb = params; params = []; }
      const handler = handlers.run;
      if (handler) {
        const result = handler(sql, params);
        if (result instanceof Error) return cb.call({}, result);
        return cb.call({ lastID: result?.lastID || 1, changes: result?.changes || 1 }, null);
      }
      cb.call({ lastID: 1, changes: 1 }, null);
    }),
    all: jest.fn((sql, params, cb) => {
      if (typeof params === 'function') { cb = params; params = []; }
      cb(null, []);
    }),
  };
}

/**
 * Helper: create a mock OidcService
 */
function createMockOidcService(overrides = {}) {
  return {
    discover: jest.fn().mockResolvedValue({
      authorization_endpoint: 'https://auth.example.com/authorize',
      token_endpoint: 'https://auth.example.com/token',
      issuer: 'https://auth.example.com',
    }),
    buildAuthorizationUrl: jest.fn().mockReturnValue('https://auth.example.com/authorize?client_id=test'),
    exchangeCode: jest.fn().mockResolvedValue({
      id_token: 'header.payload.signature',
      access_token: 'access-token',
    }),
    decodeIdToken: jest.fn().mockReturnValue({
      sub: '123',
      preferred_username: 'alice',
      email: 'alice@test.com',
      name: 'Alice Smith',
      iss: 'https://auth.example.com',
      aud: 'test-client',
      exp: Math.floor(Date.now() / 1000) + 3600,
      nonce: 'test-nonce',
    }),
    validateIdTokenClaims: jest.fn(),
    verifyIdToken: jest.fn().mockResolvedValue({
      sub: '123',
      preferred_username: 'alice',
      email: 'alice@test.com',
      name: 'Alice Smith',
      iss: 'https://auth.example.com',
      aud: 'test-client',
      exp: Math.floor(Date.now() / 1000) + 3600,
      nonce: 'test-nonce',
    }),
    extractUserInfo: jest.fn().mockReturnValue({
      sub: '123',
      username: 'alice',
      email: 'alice@test.com',
      name: 'Alice Smith',
      groups: [],
    }),
    generateState: jest.fn().mockReturnValue('mock-state'),
    generateNonce: jest.fn().mockReturnValue('mock-nonce'),
    storeState: jest.fn(),
    consumeState: jest.fn().mockReturnValue({
      nonce: 'mock-nonce',
      redirectUri: 'http://localhost:3002/api/auth/oidc/callback',
      clientId: 'test-client',
      clientSecret: 'test-secret',
      issuerUrl: 'https://auth.example.com',
      autoProvision: 1,
      defaultAdmin: 0,
    }),
    ...overrides,
  };
}

/**
 * Helper: build a test Express app with the OIDC router mounted at /
 */
function buildApp(dbHandlers = {}, oidcOverrides = {}) {
  const { createOidcAuthRouter } = require('../../server/routes/oidcAuth');
  const app = express();
  const mockDb = createMockDb(dbHandlers);
  const mockOidcService = createMockOidcService(oidcOverrides);
  app.use('/', createOidcAuthRouter({ db: mockDb, oidcService: mockOidcService }));
  return { app, mockDb, mockOidcService };
}

describe('OIDC Auth Routes', () => {

  describe('GET /config', () => {
    test('returns enabled:false when no config exists', async () => {
      const { app } = buildApp({
        get: () => null,
      });

      const res = await supertest(app).get('/config');
      expect(res.status).toBe(200);
      expect(res.body.enabled).toBe(false);
    });

    test('returns enabled:false when config exists but disabled', async () => {
      const { app } = buildApp({
        get: () => ({ enabled: 0, provider_name: 'Authentik' }),
      });

      const res = await supertest(app).get('/config');
      expect(res.status).toBe(200);
      expect(res.body.enabled).toBe(false);
    });

    test('returns enabled:true with provider name when configured', async () => {
      const { app } = buildApp({
        get: () => ({ enabled: 1, provider_name: 'Authentik' }),
      });

      const res = await supertest(app).get('/config');
      expect(res.status).toBe(200);
      expect(res.body.enabled).toBe(true);
      expect(res.body.provider_name).toBe('Authentik');
    });

    test('returns enabled:false on database error', async () => {
      const { app } = buildApp({
        get: () => { throw new Error('DB error'); },
      });

      const res = await supertest(app).get('/config');
      expect(res.status).toBe(200);
      expect(res.body.enabled).toBe(false);
    });
  });

  describe('GET /authorize', () => {
    test('returns 400 when OIDC is not configured', async () => {
      const { app } = buildApp({
        get: () => null,
      });

      const res = await supertest(app).get('/authorize');
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('not configured');
    });

    test('returns 502 when discovery fails', async () => {
      const { encryptSecret } = require('../../server/utils/oidcCrypto');
      const encryptedSecret = encryptSecret('my-client-secret', process.env.JWT_SECRET);

      const { app } = buildApp({
        get: () => ({
          id: 1,
          enabled: 1,
          provider_name: 'Authentik',
          issuer_url: 'https://auth.example.com',
          client_id: 'test-client',
          client_secret: encryptedSecret,
          auto_provision: 1,
          default_admin: 0,
        }),
      }, {
        discover: jest.fn().mockRejectedValue(new Error('Connection refused')),
      });

      const res = await supertest(app).get('/authorize');
      expect(res.status).toBe(502);
      expect(res.body.error).toContain('identity provider');
    });

    test('redirects to provider authorization URL on success', async () => {
      const { encryptSecret } = require('../../server/utils/oidcCrypto');
      const encryptedSecret = encryptSecret('my-client-secret', process.env.JWT_SECRET);

      const { app, mockOidcService } = buildApp({
        get: () => ({
          id: 1,
          enabled: 1,
          provider_name: 'Authentik',
          issuer_url: 'https://auth.example.com',
          client_id: 'test-client',
          client_secret: encryptedSecret,
          auto_provision: 1,
          default_admin: 0,
        }),
      });

      const res = await supertest(app).get('/authorize');
      expect(res.status).toBe(302);
      expect(res.headers.location).toContain('auth.example.com');
      expect(mockOidcService.storeState).toHaveBeenCalled();
      expect(mockOidcService.generateState).toHaveBeenCalled();
      expect(mockOidcService.generateNonce).toHaveBeenCalled();
    });

    test('returns 500 when client secret decryption fails', async () => {
      const { app } = buildApp({
        get: () => ({
          id: 1,
          enabled: 1,
          provider_name: 'Authentik',
          issuer_url: 'https://auth.example.com',
          client_id: 'test-client',
          client_secret: 'not-valid-encrypted-data',
          auto_provision: 1,
          default_admin: 0,
        }),
      });

      const res = await supertest(app).get('/authorize');
      expect(res.status).toBe(500);
      expect(res.body.error).toContain('configuration error');
    });
  });

  describe('GET /callback', () => {
    test('redirects with error when provider returns error', async () => {
      const { app } = buildApp();

      const res = await supertest(app).get('/callback?error=access_denied&error_description=User+denied');
      expect(res.status).toBe(302);
      expect(res.headers.location).toContain('error=oidc_provider_error');
    });

    test('redirects with error when code or state is missing', async () => {
      const { app } = buildApp();

      const res = await supertest(app).get('/callback?code=abc');
      expect(res.status).toBe(302);
      expect(res.headers.location).toContain('error=oidc_invalid_callback');
    });

    test('redirects with error when state is invalid', async () => {
      const { app } = buildApp({}, {
        consumeState: jest.fn().mockReturnValue(null),
      });

      const res = await supertest(app).get('/callback?code=abc&state=invalid');
      expect(res.status).toBe(302);
      expect(res.headers.location).toContain('error=oidc_invalid_state');
    });

    test('redirects with error when token exchange fails', async () => {
      const { app } = buildApp({}, {
        exchangeCode: jest.fn().mockRejectedValue(new Error('Token exchange failed')),
      });

      const res = await supertest(app).get('/callback?code=abc&state=valid');
      expect(res.status).toBe(302);
      expect(res.headers.location).toContain('error=oidc_token_exchange_failed');
    });

    test('redirects with error when id_token is missing from response', async () => {
      const { app } = buildApp({}, {
        exchangeCode: jest.fn().mockResolvedValue({ access_token: 'at' }),
      });

      const res = await supertest(app).get('/callback?code=abc&state=valid');
      expect(res.status).toBe(302);
      expect(res.headers.location).toContain('error=oidc_no_id_token');
    });

    test('redirects with error when ID token verification fails', async () => {
      const { app } = buildApp({}, {
        verifyIdToken: jest.fn().mockRejectedValue(new Error('Invalid issuer')),
      });

      const res = await supertest(app).get('/callback?code=abc&state=valid');
      expect(res.status).toBe(302);
      expect(res.headers.location).toContain('error=oidc_invalid_token');
    });

    test('redirects with error when user account is disabled', async () => {
      const { app } = buildApp({
        get: () => ({ id: 1, username: 'alice', account_disabled: 1 }),
      });

      const res = await supertest(app).get('/callback?code=abc&state=valid');
      expect(res.status).toBe(302);
      expect(res.headers.location).toContain('error=oidc_account_disabled');
    });

    test('redirects with error when user not found and auto-provision disabled', async () => {
      const { app } = buildApp({
        get: () => null,
      }, {
        consumeState: jest.fn().mockReturnValue({
          nonce: 'mock-nonce',
          redirectUri: 'http://localhost:3002/api/auth/oidc/callback',
          clientId: 'test-client',
          clientSecret: 'test-secret',
          issuerUrl: 'https://auth.example.com',
          autoProvision: 0,
          defaultAdmin: 0,
        }),
      });

      const res = await supertest(app).get('/callback?code=abc&state=valid');
      expect(res.status).toBe(302);
      expect(res.headers.location).toContain('error=oidc_user_not_found');
    });

    test('issues JWT and redirects with token for existing user', async () => {
      const existingUser = {
        id: 42,
        username: 'alice',
        email: 'alice@old.com',
        display_name: 'Old Name',
        account_disabled: 0,
      };

      const { app } = buildApp({
        get: () => existingUser,
      });

      const res = await supertest(app).get('/callback?code=abc&state=valid');
      expect(res.status).toBe(302);
      expect(res.headers.location).toContain('token=');
      expect(res.headers.location).not.toContain('error=');

      // Verify the JWT is valid
      const url = new URL(res.headers.location, 'http://localhost');
      const token = url.searchParams.get('token');
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      expect(decoded.id).toBe(42);
      expect(decoded.username).toBe('alice');
    });

    test('auto-provisions new user and issues JWT', async () => {
      let insertCalled = false;

      const { app } = buildApp({
        get: (sql, params) => {
          // First call: find user by username - not found
          if (sql.includes('WHERE username')) return null;
          // Second call: find user by id after insert
          if (sql.includes('WHERE id')) {
            return { id: 99, username: 'alice', email: 'alice@test.com' };
          }
          return null;
        },
        run: (sql, params) => {
          if (sql.includes('INSERT INTO users')) {
            insertCalled = true;
            return { lastID: 99, changes: 1 };
          }
          return { lastID: 0, changes: 0 };
        },
      });

      const res = await supertest(app).get('/callback?code=abc&state=valid');
      expect(res.status).toBe(302);
      expect(res.headers.location).toContain('token=');
      expect(insertCalled).toBe(true);
    });

    test('updates user email and display_name from provider on login', async () => {
      let updateSql = null;
      let updateParams = null;

      const existingUser = {
        id: 42,
        username: 'alice',
        email: 'alice@old.com',
        display_name: 'Old Name',
        account_disabled: 0,
      };

      const { app } = buildApp({
        get: () => existingUser,
        run: (sql, params) => {
          updateSql = sql;
          updateParams = params;
          return { lastID: 0, changes: 1 };
        },
      });

      const res = await supertest(app).get('/callback?code=abc&state=valid');
      expect(res.status).toBe(302);
      expect(updateSql).toContain('UPDATE users SET');
      expect(updateSql).toContain('email');
      expect(updateSql).toContain('display_name');
      expect(updateParams).toContain('alice@test.com');
      expect(updateParams).toContain('Alice Smith');
    });

    test('redirects with error when discovery fails in callback', async () => {
      const { app } = buildApp({}, {
        discover: jest.fn().mockRejectedValue(new Error('Discovery failed')),
      });

      const res = await supertest(app).get('/callback?code=abc&state=valid');
      expect(res.status).toBe(302);
      expect(res.headers.location).toContain('error=oidc_discovery_failed');
    });
  });
});
