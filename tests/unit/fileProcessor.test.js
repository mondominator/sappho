/**
 * Unit tests for File Processor Service
 * Tests metadata extraction logic, filename sanitization, and file organization patterns
 */

describe('File Processor - Utility Functions', () => {
  describe('Genre filtering (looksLikeGenres)', () => {
    // Extracted from fileProcessor.js - used to filter out genre/category values from series detection
    function looksLikeGenres(val) {
      if (!val) return true;
      // If it contains multiple commas or semicolons, likely genre list
      if ((val.match(/,/g) || []).length >= 2) return true;
      if ((val.match(/;/g) || []).length >= 1) return true;
      // Common genre keywords that wouldn't be in a series name
      const genreKeywords = /\b(fiction|non-fiction|nonfiction|thriller|mystery|romance|fantasy|horror|biography|history|science|self-help|audiobook|novel|literature)\b/i;
      if (genreKeywords.test(val)) return true;
      return false;
    }

    it('returns true for null value', () => {
      expect(looksLikeGenres(null)).toBe(true);
    });

    it('returns true for empty string', () => {
      expect(looksLikeGenres('')).toBe(true);
    });

    it('detects multiple commas as genre list', () => {
      expect(looksLikeGenres('Fiction, Mystery, Thriller')).toBe(true);
    });

    it('detects semicolon-separated genres', () => {
      expect(looksLikeGenres('Fiction; Audiobook')).toBe(true);
    });

    it('detects fiction keyword', () => {
      expect(looksLikeGenres('General Fiction')).toBe(true);
    });

    it('detects thriller keyword', () => {
      expect(looksLikeGenres('Political Thriller')).toBe(true);
    });

    it('detects mystery keyword', () => {
      expect(looksLikeGenres('Cozy Mystery')).toBe(true);
    });

    it('detects audiobook keyword', () => {
      expect(looksLikeGenres('Audiobook Collection')).toBe(true);
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
