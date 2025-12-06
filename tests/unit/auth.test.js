/**
 * Unit tests for authentication functions
 */

const { validatePassword } = require('../../server/auth');

describe('validatePassword', () => {
  test('rejects passwords shorter than 12 characters', () => {
    const errors = validatePassword('Short1!abc');
    expect(errors).toContain('Password must be at least 12 characters long');
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
