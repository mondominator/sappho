/**
 * Unit tests for content hash utilities
 */

const {
  generateContentHash,
  generateFilePathHash,
  generateBestHash
} = require('../../server/utils/contentHash');

describe('Content Hash Utilities', () => {
  describe('generateContentHash', () => {
    test('generates consistent hash for same inputs', () => {
      const hash1 = generateContentHash('The Great Gatsby', 'F. Scott Fitzgerald', 28800);
      const hash2 = generateContentHash('The Great Gatsby', 'F. Scott Fitzgerald', 28800);
      expect(hash1).toBe(hash2);
    });

    test('generates 16-character hex hash', () => {
      const hash = generateContentHash('Test Book', 'Test Author', 3600);
      expect(hash).toHaveLength(16);
      expect(/^[a-f0-9]+$/.test(hash)).toBe(true);
    });

    test('normalizes title to lowercase', () => {
      const hash1 = generateContentHash('THE GREAT GATSBY', 'Author', 1000);
      const hash2 = generateContentHash('the great gatsby', 'Author', 1000);
      expect(hash1).toBe(hash2);
    });

    test('normalizes author to lowercase', () => {
      const hash1 = generateContentHash('Book', 'F. SCOTT FITZGERALD', 1000);
      const hash2 = generateContentHash('Book', 'f. scott fitzgerald', 1000);
      expect(hash1).toBe(hash2);
    });

    test('trims whitespace from inputs', () => {
      const hash1 = generateContentHash('  Book  ', '  Author  ', 1000);
      const hash2 = generateContentHash('Book', 'Author', 1000);
      expect(hash1).toBe(hash2);
    });

    test('floors duration to integer', () => {
      const hash1 = generateContentHash('Book', 'Author', 1000.7);
      const hash2 = generateContentHash('Book', 'Author', 1000.2);
      expect(hash1).toBe(hash2);
    });

    test('handles null/undefined title', () => {
      const hash1 = generateContentHash(null, 'Author', 1000);
      const hash2 = generateContentHash(undefined, 'Author', 1000);
      expect(hash1).toBe(hash2);
    });

    test('handles null/undefined author', () => {
      const hash1 = generateContentHash('Book', null, 1000);
      const hash2 = generateContentHash('Book', undefined, 1000);
      expect(hash1).toBe(hash2);
    });

    test('handles null/undefined duration', () => {
      const hash1 = generateContentHash('Book', 'Author', null);
      const hash2 = generateContentHash('Book', 'Author', undefined);
      expect(hash1).toBe(hash2);
    });

    test('different inputs produce different hashes', () => {
      const hash1 = generateContentHash('Book A', 'Author A', 1000);
      const hash2 = generateContentHash('Book B', 'Author B', 2000);
      expect(hash1).not.toBe(hash2);
    });

    test('duration affects hash', () => {
      const hash1 = generateContentHash('Book', 'Author', 1000);
      const hash2 = generateContentHash('Book', 'Author', 2000);
      expect(hash1).not.toBe(hash2);
    });
  });

  describe('generateFilePathHash', () => {
    test('generates consistent hash for same path', () => {
      const hash1 = generateFilePathHash('/path/to/audiobook.m4b');
      const hash2 = generateFilePathHash('/path/to/audiobook.m4b');
      expect(hash1).toBe(hash2);
    });

    test('generates 16-character hex hash', () => {
      const hash = generateFilePathHash('/some/path/file.mp3');
      expect(hash).toHaveLength(16);
      expect(/^[a-f0-9]+$/.test(hash)).toBe(true);
    });

    test('normalizes path to lowercase', () => {
      const hash1 = generateFilePathHash('/PATH/TO/FILE.M4B');
      const hash2 = generateFilePathHash('/path/to/file.m4b');
      expect(hash1).toBe(hash2);
    });

    test('trims whitespace', () => {
      const hash1 = generateFilePathHash('  /path/to/file.m4b  ');
      const hash2 = generateFilePathHash('/path/to/file.m4b');
      expect(hash1).toBe(hash2);
    });

    test('handles null/undefined path', () => {
      const hash1 = generateFilePathHash(null);
      const hash2 = generateFilePathHash(undefined);
      expect(hash1).toBe(hash2);
    });

    test('different paths produce different hashes', () => {
      const hash1 = generateFilePathHash('/path/a/file.m4b');
      const hash2 = generateFilePathHash('/path/b/file.m4b');
      expect(hash1).not.toBe(hash2);
    });
  });

  describe('generateBestHash', () => {
    test('uses content hash when title and author available', () => {
      const metadata = { title: 'Book', author: 'Author', duration: 1000 };
      const filePath = '/path/to/file.m4b';

      const bestHash = generateBestHash(metadata, filePath);
      const contentHash = generateContentHash('Book', 'Author', 1000);

      expect(bestHash).toBe(contentHash);
    });

    test('uses content hash when title and duration available (no author)', () => {
      const metadata = { title: 'Book', duration: 1000 };
      const filePath = '/path/to/file.m4b';

      const bestHash = generateBestHash(metadata, filePath);
      const contentHash = generateContentHash('Book', undefined, 1000);

      expect(bestHash).toBe(contentHash);
    });

    test('falls back to file path hash when only title available', () => {
      const metadata = { title: 'Book' };
      const filePath = '/path/to/file.m4b';

      const bestHash = generateBestHash(metadata, filePath);
      const filePathHash = generateFilePathHash(filePath);

      expect(bestHash).toBe(filePathHash);
    });

    test('falls back to file path hash when no metadata', () => {
      const metadata = {};
      const filePath = '/path/to/file.m4b';

      const bestHash = generateBestHash(metadata, filePath);
      const filePathHash = generateFilePathHash(filePath);

      expect(bestHash).toBe(filePathHash);
    });

    test('falls back to file path hash when metadata is null', () => {
      const filePath = '/path/to/file.m4b';

      const bestHash = generateBestHash(null, filePath);
      const filePathHash = generateFilePathHash(filePath);

      expect(bestHash).toBe(filePathHash);
    });

    test('falls back to file path hash when metadata is undefined', () => {
      const filePath = '/path/to/file.m4b';

      const bestHash = generateBestHash(undefined, filePath);
      const filePathHash = generateFilePathHash(filePath);

      expect(bestHash).toBe(filePathHash);
    });
  });
});
