/**
 * Unit Tests for Similar Books Utilities
 *
 * Tests the multi-factor scoring algorithm and utility functions for
 * generating similar audiobook suggestions.
 */

const {
  calculateSimilarityScore,
  scoreBook,
  filterCompletedBooks,
  deduplicateCategories,
  limitResults
} = require('../../server/utils/similarBooks');

describe('Similar Books Utilities', () => {
  describe('calculateSimilarityScore', () => {
    const baseBook = {
      id: 1,
      title: 'Test Book',
      author: 'Test Author',
      narrator: 'Test Narrator',
      series: 'Test Series',
      genre: 'Fantasy',
      publisher: 'Test Publisher',
      duration: 3600 // 1 hour
    };

    it('returns 0 for completely different books', () => {
      const candidate = {
        id: 2,
        title: 'Different Book',
        author: 'Different Author',
        narrator: 'Different Narrator',
        series: 'Different Series',
        genre: 'Non-Fiction',
        publisher: 'Different Publisher',
        duration: 7200 // 2 hours (more than 20% different)
      };

      const score = calculateSimilarityScore(baseBook, candidate);
      expect(score).toBe(0);
    });

    it('awards 3 points for same series', () => {
      const candidate = {
        id: 2,
        title: 'Different Book',
        author: 'Different Author',
        narrator: 'Different Narrator',
        series: 'Test Series', // Same as base
        genre: 'Different Genre',
        publisher: 'Different Publisher',
        duration: 7200 // Different duration
      };

      const score = calculateSimilarityScore(baseBook, candidate);
      expect(score).toBe(3);
    });

    it('awards 2 points for same genre', () => {
      const candidate = {
        id: 2,
        title: 'Different Book',
        author: 'Different Author',
        narrator: 'Different Narrator',
        series: 'Different Series',
        genre: 'Fantasy', // Same as base
        publisher: 'Different Publisher',
        duration: 7200
      };

      const score = calculateSimilarityScore(baseBook, candidate);
      expect(score).toBe(2);
    });

    it('awards 1 point for same publisher', () => {
      const candidate = {
        id: 2,
        title: 'Different Book',
        author: 'Different Author',
        narrator: 'Different Narrator',
        series: 'Different Series',
        genre: 'Different Genre',
        publisher: 'Test Publisher', // Same as base
        duration: 7200
      };

      const score = calculateSimilarityScore(baseBook, candidate);
      expect(score).toBe(1);
    });

    it('awards 1 point for similar duration (±20%)', () => {
      const candidate = {
        id: 2,
        title: 'Different Book',
        author: 'Different Author',
        narrator: 'Different Narrator',
        series: 'Different Series',
        genre: 'Different Genre',
        publisher: 'Different Publisher',
        duration: 4000 // Within 20% of 3600
      };

      const score = calculateSimilarityScore(baseBook, candidate);
      expect(score).toBe(1);
    });

    it('awards 0 points for duration outside 20% threshold', () => {
      const candidate = {
        id: 2,
        title: 'Different Book',
        author: 'Different Author',
        narrator: 'Different Narrator',
        series: 'Different Series',
        genre: 'Different Genre',
        publisher: 'Different Publisher',
        duration: 5000 // Outside 20% of 3600
      };

      const score = calculateSimilarityScore(baseBook, candidate);
      expect(score).toBe(0);
    });

    it('sums points for multiple matching factors', () => {
      const candidate = {
        ...baseBook,
        id: 2,
        series: 'Test Series',
        genre: 'Fantasy',
        publisher: 'Test Publisher',
        duration: 4000
      };

      const score = calculateSimilarityScore(baseBook, candidate);
      expect(score).toBe(7); // 3 + 2 + 1 + 1
    });

    it('performs case-insensitive comparison for series', () => {
      const candidate = {
        id: 2,
        title: 'Different Book',
        author: 'Different Author',
        narrator: 'Different Narrator',
        series: 'test series', // Different case, same series
        genre: 'Different Genre',
        publisher: 'Different Publisher',
        duration: 7200
      };

      const score = calculateSimilarityScore(baseBook, candidate);
      expect(score).toBe(3);
    });

    it('performs case-insensitive comparison for genre', () => {
      const candidate = {
        id: 2,
        title: 'Different Book',
        author: 'Different Author',
        narrator: 'Different Narrator',
        series: 'Different Series',
        genre: 'fantasy', // Different case, same genre
        publisher: 'Different Publisher',
        duration: 7200
      };

      const score = calculateSimilarityScore(baseBook, candidate);
      expect(score).toBe(2);
    });

    it('performs case-insensitive comparison for publisher', () => {
      const candidate = {
        id: 2,
        title: 'Different Book',
        author: 'Different Author',
        narrator: 'Different Narrator',
        series: 'Different Series',
        genre: 'Different Genre',
        publisher: 'test publisher', // Different case, same publisher
        duration: 7200
      };

      const score = calculateSimilarityScore(baseBook, candidate);
      expect(score).toBe(1);
    });

    it('does not award series points for same book ID', () => {
      const candidate = {
        id: 1, // Same ID as base
        title: 'Different Book',
        author: 'Different Author',
        narrator: 'Different Narrator',
        series: 'Test Series',
        genre: 'Different Genre',
        publisher: 'Different Publisher',
        duration: 7200
      };

      const score = calculateSimilarityScore(baseBook, candidate);
      expect(score).toBe(0); // No points because same ID
    });

    it('handles missing series in base book', () => {
      const noSeriesBase = { ...baseBook, series: null };
      const candidate = {
        id: 2,
        title: 'Different Book',
        author: 'Different Author',
        narrator: 'Different Narrator',
        series: 'Test Series',
        genre: 'Different Genre',
        publisher: 'Different Publisher',
        duration: 7200
      };

      const score = calculateSimilarityScore(noSeriesBase, candidate);
      expect(score).toBe(0);
    });

    it('handles missing series in candidate book', () => {
      const noSeriesCandidate = {
        id: 2,
        title: 'Different Book',
        author: 'Different Author',
        narrator: 'Different Narrator',
        series: null,
        genre: 'Different Genre',
        publisher: 'Different Publisher',
        duration: 7200
      };

      const score = calculateSimilarityScore(baseBook, noSeriesCandidate);
      expect(score).toBe(0);
    });

    it('handles missing genre in both books', () => {
      const noGenreBase = { ...baseBook, genre: null };
      const noGenreCandidate = {
        id: 2,
        title: 'Different Book',
        author: 'Different Author',
        narrator: 'Different Narrator',
        series: 'Different Series',
        genre: null,
        publisher: 'Different Publisher',
        duration: 7200
      };

      const score = calculateSimilarityScore(noGenreBase, noGenreCandidate);
      expect(score).toBe(0);
    });

    it('handles missing publisher in both books', () => {
      const noPublisherBase = { ...baseBook, publisher: null };
      const noPublisherCandidate = {
        id: 2,
        title: 'Different Book',
        author: 'Different Author',
        narrator: 'Different Narrator',
        series: 'Different Series',
        genre: 'Different Genre',
        publisher: null,
        duration: 7200
      };

      const score = calculateSimilarityScore(noPublisherBase, noPublisherCandidate);
      expect(score).toBe(0);
    });

    it('handles missing duration in both books', () => {
      const noDurationBase = { ...baseBook, duration: null };
      const noDurationCandidate = {
        id: 2,
        title: 'Different Book',
        author: 'Different Author',
        narrator: 'Different Narrator',
        series: 'Different Series',
        genre: 'Different Genre',
        publisher: 'Different Publisher',
        duration: null
      };

      const score = calculateSimilarityScore(noDurationBase, noDurationCandidate);
      expect(score).toBe(0);
    });

    it('calculates exact 20% duration threshold correctly', () => {
      const candidate = {
        id: 2,
        title: 'Different Book',
        author: 'Different Author',
        narrator: 'Different Narrator',
        series: 'Different Series',
        genre: 'Different Genre',
        publisher: 'Different Publisher',
        duration: 4320 // Exactly 20% more than 3600
      };

      const score = calculateSimilarityScore(baseBook, candidate);
      expect(score).toBe(1);
    });

    it('rejects duration just above 20% threshold', () => {
      const candidate = {
        id: 2,
        title: 'Different Book',
        author: 'Different Author',
        narrator: 'Different Narrator',
        series: 'Different Series',
        genre: 'Different Genre',
        publisher: 'Different Publisher',
        duration: 4321 // Just over 20% of 3600
      };

      const score = calculateSimilarityScore(baseBook, candidate);
      expect(score).toBe(0);
    });
  });

  describe('scoreBook', () => {
    const baseBook = {
      id: 1,
      title: 'Test Book',
      author: 'Test Author',
      narrator: 'Test Narrator',
      series: 'Test Series',
      genre: 'Fantasy',
      publisher: 'Test Publisher',
      duration: 3600
    };

    it('returns score 0 for same book ID', () => {
      const candidate = { ...baseBook, id: 1 };

      const result = scoreBook(baseBook, candidate);
      expect(result.score).toBe(0);
      expect(result.reasons).toEqual([]);
    });

    it('returns score 0 for duplicate book (same author and title)', () => {
      const candidate = {
        ...baseBook,
        id: 2,
        title: 'Test Book',
        author: 'Test Author'
      };

      const result = scoreBook(baseBook, candidate);
      expect(result.score).toBe(0);
      expect(result.reasons).toContain('duplicate');
    });

    it('performs case-insensitive duplicate detection', () => {
      const candidate = {
        ...baseBook,
        id: 2,
        title: 'test book',
        author: 'test author'
      };

      const result = scoreBook(baseBook, candidate);
      expect(result.score).toBe(0);
      expect(result.reasons).toContain('duplicate');
    });

    it('includes "series" in reasons when series matches', () => {
      const candidate = {
        id: 2,
        title: 'Different Title',
        author: 'Different Author',
        narrator: 'Different Narrator',
        series: 'Test Series',
        genre: 'Different Genre',
        publisher: 'Different Publisher',
        duration: 7200
      };

      const result = scoreBook(baseBook, candidate);
      expect(result.score).toBe(3);
      expect(result.reasons).toContain('series');
    });

    it('includes "genre" in reasons when genre matches', () => {
      const candidate = {
        id: 2,
        title: 'Different Title',
        author: 'Different Author',
        narrator: 'Different Narrator',
        series: 'Different Series',
        genre: 'Fantasy',
        publisher: 'Different Publisher',
        duration: 7200
      };

      const result = scoreBook(baseBook, candidate);
      expect(result.score).toBe(2);
      expect(result.reasons).toContain('genre');
    });

    it('includes "publisher" in reasons when publisher matches', () => {
      const candidate = {
        id: 2,
        title: 'Different Title',
        author: 'Different Author',
        narrator: 'Different Narrator',
        series: 'Different Series',
        genre: 'Different Genre',
        publisher: 'Test Publisher',
        duration: 7200
      };

      const result = scoreBook(baseBook, candidate);
      expect(result.score).toBe(1);
      expect(result.reasons).toContain('publisher');
    });

    it('includes "duration" in reasons when duration is similar', () => {
      const candidate = {
        id: 2,
        title: 'Different Title',
        author: 'Different Author',
        narrator: 'Different Narrator',
        series: 'Different Series',
        genre: 'Different Genre',
        publisher: 'Different Publisher',
        duration: 4000
      };

      const result = scoreBook(baseBook, candidate);
      expect(result.score).toBe(1);
      expect(result.reasons).toContain('duration');
    });

    it('includes multiple reasons for multiple matches', () => {
      const candidate = {
        id: 2,
        title: 'Different Title',
        author: 'Different Author',
        narrator: 'Different Narrator',
        series: 'Test Series',
        genre: 'Fantasy',
        publisher: 'Test Publisher',
        duration: 7200
      };

      const result = scoreBook(baseBook, candidate);
      expect(result.score).toBe(6); // 3 + 2 + 1
      expect(result.reasons).toContain('series');
      expect(result.reasons).toContain('genre');
      expect(result.reasons).toContain('publisher');
    });

    it('handles books with missing author or title for duplicate check', () => {
      const candidate = {
        ...baseBook,
        id: 2,
        author: null,
        title: null
      };

      const result = scoreBook(baseBook, candidate);
      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.reasons).not.toContain('duplicate');
    });

    it('handles case where only author matches but not title', () => {
      const candidate = {
        ...baseBook,
        id: 2,
        author: 'Test Author',
        title: 'Different Title'
      };

      const result = scoreBook(baseBook, candidate);
      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.reasons).not.toContain('duplicate');
    });

    it('handles case where only title matches but not author', () => {
      const candidate = {
        ...baseBook,
        id: 2,
        author: 'Different Author',
        title: 'Test Book'
      };

      const result = scoreBook(baseBook, candidate);
      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.reasons).not.toContain('duplicate');
    });

    it('handles missing metadata fields gracefully', () => {
      const minimalCandidate = {
        id: 2,
        title: 'Different Title'
      };

      const result = scoreBook(baseBook, minimalCandidate);
      expect(result.score).toBe(0);
      expect(result.reasons).toEqual([]);
    });
  });

  describe('filterCompletedBooks', () => {
    const books = [
      { id: 1, title: 'Book 1' },
      { id: 2, title: 'Book 2' },
      { id: 3, title: 'Book 3' },
      { id: 4, title: 'Book 4' }
    ];

    it('returns all books when excludeCompleted is false', () => {
      const completedIds = [1, 3];
      const result = filterCompletedBooks(books, completedIds, false);

      expect(result).toEqual(books);
      expect(result.length).toBe(4);
    });

    it('returns all books when completedIds is empty', () => {
      const result = filterCompletedBooks(books, [], true);

      expect(result).toEqual(books);
      expect(result.length).toBe(4);
    });

    it('filters out completed books when excludeCompleted is true', () => {
      const completedIds = [1, 3];
      const result = filterCompletedBooks(books, completedIds, true);

      expect(result.length).toBe(2);
      expect(result.find(b => b.id === 1)).toBeUndefined();
      expect(result.find(b => b.id === 3)).toBeUndefined();
      expect(result.find(b => b.id === 2)).toBeDefined();
      expect(result.find(b => b.id === 4)).toBeDefined();
    });

    it('returns empty array when all books are completed', () => {
      const completedIds = [1, 2, 3, 4];
      const result = filterCompletedBooks(books, completedIds, true);

      expect(result).toEqual([]);
    });

    it('returns empty array when books array is empty', () => {
      const result = filterCompletedBooks([], [], true);

      expect(result).toEqual([]);
    });

    it('returns empty array when books is not an array', () => {
      const result = filterCompletedBooks(null, [], true);

      expect(result).toEqual([]);
    });

    it('returns empty array when books is undefined', () => {
      const result = filterCompletedBooks(undefined, [], true);

      expect(result).toEqual([]);
    });

    it('handles books with missing id field', () => {
      const booksWithMissingIds = [
        { id: 1, title: 'Book 1' },
        { title: 'Book 2' }, // Missing id - will be filtered out
        { id: 3, title: 'Book 3' }
      ];

      const result = filterCompletedBooks(booksWithMissingIds, [1, 3], true);

      // Book 1 and 3 are completed, Book 2 has no id so gets filtered out
      expect(result.length).toBe(0);
    });

    it('handles completedIds that are not in books array', () => {
      const completedIds = [5, 6, 7]; // IDs not in books
      const result = filterCompletedBooks(books, completedIds, true);

      expect(result).toEqual(books);
      expect(result.length).toBe(4);
    });

    it('handles completedIds being null', () => {
      const result = filterCompletedBooks(books, null, true);

      expect(result).toEqual(books);
    });

    it('handles completedIds being undefined', () => {
      const result = filterCompletedBooks(books, undefined, true);

      expect(result).toEqual(books);
    });

    it('handles edge case with invalid books data that could trigger error handling', () => {
      // Test with books array that contains potentially problematic data
      const problematicBooks = [
        { id: 1, title: 'Book 1' },
        { id: 2, title: 'Book 2' },
        { id: 3, title: 'Book 3' }
      ];

      // Use a completedIds that could potentially cause issues
      const completedIds = [1, 2, 3, 4, 5]; // Some IDs not in books

      const result = filterCompletedBooks(problematicBooks, completedIds, true);
      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(0);
    });
  });

  describe('deduplicateCategories', () => {
    it('removes duplicate books across categories', () => {
      const categories = {
        more_by_author: [
          { id: 1, title: 'Book 1' },
          { id: 2, title: 'Book 2' },
          { id: 3, title: 'Book 3' }
        ],
        more_by_narrator: [
          { id: 2, title: 'Book 2' }, // Duplicate
          { id: 4, title: 'Book 4' }
        ],
        similar_audiobooks: [
          { id: 3, title: 'Book 3' }, // Duplicate
          { id: 5, title: 'Book 5' }
        ]
      };

      const result = deduplicateCategories(categories);

      expect(result.more_by_author).toHaveLength(3);
      expect(result.more_by_narrator).toHaveLength(1); // Only Book 4
      expect(result.similar_audiobooks).toHaveLength(1); // Only Book 5

      // Verify first occurrence is kept
      expect(result.more_by_author.find(b => b.id === 2)).toBeDefined();
      expect(result.more_by_narrator.find(b => b.id === 2)).toBeUndefined();
    });

    it('maintains priority order (author > narrator > similar)', () => {
      const categories = {
        more_by_author: [{ id: 1, title: 'Book 1' }],
        more_by_narrator: [{ id: 1, title: 'Book 1' }],
        similar_audiobooks: [{ id: 1, title: 'Book 1' }]
      };

      const result = deduplicateCategories(categories);

      expect(result.more_by_author).toHaveLength(1);
      expect(result.more_by_narrator).toHaveLength(0);
      expect(result.similar_audiobooks).toHaveLength(0);
    });

    it('handles empty categories', () => {
      const categories = {
        more_by_author: [],
        more_by_narrator: [],
        similar_audiobooks: []
      };

      const result = deduplicateCategories(categories);

      expect(result.more_by_author).toEqual([]);
      expect(result.more_by_narrator).toEqual([]);
      expect(result.similar_audiobooks).toEqual([]);
    });

    it('handles missing categories', () => {
      const categories = {
        more_by_author: [{ id: 1, title: 'Book 1' }]
        // Missing categories
      };

      const result = deduplicateCategories(categories);

      expect(result.more_by_author).toHaveLength(1);
      expect(result.more_by_narrator).toBeUndefined();
      expect(result.similar_audiobooks).toBeUndefined();
    });

    it('filters out books with missing id', () => {
      const categories = {
        more_by_author: [
          { id: 1, title: 'Book 1' },
          { title: 'Book 2' }, // Missing id
          { id: 3, title: 'Book 3' }
        ],
        more_by_narrator: [],
        similar_audiobooks: []
      };

      const result = deduplicateCategories(categories);

      expect(result.more_by_author).toHaveLength(2);
      expect(result.more_by_author.find(b => b.id === 1)).toBeDefined();
      expect(result.more_by_author.find(b => b.id === 3)).toBeDefined();
    });

    it('handles non-array categories gracefully', () => {
      const categories = {
        more_by_author: 'not an array',
        more_by_narrator: null,
        similar_audiobooks: undefined
      };

      const result = deduplicateCategories(categories);

      expect(result.more_by_author).toEqual([]);
      expect(result.more_by_narrator).toEqual([]);
      expect(result.similar_audiobooks).toEqual([]);
    });

    it('handles duplicate within same category', () => {
      const categories = {
        more_by_author: [
          { id: 1, title: 'Book 1' },
          { id: 1, title: 'Book 1' }, // Duplicate
          { id: 2, title: 'Book 2' }
        ],
        more_by_narrator: [],
        similar_audiobooks: []
      };

      const result = deduplicateCategories(categories);

      expect(result.more_by_author).toHaveLength(2);
    });

    it('handles complex cross-category duplicates', () => {
      const categories = {
        more_by_author: [
          { id: 1, title: 'Book 1' },
          { id: 2, title: 'Book 2' },
          { id: 3, title: 'Book 3' }
        ],
        more_by_narrator: [
          { id: 2, title: 'Book 2' },
          { id: 3, title: 'Book 3' },
          { id: 4, title: 'Book 4' }
        ],
        similar_audiobooks: [
          { id: 3, title: 'Book 3' },
          { id: 4, title: 'Book 4' },
          { id: 5, title: 'Book 5' }
        ]
      };

      const result = deduplicateCategories(categories);

      expect(result.more_by_author).toHaveLength(3); // 1, 2, 3
      expect(result.more_by_narrator).toHaveLength(1); // 4
      expect(result.similar_audiobooks).toHaveLength(1); // 5
    });
  });

  describe('limitResults', () => {
    const books = [
      { id: 1, title: 'Book 1' },
      { id: 2, title: 'Book 2' },
      { id: 3, title: 'Book 3' },
      { id: 4, title: 'Book 4' },
      { id: 5, title: 'Book 5' },
      { id: 6, title: 'Book 6' },
      { id: 7, title: 'Book 7' }
    ];

    it('limits results to specified count', () => {
      const result = limitResults(books, 3);

      expect(result).toHaveLength(3);
      expect(result[0].id).toBe(1);
      expect(result[1].id).toBe(2);
      expect(result[2].id).toBe(3);
    });

    it('uses default limit of 6 when not specified', () => {
      const result = limitResults(books);

      expect(result).toHaveLength(6);
    });

    it('returns all books when limit exceeds array length', () => {
      const result = limitResults(books, 10);

      expect(result).toHaveLength(7);
      expect(result).toEqual(books);
    });

    it('returns empty array when input is empty', () => {
      const result = limitResults([], 3);

      expect(result).toEqual([]);
    });

    it('handles limit of 0', () => {
      const result = limitResults(books, 0);

      expect(result).toEqual([]);
    });

    it('handles negative limit', () => {
      const result = limitResults(books, -1);

      // JavaScript slice(0, -1) returns all elements except the last one
      expect(result).toHaveLength(6);
      expect(result).not.toContain(books[6]); // Last element should be excluded
    });

    it('handles limit of 1', () => {
      const result = limitResults(books, 1);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(1);
    });

    it('preserves order of original array', () => {
      const unorderedBooks = [
        { id: 5, title: 'Book 5' },
        { id: 2, title: 'Book 2' },
        { id: 8, title: 'Book 8' },
        { id: 1, title: 'Book 1' }
      ];

      const result = limitResults(unorderedBooks, 2);

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe(5);
      expect(result[1].id).toBe(2);
    });

    it('does not modify original array', () => {
      const originalLength = books.length;
      limitResults(books, 3);

      expect(books).toHaveLength(originalLength);
    });
  });
});
