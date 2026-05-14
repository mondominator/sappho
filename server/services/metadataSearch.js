/**
 * Metadata Search Utilities
 *
 * External API search functions for audiobook metadata:
 * Audible (via Audnexus), Google Books, Open Library, and Hardcover.
 */
const logger = require('../utils/logger');

/**
 * Search Audible and get details from Audnexus
 */
async function searchAudible(title, author, asin, normalizeGenres) {
  const results = [];
  let asins = [];

  try {
    // If ASIN provided directly, use it
    if (asin && /^[A-Z0-9]{10}$/i.test(asin)) {
      asins.push(asin.toUpperCase());
    }
    // If title looks like an ASIN, try it
    else if (title && /^[A-Z0-9]{10}$/i.test(title)) {
      asins.push(title.toUpperCase());
    }
    // Search Audible's catalog API
    else if (title || author) {
      const queryParams = new URLSearchParams({
        num_results: '10',
        products_sort_by: 'Relevance'
      });
      if (title) queryParams.append('title', title);
      if (author) queryParams.append('author', author);

      const searchUrl = `https://api.audible.com/1.0/catalog/products?${queryParams.toString()}`;
      logger.info(`[Audible Search] ${searchUrl}`);

      const searchController = new AbortController();
      const searchTimeout = setTimeout(() => searchController.abort(), 10000);
      let searchResponse;
      try {
        searchResponse = await fetch(searchUrl, { signal: searchController.signal });
      } finally {
        clearTimeout(searchTimeout);
      }
      if (searchResponse.ok) {
        const searchData = await searchResponse.json();
        if (searchData.products && searchData.products.length > 0) {
          asins = searchData.products.map(p => p.asin).filter(Boolean);
        }
      }
    }

    // Get full details from Audnexus for each ASIN
    for (const bookAsin of asins.slice(0, 10)) {
      try {
        const detailController = new AbortController();
        const detailTimeout = setTimeout(() => detailController.abort(), 10000);
        let response;
        try {
          response = await fetch(`https://api.audnex.us/books/${bookAsin}`, { signal: detailController.signal });
        } finally {
          clearTimeout(detailTimeout);
        }
        if (response.ok) {
          const book = await response.json();
          const genres = book.genres?.filter(g => g.type === 'genre').map(g => g.name) || [];
          const tags = book.genres?.filter(g => g.type === 'tag').map(g => g.name) || [];
          const publishedYear = book.releaseDate ? parseInt(book.releaseDate.split('-')[0]) : null;

          results.push({
            source: 'audible',
            asin: book.asin,
            title: book.title,
            subtitle: book.subtitle || null,
            author: book.authors?.map(a => a.name).join(', ') || null,
            narrator: book.narrators?.map(n => n.name).join(', ') || null,
            series: book.seriesPrimary?.name || null,
            series_position: book.seriesPrimary?.position || null,
            publisher: book.publisherName || null,
            published_year: publishedYear,
            copyright_year: book.copyright || null,
            isbn: book.isbn || null,
            description: book.summary ? book.summary.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim() : null,
            language: book.language || null,
            runtime: book.runtimeLengthMin || null,
            abridged: book.formatType === 'abridged' ? 1 : 0,
            genre: normalizeGenres(genres.join(', ')) || null,
            tags: tags.join(', ') || null,
            rating: book.rating || null,
            rating_count: Number.isFinite(book.ratingCount) ? book.ratingCount : null,
            image: book.image || null,
            hasChapters: true,
          });
        }
      } catch (err) {
        logger.info(`[Audible] Failed to get details for ${bookAsin}:`, err.message);
      }
    }
  } catch (err) {
    logger.info('[Audible] Search error:', err.message);
  }

  return results;
}

/**
 * Search Google Books
 */
