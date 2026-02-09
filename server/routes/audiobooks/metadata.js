/**
 * Metadata Routes
 *
 * Handles audiobook metadata operations: chapters, metadata search,
 * metadata refresh, metadata embedding, and audiobook updates.
 */

const fs = require('fs');
const path = require('path');
const { sanitizeHtml, isPrivateHostname } = require('./helpers');

// Helper: Search Audible and get details from Audnexus
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

// Helper: Search Google Books
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

// Helper: Search Open Library
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

// Helper function to download cover image from URL
async function downloadCover(url, audiobookId) {
  try {
    const https = require('https');
    const http = require('http');

    const dataDir = process.env.DATA_DIR || path.join(__dirname, '../../../data');
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

function register(router, { db, authenticateToken, requireAdmin, normalizeGenres, organizeAudiobook, needsOrganization }) {

  // Get chapters for a multi-file audiobook
  router.get('/:id/chapters', authenticateToken, (req, res) => {
    db.all(
      'SELECT * FROM audiobook_chapters WHERE audiobook_id = ? ORDER BY chapter_number ASC',
      [req.params.id],
      (err, chapters) => {
        if (err) {
          return res.status(500).json({ error: 'Internal server error' });
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

    // SECURITY: Validate ASIN format to prevent SSRF (alphanumeric, 10 chars)
    if (!/^[A-Z0-9]{10}$/.test(asin)) {
      return res.status(400).json({ error: 'Invalid ASIN format' });
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
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      let response;
      try {
        response = await fetch(`https://api.audnex.us/books/${encodeURIComponent(asin)}/chapters`, { signal: controller.signal });
      } finally {
        clearTimeout(timeout);
      }

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
      res.status(500).json({ error: 'Failed to fetch chapters' });
    }
  });

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
        searchAudible(title, author, asin, normalizeGenres),
        searchGoogleBooks(title, author, normalizeGenres),
        searchOpenLibrary(title, author, normalizeGenres),
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
      res.status(500).json({ error: 'Metadata search failed' });
    }
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

        const controller1 = new AbortController();
        const timeout1 = setTimeout(() => controller1.abort(), 10000);
        let response1;
        try {
          response1 = await fetch(`https://openlibrary.org/search.json?${params1.toString()}`, { signal: controller1.signal });
        } finally {
          clearTimeout(timeout1);
        }
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

      const controller2 = new AbortController();
      const timeout2 = setTimeout(() => controller2.abort(), 10000);
      let response2;
      try {
        response2 = await fetch(`https://openlibrary.org/search.json?${params2.toString()}`, { signal: controller2.signal });
      } finally {
        clearTimeout(timeout2);
      }
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

          const controller3 = new AbortController();
          const timeout3 = setTimeout(() => controller3.abort(), 10000);
          let response3;
          try {
            response3 = await fetch(`https://openlibrary.org/search.json?${params3.toString()}`, { signal: controller3.signal });
          } finally {
            clearTimeout(timeout3);
          }
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
      const results = allResults.slice(0, 15).map(book => formatOpenLibraryResult(book, normalizeGenres));

      res.json({ results });
    } catch (error) {
      console.error('Open Library search error:', error);
      res.status(500).json({ error: 'Failed to search Open Library' });
    }
  });

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
      const { extractFileMetadata } = require('../../services/fileProcessor');
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

      // Update database with new metadata
      await new Promise((resolve, reject) => {
        db.run(
          `UPDATE audiobooks
           SET title = ?, author = ?, narrator = ?, description = ?, genre = ?,
               series = ?, series_position = ?, published_year = ?, cover_image = ?,
               duration = ?, is_multi_file = ?, updated_at = CURRENT_TIMESTAMP
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
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Embed metadata into audio file tags using tone (admin only)
  // Uses tone for M4B/M4A files (proper audiobook tag support) and ffmpeg for other formats
  router.post('/:id/embed-metadata', authenticateToken, async (req, res) => {
    // Check if user is admin
    if (!req.user.is_admin) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid audiobook ID' });
    }

    const { execFile } = require('child_process');
    const { promisify } = require('util');
    const execFileAsync = promisify(execFile);

    let metadataJsonFile = null;
    let tempPath = null;

    try {
      // Get audiobook from database
      const audiobook = await new Promise((resolve, reject) => {
        db.get('SELECT * FROM audiobooks WHERE id = ?', [id], (err, row) => {
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

      // Check write access before attempting embed
      try {
        fs.accessSync(path.dirname(audiobook.file_path), fs.constants.W_OK);
      } catch (_e) {
        return res.status(400).json({ error: 'Cannot embed metadata — the audiobook directory is read-only' });
      }

      // Get chapters from database
      const chapters = await new Promise((resolve, reject) => {
        db.all(
          'SELECT * FROM audiobook_chapters WHERE audiobook_id = ? ORDER BY chapter_number ASC',
          [id],
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

      // Create backup of original file before embedding
      const backupDir = path.join(dir, '.metadata-backups');
      let backupPath = null;
      try {
        if (!fs.existsSync(backupDir)) {
          fs.mkdirSync(backupDir, { recursive: true });
        }
        backupPath = path.join(backupDir, path.basename(audiobook.file_path));
        fs.copyFileSync(audiobook.file_path, backupPath);
        console.log(`Created backup at ${backupPath}`);
      } catch (backupErr) {
        console.warn(`Could not create backup: ${backupErr.message} — proceeding anyway`);
        backupPath = null;
      }

      // Use tone for M4B/M4A files - supports proper audiobook tags (MVNM, MVIN, narrator, etc.)
      if (ext === '.m4b' || ext === '.m4a') {
        // Create a JSON file with metadata to avoid command line escaping issues
        metadataJsonFile = path.join(dir, `metadata_${id}.json`);

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
          message: `Metadata embedded successfully with tone${chapters.length > 0 ? ` (${chapters.length} chapters)` : ''}`,
          backup: backupPath
        });

      } else {
        // For MP3, FLAC, OGG, and other formats, use ffmpeg
        tempPath = audiobook.file_path + '.tmp' + ext;

        const isMP3 = ext === '.mp3';
        const isVorbis = ext === '.flac' || ext === '.ogg' || ext === '.opus';

        const args = ['-i', audiobook.file_path];

        // Add cover image as second input if available
        const hasCover = coverFile && isMP3;  // Cover embedding works best for MP3
        if (hasCover) {
          args.push('-i', coverFile);
        }

        // Preserve existing metadata and merge with new values
        args.push('-map_metadata', '0');

        // Basic metadata
        if (audiobook.title) args.push('-metadata', `title=${audiobook.title}`);
        if (audiobook.author) {
          args.push('-metadata', `artist=${audiobook.author}`);
          args.push('-metadata', `album_artist=${audiobook.author}`);
        }
        if (audiobook.narrator) {
          args.push('-metadata', `composer=${audiobook.narrator}`);
          // For Vorbis (FLAC/OGG), write explicit NARRATOR tag
          if (isVorbis) args.push('-metadata', `NARRATOR=${audiobook.narrator}`);
        }
        if (audiobook.description) args.push('-metadata', `description=${audiobook.description}`);
        if (audiobook.genre) args.push('-metadata', `genre=${audiobook.genre}`);
        if (audiobook.published_year) args.push('-metadata', `date=${audiobook.published_year}`);
        if (audiobook.subtitle) args.push('-metadata', `subtitle=${audiobook.subtitle}`);

        // Series info — write format-appropriate tags for proper round-trip
        if (audiobook.series) {
          args.push('-metadata', `album=${audiobook.series}`);
          const seriesWithPosition = audiobook.series_position
            ? `${audiobook.series} #${audiobook.series_position}`
            : audiobook.series;
          args.push('-metadata', `grouping=${seriesWithPosition}`);
          if (audiobook.series_position) {
            args.push('-metadata', `disc=${audiobook.series_position}`);
          }
          // For Vorbis (FLAC/OGG), write explicit SERIES and PART tags
          if (isVorbis) {
            args.push('-metadata', `SERIES=${audiobook.series}`);
            if (audiobook.series_position) {
              args.push('-metadata', `PART=${audiobook.series_position}`);
            }
          }
        }

        // Additional metadata fields
        if (audiobook.publisher) args.push('-metadata', `publisher=${audiobook.publisher}`);
        if (audiobook.copyright_year) args.push('-metadata', `copyright=${audiobook.copyright_year}`);
        if (audiobook.isbn) {
          if (isVorbis) args.push('-metadata', `ISBN=${audiobook.isbn}`);
        }
        if (audiobook.asin) {
          if (isVorbis) args.push('-metadata', `ASIN=${audiobook.asin}`);
        }
        if (audiobook.language) args.push('-metadata', `language=${audiobook.language}`);

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
          message: `Metadata embedded successfully with ffmpeg${hasCover ? ' (with cover)' : ''}`,
          backup: backupPath
        });
      }
    } catch (error) {
      console.error('Error embedding metadata:', error.message || error);
      // Clean up temp files
      try {
        if (metadataJsonFile && fs.existsSync(metadataJsonFile)) {
          fs.unlinkSync(metadataJsonFile);
        }
        if (tempPath && fs.existsSync(tempPath)) {
          fs.unlinkSync(tempPath);
        }
      } catch (_e) { /* ignore cleanup errors */ }
      const message = error.message && error.message.includes('Permission denied')
        ? 'Permission denied — the audiobook directory is read-only'
        : 'Failed to embed metadata';
      res.status(500).json({ error: message });
    }
  });

  // Update audiobook metadata (admin only)
  router.put('/:id', authenticateToken, async (req, res) => {
    // Check if user is admin
    if (!req.user.is_admin) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid audiobook ID' });
    }

    const {
      title, subtitle, author, narrator, description, genre, tags,
      series, series_position, published_year, copyright_year,
      publisher, isbn, asin, language, rating, abridged, cover_url
    } = req.body;

    try {
      // Get current audiobook to check if author/title changed
      const currentBook = await new Promise((resolve, reject) => {
        db.get('SELECT * FROM audiobooks WHERE id = ?', [id], (err, row) => {
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
          const downloadedCover = await downloadCover(cover_url, id);
          if (downloadedCover) {
            newCoverImage = downloadedCover;
            newCoverPath = downloadedCover;
          }
        } catch (coverErr) {
          console.error('Failed to download cover:', coverErr.message);
          // Continue with update even if cover download fails
        }
      }

      // Update database with new metadata (keep current file_path for now)
      await new Promise((resolve, reject) => {
        db.run(
          `UPDATE audiobooks
           SET title = ?, subtitle = ?, author = ?, narrator = ?, description = ?, genre = ?, tags = ?,
               series = ?, series_position = ?, published_year = ?, copyright_year = ?,
               publisher = ?, isbn = ?, asin = ?, language = ?, rating = ?, abridged = ?,
               cover_path = ?, cover_image = ?,
               updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`,
          [
            title, subtitle, author, narrator, sanitizeHtml(description), genre, tags,
            series, series_position, published_year, copyright_year,
            publisher, isbn, asin, language, rating, abridged ? 1 : 0,
            newCoverPath, newCoverImage,
            id
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
          db.get('SELECT * FROM audiobooks WHERE id = ?', [id], (err, row) => {
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
      res.status(500).json({ error: 'Internal server error' });
    }
  });
}

// Helper function to format Open Library response
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

module.exports = { register };
