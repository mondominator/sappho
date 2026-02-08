/**
 * Audiobooks Routes
 *
 * API endpoints for audiobook management, streaming, and playback progress
 */

const express = require('express');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const fs = require('fs');
const path = require('path');
const { generateContentHash } = require('../utils/contentHash');

/**
 * Default dependencies - used when route is required directly
 */
const defaultDependencies = {
  db: () => require('../database'),
  auth: () => require('../auth'),
  fileOrganizer: () => require('../services/fileOrganizer'),
  activityService: () => require('../services/activityService'),
  conversionService: () => require('../services/conversionService'),
  genres: () => require('../utils/genres'),
};

// SECURITY: Rate limiting for conversion job endpoints
const jobStatusLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 60, // 60 requests per minute (polling every 2 seconds)
  message: { error: 'Too many job status requests, please try again later' },
});

const jobCancelLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10, // 10 cancellations per minute
  message: { error: 'Too many cancel requests, please try again later' },
});

const batchDeleteLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10, // 10 batch deletes per minute
  message: { error: 'Too many delete requests, please try again later' },
});

// SECURITY: Generate unique session IDs with random component
function generateSessionId(userId, audiobookId) {
  const random = crypto.randomBytes(8).toString('hex');
  return `sappho-${userId}-${audiobookId}-${random}`;
}

// SECURITY: Map to track active session IDs per user/audiobook pair
const activeSessionIds = new Map(); // key: `${userId}-${audiobookId}`, value: sessionId

function getOrCreateSessionId(userId, audiobookId) {
  const key = `${userId}-${audiobookId}`;
  if (!activeSessionIds.has(key)) {
    activeSessionIds.set(key, generateSessionId(userId, audiobookId));
  }
  return activeSessionIds.get(key);
}

function clearSessionId(userId, audiobookId) {
  const key = `${userId}-${audiobookId}`;
  activeSessionIds.delete(key);
}

// Export for use by library scanner - uses conversion service to check active conversions
// This needs to work at module level, so it uses the default dependency
const isDirectoryBeingConverted = (dir) => defaultDependencies.conversionService().isDirectoryLocked(dir);
module.exports.isDirectoryBeingConverted = isDirectoryBeingConverted;

/**
 * Strip HTML tags and decode HTML entities from text
 */
function sanitizeHtml(text) {
  if (!text) return text;
  return text
    .replace(/<[^>]*>/g, '')  // Strip HTML tags
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, num) => String.fromCharCode(num))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\s+/g, ' ')  // Normalize whitespace
    .trim();
}

/**
 * Extract real client IP address from request
 * Checks X-Forwarded-For and other proxy headers first
 */
function getClientIP(req) {
  // Check X-Forwarded-For header (set by proxies/load balancers)
  const xForwardedFor = req.headers['x-forwarded-for'];
  if (xForwardedFor) {
    // X-Forwarded-For can be a comma-separated list: "client, proxy1, proxy2"
    // The first IP is the original client
    const ips = xForwardedFor.split(',').map(ip => ip.trim());
    return ips[0];
  }

  // Check X-Real-IP header (set by some reverse proxies)
  const xRealIP = req.headers['x-real-ip'];
  if (xRealIP) {
    return xRealIP;
  }

  // Check CF-Connecting-IP (Cloudflare)
  const cfConnectingIP = req.headers['cf-connecting-ip'];
  if (cfConnectingIP) {
    return cfConnectingIP;
  }

  // Fallback to direct connection IP
  return req.ip || req.connection.remoteAddress || null;
}

/**
 * Create audiobooks routes with injectable dependencies
 * @param {Object} deps - Dependencies (for testing)
 * @param {Object} deps.db - Database module
 * @param {Object} deps.auth - Auth module
 * @param {Object} deps.fileOrganizer - File organizer service
 * @param {Object} deps.activityService - Activity service
 * @param {Object} deps.conversionService - Conversion service
 * @param {Object} deps.genres - Genres utility module
 * @returns {express.Router}
 */
function createAudiobooksRouter(deps = {}) {
  const router = express.Router();

  // Resolve dependencies (use provided or defaults)
  const db = deps.db || defaultDependencies.db();
  const auth = deps.auth || defaultDependencies.auth();
  const fileOrganizer = deps.fileOrganizer || defaultDependencies.fileOrganizer();
  const activityService = deps.activityService || defaultDependencies.activityService();
  const conversionService = deps.conversionService || defaultDependencies.conversionService();
  const genres = deps.genres || defaultDependencies.genres();

  const { authenticateToken, authenticateMediaToken, requireAdmin } = auth;
  const { organizeAudiobook, needsOrganization } = fileOrganizer;
  const { GENRE_MAPPINGS, DEFAULT_GENRE_METADATA, normalizeGenres } = genres;

  /**
   * Queue the next book in a series when the current book is finished.
   * This makes the next book appear at the top of "Continue Listening".
   */
  function queueNextInSeries(userId, finishedAudiobookId) {
    // Get the finished audiobook's series info
    db.get(
      'SELECT series, series_position, series_index FROM audiobooks WHERE id = ?',
      [finishedAudiobookId],
      (err, finishedBook) => {
        if (err || !finishedBook || !finishedBook.series) {
          return; // No series, nothing to queue
        }

        const currentPosition = finishedBook.series_position || finishedBook.series_index || 0;

        // Find the next unfinished book in the series
        db.get(
          `SELECT a.id, a.title FROM audiobooks a
           LEFT JOIN playback_progress p ON a.id = p.audiobook_id AND p.user_id = ?
           WHERE a.series = ?
             AND COALESCE(a.series_position, a.series_index, 0) > ?
             AND (a.is_available = 1 OR a.is_available IS NULL)
             AND (p.completed IS NULL OR p.completed = 0)
           ORDER BY COALESCE(a.series_position, a.series_index, 0) ASC
           LIMIT 1`,
          [userId, finishedBook.series, currentPosition],
          (err, nextBook) => {
            if (err || !nextBook) {
              return; // No next book found
            }

            // Queue the next book by setting queued_at
            db.run(
              `INSERT INTO playback_progress (user_id, audiobook_id, position, completed, queued_at, updated_at)
               VALUES (?, ?, 0, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
               ON CONFLICT(user_id, audiobook_id) DO UPDATE SET
                 queued_at = CURRENT_TIMESTAMP,
                 updated_at = CURRENT_TIMESTAMP`,
              [userId, nextBook.id],
              (err) => {
                if (!err) {
                  console.log(`Queued next book in series: "${nextBook.title}" for user ${userId}`);
                }
              }
            );
          }
        );
      }
    );
  }

  // Get all audiobooks
  router.get('/', authenticateToken, (req, res) => {
  const { genre, author, series, search, favorites, includeUnavailable, limit: rawLimit = 50, offset: rawOffset = 0 } = req.query;
  const limit = Math.min(Math.max(1, parseInt(rawLimit) || 50), 200);
  const offset = Math.max(0, parseInt(rawOffset) || 0);
  const userId = req.user.id;

  let query = `SELECT a.*, p.position as progress_position, p.completed as progress_completed,
                      p.updated_at as progress_updated_at,
                      CASE WHEN f.id IS NOT NULL THEN 1 ELSE 0 END as is_favorite,
                      ur.rating as user_rating,
                      (SELECT AVG(ur2.rating) FROM user_ratings ur2 WHERE ur2.audiobook_id = a.id AND ur2.rating IS NOT NULL) as average_rating
               FROM audiobooks a
               LEFT JOIN playback_progress p ON a.id = p.audiobook_id AND p.user_id = ?
               LEFT JOIN user_favorites f ON a.id = f.audiobook_id AND f.user_id = ?
               LEFT JOIN user_ratings ur ON a.id = ur.audiobook_id AND ur.user_id = ?
               WHERE 1=1`;
  const params = [userId, userId, userId];

  // Filter out unavailable books by default (unless includeUnavailable=true)
  if (includeUnavailable !== 'true') {
    query += ' AND (a.is_available = 1 OR a.is_available IS NULL)';
  }

  if (genre) {
    query += ' AND a.genre LIKE ?';
    params.push(`%${genre}%`);
  }

  if (author) {
    query += ' AND a.author LIKE ?';
    params.push(`%${author}%`);
  }

  if (series) {
    query += ' AND a.series LIKE ?';
    params.push(`%${series}%`);
  }

  if (search) {
    query += ' AND (a.title LIKE ? OR a.author LIKE ? OR a.narrator LIKE ? OR a.series LIKE ?)';
    params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
  }

  if (favorites === 'true') {
    query += ' AND f.id IS NOT NULL';
  }

  query += ' ORDER BY a.title ASC LIMIT ? OFFSET ?';
  params.push(parseInt(limit), parseInt(offset));

  db.all(query, params, (err, audiobooks) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }

    // Transform progress and rating fields into nested/clean format
    const transformedAudiobooks = audiobooks.map(book => {
      const { progress_position, progress_completed, progress_updated_at, is_favorite, user_rating, average_rating, ...rest } = book;
      return {
        ...rest,
        normalized_genre: normalizeGenres(book.genre),
        is_favorite: !!is_favorite,
        user_rating: user_rating || null,
        average_rating: average_rating ? Math.round(average_rating * 10) / 10 : null,
        progress: progress_position !== null ? {
          position: progress_position,
          completed: progress_completed,
          updated_at: progress_updated_at
        } : null
      };
    });

    // Get total count
    let countQuery = favorites === 'true'
      ? `SELECT COUNT(*) as total FROM audiobooks a
         INNER JOIN user_favorites f ON a.id = f.audiobook_id AND f.user_id = ?
         WHERE 1=1`
      : 'SELECT COUNT(*) as total FROM audiobooks a WHERE 1=1';
    const countParams = favorites === 'true' ? [userId] : [];

    // Filter out unavailable books by default (unless includeUnavailable=true)
    if (includeUnavailable !== 'true') {
      countQuery += ' AND (a.is_available = 1 OR a.is_available IS NULL)';
    }

    if (genre) {
      countQuery += ' AND a.genre LIKE ?';
      countParams.push(`%${genre}%`);
    }

    if (author) {
      countQuery += ' AND a.author LIKE ?';
      countParams.push(`%${author}%`);
    }

    if (series) {
      countQuery += ' AND a.series LIKE ?';
      countParams.push(`%${series}%`);
    }

    if (search) {
      countQuery += ' AND (a.title LIKE ? OR a.author LIKE ? OR a.narrator LIKE ? OR a.series LIKE ?)';
      countParams.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
    }

    db.get(countQuery, countParams, (err, count) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      res.json({ audiobooks: transformedAudiobooks, total: count.total });
    });
  });
});

// Get all favorites for the current user
// NOTE: This route MUST be defined before /:id to avoid being matched as an ID
router.get('/favorites', authenticateToken, (req, res) => {
  db.all(
    `SELECT a.*,
            p.position as progress_position,
            p.completed as progress_completed,
            f.created_at as favorited_at
     FROM user_favorites f
     INNER JOIN audiobooks a ON f.audiobook_id = a.id
     LEFT JOIN playback_progress p ON a.id = p.audiobook_id AND p.user_id = ?
     WHERE f.user_id = ?
     ORDER BY f.created_at DESC`,
    [req.user.id, req.user.id],
    (err, audiobooks) => {
      if (err) {
        console.error('Error fetching favorites:', err);
        return res.status(500).json({ error: 'Failed to fetch favorites' });
      }

      // Transform progress fields into nested object
      const transformedAudiobooks = audiobooks.map(book => ({
        ...book,
        normalized_genre: normalizeGenres(book.genre),
        is_favorite: true,
        progress: {
          position: book.progress_position,
          completed: book.progress_completed
        }
      }));
      transformedAudiobooks.forEach(b => {
        delete b.progress_position;
        delete b.progress_completed;
      });

      res.json(transformedAudiobooks);
    }
  );
});

// Get single audiobook
router.get('/:id', authenticateToken, (req, res) => {
  db.get('SELECT * FROM audiobooks WHERE id = ?', [req.params.id], (err, audiobook) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    if (!audiobook) {
      return res.status(404).json({ error: 'Audiobook not found' });
    }

    // Check if audiobook is in user's favorites
    db.get(
      'SELECT id FROM user_favorites WHERE user_id = ? AND audiobook_id = ?',
      [req.user.id, req.params.id],
      (err, favorite) => {
        if (err) {
          console.error('Error checking favorite status:', err);
          // Don't fail the whole request, just skip favorite status
          return res.json({ ...audiobook, normalized_genre: normalizeGenres(audiobook.genre) });
        }
        res.json({ ...audiobook, normalized_genre: normalizeGenres(audiobook.genre), is_favorite: !!favorite });
      }
    );
  });
});

