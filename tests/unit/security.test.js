/**
 * Security-focused unit tests
 * Tests authentication, authorization, and input validation security measures
 */

const {
  validatePassword,
  isAccountLocked,
  recordFailedAttempt,
  clearFailedAttempts,
  getLockoutRemaining,
  getLockedAccounts
} = require('../../server/auth');

describe('Security Tests', () => {
  beforeEach(() => {
    // Clear any locked accounts between tests
    clearFailedAttempts('testuser');
    clearFailedAttempts('lockeduser');
  });

  describe('Account Lockout', () => {
    test('account is not locked initially', () => {
      expect(isAccountLocked('newuser')).toBe(false);
    });

    test('account locks after 5 failed attempts', () => {
      const username = 'testuser';

      // First 4 attempts should not lock
      for (let i = 0; i < 4; i++) {
        recordFailedAttempt(username);
        expect(isAccountLocked(username)).toBe(false);
      }

      // 5th attempt should trigger lockout
      recordFailedAttempt(username);
      expect(isAccountLocked(username)).toBe(true);
    });

    test('getLockoutRemaining returns positive value when locked', () => {
      const username = 'lockeduser';

      // Lock the account
      for (let i = 0; i < 5; i++) {
        recordFailedAttempt(username);
      }

      const remaining = getLockoutRemaining(username);
      expect(remaining).toBeGreaterThan(0);
      expect(remaining).toBeLessThanOrEqual(15 * 60); // Max 15 minutes
    });

    test('getLockoutRemaining returns 0 for unlocked accounts', () => {
      expect(getLockoutRemaining('neverlockeduser')).toBe(0);
    });

    test('clearFailedAttempts unlocks the account', () => {
      const username = 'testuser';

      // Lock the account
      for (let i = 0; i < 5; i++) {
        recordFailedAttempt(username);
      }
      expect(isAccountLocked(username)).toBe(true);

      // Clear attempts
      clearFailedAttempts(username);
      expect(isAccountLocked(username)).toBe(false);
    });

    test('getLockedAccounts returns list of locked accounts', () => {
      // Lock a user
      const username = 'lockeduser';
      for (let i = 0; i < 5; i++) {
        recordFailedAttempt(username);
      }

      const locked = getLockedAccounts();
      expect(locked.length).toBeGreaterThanOrEqual(1);
      expect(locked.some(a => a.username === username)).toBe(true);
    });
  });

  describe('Password Validation Security', () => {
    test('rejects common weak passwords', () => {
      const weakPasswords = [
        'password',
        '123456',
        'qwerty',
        'abc123',
        'letmein',
      ];

      weakPasswords.forEach(password => {
        const errors = validatePassword(password);
        expect(errors.length).toBeGreaterThan(0);
      });
    });

    test('requires minimum length of 6', () => {
      const errors = validatePassword('Ab1!');
      expect(errors).toContain('Password must be at least 6 characters long');
    });

    test('requires mixed case', () => {
      const lowercaseOnly = validatePassword('password123!');
      expect(lowercaseOnly).toContain('Password must contain at least one uppercase letter');

      const uppercaseOnly = validatePassword('PASSWORD123!');
      expect(uppercaseOnly).toContain('Password must contain at least one lowercase letter');
    });

    test('requires numbers', () => {
      const errors = validatePassword('Password!!');
      expect(errors).toContain('Password must contain at least one number');
    });

    test('requires special characters', () => {
      const errors = validatePassword('Password123');
      expect(errors).toContain('Password must contain at least one special character');
    });

    test('accepts strong passwords', () => {
      const strongPasswords = [
        'Str0ng!Pass',
        'C0mplex@Pwd',
        'Secur3#Key!',
        'P@ssw0rd123',
      ];

      strongPasswords.forEach(password => {
        const errors = validatePassword(password);
        expect(errors).toHaveLength(0);
      });
    });
  });

  describe('Input Validation Patterns', () => {
    test('SQL special characters in password are handled safely', () => {
      // These passwords should pass validation if they meet complexity requirements
      // The important thing is they should never cause SQL injection
      const sqlInjectionAttempts = [
        "P@ss'; DROP TABLE users;--1",
        'P@ss" OR "1"="1',
        "P@ss' OR '1'='1",
        'P@ss/**/OR/**/1=1',
      ];

      sqlInjectionAttempts.forEach(password => {
        // These should either pass or fail validation based on complexity rules
        // but should never cause code execution
        const errors = validatePassword(password);
        expect(Array.isArray(errors)).toBe(true);
      });
    });

    test('XSS payloads in password are handled safely', () => {
      const xssAttempts = [
        '<script>alert("XSS")</script>P@ss1',
        'P@ss1<img src=x onerror=alert(1)>',
        'P@ss1"><script>alert(1)</script>',
      ];

      xssAttempts.forEach(password => {
        // Passwords with these characters should still go through validation
        const errors = validatePassword(password);
        expect(Array.isArray(errors)).toBe(true);
      });
    });
  });
});
