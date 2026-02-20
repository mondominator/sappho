/**
 * Metadata Routes
 *
 * Handles audiobook metadata operations: chapters, metadata search,
 * metadata refresh, metadata embedding, and audiobook updates.
 */

const fs = require('fs');
const path = require('path');
const { sanitizeHtml } = require('./helpers');
const { createDbHelpers } = require('../../utils/db');
const { createQueryHelpers } = require('../../utils/queryHelpers');
const { searchAudible, searchGoogleBooks, searchOpenLibrary, formatOpenLibraryResult } = require('../../services/metadataSearch');
const { downloadCover } = require('../../services/coverDownloader');
const { embedWithTone, embedWithFfmpeg } = require('../../services/metadataEmbedder');
const { invalidateThumbnails } = require('../../services/thumbnailService');

function register(router, { db, authenticateToken, requireAdmin, normalizeGenres, organizeAudiobook, needsOrganization }) {
  const { dbGet, dbAll, dbRun } = createDbHelpers(db);
  const { getAudiobookById } = createQueryHelpers(db);

  // Get chapters for a multi-file audiobook
  router.get('/:id/chapters', authenticateToken, async (req, res) => {
    try {
      const chapters = await dbAll(
        'SELECT * FROM audiobook_chapters WHERE audiobook_id = ? ORDER BY chapter_number ASC',
        [req.params.id]
      );
      res.json(chapters || []);
    } catch (_err) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Update chapter titles (admin only)
  router.put('/:id/chapters', authenticateToken, requireAdmin, async (req, res) => {
    const { chapters } = req.body;

    if (!chapters || !Array.isArray(chapters)) {
      return res.status(400).json({ error: 'Chapters array required' });
    }

    try {
      // Update each chapter title
      for (const chapter of chapters) {
        if (chapter.id && chapter.title !== undefined) {
          await dbRun(
            'UPDATE audiobook_chapters SET title = ? WHERE id = ? AND audiobook_id = ?',
            [chapter.title, chapter.id, req.params.id]
          );
        }
      }

      res.json({ message: 'Chapters updated successfully' });
    } catch (error) {
      console.error('Error updating chapters:', error);
      res.status(500).json({ error: 'Failed to update chapters' });
    }
  });

  // Fetch chapters from Audnexus by ASIN (admin only)
  router.post('/:id/fetch-chapters', authenticateToken, requireAdmin, async (req, res) => {
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
      const audiobook = await dbGet('SELECT file_path FROM audiobooks WHERE id = ?', [req.params.id]);

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
      await dbRun('DELETE FROM audiobook_chapters WHERE audiobook_id = ?', [req.params.id]);

      // Insert new chapters (use audiobook's file_path for all chapters)
      for (let i = 0; i < data.chapters.length; i++) {
        const chapter = data.chapters[i];
        await dbRun(
          `INSERT INTO audiobook_chapters (audiobook_id, chapter_number, file_path, title, start_time, duration)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [
            req.params.id,
            i + 1,
            audiobook.file_path,
            chapter.title || `Chapter ${i + 1}`,
            Math.floor(chapter.startOffsetMs / 1000), // Convert ms to seconds
            Math.floor(chapter.lengthMs / 1000) // Convert ms to seconds
          ]
        );
      }

      // Update the ASIN in the audiobook record if not already set
      await dbRun(
        'UPDATE audiobooks SET asin = ? WHERE id = ? AND (asin IS NULL OR asin = "")',
        [asin, req.params.id]
      );

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
  router.get('/:id/search-audnexus', authenticateToken, requireAdmin, async (req, res) => {
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
  router.get('/:id/search-metadata', authenticateToken, requireAdmin, async (req, res) => {
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
      const audiobook = await getAudiobookById(req.params.id);

      if (!audiobook) {
        return res.status(404).json({ error: 'Audiobook not found' });
      }

      if (!fs.existsSync(audiobook.file_path)) {
        return res.status(404).json({ error: 'Audio file not found on disk' });
      }

      // Re-extract metadata from primary file
      const { extractFileMetadata } = require('../../services/fileProcessor');
      const metadata = await extractFileMetadata(audiobook.file_path);

      let totalDuration = metadata.duration;

      // Handle multifile audiobooks: recalculate duration from all chapter files
      if (audiobook.is_multi_file) {
        const existingChapters = await dbAll(
          'SELECT * FROM audiobook_chapters WHERE audiobook_id = ? ORDER BY chapter_number ASC',
          [req.params.id]
        );

        if (existingChapters.length > 0) {
          totalDuration = 0;
          let cumulativeTime = 0;

          for (const chapter of existingChapters) {
            if (chapter.file_path && fs.existsSync(chapter.file_path)) {
              const chapterMeta = await extractFileMetadata(chapter.file_path);
              const chapterDuration = chapterMeta.duration || 0;
              totalDuration += chapterDuration;

              // Update chapter with refreshed duration and start time
              await dbRun(
                'UPDATE audiobook_chapters SET duration = ?, start_time = ?, title = ? WHERE id = ?',
                [chapterDuration, cumulativeTime, chapterMeta.title || chapter.title, chapter.id]
              );
              cumulativeTime += chapterDuration;
            }
          }

          console.log(`Refreshed ${existingChapters.length} chapter files for multifile audiobook: ${audiobook.title}`);
        }
      } else {
        // Single file: check for embedded chapters (M4B)
        const ext = path.extname(audiobook.file_path).toLowerCase();
        const isM4B = ext === '.m4b';
        let chapters = null;

        if (isM4B) {
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

        const hasEmbeddedChapters = chapters && chapters.length > 1;

        // Replace embedded chapters if found
        if (hasEmbeddedChapters) {
          await dbRun('DELETE FROM audiobook_chapters WHERE audiobook_id = ?', [req.params.id]);

          for (const chapter of chapters) {
            await dbRun(
              `INSERT INTO audiobook_chapters
               (audiobook_id, chapter_number, file_path, duration, start_time, title)
               VALUES (?, ?, ?, ?, ?, ?)`,
              [
                req.params.id,
                chapter.chapter_number,
                audiobook.file_path,
                chapter.duration,
                chapter.start_time,
                chapter.title,
              ]
            );
          }
          console.log(`Extracted ${chapters.length} chapters from ${path.basename(audiobook.file_path)}`);
        }
      }

      // For multifile books, if the title looks like a chapter name, use the directory name instead
      const looksLikeChapter = metadata.title && (
        /\bchapter\s+\d/i.test(metadata.title) ||
        /\bpart\s+\d/i.test(metadata.title) ||
        /\btrack\s+\d/i.test(metadata.title) ||
        /\d+\s*(of|\/)\s*\d+/.test(metadata.title) ||
        /^\d{1,3}\s*[-–.]/.test(metadata.title)
      );
      if (audiobook.is_multi_file && looksLikeChapter) {
        const directory = path.dirname(audiobook.file_path);
        let cleanDir = path.basename(directory)
          .replace(/[._]+/g, ' ')
          .replace(/\s*\([^)]*$/, '')
          .replace(/\s*\([^)]*\)\s*$/, '')
          .trim();

        // Try to extract series from directory patterns like "Series Bk N - Title"
        const bkMatch = cleanDir.match(/(?:^[^-]+-\s*)?(.+?)\s*(?:Bk|Book|Vol|Volume)\s*\.?\s*(\d+(?:\.\d+)?)\s*[-–]\s*(.+)/i);
        if (bkMatch) {
          const dirSeries = bkMatch[1].trim().replace(/\s+/g, ' ');
          const dirPosition = parseFloat(bkMatch[2]);
          const dirTitle = bkMatch[3].trim().replace(/\s+/g, ' ');
          if (dirTitle && dirSeries) {
            cleanDir = dirTitle;
            if (!metadata.series) {
              metadata.series = dirSeries;
              if (!metadata.series_position && !isNaN(dirPosition)) {
                metadata.series_position = dirPosition;
              }
            }
          }
        } else if (metadata.author) {
          const authorPattern = metadata.author.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '[\\s._-]+');
          cleanDir = cleanDir.replace(new RegExp('^' + authorPattern + '\\s*[-–]\\s*', 'i'), '');
        }

        metadata.title = cleanDir || metadata.title;
      }

      // Discard series if it's the same as the title
      if (metadata.series && metadata.title) {
        const normSeries = metadata.series.trim().toLowerCase();
        const normTitle = metadata.title.trim().toLowerCase();
        if (normSeries === normTitle || normTitle.startsWith(normSeries + ':') || normTitle.startsWith(normSeries + ' -')) {
          metadata.series = null;
          metadata.series_position = null;
        }
      }

      // Update database with refreshed metadata (preserve is_multi_file status)
      await dbRun(
        `UPDATE audiobooks
         SET title = ?, author = ?, narrator = ?, description = ?, genre = ?,
             series = ?, series_position = ?, published_year = ?, cover_image = ?,
             duration = ?, updated_at = CURRENT_TIMESTAMP
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
          totalDuration,
          req.params.id
        ]
      );

      // Invalidate cached thumbnails so the new cover is picked up
      invalidateThumbnails(req.params.id);

      // Get updated audiobook
      let updatedAudiobook = await getAudiobookById(req.params.id);

      // Check if file needs to be reorganized based on new metadata
      let fileReorganized = false;
      if (updatedAudiobook && needsOrganization(updatedAudiobook)) {
        const result = await organizeAudiobook(updatedAudiobook);
        if (result.moved) {
          fileReorganized = true;
          // Re-fetch audiobook with updated path
          updatedAudiobook = await getAudiobookById(req.params.id);
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
  router.post('/:id/embed-metadata', authenticateToken, requireAdmin, async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid audiobook ID' });
    }

    try {
      // Get audiobook from database
      const audiobook = await getAudiobookById(id);

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
      const chapters = await dbAll(
        'SELECT * FROM audiobook_chapters WHERE audiobook_id = ? ORDER BY chapter_number ASC',
        [id]
      ) || [];

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

      // Embed metadata using the appropriate tool
      const result = (ext === '.m4b' || ext === '.m4a')
        ? await embedWithTone(audiobook, chapters, coverFile)
        : await embedWithFfmpeg(audiobook, chapters, coverFile);

      res.json({ message: result.message, backup: backupPath });
    } catch (error) {
      console.error('Error embedding metadata:', error.message || error);
      const message = error.message && error.message.includes('Permission denied')
        ? 'Permission denied — the audiobook directory is read-only'
        : 'Failed to embed metadata';
      res.status(500).json({ error: message });
    }
  });

  // Update audiobook metadata (admin only)
  router.put('/:id', authenticateToken, requireAdmin, async (req, res) => {
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
      const currentBook = await getAudiobookById(id);

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
      await dbRun(
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
        ]
      );

      // Invalidate cached thumbnails so the new cover is picked up
      invalidateThumbnails(id);

      // Check if file reorganization is needed (author, title, series, or position changed)
      let fileReorganized = false;
      let newFilePath = currentBook.file_path;

      if ((authorChanged || titleChanged || seriesChanged || seriesPositionChanged) &&
          fs.existsSync(currentBook.file_path)) {
        // Re-fetch the audiobook with updated metadata
        const updatedBook = await getAudiobookById(id);

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
module.exports = { register };
