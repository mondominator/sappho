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
  });
});
