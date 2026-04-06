const axios = require('axios');
const logger = require('../utils/logger');

// This is a basic implementation using Google Books API
// You can extend this to use Audible or other audiobook-specific APIs

async function scrapeMetadata(title, author) {
  try {
    // Try Google Books API first
    const googleBooksData = await scrapeGoogleBooks(title, author);
    if (googleBooksData) {
      return googleBooksData;
    }

    return null;
  } catch (error) {
    logger.error('Metadata scraping error:', error.message);
    return null;
  }
}

async function scrapeGoogleBooks(title, author) {
  try {
    const query = encodeURIComponent(`${title} ${author}`);
    const url = `https://www.googleapis.com/books/v1/volumes?q=${query}&maxResults=1`;

    const response = await axios.get(url, { timeout: 5000 });

    if (response.data.items && response.data.items.length > 0) {
      const book = response.data.items[0].volumeInfo;

      return {
        title: book.title || null,
        author: book.authors ? book.authors.join(', ') : null,
        description: book.description || null,
        published_year: book.publishedDate ? parseInt(book.publishedDate.substring(0, 4)) : null,
        isbn: book.industryIdentifiers ?
          book.industryIdentifiers.find(id => id.type === 'ISBN_13')?.identifier : null,
        genre: book.categories ? book.categories.join(', ') : null,
        language: book.language || null,
        cover_image_url: book.imageLinks?.thumbnail || book.imageLinks?.smallThumbnail || null,
      };
    }

    return null;
  } catch (error) {
    logger.error('Google Books API error:', error.message);
    return null;
  }
}

module.exports = {
  scrapeMetadata,
  scrapeGoogleBooks,
};
