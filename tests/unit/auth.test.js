/**
 * Unit tests for authentication functions
 */

// Set up environment before requiring auth module
process.env.JWT_SECRET = 'test-secret-key-at-least-32-characters-long';

// Mock database before requiring auth
jest.mock('../../server/database', () => ({
  get: jest.fn(),
  run: jest.fn()
}));

const db = require('../../server/database');

const {
  validatePassword,
  blacklistToken,
  invalidateUserTokens,
  logout,
  requireAdmin,
  authenticateToken,
  authenticateMediaToken,
  register,
  login,
  isAccountLocked,
  recordFailedAttempt,
  clearFailedAttempts
} = require('../../server/auth');

const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

describe('validatePassword', () => {
  test('rejects passwords shorter than 8 characters', () => {
    const errors = validatePassword('Ab1!');
    expect(errors).toContain('Password must be at least 8 characters long');
  });

  test('rejects passwords without uppercase letters', () => {
    const errors = validatePassword('alllowercase123!');
    expect(errors).toContain('Password must contain at least one uppercase letter');
  });

  test('rejects passwords without lowercase letters', () => {
    const errors = validatePassword('ALLUPPERCASE123!');
    expect(errors).toContain('Password must contain at least one lowercase letter');
  });

  test('rejects passwords without numbers', () => {
    const errors = validatePassword('NoNumbersHere!@');
    expect(errors).toContain('Password must contain at least one number');
  });

  test('rejects passwords without special characters', () => {
    const errors = validatePassword('NoSpecialChar123');
    expect(errors).toContain('Password must contain at least one special character');
  });

  test('accepts valid passwords', () => {
    const errors = validatePassword('ValidPass123!@#');
    expect(errors).toHaveLength(0);
  });

  test('accepts passwords with various special characters', () => {
    const validPasswords = [
      'Password123!',
      'Password123@',
      'Password123#',
      'Password123$',
      'Password123%',
      'Password123^',
      'Password123&',
      'Password123*',
    ];

    validPasswords.forEach(password => {
      const errors = validatePassword(password);
      expect(errors).toHaveLength(0);
    });
  });

  test('returns multiple errors for very weak passwords', () => {
    const errors = validatePassword('weak');
    expect(errors.length).toBeGreaterThan(1);
  });
});

describe('Token Blacklist Functions', () => {
  test('blacklistToken adds token to blacklist', () => {
    const token = 'test-token-12345';
    const expiresAt = Date.now() + 3600000;
    expect(() => blacklistToken(token, expiresAt)).not.toThrow();
  });

  test('invalidateUserTokens stores invalidation timestamp', () => {
    const userId = 88888; // Use unique ID to avoid test interference
    expect(() => invalidateUserTokens(userId)).not.toThrow();
  });
});

describe('logout', () => {
  test('returns true when token is successfully decoded and blacklisted', () => {
    const token = jwt.sign({ id: 1 }, process.env.JWT_SECRET, { expiresIn: '1h' });
    const result = logout(token);
    expect(result).toBe(true);
  });

  test('returns false when token cannot be decoded', () => {
    const result = logout('invalid-token-format');
    expect(result).toBe(false);
  });

  test('returns false for empty token', () => {
    const result = logout('');
    expect(result).toBe(false);
  });
});

describe('requireAdmin', () => {
  let mockReq;
  let mockRes;
  let mockNext;

  beforeEach(() => {
    mockReq = { user: null };
    mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis()
    };
    mockNext = jest.fn();
  });

  test('calls next() when user is admin', () => {
    mockReq.user = { id: 1, username: 'admin', is_admin: 1 };
    requireAdmin(mockReq, mockRes, mockNext);
    expect(mockNext).toHaveBeenCalled();
    expect(mockRes.status).not.toHaveBeenCalled();
  });

  test('returns 403 when user is not admin', () => {
    mockReq.user = { id: 2, username: 'user', is_admin: 0 };
    requireAdmin(mockReq, mockRes, mockNext);
    expect(mockNext).not.toHaveBeenCalled();
    expect(mockRes.status).toHaveBeenCalledWith(403);
    expect(mockRes.json).toHaveBeenCalledWith({ error: 'Admin access required' });
  });

  test('returns 403 when user is not set', () => {
    mockReq.user = null;
    requireAdmin(mockReq, mockRes, mockNext);
    expect(mockNext).not.toHaveBeenCalled();
    expect(mockRes.status).toHaveBeenCalledWith(403);
  });

  test('returns 403 when user object is undefined', () => {
    delete mockReq.user;
    requireAdmin(mockReq, mockRes, mockNext);
    expect(mockNext).not.toHaveBeenCalled();
    expect(mockRes.status).toHaveBeenCalledWith(403);
  });

  test('returns 403 when is_admin is false (boolean)', () => {
    mockReq.user = { id: 2, username: 'user', is_admin: false };
    requireAdmin(mockReq, mockRes, mockNext);
    expect(mockNext).not.toHaveBeenCalled();
    expect(mockRes.status).toHaveBeenCalledWith(403);
  });
});

