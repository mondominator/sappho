const originalEnv = { ...process.env };

beforeEach(() => {
  process.env = { ...originalEnv };
  process.env.ENCRYPTION_KEY = 'a-valid-encryption-key-that-is-at-least-32-characters-long';
  jest.resetModules();
  jest.restoreAllMocks();
});

afterEach(() => {
  process.env = originalEnv;
});

describe('hardcoverEncryption', () => {
  describe('HARDCOVER_GRAPHQL_URL', () => {
    it('exports the canonical Hardcover GraphQL endpoint', () => {
      const { HARDCOVER_GRAPHQL_URL } = require('../../server/utils/hardcoverEncryption');
      expect(HARDCOVER_GRAPHQL_URL).toBe('https://hardcover.app/api/graphql');
    });
  });

  describe('encryptHardcoverKey / decryptHardcoverKey', () => {
    it('encrypts and decrypts a key round-trip', () => {
      const { encryptHardcoverKey, decryptHardcoverKey } = require('../../server/utils/hardcoverEncryption');
      const plaintext = 'a'.repeat(40);
      const { encrypted, salt, iv, authTag } = encryptHardcoverKey(plaintext);
      const decrypted = decryptHardcoverKey(encrypted, salt, iv, authTag);
      expect(decrypted).toBe(plaintext);
    });

    it('produces distinct ciphertexts for the same plaintext (random salt/iv)', () => {
      const { encryptHardcoverKey } = require('../../server/utils/hardcoverEncryption');
      const plaintext = 'b'.repeat(40);
      const a = encryptHardcoverKey(plaintext);
      const b = encryptHardcoverKey(plaintext);
      expect(a.salt).not.toBe(b.salt);
      expect(a.iv).not.toBe(b.iv);
      expect(a.encrypted).not.toBe(b.encrypted);
    });

    it('returns null when authTag is wrong', () => {
      jest.doMock('../../server/utils/logger', () => ({ error: jest.fn() }));
      const { encryptHardcoverKey, decryptHardcoverKey } = require('../../server/utils/hardcoverEncryption');
      const { encrypted, salt, iv } = encryptHardcoverKey('c'.repeat(40));
      const badAuthTag = '00'.repeat(16);
      expect(decryptHardcoverKey(encrypted, salt, iv, badAuthTag)).toBeNull();
    });

    it('returns null when ciphertext is corrupted', () => {
      jest.doMock('../../server/utils/logger', () => ({ error: jest.fn() }));
      const { decryptHardcoverKey } = require('../../server/utils/hardcoverEncryption');
      expect(decryptHardcoverKey('not-hex-garbage', '00'.repeat(32), '00'.repeat(16), '00'.repeat(16))).toBeNull();
    });

    it('throws when ENCRYPTION_KEY is unset and encrypt is called', () => {
      delete process.env.ENCRYPTION_KEY;
      const { encryptHardcoverKey } = require('../../server/utils/hardcoverEncryption');
      expect(() => encryptHardcoverKey('x'.repeat(40))).toThrow('ENCRYPTION_KEY is required');
    });

    it('memoizes the master key across calls (lazy-init only runs once)', () => {
      const { encryptHardcoverKey, decryptHardcoverKey } = require('../../server/utils/hardcoverEncryption');
      const first = encryptHardcoverKey('d'.repeat(40));
      // Mutating env after first call should not change derived key
      process.env.ENCRYPTION_KEY = 'a-different-key-that-is-also-32-characters-long-aaaa';
      const decrypted = decryptHardcoverKey(first.encrypted, first.salt, first.iv, first.authTag);
      expect(decrypted).toBe('d'.repeat(40));
    });
  });

  describe('resolveUserHardcoverKey', () => {
    function makeDb(impl) {
      return { get: jest.fn(impl) };
    }

    it('returns null when userId is missing and no server-wide key', async () => {
      delete process.env.HARDCOVER_API_KEY;
      const { resolveUserHardcoverKey } = require('../../server/utils/hardcoverEncryption');
      const db = makeDb(() => {});
      await expect(resolveUserHardcoverKey(null, db)).resolves.toBeNull();
      expect(db.get).not.toHaveBeenCalled();
    });

    it('returns server-wide key when userId is missing', async () => {
      process.env.HARDCOVER_API_KEY = 'server-wide-key';
      const { resolveUserHardcoverKey } = require('../../server/utils/hardcoverEncryption');
      const db = makeDb(() => {});
      await expect(resolveUserHardcoverKey(0, db)).resolves.toBe('server-wide-key');
    });

    it('falls back to server-wide key when DB errors', async () => {
      jest.doMock('../../server/utils/logger', () => ({ error: jest.fn() }));
      process.env.HARDCOVER_API_KEY = 'fallback-key';
      const { resolveUserHardcoverKey } = require('../../server/utils/hardcoverEncryption');
      const db = makeDb((_sql, _params, cb) => cb(new Error('db boom'), null));
      await expect(resolveUserHardcoverKey(7, db)).resolves.toBe('fallback-key');
    });

    it('returns null when DB errors and no fallback configured', async () => {
      jest.doMock('../../server/utils/logger', () => ({ error: jest.fn() }));
      delete process.env.HARDCOVER_API_KEY;
      const { resolveUserHardcoverKey } = require('../../server/utils/hardcoverEncryption');
      const db = makeDb((_sql, _params, cb) => cb(new Error('db boom'), null));
      await expect(resolveUserHardcoverKey(7, db)).resolves.toBeNull();
    });

    it('falls back when user row is missing', async () => {
      process.env.HARDCOVER_API_KEY = 'fallback-key';
      const { resolveUserHardcoverKey } = require('../../server/utils/hardcoverEncryption');
      const db = makeDb((_sql, _params, cb) => cb(null, null));
      await expect(resolveUserHardcoverKey(7, db)).resolves.toBe('fallback-key');
    });

    it('falls back when user has no stored key', async () => {
      process.env.HARDCOVER_API_KEY = 'fallback-key';
      const { resolveUserHardcoverKey } = require('../../server/utils/hardcoverEncryption');
      const db = makeDb((_sql, _params, cb) => cb(null, { hardcover_api_key: null }));
      await expect(resolveUserHardcoverKey(7, db)).resolves.toBe('fallback-key');
    });

    it('returns the decrypted per-user key when present', async () => {
      const { encryptHardcoverKey, resolveUserHardcoverKey } = require('../../server/utils/hardcoverEncryption');
      const plaintext = 'e'.repeat(40);
      const blob = JSON.stringify(encryptHardcoverKey(plaintext));
      const db = makeDb((_sql, _params, cb) => cb(null, { hardcover_api_key: blob }));
      await expect(resolveUserHardcoverKey(7, db)).resolves.toBe(plaintext);
    });

    it('falls back to env key when decrypt fails', async () => {
      jest.doMock('../../server/utils/logger', () => ({ error: jest.fn() }));
      process.env.HARDCOVER_API_KEY = 'fallback-key';
      const { encryptHardcoverKey, resolveUserHardcoverKey } = require('../../server/utils/hardcoverEncryption');
      const good = encryptHardcoverKey('f'.repeat(40));
      const blob = JSON.stringify({ ...good, authTag: '00'.repeat(16) });
      const db = makeDb((_sql, _params, cb) => cb(null, { hardcover_api_key: blob }));
      await expect(resolveUserHardcoverKey(7, db)).resolves.toBe('fallback-key');
    });

    it('returns null when decrypt fails and no fallback configured', async () => {
      jest.doMock('../../server/utils/logger', () => ({ error: jest.fn() }));
      delete process.env.HARDCOVER_API_KEY;
      const { encryptHardcoverKey, resolveUserHardcoverKey } = require('../../server/utils/hardcoverEncryption');
      const good = encryptHardcoverKey('g'.repeat(40));
      const blob = JSON.stringify({ ...good, authTag: '00'.repeat(16) });
      const db = makeDb((_sql, _params, cb) => cb(null, { hardcover_api_key: blob }));
      await expect(resolveUserHardcoverKey(7, db)).resolves.toBeNull();
    });

    it('falls back when stored blob is malformed JSON', async () => {
      jest.doMock('../../server/utils/logger', () => ({ error: jest.fn() }));
      process.env.HARDCOVER_API_KEY = 'fallback-key';
      const { resolveUserHardcoverKey } = require('../../server/utils/hardcoverEncryption');
      const db = makeDb((_sql, _params, cb) => cb(null, { hardcover_api_key: '{not-json' }));
      await expect(resolveUserHardcoverKey(7, db)).resolves.toBe('fallback-key');
    });

    it('returns null when user has no stored key and no fallback configured', async () => {
      delete process.env.HARDCOVER_API_KEY;
      const { resolveUserHardcoverKey } = require('../../server/utils/hardcoverEncryption');
      const db = makeDb((_sql, _params, cb) => cb(null, { hardcover_api_key: null }));
      await expect(resolveUserHardcoverKey(7, db)).resolves.toBeNull();
    });

    it('returns null when stored blob is malformed and no fallback configured', async () => {
      jest.doMock('../../server/utils/logger', () => ({ error: jest.fn() }));
      delete process.env.HARDCOVER_API_KEY;
      const { resolveUserHardcoverKey } = require('../../server/utils/hardcoverEncryption');
      const db = makeDb((_sql, _params, cb) => cb(null, { hardcover_api_key: '{not-json' }));
      await expect(resolveUserHardcoverKey(7, db)).resolves.toBeNull();
    });
  });
});
