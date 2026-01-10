/**
 * Unit tests for Metadata Scraper Service
 */

const axios = require('axios');

// Mock axios
jest.mock('axios');

const {
  scrapeMetadata,
  scrapeGoogleBooks,
  scrapeAudible
} = require('../../server/services/metadataScraper');

describe('Metadata Scraper Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('scrapeGoogleBooks', () => {
    test('returns metadata from Google Books API', async () => {
      const mockResponse = {
        data: {
          items: [{
            volumeInfo: {
              title: 'The Great Gatsby',
              authors: ['F. Scott Fitzgerald'],
              description: 'A classic novel about the American Dream',
              publishedDate: '1925-04-10',
              industryIdentifiers: [
                { type: 'ISBN_13', identifier: '9780743273565' }
              ],
              categories: ['Fiction', 'Classics'],
              language: 'en',
              imageLinks: {
                thumbnail: 'https://example.com/cover.jpg'
              }
            }
          }]
        }
      };

      axios.get.mockResolvedValueOnce(mockResponse);

      const result = await scrapeGoogleBooks('The Great Gatsby', 'F. Scott Fitzgerald');

      expect(result).not.toBeNull();
      expect(result.title).toBe('The Great Gatsby');
      expect(result.author).toBe('F. Scott Fitzgerald');
      expect(result.description).toBe('A classic novel about the American Dream');
      expect(result.published_year).toBe(1925);
      expect(result.isbn).toBe('9780743273565');
      expect(result.genre).toBe('Fiction, Classics');
      expect(result.language).toBe('en');
      expect(result.cover_image_url).toBe('https://example.com/cover.jpg');
    });

    test('returns null when no results found', async () => {
      axios.get.mockResolvedValueOnce({ data: { items: [] } });

      const result = await scrapeGoogleBooks('Nonexistent Book', 'Unknown Author');
      expect(result).toBeNull();
    });

    test('returns null when items is undefined', async () => {
      axios.get.mockResolvedValueOnce({ data: {} });

      const result = await scrapeGoogleBooks('Nonexistent Book', 'Unknown Author');
      expect(result).toBeNull();
    });

    test('handles API errors gracefully', async () => {
      axios.get.mockRejectedValueOnce(new Error('Network error'));

      const result = await scrapeGoogleBooks('Test Book', 'Test Author');
      expect(result).toBeNull();
    });

    test('handles missing optional fields', async () => {
      const mockResponse = {
        data: {
          items: [{
            volumeInfo: {
              title: 'Minimal Book'
              // No other fields
            }
          }]
        }
      };

      axios.get.mockResolvedValueOnce(mockResponse);

      const result = await scrapeGoogleBooks('Minimal Book', '');

      expect(result).not.toBeNull();
      expect(result.title).toBe('Minimal Book');
      expect(result.author).toBeNull();
      expect(result.description).toBeNull();
      expect(result.published_year).toBeNull();
      expect(result.isbn).toBeNull();
      expect(result.genre).toBeNull();
      expect(result.language).toBeNull();
      expect(result.cover_image_url).toBeNull();
    });

    test('uses smallThumbnail as fallback for cover', async () => {
      const mockResponse = {
        data: {
          items: [{
            volumeInfo: {
              title: 'Test Book',
              imageLinks: {
                smallThumbnail: 'https://example.com/small.jpg'
              }
            }
          }]
        }
      };

      axios.get.mockResolvedValueOnce(mockResponse);

      const result = await scrapeGoogleBooks('Test Book', '');
      expect(result.cover_image_url).toBe('https://example.com/small.jpg');
    });

    test('correctly encodes query parameters', async () => {
      axios.get.mockResolvedValueOnce({ data: { items: [] } });

      await scrapeGoogleBooks('Book Title', 'Author Name');

      expect(axios.get).toHaveBeenCalledWith(
        expect.stringContaining('Book%20Title%20Author%20Name'),
        expect.any(Object)
      );
    });

    test('sets timeout for API request', async () => {
      axios.get.mockResolvedValueOnce({ data: { items: [] } });

      await scrapeGoogleBooks('Test', 'Test');

      expect(axios.get).toHaveBeenCalledWith(
        expect.any(String),
        { timeout: 5000 }
      );
    });

    test('handles multiple authors', async () => {
      const mockResponse = {
        data: {
          items: [{
            volumeInfo: {
              title: 'Collaborative Book',
              authors: ['Author One', 'Author Two', 'Author Three']
            }
          }]
        }
      };

      axios.get.mockResolvedValueOnce(mockResponse);

      const result = await scrapeGoogleBooks('Collaborative Book', '');
      expect(result.author).toBe('Author One, Author Two, Author Three');
    });

    test('parses year from various date formats', async () => {
      const mockResponse = {
        data: {
          items: [{
            volumeInfo: {
              title: 'Test',
              publishedDate: '2020'
            }
          }]
        }
      };

      axios.get.mockResolvedValueOnce(mockResponse);

      const result = await scrapeGoogleBooks('Test', '');
      expect(result.published_year).toBe(2020);
    });
  });

  describe('scrapeAudible', () => {
    test('returns null (not implemented)', async () => {
      const result = await scrapeAudible('Test Book', 'Test Author');
      expect(result).toBeNull();
    });
  });

  describe('scrapeMetadata', () => {
    test('returns Google Books data when available', async () => {
      const mockResponse = {
        data: {
          items: [{
            volumeInfo: {
              title: 'Test Book',
              authors: ['Test Author']
            }
          }]
        }
      };

      axios.get.mockResolvedValueOnce(mockResponse);

      const result = await scrapeMetadata('Test Book', 'Test Author');

      expect(result).not.toBeNull();
      expect(result.title).toBe('Test Book');
    });

    test('returns null when no sources have data', async () => {
      axios.get.mockResolvedValueOnce({ data: {} });

      const result = await scrapeMetadata('Unknown Book', 'Unknown Author');
      expect(result).toBeNull();
    });

    test('handles errors gracefully', async () => {
      axios.get.mockRejectedValueOnce(new Error('Network error'));

      const result = await scrapeMetadata('Test', 'Test');
      expect(result).toBeNull();
    });
  });
});