describe('authenticateToken', () => {
  let mockReq;
  let mockRes;
  let mockNext;

  beforeEach(() => {
    jest.clearAllMocks();
    mockReq = { headers: {}, query: {} };
    mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis()
    };
    mockNext = jest.fn();
  });

  test('returns 401 when no token provided', () => {
    authenticateToken(mockReq, mockRes, mockNext);
    expect(mockRes.status).toHaveBeenCalledWith(401);
    expect(mockRes.json).toHaveBeenCalledWith({ error: 'Access token required' });
    expect(mockNext).not.toHaveBeenCalled();
  });

  test('returns 403 for invalid JWT token', () => {
    mockReq.headers['authorization'] = 'Bearer invalid-token';
    authenticateToken(mockReq, mockRes, mockNext);
    expect(mockRes.status).toHaveBeenCalledWith(403);
    expect(mockRes.json).toHaveBeenCalledWith({ error: 'Invalid or expired token' });
  });

  test('returns 403 for expired JWT token', () => {
    const expiredToken = jwt.sign({ id: 1 }, process.env.JWT_SECRET, { expiresIn: '-1s' });
    mockReq.headers['authorization'] = `Bearer ${expiredToken}`;
    authenticateToken(mockReq, mockRes, mockNext);
    expect(mockRes.status).toHaveBeenCalledWith(403);
  });

  test('validates token and fetches user from database', (done) => {
    const validToken = jwt.sign({ id: 1, username: 'testuser' }, process.env.JWT_SECRET, { expiresIn: '1h' });
    mockReq.headers['authorization'] = `Bearer ${validToken}`;

    db.get.mockImplementation((query, params, callback) => {
      callback(null, { id: 1, username: 'testuser', is_admin: 0, must_change_password: 0 });
    });

    authenticateToken(mockReq, mockRes, () => {
      expect(mockReq.user).toEqual({ id: 1, username: 'testuser', is_admin: 0, must_change_password: false });
      expect(mockReq.token).toBe(validToken);
      done();
    });
  });

  test('returns 403 when user not found in database', (done) => {
    const validToken = jwt.sign({ id: 999, username: 'deleted' }, process.env.JWT_SECRET, { expiresIn: '1h' });
    mockReq.headers['authorization'] = `Bearer ${validToken}`;

    db.get.mockImplementation((query, params, callback) => {
      callback(null, null); // User not found
    });

    mockRes.status.mockImplementation((code) => {
      expect(code).toBe(403);
      return mockRes;
    });
    mockRes.json.mockImplementation((body) => {
      expect(body).toEqual({ error: 'User not found' });
      done();
      return mockRes;
    });

    authenticateToken(mockReq, mockRes, mockNext);
  });

  test('returns 500 on database error', (done) => {
    const validToken = jwt.sign({ id: 1, username: 'testuser' }, process.env.JWT_SECRET, { expiresIn: '1h' });
    mockReq.headers['authorization'] = `Bearer ${validToken}`;

    db.get.mockImplementation((query, params, callback) => {
      callback(new Error('Database connection failed'), null);
    });

    mockRes.status.mockImplementation((code) => {
      expect(code).toBe(500);
      return mockRes;
    });
    mockRes.json.mockImplementation((body) => {
      expect(body).toEqual({ error: 'Database error' });
      done();
      return mockRes;
    });

    authenticateToken(mockReq, mockRes, mockNext);
  });

  test('handles API key authentication', (done) => {
    const apiKey = 'sapho_test_api_key_12345';
    mockReq.headers['authorization'] = `Bearer ${apiKey}`;

    // Mock the API key lookup and user lookup
    db.get
      .mockImplementationOnce((query, params, callback) => {
        // API key found
        callback(null, { id: 1, user_id: 1, is_active: 1, expires_at: null });
      })
      .mockImplementationOnce((query, params, callback) => {
        // User lookup
        callback(null, { id: 1, username: 'apiuser', is_admin: 0 });
      });

    db.run.mockImplementation((query, params, callback) => {
      if (callback) callback(null);
    });

    authenticateToken(mockReq, mockRes, () => {
      expect(mockReq.user).toEqual({ id: 1, username: 'apiuser', is_admin: 0 });
      expect(mockReq.apiKey).toBeDefined();
      done();
    });
  });

  test('returns 403 for invalid API key', (done) => {
    const apiKey = 'sapho_invalid_key';
    mockReq.headers['authorization'] = `Bearer ${apiKey}`;

    db.get.mockImplementation((query, params, callback) => {
      callback(null, null); // API key not found
    });

    mockRes.json.mockImplementation((body) => {
      expect(body).toEqual({ error: 'Invalid API key' });
      done();
      return mockRes;
    });

    authenticateToken(mockReq, mockRes, mockNext);
  });

  test('returns 403 for expired API key', (done) => {
    const apiKey = 'sapho_expired_key';
    mockReq.headers['authorization'] = `Bearer ${apiKey}`;

    db.get.mockImplementation((query, params, callback) => {
      callback(null, { id: 1, user_id: 1, is_active: 1, expires_at: '2020-01-01T00:00:00Z' });
    });

    mockRes.json.mockImplementation((body) => {
      expect(body).toEqual({ error: 'API key has expired' });
      done();
      return mockRes;
    });

    authenticateToken(mockReq, mockRes, mockNext);
  });

  test('returns 500 on API key database error', (done) => {
    const apiKey = 'sapho_test_key';
    mockReq.headers['authorization'] = `Bearer ${apiKey}`;

    db.get.mockImplementation((query, params, callback) => {
      callback(new Error('Database error'), null);
    });

    mockRes.json.mockImplementation((body) => {
      expect(body).toEqual({ error: 'Database error' });
      done();
      return mockRes;
    });

    authenticateToken(mockReq, mockRes, mockNext);
  });

  test('returns 403 when API key user not found', (done) => {
    const apiKey = 'sapho_orphan_key';
    mockReq.headers['authorization'] = `Bearer ${apiKey}`;

    db.get
      .mockImplementationOnce((query, params, callback) => {
        // API key found
        callback(null, { id: 1, user_id: 999, is_active: 1, expires_at: null });
      })
      .mockImplementationOnce((query, params, callback) => {
        // User not found
        callback(null, null);
      });

    db.run.mockImplementation((query, params, callback) => {
      if (callback) callback(null);
    });

    mockRes.json.mockImplementation((body) => {
      expect(body).toEqual({ error: 'Invalid API key user' });
      done();
      return mockRes;
    });

    authenticateToken(mockReq, mockRes, mockNext);
  });

  test('returns 403 for blacklisted token', () => {
    const token = jwt.sign({ id: 1 }, process.env.JWT_SECRET, { expiresIn: '1h' });
    // Blacklist the token first
    blacklistToken(token, Date.now() + 3600000);

    mockReq.headers['authorization'] = `Bearer ${token}`;
    authenticateToken(mockReq, mockRes, mockNext);

    expect(mockRes.status).toHaveBeenCalledWith(403);
    expect(mockRes.json).toHaveBeenCalledWith({ error: 'Token has been revoked' });
  });
});

