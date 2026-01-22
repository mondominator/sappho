/**
 * Unit tests for Unlock Service
 */

// Mock database before requiring the module
jest.mock('../../server/database', () => ({
  get: jest.fn(),
  run: jest.fn()
}));

// Mock auth module
jest.mock('../../server/auth', () => ({
  clearFailedAttempts: jest.fn()
}));

const db = require('../../server/database');
const { clearFailedAttempts } = require('../../server/auth');

// Now require the service after mocks are set up
const {
  generateUnlockToken,
  validateUnlockToken,
  consumeUnlockToken,
  getUserByEmail,
  disableAccount,
  enableAccount,
  getAccountStatus,
  cleanupExpiredTokens
} = require('../../server/services/unlockService');

describe('Unlock Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('generateUnlockToken', () => {
    test('generates token and stores in database', async () => {
      // Mock delete existing tokens
      db.run.mockImplementationOnce((query, params, callback) => {
        callback(null);
      });
      // Mock insert new token
      db.run.mockImplementationOnce(function(query, params, callback) {
        callback.call({ lastID: 1 }, null);
      });

      const token = await generateUnlockToken(1);

      expect(token).toBeDefined();
      expect(typeof token).toBe('string');
      expect(token.length).toBe(64); // 32 bytes hex = 64 characters
      expect(db.run).toHaveBeenCalledTimes(2);
      expect(db.run).toHaveBeenNthCalledWith(
        1,
        expect.stringContaining('DELETE FROM unlock_tokens'),
        [1],
        expect.any(Function)
      );
      expect(db.run).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining('INSERT INTO unlock_tokens'),
        expect.arrayContaining([1, token]),
        expect.any(Function)
      );
    });

    test('deletes existing unused tokens before creating new one', async () => {
      db.run.mockImplementationOnce((query, params, callback) => {
        callback(null);
      });
      db.run.mockImplementationOnce(function(query, params, callback) {
        callback.call({ lastID: 1 }, null);
      });

      await generateUnlockToken(1);

      expect(db.run).toHaveBeenNthCalledWith(
        1,
        'DELETE FROM unlock_tokens WHERE user_id = ? AND used_at IS NULL',
        [1],
        expect.any(Function)
      );
    });

    test('rejects on delete error', async () => {
      db.run.mockImplementation((query, params, callback) => {
        callback(new Error('Database error'));
      });

      await expect(generateUnlockToken(1)).rejects.toThrow('Database error');
    });

    test('rejects on insert error', async () => {
      db.run.mockImplementationOnce((query, params, callback) => {
        callback(null);
      });
      db.run.mockImplementationOnce((query, params, callback) => {
        callback(new Error('Insert failed'));
      });

      await expect(generateUnlockToken(1)).rejects.toThrow('Insert failed');
    });
  });

  describe('validateUnlockToken', () => {
    test('returns user data for valid token', async () => {
      const mockData = {
        id: 1,
        user_id: 1,
        username: 'testuser',
        email: 'test@example.com',
        token: 'validtoken',
        expires_at: '2099-12-31'
      };

      db.get.mockImplementation((query, params, callback) => {
        callback(null, mockData);
      });

      const result = await validateUnlockToken('validtoken');

      expect(result).toEqual(mockData);
      expect(db.get).toHaveBeenCalledWith(
        expect.stringContaining('SELECT'),
        ['validtoken'],
        expect.any(Function)
      );
    });

    test('returns null for invalid token', async () => {
      db.get.mockImplementation((query, params, callback) => {
        callback(null, null);
      });

      const result = await validateUnlockToken('invalidtoken');

      expect(result).toBeNull();
    });

    test('returns null for expired token', async () => {
      db.get.mockImplementation((query, params, callback) => {
        callback(null, null); // DB query filters out expired tokens
      });

      const result = await validateUnlockToken('expiredtoken');

      expect(result).toBeNull();
    });

    test('rejects on database error', async () => {
      db.get.mockImplementation((query, params, callback) => {
        callback(new Error('Database error'), null);
      });

      await expect(validateUnlockToken('anytoken')).rejects.toThrow('Database error');
    });
  });

  describe('consumeUnlockToken', () => {
    test('consumes valid token and clears lockout', async () => {
      const mockTokenData = {
        id: 1,
        user_id: 1,
        username: 'testuser',
        token: 'validtoken'
      };

      // Mock validateUnlockToken
      db.get.mockImplementation((query, params, callback) => {
        callback(null, mockTokenData);
      });

      // Mock update token as used
      db.run.mockImplementation((query, params, callback) => {
        callback(null);
      });

      const result = await consumeUnlockToken('validtoken');

      expect(result).toEqual({
        success: true,
        username: 'testuser'
      });
      expect(clearFailedAttempts).toHaveBeenCalledWith('testuser');
      expect(db.run).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE unlock_tokens SET used_at'),
        ['validtoken'],
        expect.any(Function)
      );
    });

    test('throws error for invalid token', async () => {
      db.get.mockImplementation((query, params, callback) => {
        callback(null, null);
      });

      await expect(consumeUnlockToken('invalidtoken')).rejects.toThrow('Invalid or expired unlock token');
    });

    test('rejects on database error during update', async () => {
      const mockTokenData = {
        id: 1,
        user_id: 1,
        username: 'testuser'
      };

      db.get.mockImplementation((query, params, callback) => {
        callback(null, mockTokenData);
      });

      db.run.mockImplementation((query, params, callback) => {
        callback(new Error('Update failed'));
      });

      await expect(consumeUnlockToken('validtoken')).rejects.toThrow('Update failed');
    });
  });

  describe('getUserByEmail', () => {
    test('returns user for valid email', async () => {
      const mockUser = {
        id: 1,
        username: 'testuser',
        email: 'test@example.com'
      };

      db.get.mockImplementation((query, params, callback) => {
        callback(null, mockUser);
      });

      const result = await getUserByEmail('test@example.com');

      expect(result).toEqual(mockUser);
      expect(db.get).toHaveBeenCalledWith(
        expect.stringContaining('SELECT'),
        ['test@example.com'],
        expect.any(Function)
      );
    });

    test('returns null for unknown email', async () => {
      db.get.mockImplementation((query, params, callback) => {
        callback(null, null);
      });

      const result = await getUserByEmail('unknown@example.com');

      expect(result).toBeNull();
    });

    test('normalizes email to lowercase and trims', async () => {
      db.get.mockImplementation((query, params, callback) => {
        callback(null, { id: 1, username: 'test', email: 'test@example.com' });
      });

      await getUserByEmail('  TEST@Example.COM  ');

      expect(db.get).toHaveBeenCalledWith(
        expect.any(String),
        ['test@example.com'],
        expect.any(Function)
      );
    });

    test('rejects on database error', async () => {
      db.get.mockImplementation((query, params, callback) => {
        callback(new Error('Database error'), null);
      });

      await expect(getUserByEmail('test@example.com')).rejects.toThrow('Database error');
    });
  });

  describe('disableAccount', () => {
    test('disables account with reason', async () => {
      db.run.mockImplementation(function(query, params, callback) {
        callback.call({ changes: 1 }, null);
      });

      const result = await disableAccount(1, 'Violation of terms');

      expect(result).toEqual({ success: true });
      expect(db.run).toHaveBeenCalledWith(
        expect.stringContaining('account_disabled = 1'),
        ['Violation of terms', 1],
        expect.any(Function)
      );
    });

    test('disables account without reason', async () => {
      db.run.mockImplementation(function(query, params, callback) {
        callback.call({ changes: 1 }, null);
      });

      const result = await disableAccount(1);

      expect(result).toEqual({ success: true });
      expect(db.run).toHaveBeenCalledWith(
        expect.any(String),
        [null, 1],
        expect.any(Function)
      );
    });

    test('throws error when user not found', async () => {
      db.run.mockImplementation(function(query, params, callback) {
        callback.call({ changes: 0 }, null);
      });

      await expect(disableAccount(999)).rejects.toThrow('User not found');
    });

    test('rejects on database error', async () => {
      db.run.mockImplementation((query, params, callback) => {
        callback(new Error('Database error'));
      });

      await expect(disableAccount(1)).rejects.toThrow('Database error');
    });
  });

  describe('enableAccount', () => {
    test('enables disabled account', async () => {
      db.run.mockImplementation(function(query, params, callback) {
        callback.call({ changes: 1 }, null);
      });

      const result = await enableAccount(1);

      expect(result).toEqual({ success: true });
      expect(db.run).toHaveBeenCalledWith(
        expect.stringContaining('account_disabled = 0'),
        [1],
        expect.any(Function)
      );
    });

    test('throws error when user not found', async () => {
      db.run.mockImplementation(function(query, params, callback) {
        callback.call({ changes: 0 }, null);
      });

      await expect(enableAccount(999)).rejects.toThrow('User not found');
    });

    test('rejects on database error', async () => {
      db.run.mockImplementation((query, params, callback) => {
        callback(new Error('Database error'));
      });

      await expect(enableAccount(1)).rejects.toThrow('Database error');
    });
  });

  describe('getAccountStatus', () => {
    test('returns status for enabled account', async () => {
      db.get.mockImplementation((query, params, callback) => {
        callback(null, {
          id: 1,
          username: 'testuser',
          account_disabled: 0,
          disabled_at: null,
          disabled_reason: null
        });
      });

      const result = await getAccountStatus(1);

      expect(result).toEqual({
        id: 1,
        username: 'testuser',
        disabled: false,
        disabledAt: null,
        disabledReason: null
      });
    });

    test('returns status for disabled account', async () => {
      db.get.mockImplementation((query, params, callback) => {
        callback(null, {
          id: 1,
          username: 'testuser',
          account_disabled: 1,
          disabled_at: '2024-01-01T00:00:00Z',
          disabled_reason: 'Violation'
        });
      });

      const result = await getAccountStatus(1);

      expect(result).toEqual({
        id: 1,
        username: 'testuser',
        disabled: true,
        disabledAt: '2024-01-01T00:00:00Z',
        disabledReason: 'Violation'
      });
    });

    test('throws error when user not found', async () => {
      db.get.mockImplementation((query, params, callback) => {
        callback(null, null);
      });

      await expect(getAccountStatus(999)).rejects.toThrow('User not found');
    });

    test('rejects on database error', async () => {
      db.get.mockImplementation((query, params, callback) => {
        callback(new Error('Database error'), null);
      });

      await expect(getAccountStatus(1)).rejects.toThrow('Database error');
    });
  });

  describe('cleanupExpiredTokens', () => {
    test('deletes expired tokens and returns count', async () => {
      db.run.mockImplementation(function(query, params, callback) {
        callback.call({ changes: 5 }, null);
      });

      const result = await cleanupExpiredTokens();

      expect(result).toBe(5);
      expect(db.run).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM unlock_tokens WHERE expires_at'),
        [],
        expect.any(Function)
      );
    });

    test('returns 0 when no expired tokens', async () => {
      db.run.mockImplementation(function(query, params, callback) {
        callback.call({ changes: 0 }, null);
      });

      const result = await cleanupExpiredTokens();

      expect(result).toBe(0);
    });

    test('rejects on database error', async () => {
      db.run.mockImplementation((query, params, callback) => {
        callback(new Error('Database error'));
      });

      await expect(cleanupExpiredTokens()).rejects.toThrow('Database error');
    });
  });
});