// Get chapters for a multi-file audiobook
router.get('/:id/chapters', authenticateToken, (req, res) => {
  db.all(
    'SELECT * FROM audiobook_chapters WHERE audiobook_id = ? ORDER BY chapter_number ASC',
    [req.params.id],
    (err, chapters) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      res.json(chapters || []);
    }
  );
});

// Update chapter titles (admin only)
router.put('/:id/chapters', authenticateToken, async (req, res) => {
  // Check if user is admin
  if (!req.user.is_admin) {
    return res.status(403).json({ error: 'Admin access required' });
  }

  const { chapters } = req.body;

  if (!chapters || !Array.isArray(chapters)) {
    return res.status(400).json({ error: 'Chapters array required' });
  }

  try {
    // Update each chapter title
    for (const chapter of chapters) {
      if (chapter.id && chapter.title !== undefined) {
        await new Promise((resolve, reject) => {
          db.run(
            'UPDATE audiobook_chapters SET title = ? WHERE id = ? AND audiobook_id = ?',
            [chapter.title, chapter.id, req.params.id],
            (err) => {
              if (err) reject(err);
              else resolve();
            }
          );
        });
      }
    }

    res.json({ message: 'Chapters updated successfully' });
  } catch (error) {
    console.error('Error updating chapters:', error);
    res.status(500).json({ error: 'Failed to update chapters' });
  }
});

