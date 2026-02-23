const { normalizeAuthor } = require('../../server/utils/normalizeAuthor');

describe('normalizeAuthor', () => {
  test('trims leading and trailing whitespace', () => {
    expect(normalizeAuthor('  Brandon Sanderson  ')).toBe('Brandon Sanderson');
  });

  test('collapses multiple internal spaces to single space', () => {
    expect(normalizeAuthor('Brandon  Sanderson')).toBe('Brandon Sanderson');
    expect(normalizeAuthor('Brandon    Sanderson')).toBe('Brandon Sanderson');
  });

  test('handles tabs and mixed whitespace', () => {
    expect(normalizeAuthor('Brandon\tSanderson')).toBe('Brandon Sanderson');
    expect(normalizeAuthor('Brandon \t Sanderson')).toBe('Brandon Sanderson');
    expect(normalizeAuthor('\t Brandon  Sanderson \t')).toBe('Brandon Sanderson');
  });

  test('returns null for null input', () => {
    expect(normalizeAuthor(null)).toBeNull();
  });

  test('returns undefined for undefined input', () => {
    expect(normalizeAuthor(undefined)).toBeUndefined();
  });

  test('returns null for whitespace-only input', () => {
    expect(normalizeAuthor('   ')).toBeNull();
    expect(normalizeAuthor('\t\n')).toBeNull();
  });

  test('returns empty string for empty string', () => {
    expect(normalizeAuthor('')).toBe('');
  });

  test('preserves case (no case normalization)', () => {
    expect(normalizeAuthor('e.e. cummings')).toBe('e.e. cummings');
    expect(normalizeAuthor('bell hooks')).toBe('bell hooks');
  });

  test('handles normal author name unchanged', () => {
    expect(normalizeAuthor('Brandon Sanderson')).toBe('Brandon Sanderson');
  });

  test('standardizes spacing after initials', () => {
    expect(normalizeAuthor('B.V. Larson')).toBe('B. V. Larson');
    expect(normalizeAuthor('James S.A. Corey')).toBe('James S. A. Corey');
    expect(normalizeAuthor('J.R.R. Tolkien')).toBe('J. R. R. Tolkien');
  });

  test('does not add extra space when initials already spaced', () => {
    expect(normalizeAuthor('B. V. Larson')).toBe('B. V. Larson');
    expect(normalizeAuthor('James S. A. Corey')).toBe('James S. A. Corey');
    expect(normalizeAuthor('J. R. R. Tolkien')).toBe('J. R. R. Tolkien');
  });

  test('does not affect lowercase initials', () => {
    expect(normalizeAuthor('e.e. cummings')).toBe('e.e. cummings');
  });

  test('handles compound authors with initials', () => {
    expect(normalizeAuthor('B.V. Larson, David VanDyke')).toBe('B. V. Larson, David VanDyke');
  });
});