describe('authenticateMediaToken', () => {
  let mockReq;
  let mockRes;
  let mockNext;

  beforeEach(() => {
    jest.clearAllMocks();
    mockReq = { headers: {}, query: {} };
    mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis()
    };
    mockNext = jest.fn();
  });

  test('returns 401 when no token in header or query', () => {
    authenticateMediaToken(mockReq, mockRes, mockNext);
    expect(mockRes.status).toHaveBeenCalledWith(401);
    expect(mockRes.json).toHaveBeenCalledWith({ error: 'Access token required' });
  });

  test('accepts token from query string', (done) => {
    const validToken = jwt.sign({ id: 1, username: 'testuser' }, process.env.JWT_SECRET, { expiresIn: '1h' });
    mockReq.query.token = validToken;

    db.get.mockImplementation((query, params, callback) => {
      callback(null, { id: 1, username: 'testuser', is_admin: 0, must_change_password: 0 });
    });

    authenticateMediaToken(mockReq, mockRes, () => {
      expect(mockReq.user).toEqual({ id: 1, username: 'testuser', is_admin: 0, must_change_password: false });
      done();
    });
  });

  test('prefers header token over query token', (done) => {
    const headerToken = jwt.sign({ id: 1, username: 'headeruser' }, process.env.JWT_SECRET, { expiresIn: '1h' });
    const queryToken = jwt.sign({ id: 2, username: 'queryuser' }, process.env.JWT_SECRET, { expiresIn: '1h' });

    mockReq.headers['authorization'] = `Bearer ${headerToken}`;
    mockReq.query.token = queryToken;

    db.get.mockImplementation((query, params, callback) => {
      // Return user based on which token was used (id in params)
      if (params[0] === 1) {
        callback(null, { id: 1, username: 'headeruser', is_admin: 0 });
      } else {
        callback(null, { id: 2, username: 'queryuser', is_admin: 0 });
      }
    });

    authenticateMediaToken(mockReq, mockRes, () => {
      expect(mockReq.user.username).toBe('headeruser');
      done();
    });
  });

  test('accepts API key from query string', (done) => {
    const apiKey = 'sapho_query_api_key';
    mockReq.query.token = apiKey;

    db.get
      .mockImplementationOnce((query, params, callback) => {
        callback(null, { id: 1, user_id: 1, is_active: 1, expires_at: null });
      })
      .mockImplementationOnce((query, params, callback) => {
        callback(null, { id: 1, username: 'apiuser', is_admin: 0 });
      });

    db.run.mockImplementation((query, params, callback) => {
      if (callback) callback(null);
    });

    authenticateMediaToken(mockReq, mockRes, () => {
      expect(mockReq.user).toEqual({ id: 1, username: 'apiuser', is_admin: 0 });
      done();
    });
  });
});