// Fetch chapters from Audnexus by ASIN (admin only)
router.post('/:id/fetch-chapters', authenticateToken, async (req, res) => {
  // Check if user is admin
  if (!req.user.is_admin) {
    return res.status(403).json({ error: 'Admin access required' });
  }

  const { asin } = req.body;

  if (!asin) {
    return res.status(400).json({ error: 'ASIN is required' });
  }

  try {
    // Get the audiobook's file path (needed for chapter records)
    const audiobook = await new Promise((resolve, reject) => {
      db.get('SELECT file_path FROM audiobooks WHERE id = ?', [req.params.id], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });

    if (!audiobook || !audiobook.file_path) {
      return res.status(404).json({ error: 'Audiobook not found' });
    }

    // Fetch chapters from Audnexus
    const response = await fetch(`https://api.audnex.us/books/${asin}/chapters`);

    if (!response.ok) {
      if (response.status === 404) {
        return res.status(404).json({ error: 'No chapters found for this ASIN' });
      }
      return res.status(500).json({ error: 'Failed to fetch chapters from Audnexus' });
    }

    const data = await response.json();

    if (!data.chapters || data.chapters.length === 0) {
      return res.status(404).json({ error: 'No chapters found' });
    }

    // Delete existing chapters for this audiobook
    await new Promise((resolve, reject) => {
      db.run('DELETE FROM audiobook_chapters WHERE audiobook_id = ?', [req.params.id], (err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    // Insert new chapters (use audiobook's file_path for all chapters)
    for (let i = 0; i < data.chapters.length; i++) {
      const chapter = data.chapters[i];
      await new Promise((resolve, reject) => {
        db.run(
          `INSERT INTO audiobook_chapters (audiobook_id, chapter_number, file_path, title, start_time, duration)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [
            req.params.id,
            i + 1,
            audiobook.file_path,
            chapter.title || `Chapter ${i + 1}`,
            Math.floor(chapter.startOffsetMs / 1000), // Convert ms to seconds
            Math.floor(chapter.lengthMs / 1000) // Convert ms to seconds
          ],
          (err) => {
            if (err) reject(err);
            else resolve();
          }
        );
      });
    }

    // Update the ASIN in the audiobook record if not already set
    await new Promise((resolve, reject) => {
      db.run(
        'UPDATE audiobooks SET asin = ? WHERE id = ? AND (asin IS NULL OR asin = "")',
        [asin, req.params.id],
        (err) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });

    res.json({
      message: `Successfully imported ${data.chapters.length} chapters`,
      chapterCount: data.chapters.length
    });
  } catch (error) {
    console.error('Error fetching chapters:', error);
    res.status(500).json({ error: 'Failed to fetch chapters: ' + error.message });
  }
});

// Helper: Search Audible and get details from Audnexus
async function searchAudible(title, author, asin) {
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

      const searchResponse = await fetch(searchUrl);
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
        const response = await fetch(`https://api.audnex.us/books/${bookAsin}`);
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

// Helper: Search Google Books
async function searchGoogleBooks(title, author) {
  const results = [];

  try {
    let query = '';
    if (title) query += `intitle:${title}`;
    if (author) query += `${query ? '+' : ''}inauthor:${author}`;

    const searchUrl = `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(query)}&maxResults=10`;
    console.log(`[Google Books] ${searchUrl}`);

    const response = await fetch(searchUrl);
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

// Helper: Search Open Library
async function searchOpenLibrary(title, author) {
  const results = [];

  try {
    const queryParts = [];
    if (title) queryParts.push(`title=${encodeURIComponent(title)}`);
    if (author) queryParts.push(`author=${encodeURIComponent(author)}`);

    const searchUrl = `https://openlibrary.org/search.json?${queryParts.join('&')}&limit=10`;
    console.log(`[Open Library] ${searchUrl}`);

    const response = await fetch(searchUrl);
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

// Search multiple sources for metadata (admin only)
router.get('/:id/search-audnexus', authenticateToken, async (req, res) => {
  // Check if user is admin
  if (!req.user.is_admin) {
    return res.status(403).json({ error: 'Admin access required' });
  }

  const { title, author, asin } = req.query;

  if (!title && !author && !asin) {
    return res.json({ results: [], message: 'Provide title or author to search' });
  }

  try {
    // Search all sources in parallel
    const [audibleResults, googleResults, openLibraryResults] = await Promise.all([
      searchAudible(title, author, asin),
      searchGoogleBooks(title, author),
      searchOpenLibrary(title, author),
    ]);

    console.log(`[Search] Found: Audible=${audibleResults.length}, Google=${googleResults.length}, OpenLibrary=${openLibraryResults.length}`);

    // Combine results - Audible first (best for audiobooks), then others
    const results = [
      ...audibleResults,
      ...googleResults,
      ...openLibraryResults,
    ];

    if (results.length === 0) {
      return res.json({
        results: [],
        message: 'No results found. Try a different title or author.'
      });
    }

    res.json({
      results,
      sources: {
        audible: audibleResults.length,
        google: googleResults.length,
        openlibrary: openLibraryResults.length,
      }
    });
  } catch (error) {
    console.error('Multi-source search error:', error);
    res.status(500).json({ error: 'Failed to search: ' + error.message });
  }
});

// Get all files in the audiobook's directory
router.get('/:id/directory-files', authenticateToken, (req, res) => {
  db.get('SELECT file_path FROM audiobooks WHERE id = ?', [req.params.id], (err, audiobook) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    if (!audiobook || !audiobook.file_path) {
      return res.status(404).json({ error: 'Audiobook not found' });
    }

    try {
      // Get the directory containing the audiobook file
      const directory = path.dirname(audiobook.file_path);

      // List all files in the directory
      const files = fs.readdirSync(directory);

      // Filter to only audio files and sort them
      const audioExtensions = ['.mp3', '.m4a', '.m4b', '.flac', '.ogg', '.wav'];
      const audioFiles = files
        .filter(file => {
          const ext = path.extname(file).toLowerCase();
          return audioExtensions.includes(ext);
        })
        .map(file => {
          const fullPath = path.join(directory, file);
          const stats = fs.statSync(fullPath);
          return {
            name: file,
            path: fullPath,
            size: stats.size,
            extension: path.extname(file).toLowerCase()
          };
        })
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

      res.json(audioFiles);
    } catch (error) {
      console.error('Error reading directory:', error);
      res.status(500).json({ error: 'Failed to read directory' });
    }
  });
});

// Delete a specific file from an audiobook directory (admin only)
router.delete('/:id/files', authenticateToken, requireAdmin, (req, res) => {
  const { file_path } = req.body;
  if (!file_path) {
    return res.status(400).json({ error: 'file_path is required' });
  }

  db.get('SELECT * FROM audiobooks WHERE id = ?', [req.params.id], (err, audiobook) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    if (!audiobook) {
      return res.status(404).json({ error: 'Audiobook not found' });
    }

    // Verify the file is in the audiobook's directory (security check)
    const audiobookDir = path.dirname(audiobook.file_path);

    if (!file_path.startsWith(audiobookDir)) {
      return res.status(403).json({ error: 'Cannot delete files outside audiobook directory' });
    }

    // Prevent deleting the main audiobook file
    if (file_path === audiobook.file_path) {
      return res.status(400).json({ error: 'Cannot delete the main audiobook file. Use delete audiobook instead.' });
    }

    try {
      if (!fs.existsSync(file_path)) {
        return res.status(404).json({ error: 'File not found' });
      }

      fs.unlinkSync(file_path);
      console.log(`Deleted file: ${file_path}`);
      res.json({ message: 'File deleted successfully' });
    } catch (error) {
      console.error('Error deleting file:', error);
      res.status(500).json({ error: 'Failed to delete file: ' + error.message });
    }
  });
});

/**
 * Get the appropriate MIME type for an audio file based on extension
 */
function getAudioMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const mimeTypes = {
    '.mp3': 'audio/mpeg',
    '.m4b': 'audio/mp4',
    '.m4a': 'audio/mp4',
    '.mp4': 'audio/mp4',
    '.ogg': 'audio/ogg',
    '.flac': 'audio/flac',
    '.wav': 'audio/wav',
    '.opus': 'audio/opus',
    '.aac': 'audio/aac',
    '.wma': 'audio/x-ms-wma',
  };
  return mimeTypes[ext] || 'audio/mpeg';
}

// Stream audiobook (uses authenticateMediaToken to allow query string tokens for <audio> tags)
router.get('/:id/stream', authenticateMediaToken, (req, res) => {
  db.get('SELECT * FROM audiobooks WHERE id = ?', [req.params.id], (err, audiobook) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    if (!audiobook) {
      return res.status(404).json({ error: 'Audiobook not found' });
    }

    const filePath = audiobook.file_path;

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Audio file not found' });
    }

    const stat = fs.statSync(filePath);
    const fileSize = stat.size;
    const range = req.headers.range;
    const contentType = getAudioMimeType(filePath);

    // Generate ETag from file size and modification time for cache validation
    const etag = `"${stat.size}-${stat.mtime.getTime()}"`;
    const lastModified = stat.mtime.toUTCString();

    // Check if client has valid cached version
    if (req.headers['if-none-match'] === etag) {
      return res.status(304).end();
    }

    // Common headers for caching and buffering optimization
    const cacheHeaders = {
      'Accept-Ranges': 'bytes',
      'Content-Type': contentType,
      'ETag': etag,
      'Last-Modified': lastModified,
      // Allow caching for 1 hour, revalidate after
      'Cache-Control': 'private, max-age=3600, must-revalidate',
    };

    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

      // Validate range values
      if (isNaN(start) || start < 0 || start >= fileSize || end < start || end >= fileSize) {
        res.writeHead(416, { 'Content-Range': `bytes */${fileSize}` });
        return res.end();
      }

      const chunksize = (end - start) + 1;
      const file = fs.createReadStream(filePath, { start, end });
      file.on('error', (streamErr) => {
        console.error('Stream read error:', streamErr.message);
        if (!res.headersSent) res.status(500).end();
        else res.end();
      });
      const head = {
        ...cacheHeaders,
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Content-Length': chunksize,
      };
      res.writeHead(206, head);
      file.pipe(res);
    } else {
      const head = {
        ...cacheHeaders,
        'Content-Length': fileSize,
      };
      res.writeHead(200, head);
      const file = fs.createReadStream(filePath);
      file.on('error', (streamErr) => {
        console.error('Stream read error:', streamErr.message);
        if (!res.headersSent) res.status(500).end();
        else res.end();
      });
      file.pipe(res);
    }
  });
});

// Download audiobook
router.get('/:id/download', authenticateToken, (req, res) => {
  db.get('SELECT * FROM audiobooks WHERE id = ?', [req.params.id], (err, audiobook) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    if (!audiobook) {
      return res.status(404).json({ error: 'Audiobook not found' });
    }

    const filePath = audiobook.file_path;

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Audio file not found' });
    }

    const filename = path.basename(filePath);
    res.download(filePath, `${audiobook.title}.${filename.split('.').pop()}`);
  });
});

// Delete audiobook (admin only)
router.delete('/:id', authenticateToken, requireAdmin, (req, res) => {
  db.get('SELECT * FROM audiobooks WHERE id = ?', [req.params.id], (err, audiobook) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    if (!audiobook) {
      return res.status(404).json({ error: 'Audiobook not found' });
    }

    // Delete file
    if (fs.existsSync(audiobook.file_path)) {
      fs.unlinkSync(audiobook.file_path);
    }

    // Delete cover image if exists
    if (audiobook.cover_image && fs.existsSync(audiobook.cover_image)) {
      fs.unlinkSync(audiobook.cover_image);
    }

    // Delete from database
    db.run('DELETE FROM audiobooks WHERE id = ?', [req.params.id], (err) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      res.json({ message: 'Audiobook deleted successfully' });
    });
  });
});

/**
 * Check if a hostname is a private/internal address (SSRF protection)
 */
function isPrivateHostname(hostname) {
  // Normalize hostname
  const host = hostname.toLowerCase();

  // Block localhost variants
  if (host === 'localhost' || host === 'localhost.localdomain') {
    return true;
  }

  // Block IPv6 loopback
  if (host === '::1' || host === '[::1]') {
    return true;
  }

  // Check if it's an IP address
  const ipv4Regex = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
  const match = host.match(ipv4Regex);

  if (match) {
    const [, a, b, c, d] = match.map(Number);

    // Loopback (127.0.0.0/8)
    if (a === 127) return true;

    // Private ranges (RFC 1918)
    if (a === 10) return true;                                    // 10.0.0.0/8
    if (a === 172 && b >= 16 && b <= 31) return true;            // 172.16.0.0/12
    if (a === 192 && b === 168) return true;                     // 192.168.0.0/16

    // Link-local (169.254.0.0/16) - includes AWS metadata endpoint
    if (a === 169 && b === 254) return true;

    // Carrier-grade NAT (100.64.0.0/10)
    if (a === 100 && b >= 64 && b <= 127) return true;

    // Documentation ranges (should not be routable)
    if (a === 192 && b === 0 && c === 2) return true;            // 192.0.2.0/24
    if (a === 198 && b === 51 && c === 100) return true;         // 198.51.100.0/24
    if (a === 203 && b === 0 && c === 113) return true;          // 203.0.113.0/24

    // Broadcast
    if (a === 255 && b === 255 && c === 255 && d === 255) return true;

    // 0.0.0.0
    if (a === 0 && b === 0 && c === 0 && d === 0) return true;
  }

  // Block cloud metadata endpoints by hostname
  const metadataHosts = [
    'metadata.google.internal',
    'metadata.goog',
    'instance-data',
  ];
  if (metadataHosts.some(h => host === h || host.endsWith('.' + h))) {
    return true;
  }

  return false;
}

// Helper function to download cover image from URL
async function downloadCover(url, audiobookId) {
  try {
    const https = require('https');
    const http = require('http');

    const dataDir = process.env.DATA_DIR || path.join(__dirname, '../../data');
    const coversDir = path.join(dataDir, 'covers');
    if (!fs.existsSync(coversDir)) {
      fs.mkdirSync(coversDir, { recursive: true });
    }

    // Determine extension from URL or default to jpg
    const parsedUrl = new URL(url);

    // SECURITY: SSRF protection - block private/internal addresses
    if (isPrivateHostname(parsedUrl.hostname)) {
      throw new Error('Private or internal URLs are not allowed');
    }

    let ext = path.extname(parsedUrl.pathname).toLowerCase();
    if (!['.jpg', '.jpeg', '.png', '.webp'].includes(ext)) {
      ext = '.jpg';
    }

    const coverPath = path.join(coversDir, `audiobook_${audiobookId}${ext}`);

    return new Promise((resolve, reject) => {
      const protocol = url.startsWith('https') ? https : http;
      // Build request options with headers (required for Amazon CDN and other image servers)
      const requestOptions = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (url.startsWith('https') ? 443 : 80),
        path: parsedUrl.pathname + parsedUrl.search,
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; Sappho/1.0; +https://github.com/mondominator/sappho)',
          'Accept': 'image/*,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
        }
      };
      const request = protocol.get(requestOptions, (response) => {
        // Handle redirects
        if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          downloadCover(response.headers.location, audiobookId).then(resolve).catch(reject);
          return;
        }

        if (response.statusCode !== 200) {
          reject(new Error(`Failed to download cover: HTTP ${response.statusCode}`));
          return;
        }

        const fileStream = fs.createWriteStream(coverPath);
        response.pipe(fileStream);
        fileStream.on('finish', () => {
          fileStream.close();
          console.log(`Downloaded cover to: ${coverPath}`);
          resolve(coverPath);
        });
        fileStream.on('error', (err) => {
          fs.unlink(coverPath, () => {}); // Clean up partial file
          reject(err);
        });
      });

      request.on('error', reject);
      request.setTimeout(30000, () => {
        request.destroy();
        reject(new Error('Cover download timeout'));
      });
    });
  } catch (error) {
    console.error('Error downloading cover:', error);
    return null;
  }
}

// Update audiobook metadata (admin only)
router.put('/:id', authenticateToken, async (req, res) => {
  // Check if user is admin
  if (!req.user.is_admin) {
    return res.status(403).json({ error: 'Admin access required' });
  }

  const {
    title, subtitle, author, narrator, description, genre, tags,
    series, series_position, published_year, copyright_year,
    publisher, isbn, asin, language, rating, abridged, cover_url
  } = req.body;

  try {
    // Get current audiobook to check if author/title changed
    const currentBook = await new Promise((resolve, reject) => {
      db.get('SELECT * FROM audiobooks WHERE id = ?', [req.params.id], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });

    if (!currentBook) {
      return res.status(404).json({ error: 'Audiobook not found' });
    }

    // Check if fields that affect file organization are changing
    const authorChanged = author !== undefined && author !== currentBook.author;
    const titleChanged = title !== undefined && title !== currentBook.title;
    const seriesChanged = series !== undefined && series !== currentBook.series;
    const seriesPositionChanged = series_position !== undefined && series_position !== currentBook.series_position;

    // Download cover from URL if provided
    let newCoverPath = currentBook.cover_path;
    let newCoverImage = currentBook.cover_image;
    if (cover_url) {
      try {
        console.log(`Downloading cover from URL: ${cover_url}`);
        const downloadedCover = await downloadCover(cover_url, req.params.id);
        if (downloadedCover) {
          newCoverImage = downloadedCover;
          newCoverPath = downloadedCover;
        }
      } catch (coverErr) {
        console.error('Failed to download cover:', coverErr.message);
        // Continue with update even if cover download fails
      }
    }

    // Recalculate content hash if title or author changed to keep dedup in sync
    const newTitle = title !== undefined ? title : currentBook.title;
    const newAuthor = author !== undefined ? author : currentBook.author;
    const contentHash = generateContentHash(newTitle, newAuthor, currentBook.duration);

    // Update database with new metadata (keep current file_path for now)
    await new Promise((resolve, reject) => {
      db.run(
        `UPDATE audiobooks
         SET title = ?, subtitle = ?, author = ?, narrator = ?, description = ?, genre = ?, tags = ?,
             series = ?, series_position = ?, published_year = ?, copyright_year = ?,
             publisher = ?, isbn = ?, asin = ?, language = ?, rating = ?, abridged = ?,
             cover_path = ?, cover_image = ?, content_hash = ?,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [
          title, subtitle, author, narrator, sanitizeHtml(description), genre, tags,
          series, series_position, published_year, copyright_year,
          publisher, isbn, asin, language, rating, abridged ? 1 : 0,
          newCoverPath, newCoverImage, contentHash,
          req.params.id
        ],
        function (err) {
          if (err) reject(err);
          else resolve(this.changes);
        }
      );
    });

    // Check if file reorganization is needed (author, title, series, or position changed)
    let fileReorganized = false;
    let newFilePath = currentBook.file_path;

    if ((authorChanged || titleChanged || seriesChanged || seriesPositionChanged) &&
        fs.existsSync(currentBook.file_path)) {
      // Re-fetch the audiobook with updated metadata
      const updatedBook = await new Promise((resolve, reject) => {
        db.get('SELECT * FROM audiobooks WHERE id = ?', [req.params.id], (err, row) => {
          if (err) reject(err);
          else resolve(row);
        });
      });

      // Use the centralized file organizer to move files
      if (updatedBook && needsOrganization(updatedBook)) {
        const result = await organizeAudiobook(updatedBook);
        if (result.moved) {
          fileReorganized = true;
          newFilePath = result.newPath;
        } else if (result.error) {
          console.error('File reorganization failed:', result.error);
        }
      }
    }

    res.json({
      message: fileReorganized
        ? 'Audiobook updated and file reorganized successfully'
        : 'Audiobook updated successfully',
      fileReorganized,
      newPath: fileReorganized ? newFilePath : undefined
    });

  } catch (error) {
    console.error('Error updating audiobook:', error);
    res.status(500).json({ error: error.message });
  }
});

// Embed metadata into audio file tags using tone (admin only)
// Uses tone for M4B/M4A files (proper audiobook tag support) and ffmpeg for other formats
router.post('/:id/embed-metadata', authenticateToken, async (req, res) => {
  // Check if user is admin
  if (!req.user.is_admin) {
    return res.status(403).json({ error: 'Admin access required' });
  }

  const { execFile } = require('child_process');
  const { promisify } = require('util');
  const execFileAsync = promisify(execFile);

  let metadataJsonFile = null;
  let tempPath = null;

  try {
    // Get audiobook from database
    const audiobook = await new Promise((resolve, reject) => {
      db.get('SELECT * FROM audiobooks WHERE id = ?', [req.params.id], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });

    if (!audiobook) {
      return res.status(404).json({ error: 'Audiobook not found' });
    }

    if (!fs.existsSync(audiobook.file_path)) {
      return res.status(404).json({ error: 'Audio file not found on disk' });
    }

    // Get chapters from database
    const chapters = await new Promise((resolve, reject) => {
      db.all(
        'SELECT * FROM audiobook_chapters WHERE audiobook_id = ? ORDER BY chapter_number ASC',
        [req.params.id],
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows || []);
        }
      );
    });

    const ext = path.extname(audiobook.file_path).toLowerCase();
    const dir = path.dirname(audiobook.file_path);

    // Determine cover file path (check cover_path first, then cover_image as fallback)
    const coverFile = (audiobook.cover_path && fs.existsSync(audiobook.cover_path))
      ? audiobook.cover_path
      : (audiobook.cover_image && fs.existsSync(audiobook.cover_image))
        ? audiobook.cover_image
        : null;

    // Use tone for M4B/M4A files - supports proper audiobook tags (MVNM, MVIN, narrator, etc.)
    if (ext === '.m4b' || ext === '.m4a') {
      // Create a JSON file with metadata to avoid command line escaping issues
      metadataJsonFile = path.join(dir, `metadata_${req.params.id}.json`);

      // Build metadata object for tone
      const toneMetadata = {
        meta: {}
      };

      // Basic metadata
      if (audiobook.title) {
        toneMetadata.meta.title = audiobook.title;
        toneMetadata.meta.sortTitle = audiobook.title.replace(/^(The|A|An)\s+/i, '');
      }
      if (audiobook.subtitle) toneMetadata.meta.subtitle = audiobook.subtitle;
      if (audiobook.author) {
        toneMetadata.meta.artist = audiobook.author;
        toneMetadata.meta.albumArtist = audiobook.author;
        // Sort by last name if comma-separated, otherwise use as-is
        const authorParts = audiobook.author.split(',');
        toneMetadata.meta.sortArtist = authorParts.length > 1 ? audiobook.author : audiobook.author;
        toneMetadata.meta.sortAlbumArtist = toneMetadata.meta.sortArtist;
      }
      if (audiobook.narrator) {
        toneMetadata.meta.narrator = audiobook.narrator;
        toneMetadata.meta.composer = audiobook.narrator;
        toneMetadata.meta.sortComposer = audiobook.narrator;
      }
      if (audiobook.description) {
        toneMetadata.meta.description = audiobook.description;
        // Use longDescription for full text if description is long
        if (audiobook.description.length > 255) {
          toneMetadata.meta.longDescription = audiobook.description;
        }
      }
      if (audiobook.genre) toneMetadata.meta.genre = audiobook.genre;
      // publishingDate needs full ISO date format, not just year
      if (audiobook.published_year) {
        toneMetadata.meta.publishingDate = `${audiobook.published_year}-01-01`;
      }
      if (audiobook.publisher) toneMetadata.meta.publisher = audiobook.publisher;
      if (audiobook.copyright_year) toneMetadata.meta.copyright = String(audiobook.copyright_year);

      // Set iTunes media type to Audiobook
      toneMetadata.meta.itunesMediaType = 'Audiobook';

      // Tags/grouping
      if (audiobook.tags) toneMetadata.meta.group = audiobook.tags;

      // Series info - use movement tags (proper audiobook series tags)
      if (audiobook.series) {
        toneMetadata.meta.movementName = audiobook.series;
        toneMetadata.meta.album = audiobook.series;
        toneMetadata.meta.sortAlbum = audiobook.series;
        if (audiobook.series_position) {
          // movement is a string in tone's JSON format
          toneMetadata.meta.movement = String(audiobook.series_position);
          toneMetadata.meta.part = String(audiobook.series_position);
        }
      }

      // Embed cover art if available
      if (coverFile) {
        try {
          const coverData = fs.readFileSync(coverFile);
          const base64Cover = coverData.toString('base64');
          const coverExt = path.extname(coverFile).toLowerCase();
          const mimetype = coverExt === '.png' ? 'image/png' : 'image/jpeg';

          toneMetadata.meta.embeddedPictures = [{
            type: 2,  // Front cover
            code: 3,  // Front cover code
            mimetype: mimetype,
            data: base64Cover
          }];
          console.log(`Including cover art from ${coverFile}`);
        } catch (coverErr) {
          console.log(`Could not read cover art: ${coverErr.message}`);
        }
      }

      // Additional fields for ASIN, ISBN, language, rating, abridged
      const hasAdditionalFields = audiobook.asin || audiobook.isbn || audiobook.language || audiobook.rating || audiobook.abridged;
      if (hasAdditionalFields) {
        toneMetadata.meta.additionalFields = {};
        if (audiobook.asin) toneMetadata.meta.additionalFields.ASIN = audiobook.asin;
        if (audiobook.isbn) toneMetadata.meta.additionalFields.ISBN = audiobook.isbn;
        if (audiobook.language) toneMetadata.meta.additionalFields.LANGUAGE = audiobook.language;
        if (audiobook.rating) toneMetadata.meta.additionalFields.RATING = audiobook.rating;
        if (audiobook.abridged) toneMetadata.meta.additionalFields.ABRIDGED = audiobook.abridged ? 'Yes' : 'No';
      }

      // Add chapters if we have them
      if (chapters.length > 0) {
        toneMetadata.meta.chapters = chapters.map(chapter => ({
          start: Math.floor((chapter.start_time || 0) * 1000),  // milliseconds
          length: Math.floor((chapter.duration || 0) * 1000),
          title: chapter.title || `Chapter ${chapter.chapter_number}`
        }));
      }

      // Write JSON file
      const jsonContent = JSON.stringify(toneMetadata, null, 2);
      fs.writeFileSync(metadataJsonFile, jsonContent, 'utf8');
      console.log(`Created tone metadata JSON file with ${chapters.length} chapters`);
      console.log(`Tone metadata JSON (without cover data): ${JSON.stringify({
        ...toneMetadata,
        meta: {
          ...toneMetadata.meta,
          embeddedPictures: toneMetadata.meta.embeddedPictures ? '[cover data omitted]' : undefined
        }
      }, null, 2)}`);

      // Build tone command with JSON file
      const args = ['tag', audiobook.file_path, `--meta-tone-json-file=${metadataJsonFile}`];

      console.log(`Embedding metadata with tone into ${audiobook.file_path}${chapters.length > 0 ? ` with ${chapters.length} chapters` : ''}`);

      // Run tone
      try {
        const result = await execFileAsync('tone', args, { timeout: 600000, maxBuffer: 10 * 1024 * 1024 });
        console.log('Tone output:', result.stdout);

        // Tone prints errors to stdout and exits with code 0, so we need to check the output
        if (result.stdout && result.stdout.includes('Could not')) {
          console.error('Tone reported an error:', result.stdout);
          throw new Error(`Tone failed: ${result.stdout}`);
        }
      } catch (toneError) {
        console.error('Tone stderr:', toneError.stderr);
        console.error('Tone stdout:', toneError.stdout);
        throw new Error(`Tone failed: ${toneError.stderr || toneError.stdout || toneError.message}`);
      }

      // Clean up JSON file
      if (fs.existsSync(metadataJsonFile)) {
        fs.unlinkSync(metadataJsonFile);
      }

      console.log(`Successfully embedded metadata into ${audiobook.file_path}`);
      res.json({
        message: `Metadata embedded successfully with tone${chapters.length > 0 ? ` (${chapters.length} chapters)` : ''}`
      });

    } else {
      // For MP3 and other formats, use ffmpeg
      tempPath = audiobook.file_path + '.tmp' + ext;

      const args = ['-i', audiobook.file_path];

      // Add cover image as second input if available
      const hasCover = coverFile && ext === '.mp3';  // Cover embedding works best for MP3
      if (hasCover) {
        args.push('-i', coverFile);
      }

      // Add metadata flags
      if (audiobook.title) args.push('-metadata', `title=${audiobook.title}`);
      if (audiobook.author) args.push('-metadata', `artist=${audiobook.author}`);
      if (audiobook.author) args.push('-metadata', `album_artist=${audiobook.author}`);
      if (audiobook.narrator) args.push('-metadata', `composer=${audiobook.narrator}`);
      if (audiobook.description) args.push('-metadata', `description=${audiobook.description}`);
      if (audiobook.genre) args.push('-metadata', `genre=${audiobook.genre}`);
      if (audiobook.published_year) args.push('-metadata', `date=${audiobook.published_year}`);

      // Series info
      if (audiobook.series) {
        args.push('-metadata', `album=${audiobook.series}`);
        const seriesWithPosition = audiobook.series_position
          ? `${audiobook.series} #${audiobook.series_position}`
          : audiobook.series;
        args.push('-metadata', `grouping=${seriesWithPosition}`);
        if (audiobook.series_position) {
          args.push('-metadata', `track=${audiobook.series_position}`);
        }
      }
      if (audiobook.publisher) args.push('-metadata', `publisher=${audiobook.publisher}`);

      // Map streams and set codecs
      if (hasCover) {
        // Map audio from first input and cover image from second input
        args.push('-map', '0:a');
        args.push('-map', '1:v');
        args.push('-c:a', 'copy');
        args.push('-c:v', 'copy');
        // ID3v2 tag version (required for embedded pictures in MP3)
        args.push('-id3v2_version', '3');
        // Mark the image as front cover
        args.push('-metadata:s:v', 'title=Album cover');
        args.push('-metadata:s:v', 'comment=Cover (front)');
        console.log(`Including cover art from ${coverFile}`);
      } else {
        // No cover - just copy all streams
        args.push('-c', 'copy');
      }

      args.push('-y', tempPath);

      console.log(`Embedding metadata with ffmpeg into ${audiobook.file_path}${hasCover ? ' (with cover)' : ''}`);

      try {
        await execFileAsync('ffmpeg', args, { timeout: 600000, maxBuffer: 10 * 1024 * 1024 });
      } catch (ffmpegError) {
        console.error('FFmpeg stderr:', ffmpegError.stderr);
        throw new Error(`FFmpeg failed: ${ffmpegError.stderr || ffmpegError.message}`);
      }

      // Replace original with temp file
      fs.renameSync(tempPath, audiobook.file_path);

      console.log(`Successfully embedded metadata into ${audiobook.file_path}`);
      res.json({
        message: `Metadata embedded successfully with ffmpeg${hasCover ? ' (with cover)' : ''}`
      });
    }
  } catch (error) {
    console.error('Error embedding metadata:', error);
    // Clean up temp files
    try {
      if (metadataJsonFile && fs.existsSync(metadataJsonFile)) {
        fs.unlinkSync(metadataJsonFile);
      }
      if (tempPath && fs.existsSync(tempPath)) {
        fs.unlinkSync(tempPath);
      }
    } catch (_e) { /* ignore cleanup errors */ }
    res.status(500).json({ error: 'Failed to embed metadata: ' + error.message });
  }
});

// Convert audiobook to M4B format (admin only) - async with progress tracking
router.post('/:id/convert-to-m4b', authenticateToken, async (req, res) => {
  // Check if user is admin
  if (!req.user.is_admin) {
    return res.status(403).json({ error: 'Admin access required' });
  }

  try {
    const audiobook = await new Promise((resolve, reject) => {
      db.get('SELECT * FROM audiobooks WHERE id = ?', [req.params.id], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });

    if (!audiobook) {
      return res.status(404).json({ error: 'Audiobook not found' });
    }

    // Start async conversion - returns immediately with job ID
    const result = await conversionService.startConversion(audiobook, db);

    if (result.error) {
      return res.status(400).json({ error: result.error });
    }

    res.json({
      message: 'Conversion started',
      jobId: result.jobId,
      status: result.status
    });

  } catch (error) {
    console.error('Error starting conversion:', error);
    res.status(500).json({ error: 'Failed to start conversion: ' + error.message });
  }
});

// Get conversion job status (admin only)
router.get('/jobs/conversion/:jobId', jobStatusLimiter, authenticateToken, async (req, res) => {
  if (!req.user.is_admin) {
    return res.status(403).json({ error: 'Admin access required' });
  }

  const job = conversionService.getJobStatus(req.params.jobId);
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }

  res.json(job);
});

// Get all active conversion jobs (admin only)
router.get('/jobs/conversion', jobStatusLimiter, authenticateToken, async (req, res) => {
  if (!req.user.is_admin) {
    return res.status(403).json({ error: 'Admin access required' });
  }

  const jobs = conversionService.getActiveJobs();
  res.json({ jobs });
});

// Cancel a conversion job (admin only)
router.delete('/jobs/conversion/:jobId', jobCancelLimiter, authenticateToken, async (req, res) => {
  if (!req.user.is_admin) {
    return res.status(403).json({ error: 'Admin access required' });
  }

  const result = conversionService.cancelJob(req.params.jobId);
  if (result.error) {
    return res.status(400).json({ error: result.error });
  }

  res.json({ message: 'Job cancelled' });
});

// Get active conversion job for a specific audiobook (admin only)
router.get('/:id/conversion-status', jobStatusLimiter, authenticateToken, async (req, res) => {
  if (!req.user.is_admin) {
    return res.status(403).json({ error: 'Admin access required' });
  }

  const audiobookId = parseInt(req.params.id, 10);
  const job = conversionService.getActiveJobForAudiobook(audiobookId);

  if (!job) {
    return res.json({ active: false });
  }

  res.json({ active: true, job });
});

// Search Open Library for metadata (admin only)
router.get('/:id/search-metadata', authenticateToken, async (req, res) => {
  // Check if user is admin
  if (!req.user.is_admin) {
    return res.status(403).json({ error: 'Admin access required' });
  }

  // Ensure query params are strings (prevent type confusion from arrays)
  const title = Array.isArray(req.query.title) ? req.query.title[0] : req.query.title;
  const author = Array.isArray(req.query.author) ? req.query.author[0] : req.query.author;

  try {
    // Search by title/author
    if (!title && !author) {
      return res.status(400).json({ error: 'Provide title or author to search' });
    }

    const allResults = [];

    // Strategy 1: Search with both title and author if both provided
    if (title && author) {
      const params1 = new URLSearchParams();
      params1.append('title', title);
      params1.append('author', author);
      params1.append('limit', '10');

      const response1 = await fetch(`https://openlibrary.org/search.json?${params1.toString()}`);
      if (response1.ok) {
        const data1 = await response1.json();
        if (data1.docs) {
          allResults.push(...data1.docs);
        }
      }
    }

    // Strategy 2: General query search (more flexible matching)
    const queryParts = [];
    if (title) queryParts.push(title);
    if (author) queryParts.push(author);
    const query = queryParts.join(' ');

    const params2 = new URLSearchParams();
    params2.append('q', query);
    params2.append('limit', '15');

    const response2 = await fetch(`https://openlibrary.org/search.json?${params2.toString()}`);
    if (response2.ok) {
      const data2 = await response2.json();
      if (data2.docs) {
        // Add results not already in list
        for (const doc of data2.docs) {
          if (!allResults.find(r => r.key === doc.key)) {
            allResults.push(doc);
          }
        }
      }
    }

    // Strategy 3: Title-only search if we have title (catches series books, alternate titles)
    if (title && title.length > 3) {
      // Extract potential series/book name by removing common patterns
      const cleanTitle = title
        .replace(/[:,]\s*(book|volume|part|#)\s*\d+/gi, '')
        .replace(/\s*\([^)]*\)\s*/g, '')
        .trim();

      if (cleanTitle !== title && cleanTitle.length > 3) {
        const params3 = new URLSearchParams();
        params3.append('title', cleanTitle);
        params3.append('limit', '10');

        const response3 = await fetch(`https://openlibrary.org/search.json?${params3.toString()}`);
        if (response3.ok) {
          const data3 = await response3.json();
          if (data3.docs) {
            for (const doc of data3.docs) {
              if (!allResults.find(r => r.key === doc.key)) {
                allResults.push(doc);
              }
            }
          }
        }
      }
    }

    if (allResults.length === 0) {
      return res.json({ results: [] });
    }

    // Format and deduplicate results, limit to 15
    const results = allResults.slice(0, 15).map(book => formatOpenLibraryResult(book));

    res.json({ results });
  } catch (error) {
    console.error('Open Library search error:', error);
    res.status(500).json({ error: 'Failed to search Open Library' });
  }
});

// Helper function to format Open Library response
function formatOpenLibraryResult(book) {
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

// Refresh metadata from file (admin only)
router.post('/:id/refresh-metadata', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const audiobook = await new Promise((resolve, reject) => {
      db.get('SELECT * FROM audiobooks WHERE id = ?', [req.params.id], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });

    if (!audiobook) {
      return res.status(404).json({ error: 'Audiobook not found' });
    }

    if (!fs.existsSync(audiobook.file_path)) {
      return res.status(404).json({ error: 'Audio file not found on disk' });
    }

    // Re-extract metadata
    const { extractFileMetadata } = require('../services/fileProcessor');
    const metadata = await extractFileMetadata(audiobook.file_path);

    // Check if this is an M4B file with embedded chapters
    const ext = path.extname(audiobook.file_path).toLowerCase();
    const isM4B = ext === '.m4b';
    let chapters = null;

    if (isM4B) {
      // Extract chapters using ffprobe
      const { execFile } = require('child_process');
      const { promisify } = require('util');
      const execFileAsync = promisify(execFile);

      try {
        const { stdout } = await execFileAsync('ffprobe', [
          '-v', 'quiet',
          '-print_format', 'json',
          '-show_chapters',
          audiobook.file_path
        ]);

        const data = JSON.parse(stdout);
        if (data.chapters && data.chapters.length > 0) {
          chapters = data.chapters.map((chapter, index) => ({
            chapter_number: index + 1,
            title: chapter.tags?.title || `Chapter ${index + 1}`,
            start_time: parseFloat(chapter.start_time) || 0,
            end_time: parseFloat(chapter.end_time) || 0,
            duration: (parseFloat(chapter.end_time) || 0) - (parseFloat(chapter.start_time) || 0)
          }));
        }
      } catch (error) {
        console.log(`No chapters found in ${path.basename(audiobook.file_path)} or ffprobe failed:`, error.message);
      }
    }

    const hasChapters = chapters && chapters.length > 1;

    // Recalculate content hash to keep dedup in sync with refreshed metadata
    const contentHash = generateContentHash(metadata.title, metadata.author, metadata.duration);

    // Update database with new metadata (including extended fields)
    await new Promise((resolve, reject) => {
      db.run(
        `UPDATE audiobooks
         SET title = ?, author = ?, narrator = ?, description = ?, genre = ?,
             series = ?, series_position = ?, published_year = ?, cover_image = ?,
             duration = ?, is_multi_file = ?, isbn = ?,
             tags = ?, publisher = ?, copyright_year = ?, asin = ?,
             language = ?, rating = ?, abridged = ?, subtitle = ?,
             content_hash = ?,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [
          metadata.title,
          metadata.author,
          metadata.narrator,
          metadata.description,
          metadata.genre,
          metadata.series,
          metadata.series_position,
          metadata.published_year,
          metadata.cover_image,
          metadata.duration,
          hasChapters ? 1 : 0,
          metadata.isbn,
          metadata.tags,
          metadata.publisher,
          metadata.copyright_year,
          metadata.asin,
          metadata.language,
          metadata.rating,
          metadata.abridged ? 1 : 0,
          metadata.subtitle,
          contentHash,
          req.params.id
        ],
        (err) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });

    // Delete existing chapters and insert new ones if we have chapters
    if (hasChapters) {
      // Delete old chapters
      await new Promise((resolve, reject) => {
        db.run('DELETE FROM audiobook_chapters WHERE audiobook_id = ?', [req.params.id], (err) => {
          if (err) reject(err);
          else resolve();
        });
      });

      // Insert new chapters
      for (const chapter of chapters) {
        await new Promise((resolve, reject) => {
          db.run(
            `INSERT INTO audiobook_chapters
             (audiobook_id, chapter_number, file_path, duration, start_time, title)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [
              req.params.id,
              chapter.chapter_number,
              audiobook.file_path, // Same file for all chapters in m4b
              chapter.duration,
              chapter.start_time,
              chapter.title,
            ],
            (err) => {
              if (err) reject(err);
              else resolve();
            }
          );
        });
      }
      console.log(`Extracted ${chapters.length} chapters from ${path.basename(audiobook.file_path)}`);
    }

    // Get updated audiobook
    let updatedAudiobook = await new Promise((resolve, reject) => {
      db.get('SELECT * FROM audiobooks WHERE id = ?', [req.params.id], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });

    // Check if file needs to be reorganized based on new metadata
    let fileReorganized = false;
    if (updatedAudiobook && needsOrganization(updatedAudiobook)) {
      const result = await organizeAudiobook(updatedAudiobook);
      if (result.moved) {
        fileReorganized = true;
        // Re-fetch audiobook with updated path
        updatedAudiobook = await new Promise((resolve, reject) => {
          db.get('SELECT * FROM audiobooks WHERE id = ?', [req.params.id], (err, row) => {
            if (err) reject(err);
            else resolve(row);
          });
        });
      }
    }

    res.json({
      message: fileReorganized
        ? 'Metadata refreshed and file reorganized'
        : 'Metadata refreshed successfully',
      audiobook: updatedAudiobook,
      fileReorganized
    });
  } catch (error) {
    console.error('Error refreshing metadata:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get/Update playback progress
router.get('/:id/progress', authenticateToken, (req, res) => {
  db.get(
    'SELECT * FROM playback_progress WHERE user_id = ? AND audiobook_id = ?',
    [req.user.id, req.params.id],
    (err, progress) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      res.json(progress || { position: 0, completed: 0 });
    }
  );
});

router.post('/:id/progress', authenticateToken, (req, res) => {
  const { position, completed = 0, state = 'playing', clientInfo = {} } = req.body;
  const audiobookId = req.params.id;
  const userId = req.user.id;

  // Don't save progress until user has listened for at least 5 seconds
  // (unless marking as completed). This prevents tiny accidental progress.
  if (position < 5 && !completed) {
    return res.json({ success: true, skipped: true, message: 'Progress not saved until 5 seconds' });
  }

  // Update progress in database
  // Clear queued_at when user starts playing (position > 0), so it's no longer marked as "up next"
  db.run(
    `INSERT INTO playback_progress (user_id, audiobook_id, position, completed, updated_at)
     VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(user_id, audiobook_id) DO UPDATE SET
       position = excluded.position,
       completed = excluded.completed,
       updated_at = excluded.updated_at,
       queued_at = CASE WHEN excluded.position > 0 THEN NULL ELSE queued_at END`,
    [userId, audiobookId, position, completed],
    (err) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }

      // If book was marked as completed, queue the next book in the series
      if (completed) {
        queueNextInSeries(userId, audiobookId);
        // Record activity for finished book
        activityService.recordActivity(
          userId,
          activityService.EVENT_TYPES.FINISHED_BOOK,
          parseInt(audiobookId)
        ).catch(err => console.error('Failed to record finish activity:', err));
      }

      // Update session tracking
      const sessionManager = require('../services/sessionManager');
      const websocketManager = require('../services/websocketManager');

      // SECURITY: Use random session ID instead of predictable pattern
      const sessionId = getOrCreateSessionId(userId, audiobookId);

      // Get audiobook details for session tracking
      db.get('SELECT * FROM audiobooks WHERE id = ?', [audiobookId], (err, audiobook) => {
        if (!err && audiobook) {
          const actualState = completed ? 'stopped' : state;

          // If stopped, remove session from active tracking (like Plex/Emby)
          if (actualState === 'stopped' || completed) {
            // Get session before stopping for WebSocket broadcast
            const session = sessionManager.getSession(sessionId);
            if (session) {
              // Broadcast stop event
              websocketManager.broadcastSessionUpdate(session, 'session.stop');
            }
            // Remove from active sessions (so /api/sessions won't return it)
            sessionManager.stopSession(sessionId);
            // Clear the session ID mapping
            clearSessionId(userId, audiobookId);
          } else {
            // Update session for playing/paused states
            const session = sessionManager.updateSession({
              sessionId,
              userId,
              username: req.user.username,
              audiobook: audiobook,
              position: parseInt(position),
              state: actualState,
              clientInfo: {
                name: clientInfo.name || 'Web Player',
                platform: clientInfo.platform || 'Web',
                ipAddress: getClientIP(req),
              },
            });

            if (session) {
              // Broadcast to WebSocket clients based on state
              const eventType = actualState === 'playing' ? 'session.update' : 'session.pause';
              websocketManager.broadcastSessionUpdate(session, eventType);
            }
          }

          // Broadcast progress update for cross-device sync (so other devices refresh their UI)
          websocketManager.broadcastProgressUpdate(userId, audiobookId, {
            position: parseInt(position),
            completed: completed,
            state: actualState,
          });
        }
      });

      res.json({ message: 'Progress updated' });
    }
  );
});

// Clear/delete playback progress (removes the record entirely)
router.delete('/:id/progress', authenticateToken, (req, res) => {
  const audiobookId = req.params.id;
  const userId = req.user.id;

  db.run(
    'DELETE FROM playback_progress WHERE user_id = ? AND audiobook_id = ?',
    [userId, audiobookId],
    function(err) {
      if (err) {
        return res.status(500).json({ error: err.message });
      }

      // Also stop any active session
      const sessionManager = require('../services/sessionManager');
      const websocketManager = require('../services/websocketManager');
      // SECURITY: Use the tracked session ID, not a predictable one
      const sessionKey = `${userId}-${audiobookId}`;
      const sessionId = activeSessionIds.get(sessionKey);

      if (sessionId) {
        const session = sessionManager.getSession(sessionId);
        if (session) {
          websocketManager.broadcastSessionUpdate(session, 'session.stop');
          sessionManager.stopSession(sessionId);
        }
        clearSessionId(userId, audiobookId);
      }

      res.json({ message: 'Progress cleared' });
    }
  );
});

// Check if the immediately previous book in a series is completed
// Returns { previousBookCompleted: boolean, previousBook: { id, title, series_position } | null }
router.get('/:id/previous-book-status', authenticateToken, async (req, res) => {
  const audiobookId = parseInt(req.params.id);
  const userId = req.user.id;

  try {
    // Get the current book's series and position
    const currentBook = await new Promise((resolve, reject) => {
      db.get(
        'SELECT id, series, series_position FROM audiobooks WHERE id = ?',
        [audiobookId],
        (err, row) => {
          if (err) reject(err);
          else resolve(row);
        }
      );
    });

    if (!currentBook) {
      return res.status(404).json({ error: 'Audiobook not found' });
    }

    // If book is not in a series or has no position, no previous book
    if (!currentBook.series || !currentBook.series_position) {
      return res.json({ previousBookCompleted: false, previousBook: null });
    }

    const currentPosition = currentBook.series_position;

    // Find the immediately previous book in the series (the one with the highest position less than current)
    const previousBook = await new Promise((resolve, reject) => {
      db.get(
        `SELECT a.id, a.title, a.series_position, COALESCE(p.completed, 0) as completed
         FROM audiobooks a
         LEFT JOIN playback_progress p ON a.id = p.audiobook_id AND p.user_id = ?
         WHERE a.series = ? AND a.series_position < ?
         ORDER BY a.series_position DESC
         LIMIT 1`,
        [userId, currentBook.series, currentPosition],
        (err, row) => {
          if (err) reject(err);
          else resolve(row);
        }
      );
    });

    if (!previousBook) {
      // No previous book in series (this is book 1 or first with a position)
      return res.json({ previousBookCompleted: false, previousBook: null });
    }

    res.json({
      previousBookCompleted: previousBook.completed === 1,
      previousBook: {
        id: previousBook.id,
        title: previousBook.title,
        series_position: previousBook.series_position
      }
    });

  } catch (error) {
    console.error('Error checking previous book status:', error);
    res.status(500).json({ error: 'Failed to check previous book status' });
  }
});

// Get cover art (uses authenticateMediaToken to allow query string tokens for <img> tags)
router.get('/:id/cover', authenticateMediaToken, (req, res) => {
  db.get('SELECT cover_image, cover_path FROM audiobooks WHERE id = ?', [req.params.id], (err, audiobook) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    if (!audiobook) {
      return res.status(404).json({ error: 'Audiobook not found' });
    }

    // Check cover_path first (user-provided/external), then cover_image (extracted from audio)
    const coverPath = (audiobook.cover_path && fs.existsSync(audiobook.cover_path))
      ? audiobook.cover_path
      : (audiobook.cover_image && fs.existsSync(audiobook.cover_image))
        ? audiobook.cover_image
        : null;

    if (!coverPath) {
      return res.status(404).json({ error: 'Cover image not found' });
    }

    // SECURITY: Validate that cover path is within allowed directories
    const dataDir = path.resolve(process.env.DATA_DIR || path.join(__dirname, '../../data'));
    const audiobooksDir = path.resolve(process.env.AUDIOBOOKS_DIR || path.join(dataDir, 'audiobooks'));
    const coversDir = path.resolve(path.join(dataDir, 'covers'));

    const resolvedPath = path.resolve(coverPath);

    // Cover must be within covers directory OR audiobooks directory
    const isInCoversDir = resolvedPath.startsWith(coversDir + path.sep);
    const isInAudiobooksDir = resolvedPath.startsWith(audiobooksDir + path.sep);

    if (!isInCoversDir && !isInAudiobooksDir) {
      console.warn(`⚠️ Cover path escapes allowed directories: ${coverPath}`);
      return res.status(403).json({ error: 'Invalid cover path' });
    }

    res.sendFile(resolvedPath);
  });
});

// Get all series with cover IDs
router.get('/meta/series', authenticateToken, (req, res) => {
  const userId = req.user.id;

  db.all(
    `SELECT
       a.series,
       COUNT(DISTINCT a.id) as book_count,
       GROUP_CONCAT(DISTINCT a.id ORDER BY a.series_position) as book_ids,
       COUNT(DISTINCT CASE WHEN p.completed = 1 THEN a.id END) as completed_count,
       (SELECT AVG(ur.rating) FROM user_ratings ur
        INNER JOIN audiobooks a2 ON ur.audiobook_id = a2.id
        WHERE a2.series = a.series AND ur.rating IS NOT NULL
        AND (a2.is_available = 1 OR a2.is_available IS NULL)) as average_rating,
       (SELECT COUNT(*) FROM user_ratings ur
        INNER JOIN audiobooks a2 ON ur.audiobook_id = a2.id
        WHERE a2.series = a.series AND ur.rating IS NOT NULL
        AND (a2.is_available = 1 OR a2.is_available IS NULL)) as rating_count
     FROM audiobooks a
     LEFT JOIN playback_progress p ON a.id = p.audiobook_id AND p.user_id = ?
     WHERE a.series IS NOT NULL AND (a.is_available = 1 OR a.is_available IS NULL)
     GROUP BY a.series
     ORDER BY a.series ASC`,
    [userId],
    (err, series) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      // Convert comma-separated IDs to array and take first 4
      // Filter out series with only one book
      const seriesWithCovers = series
        .filter(s => s.book_count > 1)
        .map(s => ({
          ...s,
          cover_ids: s.book_ids ? s.book_ids.split(',').slice(0, 4) : [],
          completed_count: s.completed_count || 0,
          average_rating: s.average_rating ? Math.round(s.average_rating * 10) / 10 : null,
          rating_count: s.rating_count || 0
        }));
      res.json(seriesWithCovers);
    }
  );
});

// Get all authors with cover IDs and completion stats
router.get('/meta/authors', authenticateToken, (req, res) => {
  const userId = req.user.id;

  db.all(
    `SELECT
       a.author,
       COUNT(DISTINCT a.id) as book_count,
       GROUP_CONCAT(DISTINCT a.id) as book_ids,
       COUNT(DISTINCT CASE WHEN p.completed = 1 THEN a.id END) as completed_count
     FROM audiobooks a
     LEFT JOIN playback_progress p ON a.id = p.audiobook_id AND p.user_id = ?
     WHERE a.author IS NOT NULL AND (a.is_available = 1 OR a.is_available IS NULL)
     GROUP BY a.author
     ORDER BY author ASC`,
    [userId],
    (err, authors) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      // Convert comma-separated IDs to array and take first 4 for covers
      const authorsWithCovers = authors.map(a => ({
        ...a,
        cover_ids: a.book_ids ? a.book_ids.split(',').slice(0, 4) : [],
        completed_count: a.completed_count || 0
      }));
      // Remove book_ids from response
      authorsWithCovers.forEach(a => delete a.book_ids);
      res.json(authorsWithCovers);
    }
  );
});

// Get genre category mappings (for client-side filtering)
// Returns full genre metadata including keywords, colors, and icons
router.get('/meta/genre-mappings', authenticateToken, (req, res) => {
  res.json({
    genres: GENRE_MAPPINGS,
    defaults: DEFAULT_GENRE_METADATA
  });
});

// Get all genres (normalized to major categories) with cover IDs
router.get('/meta/genres', authenticateToken, (req, res) => {
  db.all(
    'SELECT id, genre, cover_image FROM audiobooks WHERE genre IS NOT NULL AND genre != \'\' AND (is_available = 1 OR is_available IS NULL)',
    [],
    (err, books) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }

      // Build genre data with counts and cover IDs
      const genreData = {};

      books.forEach(book => {
        // Normalize the genre string to get categories
        const normalizedGenres = normalizeGenres(book.genre);
        if (!normalizedGenres) return;

        const categories = normalizedGenres.split(', ');
        categories.forEach(genre => {
          if (!genreData[genre]) {
            genreData[genre] = {
              genre,
              count: 0,
              cover_ids: []
            };
          }
          genreData[genre].count++;
          // Collect cover IDs (up to 4 for display)
          if (book.cover_image && genreData[genre].cover_ids.length < 4) {
            genreData[genre].cover_ids.push(book.id);
          }
        });
      });

      // Convert to array and sort by count descending
      const genres = Object.values(genreData)
        .sort((a, b) => b.count - a.count);

      res.json(genres);
    }
  );
});

// Get recently added audiobooks
router.get('/meta/recent', authenticateToken, (req, res) => {
  const limit = parseInt(req.query.limit) || 10;
  const userId = req.user.id;

  db.all(
    `SELECT a.*, p.position as progress_position, p.completed as progress_completed,
            CASE WHEN f.id IS NOT NULL THEN 1 ELSE 0 END as is_favorite
     FROM audiobooks a
     LEFT JOIN playback_progress p ON a.id = p.audiobook_id AND p.user_id = ?
     LEFT JOIN user_favorites f ON a.id = f.audiobook_id AND f.user_id = ?
     WHERE (a.is_available = 1 OR a.is_available IS NULL)
     ORDER BY a.created_at DESC
     LIMIT ?`,
    [userId, userId, limit],
    (err, audiobooks) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }

      // Transform progress fields into nested object
      const transformedAudiobooks = audiobooks.map(book => ({
        ...book,
        normalized_genre: normalizeGenres(book.genre),
        is_favorite: !!book.is_favorite,
        progress: book.progress_position !== null ? {
          position: book.progress_position,
          completed: book.progress_completed
        } : null
      }));
      transformedAudiobooks.forEach(b => {
        delete b.progress_position;
        delete b.progress_completed;
      });

      res.json(transformedAudiobooks);
    }
  );
});