async function searchGoogleBooks(title, author, normalizeGenres) {
  const results = [];

  try {
    let query = '';
    if (title) query += `intitle:${title}`;
    if (author) query += `${query ? '+' : ''}inauthor:${author}`;

    const searchUrl = `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(query)}&maxResults=10`;
    logger.info(`[Google Books] ${searchUrl}`);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    let response;
    try {
      response = await fetch(searchUrl, { signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
    if (response.ok) {
      const data = await response.json();
      if (data.items) {
        for (const item of data.items) {
          const vol = item.volumeInfo;

          // Try to extract series info from title (common pattern: "Title (Series Name #1)")
          let series = null;
          let seriesPosition = null;
          const seriesMatch = vol.title?.match(/\(([^)]+)\s*#?(\d+(?:\.\d+)?)\)$/);
          if (seriesMatch) {
            series = seriesMatch[1].trim();
            seriesPosition = seriesMatch[2];
          }

          // Get ISBN-13 or ISBN-10
          let isbn = null;
          if (vol.industryIdentifiers) {
            const isbn13 = vol.industryIdentifiers.find(id => id.type === 'ISBN_13');
            const isbn10 = vol.industryIdentifiers.find(id => id.type === 'ISBN_10');
            isbn = isbn13?.identifier || isbn10?.identifier || null;
          }

          results.push({
            source: 'google',
            title: vol.title || null,
            subtitle: vol.subtitle || null,
            author: vol.authors?.join(', ') || null,
            narrator: null, // Google Books doesn't have narrator
            series: series,
            series_position: seriesPosition,
            publisher: vol.publisher || null,
            published_year: vol.publishedDate ? parseInt(vol.publishedDate.split('-')[0]) : null,
            isbn: isbn,
            description: vol.description || null,
            language: vol.language || null,
            genre: normalizeGenres(vol.categories?.join(', ')) || null,
            rating: vol.averageRating?.toString() || null,
            rating_count: Number.isFinite(vol.ratingsCount) ? vol.ratingsCount : null,
            image: vol.imageLinks?.thumbnail?.replace('http:', 'https:') || null,
            hasChapters: false,
          });
        }
      }
    }
  } catch (err) {
    logger.info('[Google Books] Search error:', err.message);
  }

  return results;
}

/**
 * Search Open Library
 */
async function searchOpenLibrary(title, author, normalizeGenres) {
  const results = [];

  try {
    const queryParts = [];
    if (title) queryParts.push(`title=${encodeURIComponent(title)}`);
    if (author) queryParts.push(`author=${encodeURIComponent(author)}`);

    const searchUrl = `https://openlibrary.org/search.json?${queryParts.join('&')}&limit=10`;
    logger.info(`[Open Library] ${searchUrl}`);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    let response;
    try {
      response = await fetch(searchUrl, { signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
    if (response.ok) {
      const data = await response.json();
      if (data.docs) {
        for (const doc of data.docs.slice(0, 10)) {
          // Open Library has series info in some cases
          let series = null;
          const seriesPosition = null;

          // Try to get series from the first_series field or parse from title
          if (doc.series) {
            series = Array.isArray(doc.series) ? doc.series[0] : doc.series;
          }

          // Get cover
          let image = null;
          if (doc.cover_i) {
            image = `https://covers.openlibrary.org/b/id/${doc.cover_i}-L.jpg`;
          }

          results.push({
            source: 'openlibrary',
            title: doc.title || null,
            subtitle: doc.subtitle || null,
            author: doc.author_name?.join(', ') || null,
            narrator: null, // Open Library doesn't have narrator
            series: series,
            series_position: seriesPosition,
            publisher: doc.publisher?.[0] || null,
            published_year: doc.first_publish_year || null,
            isbn: doc.isbn?.[0] || null,
            description: null, // Would need another API call to get description
            language: doc.language?.[0] || null,
            genre: normalizeGenres(doc.subject?.slice(0, 10).join(', ')) || null,
            image: image,
            hasChapters: false,
          });
        }
      }
    }
  } catch (err) {
    logger.info('[Open Library] Search error:', err.message);
  }

  return results;
}

/**
 * Format an Open Library search result for the secondary search endpoint
 */
function formatOpenLibraryResult(book, normalizeGenres) {
  // Get cover URL if available
  let cover_url = null;
  if (book.cover_i) {
    cover_url = `https://covers.openlibrary.org/b/id/${book.cover_i}-L.jpg`;
  }

  return {
    key: book.key,
    title: book.title,
    author: book.author_name?.join(', ') || null,
    narrator: null, // Open Library doesn't have narrator info
    description: null, // Would need additional API call to get description
    genre: normalizeGenres(book.subject?.slice(0, 10).join(', ')) || null,
    series: null, // Open Library doesn't have good series data
    series_position: null,
    published_year: book.first_publish_year || null,
    cover_url: cover_url,
    language: book.language?.includes('eng') ? 'en' : book.language?.[0] || 'en',
  };
}

/**
 * Validate ISBN-10 or ISBN-13 checksum
 * Returns true if the ISBN is valid, false otherwise
 *
 * ISBN-10: Uses modulo 11 checksum (10 represented as 'X')
 * ISBN-13: Uses modulo 10 checksum with weights 1 and 3 alternating
 */
function isValidISBN(isbn) {
  if (!isbn || typeof isbn !== 'string') return false;

  // Remove hyphens and spaces, convert to uppercase
  const cleaned = isbn.replace(/[-\s]/g, '').toUpperCase();

  // ISBN-10 validation (10 characters, last can be X)
  if (cleaned.length === 10) {
    let sum = 0;
    for (let i = 0; i < 9; i++) {
      const digit = parseInt(cleaned[i], 10);
      if (isNaN(digit)) return false;
      sum += digit * (10 - i);
    }
    // Check digit (can be X representing 10)
    const last = cleaned[9];
    const checkDigit = last === 'X' ? 10 : parseInt(last, 10);
    if (isNaN(checkDigit)) return false;

    return sum % 11 === checkDigit;
  }

  // ISBN-13 validation (13 digits)
  if (cleaned.length === 13) {
    let sum = 0;
    for (let i = 0; i < 13; i++) {
      const digit = parseInt(cleaned[i], 10);
      if (isNaN(digit)) return false;
      sum += digit * (i % 2 === 0 ? 1 : 3);
    }
    return sum % 10 === 0;
  }

  return false;
}

/**
 * Search Hardcover.app via GraphQL API
 *
 * Hardcover uses GraphQL with Books-focused metadata including:
 * - Genres, moods, content warnings
 * - Series information with positions
 * - Audiobook availability indicators (has_audiobook, audio_seconds)
 * - Community data (user counts, ratings)
 *
 * Requires HARDCOVER_API_KEY environment variable.
 * API is in beta and subject to change.
 */
async function searchHardcover(title, author, normalizeGenres, apiToken) {
  const results = [];

  // Validate API token - must be non-empty string (not null, undefined, empty, or whitespace-only)
  if (!apiToken || typeof apiToken !== 'string' || apiToken.trim().length === 0) {
    logger.info('[Hardcover] No valid API token configured, skipping search');
    return results;
  }

  // Parse and validate HARDCOVER_RESULTS_LIMIT (default: 10, range: 1-50)
  const resultsLimit = Math.min(
    Math.max(parseInt(process.env.HARDCOVER_RESULTS_LIMIT || '10', 10) || 10, 1),
    50
  );

  try {
    // Build search query - combine title and author if both provided
    const queryParts = [];
    if (title) queryParts.push(title);
    if (author) queryParts.push(author);
    const searchQuery = queryParts.join(' ').trim();

    if (!searchQuery) {
      return results;
    }

    logger.info(`[Hardcover] Searching for: "${searchQuery}"`);

    // GraphQL query for Hardcover
    // Note: results is a JSON scalar type, not a GraphQL object type
    // We query it without subselection and parse the nested structure
    const graphqlQuery = {
      query: `
        query SearchBooks($query: String!, $perPage: Int!) {
          search(
            query: $query
            query_type: "Book"
            per_page: $perPage
          ) {
            results
          }
        }
      `,
      variables: {
        query: searchQuery,
        perPage: resultsLimit
      }
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000); // 10s timeout to match other sources

    let response;
    try {
      response = await fetch('https://hardcover.app/api/graphql', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiToken}`,
          'User-Agent': 'Sappho Audiobook Server'
        },
        body: JSON.stringify(graphqlQuery),
        signal: controller.signal
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      if (response.status === 401) {
        logger.warn('[Hardcover] Invalid or expired API token');
      } else if (response.status === 429) {
        logger.warn('[Hardcover] Rate limited - too many requests');
      } else {
        logger.warn(`[Hardcover] API returned status ${response.status}`);
      }
      return results;
    }

    const data = await response.json();

    // Handle GraphQL errors
    if (data.errors) {
      logger.warn('[Hardcover] GraphQL errors:', JSON.stringify(data.errors));
      return results;
    }

    // Hardcover returns results as a JSON object with nested structure:
    // results: { found: number, hits: [ { document: {...}, highlight: {...} } ] }
    const searchResults = data?.data?.search?.results;
    if (!searchResults || !searchResults.hits) {
      logger.info('[Hardcover] No hits in search results');
      return results;
    }

    const books = searchResults.hits.map(hit => hit.document);

    for (const book of books) {
      // Skip books without a title (shouldn't happen but defensive)
      if (!book.title) continue;

      // Extract series info - Hardcover has both series_names array and featured_series object
      let series = null;
      let seriesPosition = null;

      if (book.featured_series) {
        // featured_series might be an object with a name property, or just a string
        series = typeof book.featured_series === 'object' ? book.featured_series.name || book.featured_series.title : book.featured_series;
        seriesPosition = book.featured_series_position;
      } else if (book.series_names && book.series_names.length > 0) {
        // series_names might contain objects or strings
        const firstSeries = book.series_names[0];
        series = typeof firstSeries === 'object' ? firstSeries.name || firstSeries.title : firstSeries;
      }

      // Combine genres and moods for a richer genre field
      const allGenres = [];
      if (book.genres) allGenres.push(...book.genres);
      if (book.moods) allGenres.push(...book.moods);

      // Get ISBN-13 preferentially, or ISBN-10, or any valid ISBN
      // Validates ISBN checksum to ensure it's a real ISBN
      let isbn = null;
      if (book.isbns && book.isbns.length > 0) {
        // Prefer ISBN-13, then ISBN-10, but validate all with checksum
        isbn = book.isbns.find(isbnStr => isbnStr.length === 13 && isValidISBN(isbnStr)) ||
               book.isbns.find(isbnStr => isbnStr.length === 10 && isValidISBN(isbnStr)) ||
               book.isbns.find(isbnStr => isValidISBN(isbnStr)) ||
               book.isbns[0]; // Fallback to first ISBN even if invalid (better than nothing)
      }

      // Cover image - Try API-provided image fields first, fall back to slug-based URL
      let image = null;
      if (book.image || book.cover_url || book.cached_image) {
        image = book.image || book.cover_url || book.cached_image;
      } else if (book.slug) {
        // Fallback: Construct URL from slug (may not work for all books)
        image = `https://hardcover.app/books/${book.slug}/image.jpg`;
      }

      results.push({
        source: 'hardcover',
        title: book.title,
        subtitle: book.subtitle || null,
        author: book.author_names?.map(a => typeof a === 'object' ? a.name || a.title || a : a).join(', ') || null,
        narrator: null, // Hardcover doesn't track narrator info
        series: series,
        series_position: seriesPosition,
        description: book.description || null,
        genre: normalizeGenres(allGenres.map(g => typeof g === 'object' ? g.name || g.title || g : g).join(', ')) || null,
        published_year: book.release_year || null,
        isbn: isbn,
        rating: book.rating?.toString() || null,
        rating_count: Number.isFinite(book.ratings_count) ? book.ratings_count : null,
        image: image,
        hasChapters: false,
        // Hardcover-specific fields - don't include objects in the result
        has_audiobook: book.has_audiobook || false,
        audio_seconds: book.audio_seconds || null,
        moods: book.moods?.map(m => typeof m === 'object' ? m.name || m.title || m : m).join(', ') || null,
        tags: book.tags?.map(t => typeof t === 'object' ? t.name || t.title || t : t).join(', ') || null,
        users_count: book.users_count || null,
      });
    }

    logger.info(`[Hardcover] Found ${results.length} results for "${searchQuery}"`);
  } catch (err) {
    if (err.name === 'AbortError') {
      logger.warn('[Hardcover] Request timeout (>10s)');
    } else {
      logger.info('[Hardcover] Search error:', err.message);
    }
  }

  return results;
}

module.exports = {
  searchAudible,
  searchGoogleBooks,
  searchOpenLibrary,
  searchHardcover,
  formatOpenLibraryResult
};
