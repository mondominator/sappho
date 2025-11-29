const express = require('express');
const router = express.Router();
const db = require('../database');
const fs = require('fs');
const path = require('path');
const { authenticateToken } = require('../auth');

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

// Get all audiobooks
router.get('/', authenticateToken, (req, res) => {
  const { genre, author, series, search, limit = 50, offset = 0 } = req.query;
  const userId = req.user.id;

  let query = `SELECT a.*, p.position as progress_position, p.completed as progress_completed
               FROM audiobooks a
               LEFT JOIN playback_progress p ON a.id = p.audiobook_id AND p.user_id = ?
               WHERE 1=1`;
  const params = [userId];

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

  query += ' ORDER BY a.title ASC LIMIT ? OFFSET ?';
  params.push(parseInt(limit), parseInt(offset));

  db.all(query, params, (err, audiobooks) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }

    // Transform progress fields into nested object
    const transformedAudiobooks = audiobooks.map(book => ({
      ...book,
      progress: book.progress_position !== null ? {
        position: book.progress_position,
        completed: book.progress_completed
      } : null
    }));
    delete transformedAudiobooks.forEach(b => {
      delete b.progress_position;
      delete b.progress_completed;
    });

    // Get total count
    let countQuery = 'SELECT COUNT(*) as total FROM audiobooks WHERE 1=1';
    const countParams = [];

    if (genre) {
      countQuery += ' AND genre LIKE ?';
      countParams.push(`%${genre}%`);
    }

    if (author) {
      countQuery += ' AND author LIKE ?';
      countParams.push(`%${author}%`);
    }

    if (series) {
      countQuery += ' AND series LIKE ?';
      countParams.push(`%${series}%`);
    }

    if (search) {
      countQuery += ' AND (title LIKE ? OR author LIKE ? OR narrator LIKE ? OR series LIKE ?)';
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

// Get single audiobook
router.get('/:id', authenticateToken, (req, res) => {
  db.get('SELECT * FROM audiobooks WHERE id = ?', [req.params.id], (err, audiobook) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    if (!audiobook) {
      return res.status(404).json({ error: 'Audiobook not found' });
    }
    res.json(audiobook);
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

// Search Audible catalog and get details from Audnexus (admin only)
// Uses Audible's public catalog API (same as Audiobookshelf)
router.get('/:id/search-audnexus', authenticateToken, async (req, res) => {
  // Check if user is admin
  if (!req.user.is_admin) {
    return res.status(403).json({ error: 'Admin access required' });
  }

  const { title, author, asin } = req.query;

  try {
    let asins = [];

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
      console.log(`[Audnexus Search] Searching Audible: ${searchUrl}`);

      const searchResponse = await fetch(searchUrl, { timeout: 10000 });

      if (searchResponse.ok) {
        const searchData = await searchResponse.json();
        if (searchData.products && searchData.products.length > 0) {
          asins = searchData.products.map(p => p.asin).filter(Boolean);
        }
      } else {
        console.log(`[Audnexus Search] Audible search failed: ${searchResponse.status}`);
      }
    }

    if (asins.length === 0) {
      return res.json({
        results: [],
        message: 'No audiobooks found. Try a different title or author.'
      });
    }

    // Get full details from Audnexus for each ASIN
    const results = [];
    for (const bookAsin of asins.slice(0, 10)) {
      try {
        const response = await fetch(`https://api.audnex.us/books/${bookAsin}`);
        if (response.ok) {
          const book = await response.json();

          // Extract genres and tags separately
          const genres = book.genres?.filter(g => g.type === 'genre').map(g => g.name) || [];
          const tags = book.genres?.filter(g => g.type === 'tag').map(g => g.name) || [];

          // Extract year from releaseDate
          const publishedYear = book.releaseDate ? parseInt(book.releaseDate.split('-')[0]) : null;

          results.push({
            // Core fields
            asin: book.asin,
            title: book.title,
            subtitle: book.subtitle || null,
            author: book.authors?.map(a => a.name).join(', ') || null,
            narrator: book.narrators?.map(n => n.name).join(', ') || null,

            // Series info
            series: book.seriesPrimary?.name || null,
            series_position: book.seriesPrimary?.position || null,

            // Publication info
            publisher: book.publisherName || null,
            published_year: publishedYear,
            copyright_year: book.copyright || null,
            release_date: book.releaseDate || null,

            // Identifiers
            isbn: book.isbn || null,

            // Content info
            description: book.summary ? book.summary.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim() : null,
            language: book.language || null,
            runtime: book.runtimeLengthMin || null,
            abridged: book.formatType === 'abridged' ? 1 : 0,

            // Categories
            genre: genres.join(', ') || null,
            tags: tags.join(', ') || null,

            // Rating
            rating: book.rating || null,

            // Cover
            image: book.image || null,
          });
        }
      } catch (err) {
        console.log(`[Audnexus Search] Failed to get details for ${bookAsin}:`, err.message);
      }
    }

    if (results.length === 0) {
      return res.json({
        results: [],
        message: 'Found audiobooks on Audible but could not get details. Try again later.'
      });
    }

    res.json({ results });
  } catch (error) {
    console.error('Audible/Audnexus search error:', error);
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

// Stream audiobook
router.get('/:id/stream', authenticateToken, (req, res) => {
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

    if (range) {
      const parts = range.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunksize = (end - start) + 1;
      const file = fs.createReadStream(filePath, { start, end });
      const head = {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunksize,
        'Content-Type': 'audio/mpeg',
      };
      res.writeHead(206, head);
      file.pipe(res);
    } else {
      const head = {
        'Content-Length': fileSize,
        'Content-Type': 'audio/mpeg',
      };
      res.writeHead(200, head);
      fs.createReadStream(filePath).pipe(res);
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

// Delete audiobook
router.delete('/:id', authenticateToken, (req, res) => {
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

// Update audiobook metadata (admin only)
router.put('/:id', authenticateToken, (req, res) => {
  // Check if user is admin
  if (!req.user.is_admin) {
    return res.status(403).json({ error: 'Admin access required' });
  }

  const {
    title, subtitle, author, narrator, description, genre, tags,
    series, series_position, published_year, copyright_year,
    publisher, isbn, asin, language, rating, abridged
  } = req.body;

  db.run(
    `UPDATE audiobooks
     SET title = ?, subtitle = ?, author = ?, narrator = ?, description = ?, genre = ?, tags = ?,
         series = ?, series_position = ?, published_year = ?, copyright_year = ?,
         publisher = ?, isbn = ?, asin = ?, language = ?, rating = ?, abridged = ?,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [
      title, subtitle, author, narrator, description, genre, tags,
      series, series_position, published_year, copyright_year,
      publisher, isbn, asin, language, rating, abridged ? 1 : 0,
      req.params.id
    ],
    function (err) {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      if (this.changes === 0) {
        return res.status(404).json({ error: 'Audiobook not found' });
      }
      res.json({ message: 'Audiobook updated successfully' });
    }
  );
});

// Embed metadata into audio file tags (admin only)
router.post('/:id/embed-metadata', authenticateToken, async (req, res) => {
  // Check if user is admin
  if (!req.user.is_admin) {
    return res.status(403).json({ error: 'Admin access required' });
  }

  const { execFile } = require('child_process');
  const { promisify } = require('util');
  const execFileAsync = promisify(execFile);

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

    const ext = path.extname(audiobook.file_path).toLowerCase();
    const tempPath = audiobook.file_path + '.tmp' + ext;

    // Build ffmpeg arguments for metadata embedding
    const args = [
      '-i', audiobook.file_path,
      '-c', 'copy', // Copy streams without re-encoding
    ];

    // Add metadata tags
    if (audiobook.title) args.push('-metadata', `title=${audiobook.title}`);
    if (audiobook.author) args.push('-metadata', `artist=${audiobook.author}`);
    if (audiobook.author) args.push('-metadata', `album_artist=${audiobook.author}`);
    if (audiobook.narrator) args.push('-metadata', `composer=${audiobook.narrator}`);
    if (audiobook.description) args.push('-metadata', `comment=${audiobook.description}`);
    if (audiobook.genre) args.push('-metadata', `genre=${audiobook.genre}`);
    if (audiobook.published_year) args.push('-metadata', `date=${audiobook.published_year}`);
    if (audiobook.series) {
      args.push('-metadata', `album=${audiobook.series}`);
      if (audiobook.series_position) {
        args.push('-metadata', `track=${audiobook.series_position}`);
      }
    }

    // Output to temp file
    args.push('-y', tempPath);

    console.log(`Embedding metadata into ${audiobook.file_path}`);

    // Run ffmpeg
    await execFileAsync('ffmpeg', args, { timeout: 600000 }); // 10 min timeout

    // Replace original with temp file
    fs.renameSync(tempPath, audiobook.file_path);

    console.log(`Successfully embedded metadata into ${audiobook.file_path}`);
    res.json({ message: 'Metadata embedded successfully' });
  } catch (error) {
    console.error('Error embedding metadata:', error);
    // Clean up temp file if it exists
    try {
      const audiobook = await new Promise((resolve, reject) => {
        db.get('SELECT file_path FROM audiobooks WHERE id = ?', [req.params.id], (err, row) => {
          if (err) reject(err);
          else resolve(row);
        });
      });
      if (audiobook) {
        const ext = path.extname(audiobook.file_path).toLowerCase();
        const tempPath = audiobook.file_path + '.tmp' + ext;
        if (fs.existsSync(tempPath)) {
          fs.unlinkSync(tempPath);
        }
      }
    } catch (e) { /* ignore cleanup errors */ }
    res.status(500).json({ error: 'Failed to embed metadata: ' + error.message });
  }
});

// Search Open Library for metadata (admin only)
router.get('/:id/search-metadata', authenticateToken, async (req, res) => {
  // Check if user is admin
  if (!req.user.is_admin) {
    return res.status(403).json({ error: 'Admin access required' });
  }

  const { title, author } = req.query;

  try {
    // Search by title/author
    if (!title && !author) {
      return res.status(400).json({ error: 'Provide title or author to search' });
    }

    let allResults = [];

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
    genre: book.subject?.slice(0, 3).join(', ') || null,
    series: null, // Open Library doesn't have good series data
    series_position: null,
    published_year: book.first_publish_year || null,
    cover_url: cover_url,
    language: book.language?.includes('eng') ? 'en' : book.language?.[0] || 'en',
  };
}

// Refresh metadata from file
router.post('/:id/refresh-metadata', authenticateToken, async (req, res) => {
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

    // Return updated audiobook
    const updatedAudiobook = await new Promise((resolve, reject) => {
      db.get('SELECT * FROM audiobooks WHERE id = ?', [req.params.id], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });

    res.json({ message: 'Metadata refreshed successfully', audiobook: updatedAudiobook });
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

  // Update progress in database
  db.run(
    `INSERT INTO playback_progress (user_id, audiobook_id, position, completed, updated_at)
     VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(user_id, audiobook_id) DO UPDATE SET
       position = excluded.position,
       completed = excluded.completed,
       updated_at = excluded.updated_at`,
    [userId, audiobookId, position, completed],
    (err) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }

      // Update session tracking
      const sessionManager = require('../services/sessionManager');
      const websocketManager = require('../services/websocketManager');

      const sessionId = `sapho-${userId}-${audiobookId}`;

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
        }
      });

      res.json({ message: 'Progress updated' });
    }
  );
});

// Get cover art
router.get('/:id/cover', authenticateToken, (req, res) => {
  db.get('SELECT cover_image FROM audiobooks WHERE id = ?', [req.params.id], (err, audiobook) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    if (!audiobook || !audiobook.cover_image) {
      return res.status(404).json({ error: 'Cover image not found' });
    }

    const coverPath = audiobook.cover_image;

    if (!fs.existsSync(coverPath)) {
      return res.status(404).json({ error: 'Cover image file not found' });
    }

    res.sendFile(path.resolve(coverPath));
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
       COUNT(DISTINCT CASE WHEN p.completed = 1 THEN a.id END) as completed_count
     FROM audiobooks a
     LEFT JOIN playback_progress p ON a.id = p.audiobook_id AND p.user_id = ?
     WHERE a.series IS NOT NULL
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
          completed_count: s.completed_count || 0
        }));
      res.json(seriesWithCovers);
    }
  );
});

// Get all authors
router.get('/meta/authors', authenticateToken, (req, res) => {
  db.all(
    `SELECT DISTINCT author, COUNT(*) as book_count
     FROM audiobooks
     WHERE author IS NOT NULL
     GROUP BY author
     ORDER BY author ASC`,
    [],
    (err, authors) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      res.json(authors);
    }
  );
});

// Get recently added audiobooks
router.get('/meta/recent', authenticateToken, (req, res) => {
  const limit = parseInt(req.query.limit) || 10;
  const userId = req.user.id;

  db.all(
    `SELECT a.*, p.position as progress_position, p.completed as progress_completed
     FROM audiobooks a
     LEFT JOIN playback_progress p ON a.id = p.audiobook_id AND p.user_id = ?
     ORDER BY a.created_at DESC
     LIMIT ?`,
    [userId, limit],
    (err, audiobooks) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }

      // Transform progress fields into nested object
      const transformedAudiobooks = audiobooks.map(book => ({
        ...book,
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

// Get in-progress audiobooks (Up Next / Continue Listening)
router.get('/meta/in-progress', authenticateToken, (req, res) => {
  const limit = parseInt(req.query.limit) || 10;

  db.all(
    `SELECT a.*, p.position as progress_position, p.completed as progress_completed, p.updated_at as last_played
     FROM audiobooks a
     INNER JOIN playback_progress p ON a.id = p.audiobook_id
     WHERE p.user_id = ? AND p.completed = 0 AND p.position >= 20
     ORDER BY p.updated_at DESC
     LIMIT ?`,
    [req.user.id, limit],
    (err, audiobooks) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }

      // Transform progress fields into nested object
      const transformedAudiobooks = audiobooks.map(book => ({
        ...book,
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

// Get ALL in-progress audiobooks (all users) - for monitoring systems
router.get('/meta/in-progress/all', authenticateToken, (req, res) => {
  const limit = parseInt(req.query.limit) || 100;

  db.all(
    `SELECT a.*, p.position, p.updated_at as last_played, p.user_id
     FROM audiobooks a
     INNER JOIN playback_progress p ON a.id = p.audiobook_id
     WHERE p.completed = 0 AND p.position >= 20
     ORDER BY p.updated_at DESC
     LIMIT ?`,
    [limit],
    (err, audiobooks) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      res.json(audiobooks);
    }
  );
});

// Get "up next" books - next book in series after currently listening books
router.get('/meta/up-next', authenticateToken, (req, res) => {
  const limit = parseInt(req.query.limit) || 10;

  db.all(
    `WITH RankedBooks AS (
       SELECT a.*,
              p.position as progress_position,
              p.completed as progress_completed,
              ROW_NUMBER() OVER (
                PARTITION BY a.series
                ORDER BY COALESCE(a.series_index, a.series_position, 0) ASC
              ) as row_num
       FROM audiobooks a
       LEFT JOIN playback_progress p ON a.id = p.audiobook_id AND p.user_id = ?
       WHERE a.series IS NOT NULL AND a.series != ''
       AND (a.series_index IS NOT NULL OR a.series_position IS NOT NULL)
       AND EXISTS (
         SELECT 1
         FROM audiobooks a2
         INNER JOIN playback_progress p2 ON a2.id = p2.audiobook_id
         WHERE p2.user_id = ?
         AND (p2.completed = 1 OR p2.position > 0)
         AND a2.series = a.series
         AND COALESCE(a2.series_index, a2.series_position, 0) < COALESCE(a.series_index, a.series_position, 0)
       )
       AND (p.position IS NULL OR p.position = 0)
       AND (p.completed IS NULL OR p.completed = 0)
     )
     SELECT * FROM RankedBooks
     WHERE row_num = 1
     ORDER BY series ASC
     LIMIT ?`,
    [req.user.id, req.user.id, limit],
    (err, audiobooks) => {
      if (err) {
        console.error('Error in up-next query:', err);
        return res.status(500).json({ error: err.message });
      }

      // Transform progress fields into nested object
      const transformedAudiobooks = audiobooks.map(book => ({
        ...book,
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

// Get finished audiobooks (completed = 1) in random order
router.get('/meta/finished', authenticateToken, (req, res) => {
  const limit = parseInt(req.query.limit) || 10;

  db.all(
    `SELECT a.*, p.position as progress_position, p.completed as progress_completed
     FROM audiobooks a
     INNER JOIN playback_progress p ON a.id = p.audiobook_id
     WHERE p.user_id = ? AND p.completed = 1
     ORDER BY RANDOM()
     LIMIT ?`,
    [req.user.id, limit],
    (err, audiobooks) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }

      // Transform progress fields into nested object
      const transformedAudiobooks = audiobooks.map(book => ({
        ...book,
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

module.exports = router;