// Get in-progress audiobooks (Continue Listening) - ordered by most recently played
// Deduplicates by series: only shows most recently played book per series
// Standalone books (no series) are shown individually
router.get('/meta/in-progress', authenticateToken, (req, res) => {
  const limit = parseInt(req.query.limit) || 10;
  const userId = req.user.id;

  db.all(
    `WITH RankedBooks AS (
       SELECT a.*, p.position as progress_position, p.completed as progress_completed,
              p.updated_at as last_played, p.queued_at,
              CASE WHEN f.id IS NOT NULL THEN 1 ELSE 0 END as is_favorite,
              ROW_NUMBER() OVER (
                PARTITION BY CASE
                  WHEN a.series IS NOT NULL AND a.series != '' THEN a.series
                  ELSE 'standalone_' || a.id
                END
                ORDER BY p.updated_at DESC
              ) as rn
       FROM audiobooks a
       INNER JOIN playback_progress p ON a.id = p.audiobook_id
       LEFT JOIN user_favorites f ON a.id = f.audiobook_id AND f.user_id = ?
       WHERE p.user_id = ? AND p.completed = 0
         AND (p.position >= 5 OR p.queued_at IS NOT NULL)
         AND (a.is_available = 1 OR a.is_available IS NULL)
     )
     SELECT * FROM RankedBooks
     WHERE rn = 1
     ORDER BY last_played DESC
     LIMIT ?`,
    [userId, userId, limit],
    (err, audiobooks) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }

      // Transform progress fields into nested object
      const transformedAudiobooks = audiobooks.map(book => ({
        ...book,
        normalized_genre: normalizeGenres(book.genre),
        is_favorite: !!book.is_favorite,
        is_queued: !!book.queued_at,
        progress: {
          position: book.progress_position,
          completed: book.progress_completed
        }
      }));
      transformedAudiobooks.forEach(b => {
        delete b.progress_position;
        delete b.progress_completed;
        delete b.queued_at;
        delete b.rn;
      });

      res.json(transformedAudiobooks);
    }
  );
});

