/**
 * Metadata Search Utilities
 *
 * External API search functions for audiobook metadata:
 * Audible (via Audnexus), Google Books, and Open Library.
 */

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
      console.log(`[Audible Search] ${searchUrl}`);

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
            image: book.image || null,
            hasChapters: true,
          });
        }
      } catch (err) {
        console.log(`[Audible] Failed to get details for ${bookAsin}:`, err.message);
      }
    }
  } catch (err) {
    console.log('[Audible] Search error:', err.message);
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
    console.log(`[Google Books] ${searchUrl}`);

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
            image: vol.imageLinks?.thumbnail?.replace('http:', 'https:') || null,
            hasChapters: false,
          });
        }
      }
    }
  } catch (err) {
    console.log('[Google Books] Search error:', err.message);
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
    console.log(`[Open Library] ${searchUrl}`);

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
    console.log('[Open Library] Search error:', err.message);
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

module.exports = {
  searchAudible,
  searchGoogleBooks,
  searchOpenLibrary,
  formatOpenLibraryResult
};
