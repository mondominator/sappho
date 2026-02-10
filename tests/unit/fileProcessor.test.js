/**
 * Unit tests for File Processor Service
 * Tests metadata extraction logic, filename sanitization, and file organization patterns
 */

describe('File Processor - Utility Functions', () => {
  describe('Genre filtering (looksLikeGenres)', () => {
    // Extracted from fileProcessor.js - used to filter out genre/category values from series detection
    // Only applied to ambiguous tags, not explicit series tags
    function looksLikeGenres(val) {
      if (!val) return true;
      const commaCount = (val.match(/,/g) || []).length;
      const semicolonCount = (val.match(/;/g) || []).length;

      // Strong signal: many separators suggest a list, not a series name
      if (commaCount >= 3) return true;
      if (semicolonCount >= 2) return true;

      // Moderate signal: separators + genre keywords suggest genre list
      if (commaCount >= 1 || semicolonCount >= 1) {
        const genreKeywords = /\b(fiction|nonfiction|non-fiction|mystery|thriller|romance|fantasy|horror|sci-fi|science fiction|biography|history|drama|comedy|adventure|literary|suspense|crime|detective|young adult|children|self-help|memoir|poetry|western|dystopian|paranormal)\b/i;
        if (genreKeywords.test(val)) return true;
      }

      return false;
    }

    it('returns true for null value', () => {
      expect(looksLikeGenres(null)).toBe(true);
    });

    it('returns true for empty string', () => {
      expect(looksLikeGenres('')).toBe(true);
    });

    it('detects many commas as genre list', () => {
      expect(looksLikeGenres('Fiction, Mystery, Thriller, Drama')).toBe(true);
    });

    it('detects commas with genre keywords as genre list', () => {
      expect(looksLikeGenres('Fiction, Mystery')).toBe(true);
    });

    it('detects semicolons with genre keywords as genre list', () => {
      expect(looksLikeGenres('Fiction; Thriller')).toBe(true);
    });

    it('detects many semicolons as genre list', () => {
      expect(looksLikeGenres('Fiction;Thriller;Drama')).toBe(true);
    });

    it('allows series with one comma and no genre keywords', () => {
      expect(looksLikeGenres('Rivers of London, Book 1')).toBe(false);
    });

    it('allows series with one semicolon and no genre keywords', () => {
      expect(looksLikeGenres('The Expanse; Book 1')).toBe(false);
    });

    it('allows genre keyword without separators (not a list)', () => {
      expect(looksLikeGenres('General Fiction')).toBe(false);
    });

    it('returns false for valid series name', () => {
      expect(looksLikeGenres('The Lord of the Rings')).toBe(false);
    });

    it('returns false for series with number', () => {
      expect(looksLikeGenres('Harry Potter #1')).toBe(false);
    });

    it('returns false for simple series name', () => {
      expect(looksLikeGenres('The Eden Chronicles')).toBe(false);
    });
  });

  describe('Series extraction from title', () => {
    function extractSeriesFromTitle(title) {
      if (!title) return null;

      // Pattern: "Title: Series Name, Book N" or "Title (Series Name #N)"
      const seriesMatch = title.match(/:\s*([^,]+),\s*Book\s+(\d+)/i) ||
                         title.match(/\(([^#]+)#(\d+)\)/i) ||
                         title.match(/:\s*([^,]+)\s+(\d+)/i);

      if (seriesMatch) {
        return {
          series: seriesMatch[1].trim(),
          position: parseFloat(seriesMatch[2]),
        };
      }

      return null;
    }

    it('extracts series from "Title: Series, Book N" pattern', () => {
      const result = extractSeriesFromTitle('The Hobbit: Middle Earth, Book 1');
      expect(result).toEqual({ series: 'Middle Earth', position: 1 });
    });

    it('extracts series from "(Series #N)" pattern', () => {
      const result = extractSeriesFromTitle('Storm Front (Dresden Files #1)');
      expect(result).toEqual({ series: 'Dresden Files', position: 1 });
    });

    it('extracts series with high book number', () => {
      const result = extractSeriesFromTitle('Final Chapter: Epic Saga, Book 15');
      expect(result).toEqual({ series: 'Epic Saga', position: 15 });
    });

    it('returns null for title without series pattern', () => {
      const result = extractSeriesFromTitle('A Simple Book Title');
      expect(result).toBeNull();
    });

    it('returns null for null title', () => {
      const result = extractSeriesFromTitle(null);
      expect(result).toBeNull();
    });
  });

  describe('Series hash extraction (series #N pattern)', () => {
    function extractSeriesHash(seriesValue) {
      if (!seriesValue) return null;

      // Pattern: "Series Name #N" or "Series Name #1.5"
      const match = seriesValue.match(/^(.+?)\s*#(\d+(?:\.\d+)?)$/);
      if (match) {
        return {
          series: match[1].trim(),
          position: parseFloat(match[2]),
        };
      }

      return { series: seriesValue, position: null };
    }

    it('extracts series name and integer position', () => {
      const result = extractSeriesHash('The Eden Chronicles #1');
      expect(result).toEqual({ series: 'The Eden Chronicles', position: 1 });
    });

    it('extracts series name and decimal position', () => {
      const result = extractSeriesHash('Dresden Files #2.5');
      expect(result).toEqual({ series: 'Dresden Files', position: 2.5 });
    });

    it('handles series without hash pattern', () => {
      const result = extractSeriesHash('Standalone Series');
      expect(result).toEqual({ series: 'Standalone Series', position: null });
    });

    it('returns null for null input', () => {
      expect(extractSeriesHash(null)).toBeNull();
    });
  });

  describe('Folder name sanitization', () => {
    function sanitizeFolderName(name, defaultName = 'Unknown') {
      return (name || defaultName).replace(/[^a-z0-9\s]/gi, '_').trim();
    }

    it('preserves alphanumeric characters', () => {
      expect(sanitizeFolderName('John Smith')).toBe('John Smith');
    });

    it('replaces special characters with underscore', () => {
      expect(sanitizeFolderName('Author: Name')).toBe('Author_ Name');
    });

    it('replaces colons and slashes', () => {
      expect(sanitizeFolderName('Test: Part/1')).toBe('Test_ Part_1');
    });

    it('uses default for null input', () => {
      expect(sanitizeFolderName(null, 'Unknown Author')).toBe('Unknown Author');
    });

    it('uses default for empty string', () => {
      expect(sanitizeFolderName('', 'Unknown Title')).toBe('Unknown Title');
    });

    it('trims whitespace', () => {
      expect(sanitizeFolderName('  Name  ')).toBe('Name');
    });
  });

  describe('Cover art extension extraction', () => {
    function getCoverExtension(format) {
      return format.split('/')[1] || 'jpg';
    }

    it('extracts jpg from image/jpeg', () => {
      expect(getCoverExtension('image/jpeg')).toBe('jpeg');
    });

    it('extracts png from image/png', () => {
      expect(getCoverExtension('image/png')).toBe('png');
    });

    it('extracts webp from image/webp', () => {
      expect(getCoverExtension('image/webp')).toBe('webp');
    });

    it('defaults to jpg for invalid format', () => {
      expect(getCoverExtension('invalid')).toBe('jpg');
    });

    it('defaults to jpg for empty string', () => {
      expect(getCoverExtension('')).toBe('jpg');
    });
  });

  describe('Chapter listing detection', () => {
    function looksLikeChapters(text) {
      return /^(Chapter|Part|Track|\d+[.:\-)]|Dedication|Opening|Prologue)/i.test(text.trim());
    }

    it('detects Chapter prefix', () => {
      expect(looksLikeChapters('Chapter 1: The Beginning')).toBe(true);
    });

    it('detects Part prefix', () => {
      expect(looksLikeChapters('Part One')).toBe(true);
    });

    it('detects Track prefix', () => {
      expect(looksLikeChapters('Track 01')).toBe(true);
    });

    it('detects numeric prefix with period', () => {
      expect(looksLikeChapters('1. Introduction')).toBe(true);
    });

    it('detects numeric prefix with colon', () => {
      expect(looksLikeChapters('01: Opening')).toBe(true);
    });

    it('detects Prologue', () => {
      expect(looksLikeChapters('Prologue')).toBe(true);
    });

    it('detects Dedication', () => {
      expect(looksLikeChapters('Dedication')).toBe(true);
    });

    it('returns false for regular description', () => {
      expect(looksLikeChapters('This is a thrilling story about...')).toBe(false);
    });

    it('handles leading whitespace', () => {
      expect(looksLikeChapters('  Chapter 1')).toBe(true);
    });
  });

  describe('Copyright year extraction', () => {
    function extractCopyrightYear(cprt) {
      if (!cprt) return null;
      const yearMatch = String(cprt).match(/\d{4}/);
      return yearMatch ? parseInt(yearMatch[0], 10) : null;
    }

    it('extracts year from plain year', () => {
      expect(extractCopyrightYear('1985')).toBe(1985);
    });

    it('extracts year from copyright string', () => {
      expect(extractCopyrightYear('©1985 Publisher Name')).toBe(1985);
    });

    it('extracts year from copyright with (C)', () => {
      expect(extractCopyrightYear('(C) 2020 Author')).toBe(2020);
    });

    it('extracts first year from multiple years', () => {
      expect(extractCopyrightYear('2015, 2020 Publisher')).toBe(2015);
    });

    it('returns null for null input', () => {
      expect(extractCopyrightYear(null)).toBeNull();
    });

    it('returns null for string without year', () => {
      expect(extractCopyrightYear('No year here')).toBeNull();
    });
  });

  describe('Abridged value parsing', () => {
    function parseAbridged(value) {
      if (!value) return null;
      const valLower = String(value).toLowerCase();
      return valLower === 'yes' || valLower === '1' || valLower === 'true';
    }

    it('parses "yes" as true', () => {
      expect(parseAbridged('yes')).toBe(true);
    });

    it('parses "YES" as true (case insensitive)', () => {
      expect(parseAbridged('YES')).toBe(true);
    });

    it('parses "1" as true', () => {
      expect(parseAbridged('1')).toBe(true);
    });

    it('parses "true" as true', () => {
      expect(parseAbridged('true')).toBe(true);
    });

    it('parses "no" as false', () => {
      expect(parseAbridged('no')).toBe(false);
    });

    it('parses "0" as false', () => {
      expect(parseAbridged('0')).toBe(false);
    });

    it('parses "false" as false', () => {
      expect(parseAbridged('false')).toBe(false);
    });

    it('returns null for null input', () => {
      expect(parseAbridged(null)).toBeNull();
    });
  });

  describe('Published year extraction from rldt', () => {
    function extractPublishedYear(rldtValue) {
      if (!rldtValue) return null;
      const rldtStr = String(rldtValue);
      const yearMatch = rldtStr.match(/(\d{4})/);
      return yearMatch ? parseInt(yearMatch[1], 10) : null;
    }

    it('extracts year from ISO date format', () => {
      expect(extractPublishedYear('2009-01-01')).toBe(2009);
    });

    it('extracts year from text date format', () => {
      expect(extractPublishedYear('12-Dec-2023')).toBe(2023);
    });

    it('extracts year from plain year', () => {
      expect(extractPublishedYear('2015')).toBe(2015);
    });

    it('returns null for null input', () => {
      expect(extractPublishedYear(null)).toBeNull();
    });

    it('returns null for invalid date', () => {
      expect(extractPublishedYear('no date')).toBeNull();
    });
  });

  describe('Narrator extraction from composer', () => {
    function extractNarrator(composer) {
      if (!composer) return null;
      if (Array.isArray(composer)) {
        return composer[0] || null;
      }
      if (typeof composer === 'string') {
        return composer;
      }
      return null;
    }

    it('extracts from string composer', () => {
      expect(extractNarrator('John Smith')).toBe('John Smith');
    });

    it('extracts first from array composer', () => {
      expect(extractNarrator(['Jane Doe', 'John Smith'])).toBe('Jane Doe');
    });

    it('returns null for empty array', () => {
      expect(extractNarrator([])).toBeNull();
    });

    it('returns null for null input', () => {
      expect(extractNarrator(null)).toBeNull();
    });
  });

  describe('Title fallback from filename', () => {
    function getTitleFallback(filePath) {
      const path = require('path');
      return path.basename(filePath, path.extname(filePath));
    }

    it('extracts title from m4b file', () => {
      expect(getTitleFallback('/path/to/My Audiobook.m4b')).toBe('My Audiobook');
    });

    it('extracts title from mp3 file', () => {
      expect(getTitleFallback('/path/to/Book Title.mp3')).toBe('Book Title');
    });

    it('handles nested paths', () => {
      expect(getTitleFallback('/audiobooks/Author/Book/audio.m4a')).toBe('audio');
    });
  });

  describe('Description cleaning validation', () => {
    function isValidDescription(cleaned) {
      if (!cleaned) return false;
      // At least 50 characters after cleaning
      if (cleaned.length < 50) return false;
      // Doesn't start with common chapter patterns
      const looksLikeChapters = /^(Chapter|Part|Track|\d+[.:\-)]|Dedication|Opening|Prologue)/i.test(cleaned.trim());
      return !looksLikeChapters;
    }

    it('accepts long description', () => {
      const desc = 'This is a thrilling story about adventure and mystery that spans multiple continents.';
      expect(isValidDescription(desc)).toBe(true);
    });

    it('rejects short description', () => {
      expect(isValidDescription('Too short')).toBe(false);
    });

    it('rejects chapter listing', () => {
      const desc = 'Chapter 1: Introduction\nChapter 2: The Journey\nChapter 3: The End';
      expect(isValidDescription(desc)).toBe(false);
    });

    it('rejects null', () => {
      expect(isValidDescription(null)).toBe(false);
    });

    it('rejects empty string', () => {
      expect(isValidDescription('')).toBe(false);
    });
  });

  describe('File collision handling', () => {
    function getUniqueFilename(baseName, ext, existingFiles) {
      let filename = `${baseName}${ext}`;
      if (!existingFiles.includes(filename)) {
        return filename;
      }

      let counter = 1;
      while (existingFiles.includes(`${baseName}_${counter}${ext}`)) {
        counter++;
      }
      return `${baseName}_${counter}${ext}`;
    }

    it('returns base filename when no collision', () => {
      const result = getUniqueFilename('Book', '.m4b', []);
      expect(result).toBe('Book.m4b');
    });

    it('appends _1 for first collision', () => {
      const result = getUniqueFilename('Book', '.m4b', ['Book.m4b']);
      expect(result).toBe('Book_1.m4b');
    });

    it('appends _2 for second collision', () => {
      const result = getUniqueFilename('Book', '.m4b', ['Book.m4b', 'Book_1.m4b']);
      expect(result).toBe('Book_2.m4b');
    });

    it('handles multiple collisions', () => {
      const existing = ['Book.m4b', 'Book_1.m4b', 'Book_2.m4b', 'Book_3.m4b'];
      const result = getUniqueFilename('Book', '.m4b', existing);
      expect(result).toBe('Book_4.m4b');
    });
  });

  describe('Genre array joining', () => {
    function formatGenres(genres) {
      if (!genres) return null;
      return genres.join(', ');
    }

    it('joins multiple genres with comma', () => {
      expect(formatGenres(['Fiction', 'Mystery'])).toBe('Fiction, Mystery');
    });

    it('handles single genre', () => {
      expect(formatGenres(['Audiobook'])).toBe('Audiobook');
    });

    it('returns null for null input', () => {
      expect(formatGenres(null)).toBeNull();
    });

    it('handles empty array', () => {
      expect(formatGenres([])).toBe('');
    });
  });

  describe('Duration rounding', () => {
    function formatDuration(duration) {
      if (!duration) return null;
      return Math.round(duration);
    }

    it('rounds decimal duration', () => {
      expect(formatDuration(3600.5)).toBe(3601);
    });

    it('keeps integer duration', () => {
      expect(formatDuration(7200)).toBe(7200);
    });

    it('rounds down small decimals', () => {
      expect(formatDuration(3600.4)).toBe(3600);
    });

    it('returns null for null input', () => {
      expect(formatDuration(null)).toBeNull();
    });

    it('returns null for zero', () => {
      expect(formatDuration(0)).toBeNull();
    });
  });

  describe('Cover file name patterns', () => {
    function findCoverFile(directory, existingFiles) {
      const coverExtensions = ['.jpg', '.jpeg', '.png', '.webp'];
      const coverNames = ['cover', 'folder', 'album', 'front'];

      for (const name of coverNames) {
        for (const ext of coverExtensions) {
          const filename = `${name}${ext}`;
          if (existingFiles.includes(filename)) {
            return `${directory}/${filename}`;
          }
        }
      }
      return null;
    }

    it('finds cover.jpg', () => {
      const result = findCoverFile('/audiobook', ['audio.m4b', 'cover.jpg']);
      expect(result).toBe('/audiobook/cover.jpg');
    });

    it('finds folder.png', () => {
      const result = findCoverFile('/audiobook', ['audio.m4b', 'folder.png']);
      expect(result).toBe('/audiobook/folder.png');
    });

    it('prefers cover over folder', () => {
      const result = findCoverFile('/audiobook', ['folder.jpg', 'cover.jpg']);
      expect(result).toBe('/audiobook/cover.jpg');
    });

    it('returns null when no cover found', () => {
      const result = findCoverFile('/audiobook', ['audio.m4b', 'readme.txt']);
      expect(result).toBeNull();
    });

    it('finds album.webp', () => {
      const result = findCoverFile('/audiobook', ['album.webp']);
      expect(result).toBe('/audiobook/album.webp');
    });
  });
});

/**
 * Tests for actual fileProcessor.js module exports
 * These test extractFileMetadata with mocked music-metadata
 *
 * Strategy: music-metadata is ESM and loaded via dynamic import(). jest.doMock() doesn't
 * intercept import() calls, so we use jest.mock() at top level with a factory that returns
 * a controllable mock. Each test reconfigures the mockParseFile behavior before calling
 * extractFileMetadata.
 */

// music-metadata is ESM-only and import() doesn't work in Jest VM.
// Instead, we inject the mock via _setParseFile() after loading the module.
const mockParseFile = jest.fn();

// Top-level mocks for fileProcessor dependencies
jest.mock('../../server/database', () => ({
  run: jest.fn(),
  get: jest.fn(),
  all: jest.fn(),
}));
jest.mock('../../server/utils/db', () => ({
  createDbHelpers: jest.fn().mockReturnValue({ dbTransaction: jest.fn() }),
}));
jest.mock('../../server/services/metadataScraper', () => ({
  scrapeMetadata: jest.fn().mockResolvedValue({}),
}));
jest.mock('../../server/services/websocketManager', () => ({
  broadcastLibraryUpdate: jest.fn(),
}));
jest.mock('../../server/utils/contentHash', () => ({
  generateBestHash: jest.fn().mockReturnValue('hash123'),
}));
jest.mock('../../server/utils/cleanDescription', () => ({
  cleanDescription: jest.fn().mockImplementation(s => s),
}));
jest.mock('../../server/services/fileOrganizer', () => ({
  sanitizeName: jest.fn().mockImplementation(s => s || 'Unknown'),
}));

// Require after mocks are set up
const fileProcessor = require('../../server/services/fileProcessor');

/** Create a minimal metadata result from music-metadata parseFile */
function createMockMetadata(overrides = {}) {
  return {
    common: {
      title: 'Test Title',
      artist: 'Test Author',
      composer: null,
      album: null,
      genre: null,
      year: null,
      picture: null,
      description: null,
      movementName: null,
      movementIndex: null,
      disk: null,
      track: null,
      language: null,
      ...overrides.common,
    },
    format: {
      duration: 3600,
      ...overrides.format,
    },
    native: overrides.native || {},
  };
}

describe('File Processor - Module Exports', () => {
  beforeEach(() => {
    mockParseFile.mockReset();
    // Inject mock parseFile into the module (bypasses ESM import() issue)
    fileProcessor._setParseFile(mockParseFile);

    // Suppress console
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('extractFileMetadata', () => {
    it('extracts basic metadata (title, author, duration)', async () => {
      mockParseFile.mockResolvedValue(createMockMetadata());

      const result = await fileProcessor.extractFileMetadata('/test/book.m4b');

      expect(result.title).toBe('Test Title');
      expect(result.author).toBe('Test Author');
      expect(result.duration).toBe(3600);
    });

    it('extracts cover art from embedded picture', async () => {
      mockParseFile.mockResolvedValue(createMockMetadata({
        common: {
          picture: [{
            format: 'image/jpeg',
            data: Buffer.from('fake-image-data'),
          }],
        },
      }));

      const result = await fileProcessor.extractFileMetadata('/test/book.m4b');
      // Cover art is saved to a file and the path is returned
      expect(result.cover_image).not.toBeNull();
    });

    it('extracts series from movementName', async () => {
      mockParseFile.mockResolvedValue(createMockMetadata({
        common: {
          movementName: 'The Dark Tower',
          movementIndex: { no: 3 },
        },
      }));

      const result = await fileProcessor.extractFileMetadata('/test/book.m4b');
      expect(result.series).toBe('The Dark Tower');
      expect(result.series_position).toBe(3);
    });

    it('extracts series from iTunes SERIES tag', async () => {
      mockParseFile.mockResolvedValue(createMockMetadata({
        native: {
          iTunes: [
            { id: '----:com.apple.iTunes:SERIES', value: 'Discworld' },
            { id: '----:com.apple.iTunes:PART', value: '5' },
          ],
        },
      }));

      const result = await fileProcessor.extractFileMetadata('/test/book.m4b');
      expect(result.series).toBe('Discworld');
      expect(result.series_position).toBe(5);
    });

    it('extracts series with hash pattern from tag', async () => {
      mockParseFile.mockResolvedValue(createMockMetadata({
        native: {
          iTunes: [
            { id: '©mvn', value: 'The Expanse #3' },
          ],
        },
      }));

      const result = await fileProcessor.extractFileMetadata('/test/book.m4b');
      expect(result.series).toBe('The Expanse');
      expect(result.series_position).toBe(3);
    });

    it('filters genre-like values from ambiguous series tags', async () => {
      mockParseFile.mockResolvedValue(createMockMetadata({
        native: {
          iTunes: [
            { id: '©grp', value: 'Fiction, Mystery, Thriller, Drama' },
          ],
        },
      }));

      const result = await fileProcessor.extractFileMetadata('/test/book.m4b');
      expect(result.series).toBeNull();
    });

    it('extracts narrator from composer tag', async () => {
      mockParseFile.mockResolvedValue(createMockMetadata({
        common: { composer: 'Ray Porter' },
      }));

      const result = await fileProcessor.extractFileMetadata('/test/book.m4b');
      expect(result.narrator).toBe('Ray Porter');
    });

    it('extracts narrator from array composer', async () => {
      mockParseFile.mockResolvedValue(createMockMetadata({
        common: { composer: ['Steven Pacey', 'Joe Smith'] },
      }));

      const result = await fileProcessor.extractFileMetadata('/test/book.m4b');
      expect(result.narrator).toBe('Steven Pacey');
    });

    it('extracts narrator from explicit iTunes narrator tag over composer', async () => {
      mockParseFile.mockResolvedValue(createMockMetadata({
        common: { composer: 'Wrong Narrator' },
        native: {
          iTunes: [
            { id: '©nrt', value: 'Correct Narrator' },
          ],
        },
      }));

      const result = await fileProcessor.extractFileMetadata('/test/book.m4b');
      expect(result.narrator).toBe('Correct Narrator');
    });

    it('falls back to filename for title when tags are empty', async () => {
      mockParseFile.mockResolvedValue(createMockMetadata({
        common: { title: null, artist: null },
      }));

      const result = await fileProcessor.extractFileMetadata('/test/My Audiobook.m4b');
      expect(result.title).toBe('My Audiobook');
    });

    it('handles parseFile failure gracefully', async () => {
      mockParseFile.mockRejectedValue(new Error('Corrupt file'));

      const result = await fileProcessor.extractFileMetadata('/test/broken.m4b');
      expect(result.title).toBe('broken');
      expect(result.author).toBeNull();
      expect(result.duration).toBeNull();
    });

    it('extracts series from ID3v2 TXXX:SERIES tag', async () => {
      mockParseFile.mockResolvedValue(createMockMetadata({
        native: {
          'ID3v2.4': [
            { id: 'TXXX:SERIES', value: 'Wheel of Time' },
            { id: 'TXXX:PART', value: '7' },
          ],
        },
      }));

      const result = await fileProcessor.extractFileMetadata('/test/book.mp3');
      expect(result.series).toBe('Wheel of Time');
      expect(result.series_position).toBe(7);
    });

    it('extracts series from vorbis SERIES tag', async () => {
      mockParseFile.mockResolvedValue(createMockMetadata({
        native: {
          vorbis: [
            { id: 'SERIES', value: 'Gentleman Bastard' },
            { id: 'PART', value: '2' },
          ],
        },
      }));

      const result = await fileProcessor.extractFileMetadata('/test/book.flac');
      expect(result.series).toBe('Gentleman Bastard');
      expect(result.series_position).toBe(2);
    });

    it('extracts genre as comma-separated string', async () => {
      mockParseFile.mockResolvedValue(createMockMetadata({
        common: { genre: ['Fiction', 'Mystery'] },
      }));

      const result = await fileProcessor.extractFileMetadata('/test/book.m4b');
      expect(result.genre).toBe('Fiction, Mystery');
    });

    it('rejects short descriptions (under 50 chars)', async () => {
      mockParseFile.mockResolvedValue(createMockMetadata({
        common: { description: 'Too short' },
      }));

      const result = await fileProcessor.extractFileMetadata('/test/book.m4b');
      expect(result.description).toBeNull();
    });

    it('extracts published year from rldt tag', async () => {
      mockParseFile.mockResolvedValue(createMockMetadata({
        native: {
          iTunes: [
            { id: 'rldt', value: '2009-01-01' },
          ],
        },
      }));

      const result = await fileProcessor.extractFileMetadata('/test/book.m4b');
      expect(result.published_year).toBe(2009);
    });

    it('falls back to common.year for published year', async () => {
      mockParseFile.mockResolvedValue(createMockMetadata({
        common: { year: 2015 },
      }));

      const result = await fileProcessor.extractFileMetadata('/test/book.m4b');
      expect(result.published_year).toBe(2015);
    });
  });
});