// Get ALL in-progress audiobooks (all users) - for monitoring systems
router.get('/meta/in-progress/all', authenticateToken, (req, res) => {
  const limit = parseInt(req.query.limit) || 100;

  db.all(
    `SELECT a.*, p.position, p.updated_at as last_played, p.user_id
     FROM audiobooks a
     INNER JOIN playback_progress p ON a.id = p.audiobook_id
     WHERE p.completed = 0 AND p.position >= 5
     ORDER BY p.updated_at DESC
     LIMIT ?`,
    [limit],
    (err, audiobooks) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      // Add normalized genre
      const transformedAudiobooks = audiobooks.map(book => ({
        ...book,
        normalized_genre: normalizeGenres(book.genre)
      }));
      res.json(transformedAudiobooks);
    }
  );
});

// Get "up next" books - next unstarted book in series where user has started or completed books
router.get('/meta/up-next', authenticateToken, (req, res) => {
  const limit = parseInt(req.query.limit) || 10;
  const userId = req.user.id;

  // Find the next UNSTARTED book in each series where user has progress on any book
  // This excludes books that are in-progress or queued (those appear in "Continue Listening")
  // Ordered by most recent activity in each series (so current series appears first)
  db.all(
    `WITH SeriesWithProgress AS (
       -- Find series where user has progress, with most recent activity time
       SELECT a.series, MAX(p.updated_at) as last_activity
       FROM audiobooks a
       INNER JOIN playback_progress p ON a.id = p.audiobook_id AND p.user_id = ?
       WHERE a.series IS NOT NULL AND a.series != ''
       AND (p.completed = 1 OR p.position > 0)
       AND (a.is_available = 1 OR a.is_available IS NULL)
       GROUP BY a.series
     ),
     NextUnstartedBooks AS (
       -- For each such series, find the first book that has NO progress at all
       SELECT a.*,
              p.position as progress_position,
              p.completed as progress_completed,
              s.last_activity,
              CASE WHEN f.id IS NOT NULL THEN 1 ELSE 0 END as is_favorite,
              ROW_NUMBER() OVER (
                PARTITION BY a.series
                ORDER BY COALESCE(a.series_index, a.series_position, 0) ASC
              ) as row_num
       FROM audiobooks a
       INNER JOIN SeriesWithProgress s ON a.series = s.series
       LEFT JOIN playback_progress p ON a.id = p.audiobook_id AND p.user_id = ?
       LEFT JOIN user_favorites f ON a.id = f.audiobook_id AND f.user_id = ?
       WHERE (a.series_index IS NOT NULL OR a.series_position IS NOT NULL)
       AND (p.position IS NULL OR p.position = 0)
       AND (p.completed IS NULL OR p.completed = 0)
       AND (p.queued_at IS NULL)
       AND (a.is_available = 1 OR a.is_available IS NULL)
     )
     SELECT * FROM NextUnstartedBooks
     WHERE row_num = 1
     ORDER BY last_activity DESC
     LIMIT ?`,
    [userId, userId, userId, limit],
    (err, audiobooks) => {
      if (err) {
        console.error('Error in up-next query:', err);
        return res.status(500).json({ error: err.message });
      }

      // Transform progress fields into nested object
      const transformedAudiobooks = audiobooks.map(book => ({
        ...book,
        normalized_genre: normalizeGenres(book.genre),
        is_favorite: !!book.is_favorite,
        progress: book.progress_position !== null ? {
          position: book.progress_position,
          completed: book.progress_completed
        } : null
      }));
      transformedAudiobooks.forEach(b => {
        delete b.progress_position;
        delete b.progress_completed;
        delete b.last_activity;
        delete b.row_num;
      });

      res.json(transformedAudiobooks);
    }
  );
});

