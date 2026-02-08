/**
 * Unit tests for FTS5 search utilities
 * Tests the sanitizeFtsQuery function which transforms user input
 * into safe FTS5 query strings.
 */

const { sanitizeFtsQuery } = require('../../server/utils/ftsSearch');

describe('sanitizeFtsQuery', () => {
  // --- Basic functionality ---

  test('converts a single word to quoted prefix query', () => {
    expect(sanitizeFtsQuery('sanderson')).toBe('"sanderson"*');
  });

  test('converts multiple words to space-separated quoted prefix queries', () => {
    expect(sanitizeFtsQuery('brandon sanderson')).toBe('"brandon"* "sanderson"*');
  });

  test('handles three or more words', () => {
    expect(sanitizeFtsQuery('the way of kings')).toBe('"the"* "way"* "of"* "kings"*');
  });

  // --- Empty/invalid input ---

  test('returns empty string for null input', () => {
    expect(sanitizeFtsQuery(null)).toBe('');
  });

  test('returns empty string for undefined input', () => {
    expect(sanitizeFtsQuery(undefined)).toBe('');
  });

  test('returns empty string for empty string', () => {
    expect(sanitizeFtsQuery('')).toBe('');
  });

  test('returns empty string for whitespace-only input', () => {
    expect(sanitizeFtsQuery('   ')).toBe('');
  });

  test('returns empty string for non-string input (number)', () => {
    expect(sanitizeFtsQuery(123)).toBe('');
  });

  test('returns empty string for non-string input (object)', () => {
    expect(sanitizeFtsQuery({})).toBe('');
  });

  test('returns empty string for non-string input (boolean)', () => {
    expect(sanitizeFtsQuery(true)).toBe('');
  });

  // --- Special character stripping ---

  test('strips double quotes from input', () => {
    expect(sanitizeFtsQuery('the "great" gatsby')).toBe('"the"* "great"* "gatsby"*');
  });

  test('strips asterisks from input', () => {
    expect(sanitizeFtsQuery('test*')).toBe('"test"*');
  });

  test('strips parentheses from input', () => {
    expect(sanitizeFtsQuery('(hello) world')).toBe('"hello"* "world"*');
  });

  test('strips curly braces from input', () => {
    expect(sanitizeFtsQuery('{test}')).toBe('"test"*');
  });

  test('strips caret from input', () => {
    expect(sanitizeFtsQuery('test^2')).toBe('"test2"*');
  });

  test('strips tilde from input', () => {
    expect(sanitizeFtsQuery('test~')).toBe('"test"*');
  });

  test('strips colons from input', () => {
    expect(sanitizeFtsQuery('title:sanderson')).toBe('"titlesanderson"*');
  });

  test('strips multiple special characters at once', () => {
    expect(sanitizeFtsQuery('"test*" (hello)')).toBe('"test"* "hello"*');
  });

  test('returns empty string when only special characters', () => {
    expect(sanitizeFtsQuery('"*(){}^~:')).toBe('');
  });

  // --- FTS5 boolean keyword filtering ---

  test('strips AND keyword', () => {
    expect(sanitizeFtsQuery('brandon AND sanderson')).toBe('"brandon"* "sanderson"*');
  });

  test('strips OR keyword', () => {
    expect(sanitizeFtsQuery('brandon OR sanderson')).toBe('"brandon"* "sanderson"*');
  });

  test('strips NOT keyword', () => {
    expect(sanitizeFtsQuery('NOT sanderson')).toBe('"sanderson"*');
  });

  test('strips NEAR keyword', () => {
    expect(sanitizeFtsQuery('NEAR sanderson')).toBe('"sanderson"*');
  });

  test('strips keywords case-insensitively', () => {
    expect(sanitizeFtsQuery('and or not near')).toBe('');
  });

  test('returns empty string when only boolean keywords', () => {
    expect(sanitizeFtsQuery('AND OR NOT')).toBe('');
  });

  test('preserves words containing boolean keywords as substrings', () => {
    // "android" contains "and", "north" contains "not" - these should be kept
    expect(sanitizeFtsQuery('android north')).toBe('"android"* "north"*');
  });

  // --- Whitespace handling ---

  test('handles multiple spaces between words', () => {
    expect(sanitizeFtsQuery('brandon    sanderson')).toBe('"brandon"* "sanderson"*');
  });

  test('handles tabs between words', () => {
    expect(sanitizeFtsQuery('brandon\tsanderson')).toBe('"brandon"* "sanderson"*');
  });

  test('handles leading and trailing whitespace', () => {
    expect(sanitizeFtsQuery('  brandon sanderson  ')).toBe('"brandon"* "sanderson"*');
  });

  test('handles newlines in input', () => {
    expect(sanitizeFtsQuery('brandon\nsanderson')).toBe('"brandon"* "sanderson"*');
  });

  // --- Real-world search scenarios ---

  test('handles typical audiobook title search', () => {
    expect(sanitizeFtsQuery('Way of Kings')).toBe('"Way"* "of"* "Kings"*');
  });

  test('handles author name search', () => {
    expect(sanitizeFtsQuery('Stephen King')).toBe('"Stephen"* "King"*');
  });

  test('handles partial search for prefix matching', () => {
    expect(sanitizeFtsQuery('bran')).toBe('"bran"*');
  });

  test('handles narrator search', () => {
    expect(sanitizeFtsQuery('Michael Kramer')).toBe('"Michael"* "Kramer"*');
  });

  test('handles series search', () => {
    expect(sanitizeFtsQuery('Stormlight Archive')).toBe('"Stormlight"* "Archive"*');
  });

  test('handles search with numbers', () => {
    expect(sanitizeFtsQuery('book 3')).toBe('"book"* "3"*');
  });

  test('handles search with hyphenated words', () => {
    expect(sanitizeFtsQuery('sci-fi adventure')).toBe('"sci-fi"* "adventure"*');
  });

  test('handles search with apostrophes', () => {
    expect(sanitizeFtsQuery("King's cage")).toBe('"King\'s"* "cage"*');
  });
});