describe('register', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('rejects registration with weak password', async () => {
    await expect(register('newuser', 'weak', 'email@test.com'))
      .rejects.toThrow();
  });

  test('successfully registers user with valid password', async () => {
    db.run.mockImplementation(function(query, params, callback) {
      callback.call({ lastID: 1 }, null);
    });

    const result = await register('newuser', 'ValidPass123!', 'email@test.com');
    expect(result).toEqual({ id: 1, username: 'newuser', email: 'email@test.com' });
  });

  test('rejects duplicate username', async () => {
    db.run.mockImplementation((query, params, callback) => {
      callback(new Error('UNIQUE constraint failed: users.username'));
    });

    await expect(register('existinguser', 'ValidPass123!', 'email@test.com'))
      .rejects.toThrow('Username already exists');
  });

  test('handles database errors', async () => {
    db.run.mockImplementation((query, params, callback) => {
      callback(new Error('Connection refused'));
    });

    await expect(register('newuser', 'ValidPass123!', 'email@test.com'))
      .rejects.toThrow('Connection refused');
  });

  test('registers user without email', async () => {
    db.run.mockImplementation(function(query, params, callback) {
      callback.call({ lastID: 2 }, null);
    });

    const result = await register('newuser', 'ValidPass123!');
    expect(result).toEqual({ id: 2, username: 'newuser', email: null });
  });
});

