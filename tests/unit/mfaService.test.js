/**
 * Unit tests for MFA Service
 */

// Mock database before requiring mfaService
jest.mock('../../server/database', () => ({
  get: jest.fn(),
  run: jest.fn()
}));

const db = require('../../server/database');
const bcrypt = require('bcryptjs');

const {
  generateSecret,
  generateQRCode,
  verifyToken,
  generateBackupCodes,
  verifyBackupCode,
  enableMFA,
  disableMFA,
  getMFAStatus,
  getUserMFASecret,
  userHasMFA,
  regenerateBackupCodes
} = require('../../server/services/mfaService');

describe('MFA Service', () => {
  describe('generateSecret', () => {
    test('generates a base32 encoded secret', () => {
      const secret = generateSecret();
      expect(secret).toBeDefined();
      expect(typeof secret).toBe('string');
      // Base32 alphabet check
      expect(/^[A-Z2-7]+$/.test(secret)).toBe(true);
    });

    test('generates unique secrets', () => {
      const secrets = new Set();
      for (let i = 0; i < 100; i++) {
        secrets.add(generateSecret());
      }
      expect(secrets.size).toBe(100);
    });

    test('generates secret of appropriate length', () => {
      const secret = generateSecret();
      // OTPLib generates 20-byte secrets by default, base32 encoded = 32 chars
      expect(secret.length).toBeGreaterThanOrEqual(16);
    });
  });

  describe('generateQRCode', () => {
    test('generates QR code data URL', async () => {
      const secret = generateSecret();
      const qrCode = await generateQRCode('testuser', secret);

      expect(qrCode).toBeDefined();
      expect(qrCode.startsWith('data:image/png;base64,')).toBe(true);
    });

    test('handles special characters in username', async () => {
      const secret = generateSecret();
      const qrCode = await generateQRCode('test.user@example.com', secret);

      expect(qrCode).toBeDefined();
      expect(qrCode.startsWith('data:image/png;base64,')).toBe(true);
    });
  });

  describe('verifyToken', () => {
    test('verifies valid TOTP token', () => {
      // Generate a secret
      const secret = generateSecret();

      // Generate a valid token using the authenticator
      const { authenticator } = require('otplib');
      const validToken = authenticator.generate(secret);

      // Verify it
      const result = verifyToken(validToken, secret);
      expect(result).toBe(true);
    });

    test('rejects invalid token', () => {
      const secret = generateSecret();
      const result = verifyToken('000000', secret);
      expect(result).toBe(false);
    });

    test('rejects malformed token', () => {
      const secret = generateSecret();
      const result = verifyToken('invalid', secret);
      expect(result).toBe(false);
    });

    test('rejects empty token', () => {
      const secret = generateSecret();
      const result = verifyToken('', secret);
      expect(result).toBe(false);
    });

    test('handles invalid secret gracefully', () => {
      const result = verifyToken('123456', 'invalid-secret');
      expect(result).toBe(false);
    });
  });

  describe('generateBackupCodes', () => {
    test('generates requested number of codes', () => {
      const { plainCodes, hashedCodes } = generateBackupCodes(10);
      expect(plainCodes.length).toBe(10);
      expect(hashedCodes.length).toBe(10);
    });

    test('generates 8-character alphanumeric codes', () => {
      const { plainCodes } = generateBackupCodes(5);
      for (const code of plainCodes) {
        expect(code.length).toBe(8);
        expect(/^[A-F0-9]+$/.test(code)).toBe(true);
      }
    });

    test('generates unique codes', () => {
      const { plainCodes } = generateBackupCodes(10);
      const uniqueCodes = new Set(plainCodes);
      expect(uniqueCodes.size).toBe(10);
    });

    test('hashes codes with bcrypt', () => {
      const { plainCodes, hashedCodes } = generateBackupCodes(3);
      const bcrypt = require('bcryptjs');

      for (let i = 0; i < plainCodes.length; i++) {
        const isValid = bcrypt.compareSync(plainCodes[i], hashedCodes[i]);
        expect(isValid).toBe(true);
      }
    });

    test('uses different hash for each code', () => {
      const { hashedCodes } = generateBackupCodes(10);
      const uniqueHashes = new Set(hashedCodes);
      expect(uniqueHashes.size).toBe(10);
    });

    test('defaults to 10 codes', () => {
      const { plainCodes } = generateBackupCodes();
      expect(plainCodes.length).toBe(10);
    });

    test('can generate custom number of codes', () => {
      const { plainCodes } = generateBackupCodes(5);
      expect(plainCodes.length).toBe(5);
    });
  });

  describe('verifyBackupCode', () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    test('returns true for valid backup code', async () => {
      const { plainCodes, hashedCodes } = generateBackupCodes(1);

      db.get.mockImplementation((query, params, callback) => {
        callback(null, { mfa_backup_codes: JSON.stringify(hashedCodes) });
      });
      db.run.mockImplementation((query, params, callback) => {
        callback.call({ changes: 1 }, null);
      });

      const result = await verifyBackupCode(1, plainCodes[0]);
      expect(result).toBe(true);
    });

    test('returns false for invalid backup code', async () => {
      const hashedCodes = [bcrypt.hashSync('ABCD1234', 10)];

      db.get.mockImplementation((query, params, callback) => {
        callback(null, { mfa_backup_codes: JSON.stringify(hashedCodes) });
      });

      const result = await verifyBackupCode(1, 'WRONGCODE');
      expect(result).toBe(false);
    });

    test('returns false when user has no backup codes', async () => {
      db.get.mockImplementation((query, params, callback) => {
        callback(null, { mfa_backup_codes: null });
      });

      const result = await verifyBackupCode(1, 'ANYCODE');
      expect(result).toBe(false);
    });

    test('returns false when user not found', async () => {
      db.get.mockImplementation((query, params, callback) => {
        callback(null, null);
      });

      const result = await verifyBackupCode(1, 'ANYCODE');
      expect(result).toBe(false);
    });

    test('rejects on database error', async () => {
      db.get.mockImplementation((query, params, callback) => {
        callback(new Error('Database error'), null);
      });

      await expect(verifyBackupCode(1, 'ANYCODE')).rejects.toThrow('Database error');
    });

    test('handles malformed JSON gracefully', async () => {
      db.get.mockImplementation((query, params, callback) => {
        callback(null, { mfa_backup_codes: 'not-valid-json' });
      });

      const result = await verifyBackupCode(1, 'ANYCODE');
      expect(result).toBe(false);
    });

    test('normalizes backup code input', async () => {
      const { plainCodes, hashedCodes } = generateBackupCodes(1);

      db.get.mockImplementation((query, params, callback) => {
        callback(null, { mfa_backup_codes: JSON.stringify(hashedCodes) });
      });
      db.run.mockImplementation((query, params, callback) => {
        callback.call({ changes: 1 }, null);
      });

      // Test with lowercase and dashes
      const result = await verifyBackupCode(1, plainCodes[0].toLowerCase());
      expect(result).toBe(true);
    });
  });

  describe('enableMFA', () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    test('enables MFA for user', async () => {
      db.run.mockImplementation(function(query, params, callback) {
        callback.call({ changes: 1 }, null);
      });

      const result = await enableMFA(1, 'secret123', ['hash1', 'hash2']);
      expect(result).toBe(true);
      expect(db.run).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE users SET'),
        expect.arrayContaining(['secret123']),
        expect.any(Function)
      );
    });

    test('returns false when user not found', async () => {
      db.run.mockImplementation(function(query, params, callback) {
        callback.call({ changes: 0 }, null);
      });

      const result = await enableMFA(999, 'secret123', ['hash1']);
      expect(result).toBe(false);
    });

    test('rejects on database error', async () => {
      db.run.mockImplementation((query, params, callback) => {
        callback(new Error('Database error'));
      });

      await expect(enableMFA(1, 'secret', [])).rejects.toThrow('Database error');
    });
  });

  describe('disableMFA', () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    test('disables MFA for user', async () => {
      db.run.mockImplementation(function(query, params, callback) {
        callback.call({ changes: 1 }, null);
      });

      const result = await disableMFA(1);
      expect(result).toBe(true);
      expect(db.run).toHaveBeenCalledWith(
        expect.stringContaining('mfa_enabled = 0'),
        [1],
        expect.any(Function)
      );
    });

    test('returns false when user not found', async () => {
      db.run.mockImplementation(function(query, params, callback) {
        callback.call({ changes: 0 }, null);
      });

      const result = await disableMFA(999);
      expect(result).toBe(false);
    });

    test('rejects on database error', async () => {
      db.run.mockImplementation((query, params, callback) => {
        callback(new Error('Database error'));
      });

      await expect(disableMFA(1)).rejects.toThrow('Database error');
    });
  });

  describe('getMFAStatus', () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    test('returns enabled status with backup code count', async () => {
      const backupCodes = ['hash1', 'hash2', null, 'hash4'];

      db.get.mockImplementation((query, params, callback) => {
        callback(null, {
          mfa_enabled: 1,
          mfa_enabled_at: '2024-01-01T00:00:00Z',
          mfa_backup_codes: JSON.stringify(backupCodes)
        });
      });

      const result = await getMFAStatus(1);
      expect(result).toEqual({
        enabled: true,
        enabledAt: '2024-01-01T00:00:00Z',
        remainingBackupCodes: 3 // 3 non-null codes
      });
    });

    test('returns disabled status when MFA not enabled', async () => {
      db.get.mockImplementation((query, params, callback) => {
        callback(null, {
          mfa_enabled: 0,
          mfa_enabled_at: null,
          mfa_backup_codes: null
        });
      });

      const result = await getMFAStatus(1);
      expect(result).toEqual({
        enabled: false,
        enabledAt: null,
        remainingBackupCodes: 0
      });
    });

    test('returns disabled when user not found', async () => {
      db.get.mockImplementation((query, params, callback) => {
        callback(null, null);
      });

      const result = await getMFAStatus(999);
      expect(result).toEqual({ enabled: false });
    });

    test('handles malformed backup codes JSON', async () => {
      db.get.mockImplementation((query, params, callback) => {
        callback(null, {
          mfa_enabled: 1,
          mfa_enabled_at: '2024-01-01',
          mfa_backup_codes: 'invalid-json'
        });
      });

      const result = await getMFAStatus(1);
      expect(result.remainingBackupCodes).toBe(0);
    });

    test('rejects on database error', async () => {
      db.get.mockImplementation((query, params, callback) => {
        callback(new Error('Database error'), null);
      });

      await expect(getMFAStatus(1)).rejects.toThrow('Database error');
    });
  });

  describe('getUserMFASecret', () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    test('returns secret when MFA is enabled', async () => {
      db.get.mockImplementation((query, params, callback) => {
        callback(null, { mfa_secret: 'supersecret', mfa_enabled: 1 });
      });

      const result = await getUserMFASecret(1);
      expect(result).toBe('supersecret');
    });

    test('returns null when MFA is disabled', async () => {
      db.get.mockImplementation((query, params, callback) => {
        callback(null, { mfa_secret: 'secret', mfa_enabled: 0 });
      });

      const result = await getUserMFASecret(1);
      expect(result).toBeNull();
    });

    test('returns null when user not found', async () => {
      db.get.mockImplementation((query, params, callback) => {
        callback(null, null);
      });

      const result = await getUserMFASecret(999);
      expect(result).toBeNull();
    });

    test('rejects on database error', async () => {
      db.get.mockImplementation((query, params, callback) => {
        callback(new Error('Database error'), null);
      });

      await expect(getUserMFASecret(1)).rejects.toThrow('Database error');
    });
  });

  describe('userHasMFA', () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    test('returns true when MFA is enabled', async () => {
      db.get.mockImplementation((query, params, callback) => {
        callback(null, { mfa_enabled: 1 });
      });

      const result = await userHasMFA(1);
      expect(result).toBe(true);
    });

    test('returns false when MFA is disabled', async () => {
      db.get.mockImplementation((query, params, callback) => {
        callback(null, { mfa_enabled: 0 });
      });

      const result = await userHasMFA(1);
      expect(result).toBe(false);
    });

    test('returns falsy value when user not found', async () => {
      db.get.mockImplementation((query, params, callback) => {
        callback(null, null);
      });

      const result = await userHasMFA(999);
      expect(result).toBeFalsy();
    });

    test('rejects on database error', async () => {
      db.get.mockImplementation((query, params, callback) => {
        callback(new Error('Database error'), null);
      });

      await expect(userHasMFA(1)).rejects.toThrow('Database error');
    });
  });

  describe('regenerateBackupCodes', () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    test('regenerates codes for user with MFA enabled', async () => {
      db.run.mockImplementation(function(query, params, callback) {
        callback.call({ changes: 1 }, null);
      });

      const result = await regenerateBackupCodes(1);
      expect(result).toHaveLength(10);
      expect(result[0]).toMatch(/^[A-F0-9]{8}$/);
    });

    test('rejects when MFA not enabled', async () => {
      db.run.mockImplementation(function(query, params, callback) {
        callback.call({ changes: 0 }, null);
      });

      await expect(regenerateBackupCodes(999)).rejects.toThrow('MFA not enabled for this user');
    });

    test('rejects on database error', async () => {
      db.run.mockImplementation((query, params, callback) => {
        callback(new Error('Database error'));
      });

      await expect(regenerateBackupCodes(1)).rejects.toThrow('Database error');
    });
  });
});
