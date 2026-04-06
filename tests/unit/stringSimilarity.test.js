const {
  levenshteinSimilarity,
  normalizeTitle,
  isChapterStyleTitle,
} = require('../../server/utils/stringSimilarity');

describe('stringSimilarity', () => {
  describe('levenshteinSimilarity', () => {
    it('returns 1 for identical strings', () => {
      expect(levenshteinSimilarity('hello', 'hello')).toBe(1);
    });

    it('returns 0 for completely different strings', () => {
      expect(levenshteinSimilarity('abc', 'xyz')).toBe(0);
    });

    it('returns 0 when both strings are empty', () => {
      expect(levenshteinSimilarity('', '')).toBe(0);
    });

    it('handles one empty string', () => {
      expect(levenshteinSimilarity('hello', '')).toBe(0);
    });

    it('calculates similarity for similar strings', () => {
      const sim = levenshteinSimilarity('kitten', 'sitting');
      expect(sim).toBeGreaterThan(0.5);
      expect(sim).toBeLessThan(0.8);
    });

    it('rejects Canticle vs Blood Canticle (false positive)', () => {
      const sim = levenshteinSimilarity('canticle', 'blood canticle');
      expect(sim).toBeLessThan(0.85);
    });

    it('rejects Skyward ReDawn vs Skyward Evershore (false positive)', () => {
      const sim = levenshteinSimilarity('skyward redawn', 'skyward evershore');
      expect(sim).toBeLessThan(0.85);
    });

    it('accepts Storm Assault vs Storm Assault (true positive)', () => {
      const sim = levenshteinSimilarity('storm assault', 'storm assault');
      expect(sim).toBe(1);
    });

    it('is symmetric', () => {
      expect(levenshteinSimilarity('abc', 'abcd')).toBe(levenshteinSimilarity('abcd', 'abc'));
    });

    it('coerces non-string input to empty string', () => {
      expect(levenshteinSimilarity(123, 'hello')).toBe(0);
      expect(levenshteinSimilarity('hello', 42)).toBe(0);
      expect(levenshteinSimilarity(null, undefined)).toBe(0);
    });
  });

  describe('normalizeTitle', () => {
    it('lowercases and strips non-alphanumeric', () => {
      expect(normalizeTitle("Harry Potter: The Boy's Tale")).toBe('harry potter the boys tale');
    });

    it('collapses whitespace', () => {
      expect(normalizeTitle('  hello   world  ')).toBe('hello world');
    });

    it('handles null/undefined', () => {
      expect(normalizeTitle(null)).toBe('');
      expect(normalizeTitle(undefined)).toBe('');
    });

    it('strips accented characters', () => {
      expect(normalizeTitle('Café au Lait')).toBe('caf au lait');
    });

    it('handles numbers-only titles', () => {
      expect(normalizeTitle('1984')).toBe('1984');
    });
  });

  describe('isChapterStyleTitle', () => {
    test.each([
      ['Chapter 1', true],
      ['chapter_2', true],
      ['Chapter-3', true],
      ['CHAPTER 1', true],
      ['Ch 1', true],
      ['Ch. 5', true],
      ['Part 1', true],
      ['Pt 2', true],
      ['Pt. 3', true],
      ['Track 1', true],
      ['Disc 2', true],
      ['CD 1', true],
      ['  Chapter 1  ', true], // leading/trailing whitespace
    ])('"%s" → matches', (input, expected) => {
      expect(isChapterStyleTitle(input)).toBe(expected);
    });

    test.each([
      ['The Hobbit', false],
      ['A Song of Ice and Fire', false],
      ['Chapterhouse: Dune', false], // word starting with "chapter" but not chapter marker
      ['', false],
      [null, false],
      [undefined, false],
    ])('"%s" → no match', (input, expected) => {
      expect(isChapterStyleTitle(input)).toBe(expected);
    });
  });
});