describe('login', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    clearFailedAttempts('testuser');
    clearFailedAttempts('lockeduser');
  });

  test('returns token for valid credentials', async () => {
    const hashedPassword = bcrypt.hashSync('ValidPass123!', 10);

    db.get.mockImplementation((query, params, callback) => {
      callback(null, {
        id: 1,
        username: 'testuser',
        password_hash: hashedPassword,
        is_admin: 0,
        must_change_password: 0,
        mfa_enabled: 0,
        account_disabled: 0
      });
    });

    const result = await login('testuser', 'ValidPass123!');
    expect(result.token).toBeDefined();
    expect(result.user).toEqual({ id: 1, username: 'testuser', is_admin: 0 });
  });

  test('rejects invalid password', async () => {
    const hashedPassword = bcrypt.hashSync('ValidPass123!', 10);

    db.get.mockImplementation((query, params, callback) => {
      callback(null, {
        id: 1,
        username: 'testuser',
        password_hash: hashedPassword,
        is_admin: 0
      });
    });

    await expect(login('testuser', 'WrongPassword123!'))
      .rejects.toThrow('Invalid username or password');
  });

  test('rejects non-existent user', async () => {
    db.get.mockImplementation((query, params, callback) => {
      callback(null, null);
    });

    await expect(login('nonexistent', 'ValidPass123!'))
      .rejects.toThrow('Invalid username or password');
  });

  test('rejects login for disabled account', async () => {
    const hashedPassword = bcrypt.hashSync('ValidPass123!', 10);

    db.get.mockImplementation((query, params, callback) => {
      callback(null, {
        id: 1,
        username: 'testuser',
        password_hash: hashedPassword,
        is_admin: 0,
        account_disabled: 1
      });
    });

    await expect(login('testuser', 'ValidPass123!'))
      .rejects.toThrow('Your account has been disabled');
  });

  test('returns MFA required response when MFA enabled', async () => {
    const hashedPassword = bcrypt.hashSync('ValidPass123!', 10);

    db.get.mockImplementation((query, params, callback) => {
      callback(null, {
        id: 1,
        username: 'testuser',
        password_hash: hashedPassword,
        is_admin: 0,
        mfa_enabled: 1,
        account_disabled: 0
      });
    });

    const result = await login('testuser', 'ValidPass123!');
    expect(result.mfa_required).toBe(true);
    expect(result.mfa_token).toBeDefined();
  });

  test('includes must_change_password flag', async () => {
    const hashedPassword = bcrypt.hashSync('ValidPass123!', 10);

    db.get.mockImplementation((query, params, callback) => {
      callback(null, {
        id: 1,
        username: 'testuser',
        password_hash: hashedPassword,
        is_admin: 0,
        must_change_password: 1,
        mfa_enabled: 0,
        account_disabled: 0
      });
    });

    const result = await login('testuser', 'ValidPass123!');
    expect(result.must_change_password).toBe(true);
  });

  test('rejects login for locked account', async () => {
    // Lock the account
    for (let i = 0; i < 5; i++) {
      recordFailedAttempt('lockeduser');
    }

    await expect(login('lockeduser', 'ValidPass123!'))
      .rejects.toThrow(/Account is locked/);
  });

  test('handles database error', async () => {
    db.get.mockImplementation((query, params, callback) => {
      callback(new Error('Database error'), null);
    });

    await expect(login('testuser', 'ValidPass123!'))
      .rejects.toThrow('Database error');
  });
});

describe('createDefaultAdmin', () => {
  const { createDefaultAdmin } = require('../../server/auth');

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('creates admin when no users exist', async () => {
    db.get.mockImplementation((query, params, callback) => {
      callback(null, { count: 0 });
    });

    db.run.mockImplementation(function(query, params, callback) {
      callback.call({ lastID: 1 }, null);
    });

    // Should resolve without error
    await expect(createDefaultAdmin()).resolves.toBeUndefined();
    expect(db.run).toHaveBeenCalled();
  });

  test('does nothing when users already exist', async () => {
    db.get.mockImplementation((query, params, callback) => {
      callback(null, { count: 5 });
    });

    await expect(createDefaultAdmin()).resolves.toBeUndefined();
    expect(db.run).not.toHaveBeenCalled();
  });

  test('rejects on database error during count', async () => {
    db.get.mockImplementation((query, params, callback) => {
      callback(new Error('Database error'), null);
    });

    await expect(createDefaultAdmin()).rejects.toThrow('Database error');
  });

  test('rejects on database error during insert', async () => {
    db.get.mockImplementation((query, params, callback) => {
      callback(null, { count: 0 });
    });

    db.run.mockImplementation((query, params, callback) => {
      callback(new Error('Insert failed'));
    });

    await expect(createDefaultAdmin()).rejects.toThrow('Insert failed');
  });
});

describe('token invalidation', () => {
  test('returns 403 when token was issued before user invalidation', (done) => {
    // Use a unique user ID that won't interfere with other tests
    const testUserId = 99999;

    // First, invalidate the user's tokens
    invalidateUserTokens(testUserId);

    // Create a token that was issued "before" the invalidation
    // by manipulating the iat claim
    const token = jwt.sign(
      { id: testUserId, username: 'testuser', iat: Math.floor(Date.now() / 1000) - 100 },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );

    const mockReq = { headers: { authorization: `Bearer ${token}` }, query: {} };
    const mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis()
    };

    mockRes.json.mockImplementation((body) => {
      expect(body.error).toContain('invalidated');
      done();
      return mockRes;
    });

    authenticateToken(mockReq, mockRes, jest.fn());
  });
});
