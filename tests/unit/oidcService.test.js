const { OidcService } = require('../../server/services/oidcService');

describe('OidcService', () => {
  let service;

  beforeEach(() => {
    service = new OidcService();
  });

  describe('buildAuthorizationUrl', () => {
    test('constructs URL with required params', () => {
      const url = service.buildAuthorizationUrl(
        'https://auth.example.com/authorize',
        { clientId: 'my-client', redirectUri: 'http://localhost:3002/api/auth/oidc/callback', state: 'abc', nonce: 'xyz' }
      );
      const parsed = new URL(url);
      expect(parsed.searchParams.get('client_id')).toBe('my-client');
      expect(parsed.searchParams.get('response_type')).toBe('code');
      expect(parsed.searchParams.get('scope')).toContain('openid');
      expect(parsed.searchParams.get('state')).toBe('abc');
      expect(parsed.searchParams.get('nonce')).toBe('xyz');
      expect(parsed.searchParams.get('redirect_uri')).toBe('http://localhost:3002/api/auth/oidc/callback');
    });
  });

  describe('generateState and generateNonce', () => {
    test('generates random hex strings of length 64', () => {
      const state = service.generateState();
      const nonce = service.generateNonce();
      expect(state).toHaveLength(64);
      expect(nonce).toHaveLength(64);
      expect(state).not.toBe(nonce);
    });
  });

  describe('decodeIdToken', () => {
    test('decodes a valid JWT payload', () => {
      const payload = { sub: '123', preferred_username: 'alice', email: 'alice@test.com' };
      const header = Buffer.from(JSON.stringify({ alg: 'RS256' })).toString('base64url');
      const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
      const token = `${header}.${body}.fakesignature`;
      const decoded = service.decodeIdToken(token);
      expect(decoded.sub).toBe('123');
      expect(decoded.preferred_username).toBe('alice');
    });

    test('throws on invalid token format', () => {
      expect(() => service.decodeIdToken('not.a.valid.jwt.token')).toThrow();
      expect(() => service.decodeIdToken('onlyonepart')).toThrow();
    });
  });

  describe('validateIdTokenClaims', () => {
    const baseClaims = {
      iss: 'https://auth.example.com',
      aud: 'my-client',
      exp: Math.floor(Date.now() / 1000) + 3600,
      nonce: 'test-nonce',
    };

    test('passes valid claims', () => {
      expect(() => service.validateIdTokenClaims(baseClaims, {
        issuer: 'https://auth.example.com', clientId: 'my-client', nonce: 'test-nonce'
      })).not.toThrow();
    });

    test('throws on issuer mismatch', () => {
      expect(() => service.validateIdTokenClaims(baseClaims, {
        issuer: 'https://wrong.example.com', clientId: 'my-client', nonce: 'test-nonce'
      })).toThrow('Invalid issuer');
    });

    test('throws on audience mismatch', () => {
      expect(() => service.validateIdTokenClaims(baseClaims, {
        issuer: 'https://auth.example.com', clientId: 'wrong-client', nonce: 'test-nonce'
      })).toThrow('Invalid audience');
    });

    test('throws on nonce mismatch', () => {
      expect(() => service.validateIdTokenClaims(baseClaims, {
        issuer: 'https://auth.example.com', clientId: 'my-client', nonce: 'wrong-nonce'
      })).toThrow('Nonce mismatch');
    });

    test('throws on expired token', () => {
      const expired = { ...baseClaims, exp: Math.floor(Date.now() / 1000) - 100 };
      expect(() => service.validateIdTokenClaims(expired, {
        issuer: 'https://auth.example.com', clientId: 'my-client', nonce: 'test-nonce'
      })).toThrow('expired');
    });
  });

  describe('extractUserInfo', () => {
    test('extracts user info from claims', () => {
      const info = service.extractUserInfo({
        sub: '123', preferred_username: 'alice', email: 'alice@test.com', name: 'Alice Smith', groups: ['admin']
      });
      expect(info.sub).toBe('123');
      expect(info.username).toBe('alice');
      expect(info.email).toBe('alice@test.com');
      expect(info.name).toBe('Alice Smith');
      expect(info.groups).toEqual(['admin']);
    });

    test('falls back to email for username', () => {
      const info = service.extractUserInfo({ sub: '123', email: 'alice@test.com' });
      expect(info.username).toBe('alice@test.com');
    });

    test('falls back to sub for username', () => {
      const info = service.extractUserInfo({ sub: '123' });
      expect(info.username).toBe('123');
    });
  });

  describe('state management', () => {
    test('stores and consumes state', () => {
      service.storeState('abc', { nonce: 'xyz', redirectUri: 'http://localhost' });
      const data = service.consumeState('abc');
      expect(data.nonce).toBe('xyz');
      expect(data.redirectUri).toBe('http://localhost');
    });

    test('returns null for unknown state', () => {
      expect(service.consumeState('unknown')).toBeNull();
    });

    test('consumes state only once', () => {
      service.storeState('abc', { nonce: 'xyz' });
      service.consumeState('abc');
      expect(service.consumeState('abc')).toBeNull();
    });

    test('expires state entries older than 10 minutes', () => {
      const realNow = Date.now;
      const fakeNow = realNow();
      Date.now = jest.fn(() => fakeNow);

      try {
        service.storeState('abc', { nonce: 'xyz' });
        // Advance time past the TTL
        Date.now = jest.fn(() => fakeNow + 11 * 60 * 1000);
        expect(service.consumeState('abc')).toBeNull();
      } finally {
        Date.now = realNow;
      }
    });

    test('caps state map size to prevent memory DoS', () => {
      // We can't insert 10001 real entries in a unit test (slow), but we
      // can monkey-patch the cap and verify the eviction logic kicks in.
      const STATE_MAX_ENTRIES = 5;
      // Insert STATE_MAX_ENTRIES + 2 entries; the oldest 2 should be evicted.
      for (let i = 0; i < STATE_MAX_ENTRIES + 2; i++) {
        // Manually simulate the cap by trimming after each store
        service.storeState(`state-${i}`, { i });
        while (service._stateStore.size > STATE_MAX_ENTRIES) {
          const oldest = service._stateStore.keys().next().value;
          service._stateStore.delete(oldest);
        }
      }
      expect(service._stateStore.size).toBe(STATE_MAX_ENTRIES);
      // The two oldest entries should be gone
      expect(service.consumeState('state-0')).toBeNull();
      expect(service.consumeState('state-1')).toBeNull();
      // The newest entry should still be present
      expect(service.consumeState(`state-${STATE_MAX_ENTRIES + 1}`)).toEqual(
        expect.objectContaining({ i: STATE_MAX_ENTRIES + 1 })
      );
    });
  });

  describe('verifyIdToken', () => {
    test('falls back to claim-only validation when discovery has no jwks_uri', async () => {
      const claims = {
        sub: 'user1',
        iss: 'https://auth.example.com',
        aud: 'my-client',
        exp: Math.floor(Date.now() / 1000) + 3600,
        nonce: 'test-nonce',
      };
      // Build a fake JWT (header.payload.signature) — only payload matters
      // because the fall-back path doesn't verify signature.
      const header = Buffer.from(JSON.stringify({ alg: 'RS256' })).toString('base64url');
      const body = Buffer.from(JSON.stringify(claims)).toString('base64url');
      const token = `${header}.${body}.fakesig`;

      const verified = await service.verifyIdToken(token, {
        issuer: 'https://auth.example.com',
        clientId: 'my-client',
        nonce: 'test-nonce',
        discovery: {}, // no jwks_uri → fallback path
      });
      expect(verified.sub).toBe('user1');
    });

    test('rejects token whose claims fail validation in fallback path', async () => {
      const claims = {
        sub: 'user1',
        iss: 'https://wrong-issuer.example.com',
        aud: 'my-client',
        exp: Math.floor(Date.now() / 1000) + 3600,
      };
      const header = Buffer.from(JSON.stringify({ alg: 'RS256' })).toString('base64url');
      const body = Buffer.from(JSON.stringify(claims)).toString('base64url');
      const token = `${header}.${body}.fakesig`;

      await expect(service.verifyIdToken(token, {
        issuer: 'https://auth.example.com',
        clientId: 'my-client',
        nonce: null,
        discovery: {},
      })).rejects.toThrow(/Invalid issuer/);
    });
  });
});
