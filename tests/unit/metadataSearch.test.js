/**
 * Unit tests for Metadata Search Service
 */

// Mock global fetch
global.fetch = jest.fn();

const {
  searchHardcover
} = require('../../server/services/metadataSearch');

describe('Metadata Search Service - Hardcover', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Set a default timeout behavior
    global.fetch.mockImplementation(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ data: { search: { results: { found: 0, hits: [] } } } })
      })
    );
  });

  describe('searchHardcover', () => {
    const mockNormalizeGenres = (genres) => genres || null;

    test('returns empty array when no API token is provided', async () => {
      const result = await searchHardcover('Test Book', 'Test Author', mockNormalizeGenres, null);

      expect(result).toEqual([]);
      expect(global.fetch).not.toHaveBeenCalled();
    });

    test('returns empty array when no query parameters are provided', async () => {
      const result = await searchHardcover('', '', mockNormalizeGenres, 'test-token');

      expect(result).toEqual([]);
      expect(global.fetch).not.toHaveBeenCalled();
    });

    test('queries Hardcover GraphQL API with correct parameters', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            search: {
              results: {
                found: 1,
                hits: [
                  {
                    document: {
                      title: 'Project Hail Mary',
                      subtitle: 'A Novel',
                      author_names: ['Andy Weir'],
                      description: 'A lone astronaut must save the earth',
                      genres: ['Science Fiction', 'Thriller'],
                      moods: ['Suspenseful'],
                      series_names: [],
                      featured_series: null,
                      featured_series_position: null,
                      isbns: ['9780593135204'],
                      slug: 'project-hail-mary',
                      rating: 4.5,
                      ratings_count: 12500,
                      reviews_count: 500,
                      release_year: 2021,
                      release_date_i: 20210504,
                      pages: 476,
                      audio_seconds: 59400,
                      has_audiobook: true,
                      has_ebook: true,
                      users_count: 25000,
                      users_read_count: 20000
                    }
                  }
                ]
              }
            }
          }
        })
      });

      const result = await searchHardcover('Project Hail Mary', 'Andy Weir', mockNormalizeGenres, 'test-token');

      expect(global.fetch).toHaveBeenCalledTimes(1);
      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.hardcover.app/v1/graphql',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            'Authorization': 'Bearer test-token',
            'User-Agent': 'Sappho Audiobook Server'
          }),
          body: expect.stringContaining('Project Hail Mary')
        })
      );

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        source: 'hardcover',
        title: 'Project Hail Mary',
        subtitle: 'A Novel',
        author: 'Andy Weir',
        description: 'A lone astronaut must save the earth',
        genre: 'Science Fiction, Thriller, Suspenseful',
        published_year: 2021,
        isbn: '9780593135204',
        rating: '4.5',
        rating_count: 12500,
        has_audiobook: true,
        audio_seconds: 59400
      });
    });

    test('correctly maps series information from featured_series', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            search: {
              results: {
                found: 1,
                hits: [
                  {
                    document: {
                      title: 'The Way of Kings',
                      author_names: ['Brandon Sanderson'],
                      series_names: ['The Stormlight Archive'],
                      featured_series: 'The Stormlight Archive',
                      featured_series_position: 1,
                      isbns: ['9780765326355'],
                      slug: 'the-way-of-kings',
                      genres: ['Fantasy'],
                      has_audiobook: true
                    }
                  }
                ]
              }
            }
          }
        })
      });

      const result = await searchHardcover('The Way of Kings', 'Brandon Sanderson', mockNormalizeGenres, 'test-token');

      expect(result[0].series).toBe('The Stormlight Archive');
      expect(result[0].series_position).toBe(1);
    });

    test('falls back to series_names array when featured_series is null', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            search: {
              results: {
                found: 1,
                hits: [
                  {
                    document: {
                      title: 'Test Book',
                      author_names: ['Test Author'],
                      series_names: ['Test Series'],
                      featured_series: null,
                      featured_series_position: null,
                      isbns: [],
                      slug: 'test-book',
                      genres: []
                    }
                  }
                ]
              }
            }
          }
        })
      });

      const result = await searchHardcover('Test Book', 'Test Author', mockNormalizeGenres, 'test-token');

      expect(result[0].series).toBe('Test Series');
      expect(result[0].series_position).toBeNull();
    });

    test('validates and selects valid ISBNs from list', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            search: {
              results: {
                found: 1,
                hits: [
                  {
                    document: {
                      title: 'Test Book',
                      author_names: ['Test Author'],
                      isbns: ['9780306406157', '9780593135204'], // Both valid ISBN-13s
                      slug: 'test-book',
                      genres: []
                    }
                  }
                ]
              }
            }
          }
        })
      });

      const result = await searchHardcover('Test Book', 'Test Author', mockNormalizeGenres, 'test-token');

      expect(result[0].isbn).toBe('9780306406157');
    });

    test('constructs cover image URL from slug', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            search: {
              results: {
                found: 1,
                hits: [
                  {
                    document: {
                      title: 'Test Book',
                      author_names: ['Test Author'],
                      slug: 'test-book',
                      genres: []
                    }
                  }
                ]
              }
            }
          }
        })
      });

      const result = await searchHardcover('Test Book', 'Test Author', mockNormalizeGenres, 'test-token');

      expect(result[0].image).toBe('https://hardcover.app/books/test-book/image.jpg');
    });

    test('handles 401 unauthorized response (invalid token)', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: false,
        status: 401
      });

      const result = await searchHardcover('Test', 'Author', mockNormalizeGenres, 'invalid-token');

      expect(result).toEqual([]);
    });

    test('handles 429 rate limit response', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: false,
        status: 429
      });

      const result = await searchHardcover('Test', 'Author', mockNormalizeGenres, 'test-token');

      expect(result).toEqual([]);
    });

    test('handles GraphQL errors in response', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          data: { search: { results: { found: 0, hits: [] } } },
          errors: [
            { message: 'Field "invalid" doesn\'t exist' }
          ]
        })
      });

      const result = await searchHardcover('Test', 'Author', mockNormalizeGenres, 'test-token');

      expect(result).toEqual([]);
    });

    test('handles network/timeout errors gracefully', async () => {
      global.fetch.mockRejectedValueOnce(new Error('AbortError'));

      const result = await searchHardcover('Test', 'Author', mockNormalizeGenres, 'test-token');

      expect(result).toEqual([]);
    });

    test('skips books without titles', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            search: {
              results: {
                found: 2,
                hits: [
                  { document: { title: null, author_names: ['Author'], genres: [] } }, // Should be skipped
                  { document: { title: 'Valid Book', author_names: ['Author'], genres: [] } } // Should be included
                ]
              }
            }
          }
        })
      });

      const result = await searchHardcover('Valid Book', 'Author', mockNormalizeGenres, 'test-token');

      expect(result).toHaveLength(1);
      expect(result[0].title).toBe('Valid Book');
    });

    test('handles empty results array', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            search: {
              results: {
                found: 0,
                hits: []
              }
            }
          }
        })
      });

      const result = await searchHardcover('Nonexistent', 'Book', mockNormalizeGenres, 'test-token');

      expect(result).toEqual([]);
    });

    test('combines genres and moods into single genre field', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            search: {
              results: {
                found: 1,
                hits: [
                  {
                    document: {
                      title: 'Test',
                      author_names: ['Author'],
                      genres: ['Fantasy', 'Adventure'],
                      moods: ['Epic', 'Emotional'],
                      tags: ['dragons', 'magic'],
                      isbns: [],
                      slug: 'test'
                    }
                  }
                ]
              }
            }
          }
        })
      });

      const result = await searchHardcover('Test', 'Author', mockNormalizeGenres, 'test-token');

      expect(result[0].genre).toBe('Fantasy, Adventure, Epic, Emotional');
    });

    test('sets hasChapters to false (Hardcover API limitation)', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            search: {
              results: {
                found: 1,
                hits: [
                  {
                    document: {
                      title: 'Test',
                      author_names: ['Author'],
                      isbns: [],
                      slug: 'test',
                      genres: []
                    }
                  }
                ]
              }
            }
          }
        })
      });

      const result = await searchHardcover('Test', 'Author', mockNormalizeGenres, 'test-token');

      expect(result[0].hasChapters).toBe(false);
    });

    test('sets narrator to null (Hardcover API limitation)', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            search: {
              results: {
                found: 1,
                hits: [
                  {
                    document: {
                      title: 'Test',
                      author_names: ['Author'],
                      isbns: [],
                      slug: 'test',
                      genres: []
                    }
                  }
                ]
              }
            }
          }
        })
      });

      const result = await searchHardcover('Test', 'Author', mockNormalizeGenres, 'test-token');

      expect(result[0].narrator).toBeNull();
    });

    test('includes Hardcover-specific fields in result', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            search: {
              results: {
                found: 1,
                hits: [
                  {
                    document: {
                      title: 'Test',
                      author_names: ['Author'],
                      has_audiobook: true,
                      audio_seconds: 36000,
                      moods: ['Funny', 'Adventurous'],
                      tags: ['time travel', 'sci-fi'],
                      users_count: 5000,
                      isbns: [],
                      slug: 'test',
                      genres: []
                    }
                  }
                ]
              }
            }
          }
        })
      });

      const result = await searchHardcover('Test', 'Author', mockNormalizeGenres, 'test-token');

      expect(result[0]).toMatchObject({
        has_audiobook: true,
        audio_seconds: 36000,
        moods: 'Funny, Adventurous',
        tags: 'time travel, sci-fi',
        users_count: 5000
      });
    });
  });
});