// Get finished audiobooks (completed = 1) in random order
router.get('/meta/finished', authenticateToken, (req, res) => {
  const limit = parseInt(req.query.limit) || 10;
  const userId = req.user.id;

  db.all(
    `SELECT a.*, p.position as progress_position, p.completed as progress_completed,
            CASE WHEN f.id IS NOT NULL THEN 1 ELSE 0 END as is_favorite
     FROM audiobooks a
     INNER JOIN playback_progress p ON a.id = p.audiobook_id
     LEFT JOIN user_favorites f ON a.id = f.audiobook_id AND f.user_id = ?
     WHERE p.user_id = ? AND p.completed = 1 AND (a.is_available = 1 OR a.is_available IS NULL)
     ORDER BY RANDOM()
     LIMIT ?`,
    [userId, userId, limit],
    (err, audiobooks) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }

      // Transform progress fields into nested object
      const transformedAudiobooks = audiobooks.map(book => ({
        ...book,
        normalized_genre: normalizeGenres(book.genre),
        is_favorite: !!book.is_favorite,
        progress: {
          position: book.progress_position,
          completed: book.progress_completed
        }
      }));
      transformedAudiobooks.forEach(b => {
        delete b.progress_position;
        delete b.progress_completed;
      });

      res.json(transformedAudiobooks);
    }
  );
});

