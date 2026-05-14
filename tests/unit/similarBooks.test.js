const {
  scoreBook,
  filterCompletedBooks,
  deduplicateCategories,
  limitResults,
  calculateSimilarityScore
} = require('../../server/utils/similarBooks');

describe('similarBooks', () => {
  describe('scoreBook', () => {
    const baseBook = {
      id: 1,
      title: 'Test Book',
      author: 'Test Author',
      series: 'Test Series',
      genre: 'Fantasy',
      publisher: 'Test Publisher',
      duration: 3600 // 1 hour
    };

    it('returns zero score for same book', () => {
      const result = scoreBook(baseBook, baseBook);
      expect(result.score).toBe(0);
      expect(result.reasons).toEqual([]);
    });

    it('returns zero score for duplicate edition (same author + title)', () => {
      const duplicateBook = {
        id: 2,
        title: 'Test Book',
        author: 'Test Author',
        series: 'Different Series',
        genre: 'Fantasy',
        publisher: 'Different Publisher',
        duration: 3600
      };

      const result = scoreBook(baseBook, duplicateBook);
      expect(result.score).toBe(0);
      expect(result.reasons).toContain('duplicate');
    });

    it('gives 3 points for same series', () => {
      const sameSeriesBook = {
        id: 2,
        title: 'Different Book',
        author: 'Different Author',
        series: 'Test Series',
        genre: 'Science Fiction',
        publisher: 'Different Publisher',
        duration: 1800
      };

      const result = scoreBook(baseBook, sameSeriesBook);
      expect(result.score).toBe(3);
      expect(result.reasons).toContain('series');
    });

    it('gives 2 points for same genre', () => {
      const sameGenreBook = {
        id: 2,
        title: 'Different Book',
        author: 'Different Author',
        series: 'Different Series',
        genre: 'Fantasy',
        publisher: 'Different Publisher',
        duration: 1800
      };

      const result = scoreBook(baseBook, sameGenreBook);
      expect(result.score).toBe(2);
      expect(result.reasons).toContain('genre');
    });

    it('gives 1 point for same publisher', () => {
      const samePublisherBook = {
        id: 2,
        title: 'Different Book',
        author: 'Different Author',
        series: 'Different Series',
        genre: 'Science Fiction',
        publisher: 'Test Publisher',
        duration: 1800
      };

      const result = scoreBook(baseBook, samePublisherBook);
      expect(result.score).toBe(1);
      expect(result.reasons).toContain('publisher');
    });

    it('gives 1 point for similar duration (within 20%)', () => {
      const similarDurationBook = {
        id: 2,
        title: 'Different Book',
        author: 'Different Author',
        series: 'Different Series',
        genre: 'Science Fiction',
        publisher: 'Different Publisher',
        duration: 4000 // Within 20% of 3600
      };

      const result = scoreBook(baseBook, similarDurationBook);
      expect(result.score).toBe(1);
      expect(result.reasons).toContain('duration');
    });

    it('gives 0 points for duration outside 20% threshold', () => {
      const differentDurationBook = {
        id: 2,
        title: 'Different Book',
        author: 'Different Author',
        series: 'Different Series',
        genre: 'Science Fiction',
        publisher: 'Different Publisher',
        duration: 5000 // Outside 20% of 3600
      };

      const result = scoreBook(baseBook, differentDurationBook);
      expect(result.score).toBe(0);
      expect(result.reasons).not.toContain('duration');
    });

    it('sums points for multiple matching factors', () => {
      const similarBook = {
        id: 2,
        title: 'Different Book',
        author: 'Different Author',
        series: 'Test Series',
        genre: 'Fantasy',
        publisher: 'Test Publisher',
        duration: 3800
      };

      const result = scoreBook(baseBook, similarBook);
      expect(result.score).toBe(7); // 3 + 2 + 1 + 1
      expect(result.reasons).toContain('series');
      expect(result.reasons).toContain('genre');
      expect(result.reasons).toContain('publisher');
      expect(result.reasons).toContain('duration');
    });

    it('is case insensitive for comparisons', () => {
      const caseDifferentBook = {
        id: 2,
        title: 'Different Book',
        author: 'Different Author',
        series: 'test series', // lowercase
        genre: 'FANTASY', // uppercase
        publisher: 'test publisher', // lowercase
        duration: 3600
      };

      const result = scoreBook(baseBook, caseDifferentBook);
      expect(result.score).toBe(7); // 3 + 2 + 1 + 1 (duration also matches)
      expect(result.reasons).toContain('series');
      expect(result.reasons).toContain('genre');
      expect(result.reasons).toContain('publisher');
      expect(result.reasons).toContain('duration');
    });

    it('handles missing optional fields', () => {
      const minimalBook = {
        id: 2,
        title: 'Different Book',
        author: 'Different Author'
      };

      const result = scoreBook(baseBook, minimalBook);
      expect(result.score).toBe(0);
      expect(result.reasons).toEqual([]);
    });

    it('handles null fields', () => {
      const nullFieldBook = {
        id: 2,
        title: 'Different Book',
        author: 'Different Author',
        series: null,
        genre: null,
        publisher: null,
        duration: null
      };

      const result = scoreBook(baseBook, nullFieldBook);
      expect(result.score).toBe(0);
      expect(result.reasons).toEqual([]);
    });

    it('handles errors gracefully', () => {
      const badBook = { id: 'invalid' };
      const result = scoreBook(baseBook, badBook);
      expect(result.score).toBe(0);
      expect(result.reasons).toEqual([]);
    });
  });

  describe('calculateSimilarityScore', () => {
    const baseBook = {
      id: 1,
      title: 'Test Book',
      author: 'Test Author',
      series: 'Test Series',
      genre: 'Fantasy',
      publisher: 'Test Publisher',
      duration: 3600
    };

    it('calculates score for same series', () => {
      const candidateBook = {
        id: 2,
        series: 'Test Series',
        genre: 'Science Fiction',
        publisher: 'Different Publisher',
        duration: 1800
      };

      const score = calculateSimilarityScore(baseBook, candidateBook);
      expect(score).toBe(3);
    });

    it('calculates score for multiple factors', () => {
      const candidateBook = {
        id: 2,
        series: 'Test Series',
        genre: 'Fantasy',
        publisher: 'Test Publisher',
        duration: 3800
      };

      const score = calculateSimilarityScore(baseBook, candidateBook);
      expect(score).toBe(7); // 3 + 2 + 1 + 1
    });

    it('returns high score for same book (does not exclude itself)', () => {
      const score = calculateSimilarityScore(baseBook, baseBook);
      expect(score).toBe(4); // Same genre + publisher + duration (series excluded by ID check)
    });

    it('handles missing fields', () => {
      const minimalBook = { id: 2 };
      const score = calculateSimilarityScore(baseBook, minimalBook);
      expect(score).toBe(0);
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
      const completedBooks = [1, 2];
      const result = filterCompletedBooks(books, completedBooks, false);
      expect(result).toEqual(books);
    });

    it('filters out completed books when excludeCompleted is true', () => {
      const completedBooks = [1, 3];
      const result = filterCompletedBooks(books, completedBooks, true);
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe(2);
      expect(result[1].id).toBe(4);
    });

    it('returns all books when completedBooks is empty', () => {
      const result = filterCompletedBooks(books, [], true);
      expect(result).toEqual(books);
    });

    it('returns all books when completedBooks is not an array', () => {
      const result = filterCompletedBooks(books, 'not an array', true);
      expect(result).toEqual(books);
    });

    it('handles empty books array', () => {
      const result = filterCompletedBooks([], [1, 2], true);
      expect(result).toEqual([]);
    });

    it('handles non-array books input', () => {
      const result = filterCompletedBooks('not an array', [1, 2], true);
      expect(result).toEqual([]);
    });

    it('handles books without id field', () => {
      const booksWithInvalid = [
        { id: 1, title: 'Book 1' },
        { title: 'Book without ID' },
        { id: 2, title: 'Book 2' }
      ];
      const result = filterCompletedBooks(booksWithInvalid, [1], true);
      expect(result).toHaveLength(1); // Book without ID is filtered out since it lacks an ID
      expect(result[0].id).toBe(2);
    });
  });

  describe('deduplicateCategories', () => {
    const categories = {
      more_by_author: [
        { id: 1, title: 'Book 1' },
        { id: 2, title: 'Book 2' },
        { id: 3, title: 'Book 3' }
      ],
      more_by_narrator: [
        { id: 2, title: 'Book 2' }, // duplicate
        { id: 4, title: 'Book 4' },
        { id: 5, title: 'Book 5' }
      ],
      similar_audiobooks: [
        { id: 3, title: 'Book 3' }, // duplicate
        { id: 4, title: 'Book 4' }, // duplicate
        { id: 6, title: 'Book 6' }
      ]
    };

    it('removes duplicates across categories', () => {
      const result = deduplicateCategories(categories);

      expect(result.more_by_author).toHaveLength(3);
      expect(result.more_by_narrator).toHaveLength(2); // Book 2 removed
      expect(result.similar_audiobooks).toHaveLength(1); // Book 3 and 4 removed
    });

    it('preserves first occurrence order', () => {
      const result = deduplicateCategories(categories);

      expect(result.more_by_author[0].id).toBe(1);
      expect(result.more_by_author[1].id).toBe(2);
      expect(result.more_by_author[2].id).toBe(3);

      expect(result.more_by_narrator[0].id).toBe(4);
      expect(result.more_by_narrator[1].id).toBe(5);

      expect(result.similar_audiobooks[0].id).toBe(6);
    });

    it('handles empty categories object', () => {
      const result = deduplicateCategories({});
      expect(result).toEqual({});
    });

    it('handles non-array categories', () => {
      const invalidCategories = {
        more_by_author: 'not an array',
        more_by_narrator: null,
        similar_audiobooks: []
      };

      const result = deduplicateCategories(invalidCategories);
      expect(result.more_by_author).toEqual([]);
      expect(result.more_by_narrator).toEqual([]);
      expect(result.similar_audiobooks).toEqual([]);
    });

    it('handles books without id field', () => {
      const categoriesWithInvalid = {
        more_by_author: [
          { id: 1, title: 'Book 1' },
          { title: 'Book without ID' },
          { id: 2, title: 'Book 2' }
        ],
        more_by_narrator: []
      };

      const result = deduplicateCategories(categoriesWithInvalid);
      expect(result.more_by_author).toHaveLength(2);
      expect(result.more_by_author[0].id).toBe(1);
      expect(result.more_by_author[1].id).toBe(2);
    });

    it('handles null book objects', () => {
      const categoriesWithNull = {
        more_by_author: [
          { id: 1, title: 'Book 1' },
          null,
          { id: 2, title: 'Book 2' }
        ],
        more_by_narrator: []
      };

      const result = deduplicateCategories(categoriesWithNull);
      expect(result.more_by_author).toHaveLength(2);
      expect(result.more_by_author[0].id).toBe(1);
      expect(result.more_by_author[1].id).toBe(2);
    });

    it('returns fallback structure on error', () => {
      // Simulate error by passing undefined
      const result = deduplicateCategories(undefined);
      expect(result).toHaveProperty('more_by_author');
      expect(result).toHaveProperty('more_by_narrator');
      expect(result).toHaveProperty('similar_audiobooks');
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

    it('limits results to default 6 when no limit specified', () => {
      const result = limitResults(books);
      expect(result).toHaveLength(6);
    });

    it('limits results to specified limit', () => {
      const result = limitResults(books, 3);
      expect(result).toHaveLength(3);
      expect(result[0].id).toBe(1);
      expect(result[1].id).toBe(2);
      expect(result[2].id).toBe(3);
    });

    it('returns all books when limit exceeds array length', () => {
      const result = limitResults(books, 10);
      expect(result).toHaveLength(7);
    });

    it('handles empty array', () => {
      const result = limitResults([], 3);
      expect(result).toEqual([]);
    });

    it('handles limit of 0', () => {
      const result = limitResults(books, 0);
      expect(result).toEqual([]);
    });

    it('preserves original order', () => {
      const result = limitResults(books, 4);
      expect(result[0].id).toBe(1);
      expect(result[1].id).toBe(2);
      expect(result[2].id).toBe(3);
      expect(result[3].id).toBe(4);
    });
  });

  describe('integration tests', () => {
    it('combines all functions for complete workflow', () => {
      const baseBook = {
        id: 1,
        title: 'Base Book',
        author: 'Base Author',
        series: 'Base Series',
        genre: 'Fantasy',
        publisher: 'Base Publisher',
        duration: 3600
      };

      const candidates = [
        { id: 2, title: 'Book 2', author: 'Different Author', series: 'Base Series', genre: 'Fantasy', publisher: 'Different Publisher', duration: 3800 },
        { id: 3, title: 'Book 3', author: 'Different Author', series: 'Different Series', genre: 'Fantasy', publisher: 'Base Publisher', duration: 3500 },
        { id: 4, title: 'Book 4', author: 'Different Author', series: 'Different Series', genre: 'Science Fiction', publisher: 'Different Publisher', duration: 1800 },
        { id: 5, title: 'Book 5', author: 'Different Author', series: 'Different Series', genre: 'Fantasy', publisher: 'Different Publisher', duration: 7200 }
      ];

      // Score all candidates
      const scored = candidates.map(book => ({
        book,
        ...scoreBook(baseBook, book)
      }));

      // Sort by score descending
      scored.sort((a, b) => b.score - a.score);

      // Take top 3
      const topScorers = scored.slice(0, 3).map(s => s.book);

      // Filter completed (none completed in this case)
      const filtered = filterCompletedBooks(topScorers, [5], true);

      // Limit results
      const final = limitResults(filtered, 2);

      expect(final).toHaveLength(2);
      expect(final[0].id).toBe(2); // Highest score (6: series + genre + duration)
      expect(final[1].id).toBe(3); // Second highest (4: genre + publisher)
    });
  });
});