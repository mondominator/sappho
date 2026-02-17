/**
 * Unit tests for content hash utilities
 */

const {
  generateBestHash,
  _internal: { generateContentHash, generateFilePathHash }
} = require('../../server/utils/contentHash');

describe('Content Hash Utilities', () => {
  describe('generateBestHash', () => {
    test('generates consistent hash for same inputs', () => {
      const hash1 = generateBestHash({ title: 'The Great Gatsby', author: 'F. Scott Fitzgerald', duration: 28800 }, '/path/to/file.m4b');
      const hash2 = generateBestHash({ title: 'The Great Gatsby', author: 'F. Scott Fitzgerald', duration: 28800 }, '/path/to/file.m4b');
      expect(hash1).toBe(hash2);
    });

    test('generates 32-character hex hash', () => {
      const hash = generateBestHash({ title: 'Test Book', author: 'Test Author', duration: 3600 }, '/path/to/file.m4b');
      expect(hash).toHaveLength(32);
      expect(/^[a-f0-9]+$/.test(hash)).toBe(true);
    });

    test('normalizes title to lowercase', () => {
      const hash1 = generateBestHash({ title: 'THE GREAT GATSBY', author: 'Author', duration: 1000 }, '/path/to/file.m4b');
      const hash2 = generateBestHash({ title: 'the great gatsby', author: 'Author', duration: 1000 }, '/path/to/file.m4b');
      expect(hash1).toBe(hash2);
    });

    test('normalizes author to lowercase', () => {
      const hash1 = generateBestHash({ title: 'Book', author: 'F. SCOTT FITZGERALD', duration: 1000 }, '/path/to/file.m4b');
      const hash2 = generateBestHash({ title: 'Book', author: 'f. scott fitzgerald', duration: 1000 }, '/path/to/file.m4b');
      expect(hash1).toBe(hash2);
    });

    test('trims whitespace from inputs', () => {
      const hash1 = generateBestHash({ title: '  Book  ', author: '  Author  ', duration: 1000 }, '/path/to/file.m4b');
      const hash2 = generateBestHash({ title: 'Book', author: 'Author', duration: 1000 }, '/path/to/file.m4b');
      expect(hash1).toBe(hash2);
    });

    test('floors duration to integer', () => {
      const hash1 = generateBestHash({ title: 'Book', author: 'Author', duration: 1000.7 }, '/path/to/file.m4b');
      const hash2 = generateBestHash({ title: 'Book', author: 'Author', duration: 1000.2 }, '/path/to/file.m4b');
      expect(hash1).toBe(hash2);
    });

    test('handles null/undefined title with author and duration (falls back to file path)', () => {
      const hash1 = generateBestHash({ title: null, author: 'Author', duration: 1000 }, '/path/to/file.m4b');
      const hash2 = generateBestHash({ title: undefined, author: 'Author', duration: 1000 }, '/path/to/file.m4b');
      expect(hash1).toBe(hash2);
    });

    test('different inputs produce different hashes', () => {
      const hash1 = generateBestHash({ title: 'Book A', author: 'Author A', duration: 1000 }, '/path/to/file.m4b');
      const hash2 = generateBestHash({ title: 'Book B', author: 'Author B', duration: 2000 }, '/path/to/file.m4b');
      expect(hash1).not.toBe(hash2);
    });

    test('duration affects hash', () => {
      const hash1 = generateBestHash({ title: 'Book', author: 'Author', duration: 1000 }, '/path/to/file.m4b');
      const hash2 = generateBestHash({ title: 'Book', author: 'Author', duration: 2000 }, '/path/to/file.m4b');
      expect(hash1).not.toBe(hash2);
    });

    test('uses content hash when title and author available', () => {
      const metadata = { title: 'Book', author: 'Author', duration: 1000 };
      // Same metadata with different file paths should produce the same hash
      // (content hash is based on metadata, not file path)
      const hash1 = generateBestHash(metadata, '/path/a/file.m4b');
      const hash2 = generateBestHash(metadata, '/path/b/file.m4b');
      expect(hash1).toBe(hash2);
    });

    test('uses content hash when title and duration available (no author)', () => {
      const metadata = { title: 'Book', duration: 1000 };
      // Same metadata with different file paths should produce the same hash
      const hash1 = generateBestHash(metadata, '/path/a/file.m4b');
      const hash2 = generateBestHash(metadata, '/path/b/file.m4b');
      expect(hash1).toBe(hash2);
    });

    test('falls back to file path hash when only title available', () => {
      const metadata = { title: 'Book' };
      // Different file paths should produce different hashes (file path based)
      const hash1 = generateBestHash(metadata, '/path/a/file.m4b');
      const hash2 = generateBestHash(metadata, '/path/b/file.m4b');
      expect(hash1).not.toBe(hash2);
    });

    test('falls back to file path hash when no metadata', () => {
      const metadata = {};
      // Different file paths should produce different hashes
      const hash1 = generateBestHash(metadata, '/path/a/file.m4b');
      const hash2 = generateBestHash(metadata, '/path/b/file.m4b');
      expect(hash1).not.toBe(hash2);
    });

    test('falls back to file path hash when metadata is null', () => {
      const hash = generateBestHash(null, '/path/to/file.m4b');
      expect(hash).toHaveLength(32);
      expect(/^[a-f0-9]+$/.test(hash)).toBe(true);
    });

    test('falls back to file path hash when metadata is undefined', () => {
      const hash = generateBestHash(undefined, '/path/to/file.m4b');
      expect(hash).toHaveLength(32);
      expect(/^[a-f0-9]+$/.test(hash)).toBe(true);
    });

    test('null and undefined metadata produce same hash for same file path', () => {
      const hash1 = generateBestHash(null, '/path/to/file.m4b');
      const hash2 = generateBestHash(undefined, '/path/to/file.m4b');
      expect(hash1).toBe(hash2);
    });

    test('file path hash normalizes case', () => {
      const hash1 = generateBestHash(null, '/PATH/TO/FILE.M4B');
      const hash2 = generateBestHash(null, '/path/to/file.m4b');
      expect(hash1).toBe(hash2);
    });

    test('file path hash trims whitespace', () => {
      const hash1 = generateBestHash(null, '  /path/to/file.m4b  ');
      const hash2 = generateBestHash(null, '/path/to/file.m4b');
      expect(hash1).toBe(hash2);
    });

    test('handles null duration with title and author', () => {
      const hash1 = generateBestHash({ title: 'Book', author: 'Author', duration: null }, '/path/to/file.m4b');
      const hash2 = generateBestHash({ title: 'Book', author: 'Author', duration: 0 }, '/path/to/file.m4b');
      expect(hash1).toBe(hash2);
    });

    test('handles undefined duration with title and author', () => {
      const hash1 = generateBestHash({ title: 'Book', author: 'Author', duration: undefined }, '/path/to/file.m4b');
      const hash2 = generateBestHash({ title: 'Book', author: 'Author', duration: 0 }, '/path/to/file.m4b');
      expect(hash1).toBe(hash2);
    });

    test('handles empty string title', () => {
      const hash1 = generateBestHash({ title: '', author: 'Author', duration: 1000 }, '/path/to/file1.m4b');
      const hash2 = generateBestHash({ title: '', author: 'Author', duration: 1000 }, '/path/to/file2.m4b');
      // Should fall back to file path since title is empty
      expect(hash1).not.toBe(hash2);
    });

    test('handles empty string author', () => {
      const hash1 = generateBestHash({ title: 'Book', author: '', duration: 1000 }, '/path/to/file1.m4b');
      const hash2 = generateBestHash({ title: 'Book', author: '', duration: 1000 }, '/path/to/file2.m4b');
      // Should use content hash since title + duration are present
      expect(hash1).toBe(hash2);
    });

    test('handles null file path', () => {
      const hash = generateBestHash({ title: 'Only Title' }, null);
      expect(hash).toHaveLength(32);
      expect(/^[a-f0-9]+$/.test(hash)).toBe(true);
    });

    test('handles undefined file path', () => {
      const hash = generateBestHash({ title: 'Only Title' }, undefined);
      expect(hash).toHaveLength(32);
      expect(/^[a-f0-9]+$/.test(hash)).toBe(true);
    });

    test('handles empty string file path', () => {
      const hash = generateBestHash({ title: 'Only Title' }, '');
      expect(hash).toHaveLength(32);
      expect(/^[a-f0-9]+$/.test(hash)).toBe(true);
    });

    test('null/undefined/empty file paths produce same hash', () => {
      const hash1 = generateBestHash({}, null);
      const hash2 = generateBestHash({}, undefined);
      const hash3 = generateBestHash({}, '');
      expect(hash1).toBe(hash2);
      expect(hash2).toBe(hash3);
    });
  });

  // Direct tests for internal functions to achieve 100% branch coverage
  describe('generateContentHash (internal)', () => {
    test('handles null title', () => {
      const hash = generateContentHash(null, 'Author', 1000);
      expect(hash).toHaveLength(32);
    });

    test('handles undefined title', () => {
      const hash = generateContentHash(undefined, 'Author', 1000);
      expect(hash).toHaveLength(32);
    });

    test('handles empty string title', () => {
      const hash = generateContentHash('', 'Author', 1000);
      expect(hash).toHaveLength(32);
    });
  });

  describe('generateFilePathHash (internal)', () => {
    test('handles null file path', () => {
      const hash = generateFilePathHash(null);
      expect(hash).toHaveLength(32);
    });

    test('handles undefined file path', () => {
      const hash = generateFilePathHash(undefined);
      expect(hash).toHaveLength(32);
    });

    test('handles empty string file path', () => {
      const hash = generateFilePathHash('');
      expect(hash).toHaveLength(32);
    });
  });
});
