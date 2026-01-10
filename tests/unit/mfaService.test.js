/**
 * Unit tests for MFA Service
 */

const {
  generateSecret,
  generateQRCode,
  verifyToken,
  generateBackupCodes
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
});