// ============================================
// FAVORITES ENDPOINTS (/:id routes only - /favorites GET is defined earlier)
// ============================================

// Check if a specific audiobook is a favorite
router.get('/:id/favorite', authenticateToken, (req, res) => {
  const audiobookId = parseInt(req.params.id);

  db.get(
    'SELECT id FROM user_favorites WHERE user_id = ? AND audiobook_id = ?',
    [req.user.id, audiobookId],
    (err, row) => {
      if (err) {
        console.error('Error checking favorite status:', err);
        return res.status(500).json({ error: 'Failed to check favorite status' });
      }

      res.json({ is_favorite: !!row });
    }
  );
});

// Add audiobook to favorites
router.post('/:id/favorite', authenticateToken, (req, res) => {
  const audiobookId = parseInt(req.params.id);

  // First check if audiobook exists
  db.get('SELECT id FROM audiobooks WHERE id = ?', [audiobookId], (err, audiobook) => {
    if (err) {
      console.error('Error checking audiobook:', err);
      return res.status(500).json({ error: 'Failed to add favorite' });
    }

    if (!audiobook) {
      return res.status(404).json({ error: 'Audiobook not found' });
    }

    // Add to favorites (IGNORE if already exists)
    db.run(
      'INSERT OR IGNORE INTO user_favorites (user_id, audiobook_id) VALUES (?, ?)',
      [req.user.id, audiobookId],
      function(err) {
        if (err) {
          console.error('Error adding favorite:', err);
          return res.status(500).json({ error: 'Failed to add favorite' });
        }

        res.json({ success: true, is_favorite: true });
      }
    );
  });
});

// Remove audiobook from favorites
router.delete('/:id/favorite', authenticateToken, (req, res) => {
  const audiobookId = parseInt(req.params.id);

  db.run(
    'DELETE FROM user_favorites WHERE user_id = ? AND audiobook_id = ?',
    [req.user.id, audiobookId],
    function(err) {
      if (err) {
        console.error('Error removing favorite:', err);
        return res.status(500).json({ error: 'Failed to remove favorite' });
      }

      res.json({ success: true, is_favorite: false });
    }
  );
});

// Toggle favorite status (convenience endpoint)
router.post('/:id/favorite/toggle', authenticateToken, (req, res) => {
  const audiobookId = parseInt(req.params.id);

  // Check current status
  db.get(
    'SELECT id FROM user_favorites WHERE user_id = ? AND audiobook_id = ?',
    [req.user.id, audiobookId],
    (err, row) => {
      if (err) {
        console.error('Error checking favorite status:', err);
        return res.status(500).json({ error: 'Failed to toggle favorite' });
      }

      if (row) {
        // Currently a favorite - remove it
        db.run(
          'DELETE FROM user_favorites WHERE user_id = ? AND audiobook_id = ?',
          [req.user.id, audiobookId],
          function(err) {
            if (err) {
              console.error('Error removing favorite:', err);
              return res.status(500).json({ error: 'Failed to remove favorite' });
            }
            res.json({ success: true, is_favorite: false });
          }
        );
      } else {
        // Not a favorite - add it (but first check audiobook exists)
        db.get('SELECT id FROM audiobooks WHERE id = ?', [audiobookId], (err, audiobook) => {
          if (err) {
            console.error('Error checking audiobook:', err);
            return res.status(500).json({ error: 'Failed to add favorite' });
          }

          if (!audiobook) {
            return res.status(404).json({ error: 'Audiobook not found' });
          }

          db.run(
            'INSERT INTO user_favorites (user_id, audiobook_id) VALUES (?, ?)',
            [req.user.id, audiobookId],
            function(err) {
              if (err) {
                console.error('Error adding favorite:', err);
                return res.status(500).json({ error: 'Failed to add favorite' });
              }
              res.json({ success: true, is_favorite: true });
            }
          );
        });
      }
    }
  );
});

// ============================================
// Book Recap (Catch Me Up) - AI-powered recap
// ============================================

// Helper to call OpenAI API
const callOpenAI = async (prompt, systemPrompt) => {
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';

  if (!apiKey) {
    throw new Error('OpenAI API key not configured');
  }

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt }
      ],
      max_tokens: 4000,
      temperature: 0.7
    })
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error?.message || 'OpenAI API request failed');
  }

  const data = await response.json();
  return data.choices[0]?.message?.content;
};

// Helper to call Google Gemini API
const callGemini = async (prompt, systemPrompt) => {
  const apiKey = process.env.GEMINI_API_KEY;
  const model = process.env.GEMINI_MODEL || 'gemini-1.5-flash';

  if (!apiKey) {
    throw new Error('Gemini API key not configured');
  }

  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      contents: [{
        parts: [{
          text: `${systemPrompt}\n\n${prompt}`
        }]
      }],
      generationConfig: {
        maxOutputTokens: 4000,
        temperature: 0.7
      }
    })
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error?.message || 'Gemini API request failed');
  }

  const data = await response.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text;
};

// Helper to call the configured AI provider
const callAI = async (prompt, systemPrompt) => {
  const provider = process.env.AI_PROVIDER || 'openai';

  if (provider === 'gemini') {
    return callGemini(prompt, systemPrompt);
  } else {
    return callOpenAI(prompt, systemPrompt);
  }
};

// Get the model used for caching purposes
const getModelUsed = () => {
  const provider = process.env.AI_PROVIDER || 'openai';
  if (provider === 'gemini') {
    return process.env.GEMINI_MODEL || 'gemini-1.5-flash';
  }
  return process.env.OPENAI_MODEL || 'gpt-4o-mini';
};

// Helper to generate hash for cache key
const generateRecapHash = (bookId, priorBooks) => {
  const bookIds = [bookId, ...priorBooks.map(b => b.id)].sort().join(',');
  return crypto.createHash('md5').update(bookIds).digest('hex');
};

// Get book recap (catch me up)
router.get('/:id/recap', authenticateToken, async (req, res) => {
  const userId = req.user.id;
  const audiobookId = parseInt(req.params.id);
  const { getRecapPrompt } = require('./settings');

  try {
    // Get the audiobook
    const audiobook = await new Promise((resolve, reject) => {
      db.get(
        `SELECT a.*, COALESCE(p.position, 0) as position, COALESCE(p.completed, 0) as completed
         FROM audiobooks a
         LEFT JOIN playback_progress p ON a.id = p.audiobook_id AND p.user_id = ?
         WHERE a.id = ?`,
        [userId, audiobookId],
        (err, row) => {
          if (err) reject(err);
          else resolve(row);
        }
      );
    });

    if (!audiobook) {
      return res.status(404).json({ error: 'Audiobook not found' });
    }

    // Check if user has progress on this book
    if (audiobook.position === 0 && audiobook.completed !== 1) {
      return res.status(400).json({
        error: 'No progress on this book yet',
        message: 'Start listening to this book to get a recap.'
      });
    }

    // Get prior books in series if this is part of a series
    let priorBooks = [];
    if (audiobook.series) {
      priorBooks = await new Promise((resolve, reject) => {
        db.all(
          `SELECT a.id, a.title, a.author, a.description, a.series_position,
                  COALESCE(p.position, 0) as position,
                  COALESCE(p.completed, 0) as completed
           FROM audiobooks a
           LEFT JOIN playback_progress p ON a.id = p.audiobook_id AND p.user_id = ?
           WHERE a.series = ? AND a.id != ?
             AND (COALESCE(p.position, 0) > 0 OR COALESCE(p.completed, 0) = 1)
             AND (a.series_position IS NULL OR a.series_position < ?)
           ORDER BY a.series_position ASC, a.title ASC`,
          [userId, audiobook.series, audiobookId, audiobook.series_position || 999],
          (err, rows) => {
            if (err) reject(err);
            else resolve(rows || []);
          }
        );
      });
    }

    // Generate cache hash
    const recapHash = generateRecapHash(audiobookId, priorBooks);

    // Check cache first
    const cached = await new Promise((resolve, reject) => {
      db.get(
        `SELECT recap_text, created_at FROM book_recaps
         WHERE user_id = ? AND audiobook_id = ? AND books_hash = ?`,
        [userId, audiobookId, recapHash],
        (err, row) => {
          if (err) reject(err);
          else resolve(row);
        }
      );
    });

    if (cached) {
      return res.json({
        recap: cached.recap_text,
        cached: true,
        cachedAt: cached.created_at,
        book: { id: audiobook.id, title: audiobook.title },
        priorBooks: priorBooks.map(b => ({ id: b.id, title: b.title, position: b.series_position }))
      });
    }

    // Check if AI is configured
    const provider = process.env.AI_PROVIDER || 'openai';
    const hasApiKey = provider === 'gemini'
      ? !!process.env.GEMINI_API_KEY
      : !!process.env.OPENAI_API_KEY;

    if (!hasApiKey) {
      return res.status(400).json({
        error: 'AI not configured',
        message: 'Please configure an AI provider in Administration > AI settings.'
      });
    }

    // Get the system prompt from settings
    const systemPrompt = getRecapPrompt();

    // Build prompt
    let prompt = '';

    if (priorBooks.length > 0) {
      const priorBooksText = priorBooks.map(b => {
        const status = b.completed ? 'completed' : 'in progress';
        return `Book ${b.series_position || '?'}: "${b.title}" (${status})${b.description ? `\nDescription: ${b.description.substring(0, 500)}` : ''}`;
      }).join('\n\n');

      prompt = `Please provide a detailed recap to help a reader remember what happened before continuing "${audiobook.title}" by ${audiobook.author || 'Unknown Author'}.

This is book ${audiobook.series_position || '?'} in the "${audiobook.series}" series.

PRIOR BOOKS THE READER HAS READ:
${priorBooksText}

CURRENT BOOK:
"${audiobook.title}"${audiobook.description ? `\nDescription: ${audiobook.description.substring(0, 500)}` : ''}

Provide a thorough recap of the prior books including major plot points, character developments, and key events. Help the reader remember where the story left off before this book.`;
    } else {
      prompt = `Please provide a brief recap/refresher for "${audiobook.title}" by ${audiobook.author || 'Unknown Author'}.

${audiobook.description ? `Description: ${audiobook.description.substring(0, 1000)}` : ''}

The reader has started this book and wants to remember what it's about and any key setup from the beginning. Provide a helpful summary without major spoilers.`;
    }

    // Call AI provider
    const recap = await callAI(prompt, systemPrompt);

    // Cache the result
    await new Promise((resolve, reject) => {
      db.run(
        `INSERT OR REPLACE INTO book_recaps (user_id, audiobook_id, books_hash, recap_text, model_used)
         VALUES (?, ?, ?, ?, ?)`,
        [userId, audiobookId, recapHash, recap, getModelUsed()],
        (err) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });

    res.json({
      recap,
      cached: false,
      book: { id: audiobook.id, title: audiobook.title },
      priorBooks: priorBooks.map(b => ({ id: b.id, title: b.title, position: b.series_position }))
    });

  } catch (error) {
    console.error('Error generating book recap:', error);
    res.status(500).json({
      error: 'Failed to generate recap',
      message: error.message
    });
  }
});

// Clear cached book recap (force regeneration)
router.delete('/:id/recap', authenticateToken, async (req, res) => {
  const userId = req.user.id;
  const audiobookId = parseInt(req.params.id);

  try {
    await new Promise((resolve, reject) => {
      db.run(
        'DELETE FROM book_recaps WHERE user_id = ? AND audiobook_id = ?',
        [userId, audiobookId],
        (err) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });

    res.json({ message: 'Recap cache cleared' });
  } catch (error) {
    console.error('Error clearing recap cache:', error);
    res.status(500).json({ error: 'Failed to clear cache' });
  }
});

// ============================================
// Batch Actions
// ============================================

// Batch mark as finished
router.post('/batch/mark-finished', authenticateToken, async (req, res) => {
  const { audiobook_ids } = req.body;
  const userId = req.user.id;

  if (!Array.isArray(audiobook_ids) || audiobook_ids.length === 0) {
    return res.status(400).json({ error: 'audiobook_ids must be a non-empty array' });
  }

  if (audiobook_ids.length > 100) {
    return res.status(400).json({ error: 'Maximum 100 audiobooks per batch' });
  }

  try {
    let successCount = 0;

    for (const audiobookId of audiobook_ids) {
      await new Promise((resolve, reject) => {
        db.run(
          `INSERT INTO playback_progress (user_id, audiobook_id, position, completed, updated_at)
           VALUES (?, ?, 0, 1, CURRENT_TIMESTAMP)
           ON CONFLICT(user_id, audiobook_id) DO UPDATE SET
             completed = 1,
             updated_at = CURRENT_TIMESTAMP`,
          [userId, audiobookId],
          function(err) {
            if (err) reject(err);
            else {
              successCount++;
              resolve();
            }
          }
        );
      });
    }

    res.json({ success: true, count: successCount });
  } catch (error) {
    console.error('Error in batch mark finished:', error);
    res.status(500).json({ error: 'Failed to mark audiobooks as finished' });
  }
});

// Batch clear progress
router.post('/batch/clear-progress', authenticateToken, async (req, res) => {
  const { audiobook_ids } = req.body;
  const userId = req.user.id;

  if (!Array.isArray(audiobook_ids) || audiobook_ids.length === 0) {
    return res.status(400).json({ error: 'audiobook_ids must be a non-empty array' });
  }

  if (audiobook_ids.length > 100) {
    return res.status(400).json({ error: 'Maximum 100 audiobooks per batch' });
  }

  try {
    const placeholders = audiobook_ids.map(() => '?').join(',');

    await new Promise((resolve, reject) => {
      db.run(
        `DELETE FROM playback_progress WHERE user_id = ? AND audiobook_id IN (${placeholders})`,
        [userId, ...audiobook_ids],
        function(err) {
          if (err) reject(err);
          else resolve(this.changes);
        }
      );
    });

    res.json({ success: true, count: audiobook_ids.length });
  } catch (error) {
    console.error('Error in batch clear progress:', error);
    res.status(500).json({ error: 'Failed to clear progress' });
  }
});

// Batch add to reading list (favorites)
router.post('/batch/add-to-reading-list', authenticateToken, async (req, res) => {
  const { audiobook_ids } = req.body;
  const userId = req.user.id;

  if (!Array.isArray(audiobook_ids) || audiobook_ids.length === 0) {
    return res.status(400).json({ error: 'audiobook_ids must be a non-empty array' });
  }

  if (audiobook_ids.length > 100) {
    return res.status(400).json({ error: 'Maximum 100 audiobooks per batch' });
  }

  try {
    let successCount = 0;

    for (const audiobookId of audiobook_ids) {
      await new Promise((resolve, reject) => {
        db.run(
          'INSERT OR IGNORE INTO user_favorites (user_id, audiobook_id) VALUES (?, ?)',
          [userId, audiobookId],
          function(err) {
            if (err) reject(err);
            else {
              if (this.changes > 0) successCount++;
              resolve();
            }
          }
        );
      });
    }

    res.json({ success: true, count: successCount });
  } catch (error) {
    console.error('Error in batch add to reading list:', error);
    res.status(500).json({ error: 'Failed to add to reading list' });
  }
});

// Batch remove from reading list
router.post('/batch/remove-from-reading-list', authenticateToken, async (req, res) => {
  const { audiobook_ids } = req.body;
  const userId = req.user.id;

  if (!Array.isArray(audiobook_ids) || audiobook_ids.length === 0) {
    return res.status(400).json({ error: 'audiobook_ids must be a non-empty array' });
  }

  if (audiobook_ids.length > 100) {
    return res.status(400).json({ error: 'Maximum 100 audiobooks per batch' });
  }

  try {
    const placeholders = audiobook_ids.map(() => '?').join(',');

    const result = await new Promise((resolve, reject) => {
      db.run(
        `DELETE FROM user_favorites WHERE user_id = ? AND audiobook_id IN (${placeholders})`,
        [userId, ...audiobook_ids],
        function(err) {
          if (err) reject(err);
          else resolve(this.changes);
        }
      );
    });

    res.json({ success: true, count: result });
  } catch (error) {
    console.error('Error in batch remove from reading list:', error);
    res.status(500).json({ error: 'Failed to remove from reading list' });
  }
});

// Batch add to collection
router.post('/batch/add-to-collection', authenticateToken, async (req, res) => {
  const { audiobook_ids, collection_id } = req.body;
  const userId = req.user.id;

  if (!Array.isArray(audiobook_ids) || audiobook_ids.length === 0) {
    return res.status(400).json({ error: 'audiobook_ids must be a non-empty array' });
  }

  if (!collection_id) {
    return res.status(400).json({ error: 'collection_id is required' });
  }

  if (audiobook_ids.length > 100) {
    return res.status(400).json({ error: 'Maximum 100 audiobooks per batch' });
  }

  try {
    // Verify collection belongs to user OR is public
    const collection = await new Promise((resolve, reject) => {
      db.get(
        'SELECT id FROM user_collections WHERE id = ? AND (user_id = ? OR is_public = 1)',
        [collection_id, userId],
        (err, row) => {
          if (err) reject(err);
          else resolve(row);
        }
      );
    });

    if (!collection) {
      return res.status(404).json({ error: 'Collection not found' });
    }

    // Get current max position
    const maxPos = await new Promise((resolve, reject) => {
      db.get(
        'SELECT MAX(position) as max_pos FROM collection_items WHERE collection_id = ?',
        [collection_id],
        (err, row) => {
          if (err) reject(err);
          else resolve(row?.max_pos || 0);
        }
      );
    });

    let successCount = 0;
    let position = maxPos;

    for (const audiobookId of audiobook_ids) {
      position++;
      await new Promise((resolve, reject) => {
        db.run(
          'INSERT OR IGNORE INTO collection_items (collection_id, audiobook_id, position) VALUES (?, ?, ?)',
          [collection_id, audiobookId, position],
          function(err) {
            if (err) reject(err);
            else {
              if (this.changes > 0) successCount++;
              resolve();
            }
          }
        );
      });
    }

    res.json({ success: true, count: successCount });
  } catch (error) {
    console.error('Error in batch add to collection:', error);
    res.status(500).json({ error: 'Failed to add to collection' });
  }
});

// Batch delete (admin only)
router.post('/batch/delete', batchDeleteLimiter, authenticateToken, async (req, res) => {
  const { audiobook_ids, delete_files } = req.body;

  if (!req.user.is_admin) {
    return res.status(403).json({ error: 'Admin access required' });
  }

  if (!Array.isArray(audiobook_ids) || audiobook_ids.length === 0) {
    return res.status(400).json({ error: 'audiobook_ids must be a non-empty array' });
  }

  if (audiobook_ids.length > 100) {
    return res.status(400).json({ error: 'Maximum 100 audiobooks per batch' });
  }

  try {
    let successCount = 0;
    const errors = [];

    for (const audiobookId of audiobook_ids) {
      try {
        // Get audiobook info first
        const audiobook = await new Promise((resolve, reject) => {
          db.get('SELECT * FROM audiobooks WHERE id = ?', [audiobookId], (err, row) => {
            if (err) reject(err);
            else resolve(row);
          });
        });

        if (!audiobook) {
          errors.push({ id: audiobookId, error: 'Not found' });
          continue;
        }

        // Delete from database
        await new Promise((resolve, reject) => {
          db.run('DELETE FROM audiobooks WHERE id = ?', [audiobookId], function(err) {
            if (err) reject(err);
            else resolve();
          });
        });

        // Optionally delete files and directory
        if (delete_files && audiobook.file_path) {
          try {
            const audioDir = path.dirname(audiobook.file_path);

            // Delete entire audiobook directory (contains audio file, cover, etc.)
            if (fs.existsSync(audioDir)) {
              fs.rmSync(audioDir, { recursive: true, force: true });
              console.log(`Deleted audiobook directory: ${audioDir}`);

              // Also try to remove empty parent directories (author folder if empty)
              const parentDir = path.dirname(audioDir);
              try {
                const parentContents = fs.readdirSync(parentDir);
                if (parentContents.length === 0) {
                  fs.rmdirSync(parentDir);
                  console.log(`Removed empty parent directory: ${parentDir}`);
                }
              } catch (_parentErr) {
                // Parent not empty or can't remove - that's fine
              }
            }
          } catch (fileErr) {
            console.error('Failed to delete files for audiobook:', audiobookId, fileErr.message);
          }
        }

        successCount++;
      } catch (err) {
        errors.push({ id: audiobookId, error: err.message });
      }
    }

    res.json({ success: true, count: successCount, errors: errors.length > 0 ? errors : undefined });
  } catch (error) {
    console.error('Error in batch delete:', error);
    res.status(500).json({ error: 'Failed to delete audiobooks' });
  }
});

  return router;
}

// Export default router for backwards compatibility with index.js
module.exports = createAudiobooksRouter();
// Export factory function for testing
module.exports.createAudiobooksRouter = createAudiobooksRouter;
// isDirectoryBeingConverted is already exported above at module level
