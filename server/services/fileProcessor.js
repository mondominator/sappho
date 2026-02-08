const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { promisify } = require('util');
const db = require('../database');
const { scrapeMetadata } = require('./metadataScraper');
const websocketManager = require('./websocketManager');
const { generateBestHash } = require('../utils/contentHash');
const { cleanDescription } = require('../utils/cleanDescription');
const { sanitizeName } = require('./fileOrganizer');

const execFileAsync = promisify(execFile);

// music-metadata is ESM only, use dynamic import
let parseFile;

const audiobooksDir = process.env.AUDIOBOOKS_DIR || path.join(__dirname, '../../data/audiobooks');

// Ensure audiobooks directory exists
if (!fs.existsSync(audiobooksDir)) {
  fs.mkdirSync(audiobooksDir, { recursive: true });
}

async function processAudiobook(filePath, userId, manualMetadata = {}) {
  try {
    // Extract metadata from file
    const fileMetadata = await extractFileMetadata(filePath);

    // Merge file metadata with manual metadata (manual takes precedence)
    // Filter out empty/falsy manual values to avoid overriding extracted data
    const filteredManual = {};
    for (const [key, value] of Object.entries(manualMetadata)) {
      if (value !== '' && value !== null && value !== undefined) {
        filteredManual[key] = value;
      }
    }
    let metadata = {
      ...fileMetadata,
      ...filteredManual,
    };

    // If we have title and author, try to scrape additional metadata
    if (metadata.title && metadata.author) {
      try {
        const scrapedMetadata = await scrapeMetadata(metadata.title, metadata.author);
        // Merge scraped metadata (don't overwrite existing data)
        metadata = {
          ...scrapedMetadata,
          ...metadata,
        };
      } catch (error) {
        console.log('Metadata scraping failed, continuing with file metadata:', error.message);
      }
    }

    // Organize file in library
    const finalPath = await organizeFile(filePath, metadata);

    // Get file stats
    const stats = fs.statSync(finalPath);

    // Save to database
    const audiobook = await saveToDatabase(metadata, finalPath, stats.size, userId);

    // Extract and save chapters for M4B/M4A files
    const ext = path.extname(finalPath).toLowerCase();
    if (ext === '.m4b' || ext === '.m4a') {
      try {
        const { stdout } = await execFileAsync('ffprobe', [
          '-v', 'quiet',
          '-print_format', 'json',
          '-show_chapters',
          finalPath
        ]);

        const data = JSON.parse(stdout);
        if (data.chapters && data.chapters.length > 1) {
          for (let i = 0; i < data.chapters.length; i++) {
            const ch = data.chapters[i];
            await new Promise((resolve, reject) => {
              db.run(
                `INSERT INTO audiobook_chapters
                 (audiobook_id, chapter_number, file_path, duration, start_time, title)
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [
                  audiobook.id,
                  i + 1,
                  finalPath,
                  (parseFloat(ch.end_time) || 0) - (parseFloat(ch.start_time) || 0),
                  parseFloat(ch.start_time) || 0,
                  ch.tags?.title || `Chapter ${i + 1}`,
                ],
                (err) => { if (err) reject(err); else resolve(); }
              );
            });
          }

          // Update is_multi_file flag
          await new Promise((resolve, reject) => {
            db.run('UPDATE audiobooks SET is_multi_file = 1 WHERE id = ?', [audiobook.id], (err) => {
              if (err) reject(err); else resolve();
            });
          });

          console.log(`Extracted ${data.chapters.length} chapters from uploaded ${path.basename(finalPath)}`);
        }
      } catch (_error) {
        console.log(`No chapters found in uploaded ${path.basename(finalPath)} or ffprobe not available`);
      }
    }

    return audiobook;
  } catch (error) {
    console.error('Error processing audiobook:', error);
    throw error;
  }
}

/**
 * Detect whether text looks like a chapter listing rather than a prose description.
 * Chapter listings typically contain timestamps, numbered lines, or repetitive patterns.
 */
function looksLikeChapterListing(text) {
  if (!text || text.length < 10) return true;

  const lines = text.split(/\n|\r\n?/).filter(l => l.trim());

  // If it starts with common chapter/track patterns
  if (/^(Chapter|Part|Track|Section|\d+[.:\-)]|Dedication|Opening|Prologue|Epilogue)\s/i.test(lines[0]?.trim())) {
    // Only flag if there are multiple such lines (single "Chapter 1" followed by prose is OK)
    const chapterLineCount = lines.filter(l =>
      /^(Chapter|Part|Track|Section|\d+[.:\-)])\s/i.test(l.trim())
    ).length;
    if (chapterLineCount >= 3) return true;
  }

  // Contains timestamps (e.g., "00:01:23", "1:23:45")
  const timestampCount = (text.match(/\d{1,2}:\d{2}(:\d{2})?/g) || []).length;
  if (timestampCount >= 3) return true;

  // Many short lines that look like a track listing (numbered entries)
  if (lines.length >= 5) {
    const numberedLines = lines.filter(l => /^\s*\d+[.)\-:\s]/.test(l));
    if (numberedLines.length >= lines.length * 0.6) return true;
  }

  return false;
}

async function extractFileMetadata(filePath) {
  try {
    // Ensure parseFile is loaded
    if (!parseFile) {
      const mm = await import('music-metadata');
      parseFile = mm.parseFile;
    }

    const metadata = await parseFile(filePath);

    const common = metadata.common;
    const format = metadata.format;

    // Extract cover art if available
    let coverImagePath = null;

    // First, try to extract embedded cover from audio file
    if (common.picture && common.picture.length > 0) {
      coverImagePath = await saveCoverArt(common.picture[0], filePath);
      if (coverImagePath) {
        console.log(`Extracted embedded cover to: ${coverImagePath}`);
      }
    }

    // If no embedded cover, look for external cover files in the same directory
    if (!coverImagePath) {
      const audioDir = path.dirname(filePath);
      const coverExtensions = ['.jpg', '.jpeg', '.png', '.webp'];
      const coverNames = ['cover', 'folder', 'album', 'front'];

      for (const name of coverNames) {
        for (const ext of coverExtensions) {
          const potentialCover = path.join(audioDir, `${name}${ext}`);
          if (fs.existsSync(potentialCover)) {
            coverImagePath = potentialCover;
            console.log(`Found external cover: ${coverImagePath}`);
            break;
          }
        }
        if (coverImagePath) break;
      }
    }

    // Extract series and series position from various possible tag locations
    // Check native tags first, then fall back to custom/additional tags
    const nativeTags = metadata.native || {};
    const iTunesTags = nativeTags.iTunes || nativeTags.MP4 || [];
    let series = null;  // Don't default to album tag - only use explicit series tags
    let seriesPosition = null;

    // Check common.movementName first (music-metadata exposes this for movement tags)
    if (common.movementName) {
      series = common.movementName;
    }
    if (common.movementIndex && common.movementIndex.no) {
      seriesPosition = common.movementIndex.no;
    }

    // Check for MP4/iTunes tags (used in M4A, M4B files)
    if (nativeTags.iTunes || nativeTags.MP4) {
      const mp4Tags = nativeTags.iTunes || nativeTags.MP4 || [];

      // Helper to extract string value from tag
      const getTagValue = (tag) => {
        if (!tag || !tag.value) return null;
        let val = Array.isArray(tag.value) ? tag.value[0] : tag.value;
        if (typeof val === 'object' && val.text) val = val.text;
        if (Buffer.isBuffer(val)) val = val.toString('utf8');
        return typeof val === 'string' ? val : null;
      };

      // Look for series in various iTunes/MP4 tag fields (AudiobookShelf compatible)
      // Split into explicit series tags (trusted) and ambiguous tags (need genre filtering)
      const explicitSeriesTags = [
        '©mvn',  // Movement Name - standard audiobook series tag (what tone writes)
        'movementName',  // Alternative movement name key
        '----:com.apple.iTunes:SERIES',
        '----:com.apple.iTunes:series',
        '----:com.pilabor.tone:SERIES',
        '----:com.pilabor.tone:series',
      ];

      // Ambiguous tags that could contain genres instead of series names
      const ambiguousSeriesTags = [
        '©grp',  // Grouping - commonly used for series BUT also for genres
        'tvsh',  // TV Show (sometimes used for series)
        'sosn',  // Sort show name
      ];

      // Helper to check if a value looks like genre/category tags rather than a series name
      // Only applied to ambiguous tags, not explicit series tags
      const looksLikeGenres = (val) => {
        if (!val) return true;
        // If it contains multiple commas or semicolons, likely genre list
        if ((val.match(/,/g) || []).length >= 2) return true;
        if ((val.match(/;/g) || []).length >= 1) return true;
        return false;
      };

      // First try explicit series tags (no genre filtering needed)
      for (const tagId of explicitSeriesTags) {
        const tag = mp4Tags.find(t => t.id === tagId);
        const val = getTagValue(tag);
        if (val) {
          series = val;
          break;
        }
      }

      // If no explicit series found, try ambiguous tags with genre filtering
      if (!series) {
        for (const tagId of ambiguousSeriesTags) {
          const tag = mp4Tags.find(t => t.id === tagId);
          const val = getTagValue(tag);
          if (val && !looksLikeGenres(val)) {
            series = val;
            break;
          }
        }
      }

      if (series) {
        // If series contains "#N" pattern, extract series name and position
        // Example: "The Eden Chronicles #1" -> series: "The Eden Chronicles", position: 1
        const seriesMatch = series.match(/^(.+?)\s*#(\d+(?:\.\d+)?)$/);
        if (seriesMatch) {
          series = seriesMatch[1].trim();
          const pos = parseFloat(seriesMatch[2]);
          if (!isNaN(pos) && !seriesPosition) {
            seriesPosition = pos;
          }
        }
      }

      // Look for series position
      // Priority: movement (proper audiobook tag) > PART > TV episode > disc
      const posTag = mp4Tags.find(tag =>
        tag.id === '©mvi' ||  // Movement Index - standard audiobook series position (what tone writes)
        tag.id === 'movement' ||  // Alternative movement key
        tag.id === '----:com.apple.iTunes:PART' ||
        tag.id === '----:com.apple.iTunes:part' ||
        tag.id === '----:com.pilabor.tone:PART' || // Tone/AudiobookShelf
        tag.id === '----:com.pilabor.tone:part' ||
        tag.id === 'tves' || // TV Episode
        tag.id === 'tvsn' || // TV Season (sometimes used for series position)
        tag.id === 'disk' // Disc number
      );
      if (posTag && posTag.value) {
        const val = Array.isArray(posTag.value) ? posTag.value[0] : posTag.value;
        const parsed = parseFloat(val);
        if (!isNaN(parsed)) {
          seriesPosition = parsed;
        }
      }

      // Also check disc/track number as fallback for series position
      if (!seriesPosition && common.disk && common.disk.no) {
        seriesPosition = common.disk.no;
      }
      if (!seriesPosition && common.track && common.track.no) {
        seriesPosition = common.track.no;
      }
    }

    // Look for series in ID3v2.4 TXXX frames or other common locations
    if (nativeTags['ID3v2.4'] || nativeTags['ID3v2.3'] || nativeTags['ID3v2.2']) {
      const id3Tags = nativeTags['ID3v2.4'] || nativeTags['ID3v2.3'] || nativeTags['ID3v2.2'] || [];

      // Look for series in TXXX:SERIES or TXXX:ALBUMSERIES
      const seriesTag = id3Tags.find(tag =>
        tag.id === 'TXXX:SERIES' ||
        tag.id === 'TXXX:ALBUMSERIES' ||
        tag.id === 'TXXX:Series'
      );
      if (seriesTag && seriesTag.value && !series) {
        series = seriesTag.value;
      }

      // Fallback: check TIT1 (grouping) for series — ffmpeg writes series here
      if (!series) {
        const tit1 = id3Tags.find(tag => tag.id === 'TIT1');
        if (tit1 && tit1.value) {
          const val = Buffer.isBuffer(tit1.value) ? tit1.value.toString('utf8') : String(tit1.value);
          // Grouping may contain "Series Name #N" format — extract if so
          const groupMatch = val.match(/^(.+?)\s*#(\d+(?:\.\d+)?)$/);
          if (groupMatch) {
            series = groupMatch[1].trim();
            if (!seriesPosition) {
              const pos = parseFloat(groupMatch[2]);
              if (!isNaN(pos)) seriesPosition = pos;
            }
          } else {
            series = val;
          }
        }
      }

      // Fallback: check TALB (album) for series — many tools write series to album
      if (!series && common.album && common.album !== common.title) {
        series = common.album;
      }

      // Look for series position in TXXX:PART or TXXX:SERIESPART
      const posTag = id3Tags.find(tag =>
        tag.id === 'TXXX:PART' ||
        tag.id === 'TXXX:SERIESPART' ||
        tag.id === 'TXXX:Part'
      );
      if (posTag && posTag.value && !seriesPosition) {
        const parsed = parseFloat(posTag.value);
        if (!isNaN(parsed)) {
          seriesPosition = parsed;
        }
      }

      // Fallback: check disc number for series position
      if (!seriesPosition && common.disk && common.disk.no) {
        seriesPosition = common.disk.no;
      }
    }

    // Check for vorbis comments (used in FLAC, OGG)
    if (nativeTags.vorbis) {
      const vorbisTag = nativeTags.vorbis.find(tag => tag.id === 'SERIES');
      if (vorbisTag && vorbisTag.value && !series) {
        series = vorbisTag.value;
      }
      const vorbisPartTag = nativeTags.vorbis.find(tag => tag.id === 'PART');
      if (vorbisPartTag && vorbisPartTag.value && !seriesPosition) {
        const parsed = parseFloat(vorbisPartTag.value);
        if (!isNaN(parsed)) {
          seriesPosition = parsed;
        }
      }
    }

    // Extract narrator from various tag locations
    // Start with composer as default (standard audiobook field)
    let narrator = null;
    if (common.composer) {
      if (Array.isArray(common.composer)) {
        narrator = common.composer[0];
      } else if (typeof common.composer === 'string') {
        narrator = common.composer;
      }
    }

    // Check MP4/iTunes tags for narrator (AudiobookShelf compatible)
    // Only override composer if we find an explicit narrator tag
    if (nativeTags.iTunes || nativeTags.MP4) {
      const mp4Tags = nativeTags.iTunes || nativeTags.MP4 || [];

      // Priority order: explicit narrator tags first, then custom tags
      // Do NOT include soaa (sort album artist) - that's typically the author, not narrator
      const narratorTagIds = [
        '©nrt',  // Standard narrator tag (what tone writes) - HIGHEST PRIORITY
        '----:com.apple.iTunes:NARRATOR',
        '----:com.apple.iTunes:narrator',
        '----:com.pilabor.tone:NARRATOR', // Tone/AudiobookShelf
        '----:com.pilabor.tone:narrator',
        'narrator',  // Alternative narrator key
      ];

      // Find the first matching tag in priority order
      let narratorTag = null;
      for (const tagId of narratorTagIds) {
        narratorTag = mp4Tags.find(tag => tag.id === tagId);
        if (narratorTag) break;
      }
      if (narratorTag && narratorTag.value) {
        const val = Array.isArray(narratorTag.value) ? narratorTag.value[0] : narratorTag.value;
        if (typeof val === 'object' && val.text) {
          narrator = val.text;
        } else if (Buffer.isBuffer(val)) {
          narrator = val.toString('utf8');
        } else {
          narrator = val;
        }
      }
    }

    // Check ID3 tags for narrator
    if (!narrator && (nativeTags['ID3v2.4'] || nativeTags['ID3v2.3'] || nativeTags['ID3v2.2'])) {
      const id3Tags = nativeTags['ID3v2.4'] || nativeTags['ID3v2.3'] || nativeTags['ID3v2.2'] || [];

      // Look for narrator in TXXX:NARRATOR or similar
      const narratorTag = id3Tags.find(tag =>
        tag.id === 'TXXX:NARRATOR' ||
        tag.id === 'TXXX:Narrator' ||
        tag.id === 'TXXX:narrator' ||
        tag.id === 'TPE3' || // Conductor/Performer refinement (sometimes used for narrator)
        tag.id === 'TXXX:READER' ||
        tag.id === 'TXXX:Reader'
      );
      if (narratorTag && narratorTag.value) {
        narrator = narratorTag.value;
      }
    }

    // Check vorbis comments for narrator
    if (!narrator && nativeTags.vorbis) {
      const vorbisNarratorTag = nativeTags.vorbis.find(tag =>
        tag.id === 'NARRATOR' ||
        tag.id === 'READER' ||
        tag.id === 'PERFORMER'
      );
      if (vorbisNarratorTag && vorbisNarratorTag.value) {
        narrator = vorbisNarratorTag.value;
      }
    }

    // Build title with smart fallback chain
    let title = common.title || null;

    // If common.title is missing, check native tags directly
    // music-metadata may fail to populate common.title for some encodings
    if (!title) {
      // Try ID3v2 TIT2 (title) tag
      const id3Tags = nativeTags['ID3v2.4'] || nativeTags['ID3v2.3'] || nativeTags['ID3v2.2'] || [];
      const tit2 = id3Tags.find(t => t.id === 'TIT2');
      if (tit2 && tit2.value) {
        title = Buffer.isBuffer(tit2.value) ? tit2.value.toString('utf8') : String(tit2.value);
      }

      // Try iTunes/MP4 ©nam (name) tag
      if (!title) {
        const nameTag = iTunesTags.find(t => t.id === '©nam');
        if (nameTag && nameTag.value) {
          const val = Array.isArray(nameTag.value) ? nameTag.value[0] : nameTag.value;
          if (Buffer.isBuffer(val)) title = val.toString('utf8');
          else if (typeof val === 'object' && val.text) title = val.text;
          else if (typeof val === 'string') title = val;
        }
      }

      // Try Vorbis TITLE tag
      if (!title && nativeTags.vorbis) {
        const vorbisTitle = nativeTags.vorbis.find(t => t.id === 'TITLE');
        if (vorbisTitle && vorbisTitle.value) {
          title = String(vorbisTitle.value);
        }
      }
    }

    // Smart filename/directory fallback if no tag-based title found
    if (!title) {
      let baseName = path.basename(filePath, path.extname(filePath));

      // Clean up filename: remove leading track numbers (e.g., "01 - Chapter Title", "01_title", "Track 01")
      baseName = baseName
        .replace(/^\d{1,3}\s*[-._)\]]\s*/, '')  // "01 - Title", "01_Title", "01.Title"
        .replace(/^track\s*\d+\s*[-._)]\s*/i, '')  // "Track 01 - Title"
        .replace(/[-_]+/g, ' ')  // Replace dashes/underscores with spaces
        .trim();

      // If the cleaned filename is too short, empty, or just a number, use parent directory name
      if (!baseName || baseName.length < 3 || /^\d+$/.test(baseName)) {
        const parentDir = path.basename(path.dirname(filePath));
        // Don't use the root audiobooks directory name
        if (parentDir && parentDir !== path.basename(audiobooksDir)) {
          baseName = parentDir.replace(/[-_]+/g, ' ').trim();
        }
      }

      title = baseName || path.basename(filePath, path.extname(filePath));
    }

    // Fallback: Try to extract series from title if not found in tags
    if (!series && title) {
      // Pattern: "Title: Series Name, Book N" or "Title (Series Name #N)"
      const seriesMatch = title.match(/:\s*([^,]+),\s*Book\s+(\d+)/i) ||
                         title.match(/\(([^#]+)#(\d+)\)/i) ||
                         title.match(/:\s*([^,]+)\s+(\d+)/i);

      if (seriesMatch) {
        series = seriesMatch[1].trim();
        const position = parseFloat(seriesMatch[2]);
        if (!isNaN(position)) {
          seriesPosition = position;
        }
      }
    }

    // Extract description from multiple possible sources
    // Priority: iTunes long description (ldes) > common.description > iTunes description (desc)
    // DO NOT use comment tags as they often contain chapter listings
    let rawDescription = null;
    let _descriptionSource = null;

    // Check iTunes/MP4 tags for long description or description fields
    if (iTunesTags.length > 0) {
      // Look for long description tag (ldes) - this is the proper description field in M4B files
      const ldesTag = iTunesTags.find(tag => tag.id === 'ldes' || tag.id === '©ldes' || tag.id === 'desc' || tag.id === '©des');
      if (ldesTag && ldesTag.value) {
        const val = Array.isArray(ldesTag.value) ? ldesTag.value[0] : ldesTag.value;
        if (typeof val === 'string') {
          rawDescription = val;
          _descriptionSource = 'iTunes:' + ldesTag.id;
        } else if (typeof val === 'object' && val.text) {
          rawDescription = val.text;
          _descriptionSource = 'iTunes:' + ldesTag.id;
        } else if (Buffer.isBuffer(val)) {
          rawDescription = val.toString('utf8');
          _descriptionSource = 'iTunes:' + ldesTag.id;
        }
      }
    }

    // Fall back to common.description if no iTunes description found
    if (!rawDescription && common.description) {
      rawDescription = Array.isArray(common.description) ? common.description.join(' ') : common.description;
      _descriptionSource = 'common.description';
    }
    // Fall back to comment tags, but only if they look like prose descriptions
    if (!rawDescription) {
      let commentText = null;

      // Check iTunes/MP4 comment tag (©cmt)
      if (iTunesTags.length > 0) {
        const cmtTag = iTunesTags.find(tag => tag.id === '©cmt');
        if (cmtTag && cmtTag.value) {
          const val = Array.isArray(cmtTag.value) ? cmtTag.value[0] : cmtTag.value;
          if (typeof val === 'string') commentText = val;
          else if (typeof val === 'object' && val.text) commentText = val.text;
          else if (Buffer.isBuffer(val)) commentText = val.toString('utf8');
        }
      }

      // Check ID3 COMM (comment) tag
      if (!commentText) {
        const id3Tags = nativeTags['ID3v2.4'] || nativeTags['ID3v2.3'] || nativeTags['ID3v2.2'] || [];
        const commTag = id3Tags.find(t => t.id === 'COMM');
        if (commTag && commTag.value) {
          const val = commTag.value;
          if (typeof val === 'string') commentText = val;
          else if (typeof val === 'object' && val.text) commentText = val.text;
        }
      }

      // Check Vorbis COMMENT/DESCRIPTION tag
      if (!commentText && nativeTags.vorbis) {
        const vorbisComment = nativeTags.vorbis.find(t =>
          t.id === 'COMMENT' || t.id === 'DESCRIPTION'
        );
        if (vorbisComment && vorbisComment.value) {
          commentText = String(vorbisComment.value);
        }
      }

      // Use the comment only if it looks like prose, not chapter listings
      if (commentText && !looksLikeChapterListing(commentText)) {
        rawDescription = commentText;
        _descriptionSource = 'comment';
      }
    }

    // Clean the description if we have one
    let meaningfulDescription = null;
    if (rawDescription) {
      const cleaned = cleanDescription(rawDescription);
      // Require at least 50 characters for a meaningful description
      if (cleaned && cleaned.length >= 50) {
        meaningfulDescription = cleaned;
      }
    }

    // Extract additional metadata fields from iTunes/MP4 tags
    // Tone writes to ----:com.pilabor.tone:* format, standard iTunes uses ©* or ----:com.apple.iTunes:*
    let tags = null;
    let publisher = null;
    let copyright_year = null;
    let isbn = null;
    let asin = null;
    let language = null;
    let rating = null;
    let abridged = null;
    let subtitle = null;

    if (iTunesTags.length > 0) {
      // Helper to get tag value from multiple possible tag IDs (first match wins)
      const getTagValMulti = (tagIds) => {
        for (const tagId of tagIds) {
          const tag = iTunesTags.find(t => t.id === tagId);
          if (tag && tag.value) {
            const val = Array.isArray(tag.value) ? tag.value[0] : tag.value;
            if (Buffer.isBuffer(val)) return val.toString('utf8');
            if (typeof val === 'object' && val.text) return val.text;
            if (typeof val === 'string' || typeof val === 'number') return val;
          }
        }
        return null;
      };

      // Tags/grouping - tone writes to group, standard uses ©grp
      tags = getTagValMulti(['©grp', '----:com.pilabor.tone:GROUP']);

      // Publisher - tone writes PUBLISHER, standard uses ©pub
      publisher = getTagValMulti([
        '----:com.pilabor.tone:PUBLISHER',
        '©pub',
        '----:com.apple.iTunes:PUBLISHER'
      ]);

      // Subtitle - tone writes SUBTITLE, standard uses ©st3
      subtitle = getTagValMulti([
        '----:com.pilabor.tone:SUBTITLE',
        '©st3',
        '----:com.apple.iTunes:SUBTITLE'
      ]);

      // Copyright year (cprt) - extract year from string like "1985" or "©1985 Publisher"
      const cprt = getTagValMulti(['cprt', '----:com.pilabor.tone:COPYRIGHT']);
      if (cprt) {
        const yearMatch = String(cprt).match(/\d{4}/);
        if (yearMatch) {
          copyright_year = parseInt(yearMatch[0], 10);
        }
      }

      // ISBN from additional fields
      isbn = getTagValMulti([
        '----:com.pilabor.tone:ISBN',
        '----:com.apple.iTunes:ISBN',
        'ISBN'
      ]);

      // ASIN from additional fields - tone uses ASIN, Audible uses AUDIBLE_ASIN
      asin = getTagValMulti([
        '----:com.pilabor.tone:ASIN',
        '----:com.pilabor.tone:AUDIBLE_ASIN',
        '----:com.apple.iTunes:ASIN',
        'ASIN'
      ]);

      // Language from additional fields
      language = getTagValMulti([
        '----:com.pilabor.tone:LANGUAGE',
        '----:com.apple.iTunes:LANGUAGE'
      ]);

      // Rating from additional fields
      rating = getTagValMulti([
        '----:com.pilabor.tone:RATING',
        '----:com.apple.iTunes:RATING'
      ]);

      // Abridged from additional fields
      const abridgedVal = getTagValMulti([
        '----:com.pilabor.tone:ABRIDGED',
        '----:com.apple.iTunes:ABRIDGED'
      ]);
      if (abridgedVal) {
        const valLower = String(abridgedVal).toLowerCase();
        abridged = valLower === 'yes' || valLower === '1' || valLower === 'true';
      }
    }

    // Fallback for language from common tags
    if (!language && common.language) {
      language = common.language;
    }

    // Extract published year - prefer rldt (release date from tone) over ©day
    // tone writes publishingDate to rldt tag, not ©day
    let published_year = null;
    if (iTunesTags.length > 0) {
      const rldtTag = iTunesTags.find(t => t.id === 'rldt');
      if (rldtTag && rldtTag.value) {
        // rldt format is "2009-01-01" or "12-Dec-2023"
        const rldtVal = String(rldtTag.value);
        const yearMatch = rldtVal.match(/(\d{4})/);
        if (yearMatch) {
          published_year = parseInt(yearMatch[1], 10);
        }
      }
    }
    // Fallback to common.year (©day tag) if rldt not found
    if (!published_year && common.year) {
      published_year = common.year;
    }

    // Build author with native tag fallbacks
    let author = common.artist || common.albumartist || null;
    if (!author) {
      // Try ID3v2 TPE1 (lead performer) or TPE2 (band/album artist)
      const id3Tags = nativeTags['ID3v2.4'] || nativeTags['ID3v2.3'] || nativeTags['ID3v2.2'] || [];
      const authorTag = id3Tags.find(t => t.id === 'TPE1' || t.id === 'TPE2');
      if (authorTag && authorTag.value) {
        author = Buffer.isBuffer(authorTag.value) ? authorTag.value.toString('utf8') : String(authorTag.value);
      }

      // Try iTunes ©ART (artist) or aART (album artist)
      if (!author) {
        const artTag = iTunesTags.find(t => t.id === '©ART' || t.id === 'aART');
        if (artTag && artTag.value) {
          const val = Array.isArray(artTag.value) ? artTag.value[0] : artTag.value;
          if (Buffer.isBuffer(val)) author = val.toString('utf8');
          else if (typeof val === 'object' && val.text) author = val.text;
          else if (typeof val === 'string') author = val;
        }
      }

      // Try Vorbis ARTIST tag
      if (!author && nativeTags.vorbis) {
        const vorbisArtist = nativeTags.vorbis.find(t => t.id === 'ARTIST' || t.id === 'ALBUMARTIST');
        if (vorbisArtist && vorbisArtist.value) {
          author = String(vorbisArtist.value);
        }
      }
    }

    return {
      title: title,
      author: author,
      narrator: narrator,
      description: meaningfulDescription,
      duration: format.duration ? Math.round(format.duration) : null,
      genre: common.genre ? (Array.isArray(common.genre) ? common.genre.join(', ') : String(common.genre)) : null,
      published_year: published_year,
      isbn: isbn,
      series: series,
      series_position: seriesPosition,
      cover_image: coverImagePath,
      // Extended metadata
      tags: tags,
      publisher: publisher,
      copyright_year: copyright_year,
      asin: asin,
      language: language,
      rating: rating,
      abridged: abridged,
      subtitle: subtitle,
    };
  } catch (error) {
    console.error('Error extracting file metadata:', error);
    // Return basic metadata from filename
    return {
      title: path.basename(filePath, path.extname(filePath)),
      author: null,
      narrator: null,
      description: null,
      duration: null,
      genre: null,
      published_year: null,
      series: null,
      series_position: null,
      cover_image: null,
    };
  }
}

async function saveCoverArt(picture, audioFilePath) {
  try {
    // Create covers directory in data folder for persistence
    const dataDir = process.env.DATA_DIR || path.join(__dirname, '../../data');
    const coversDir = path.join(dataDir, 'covers');
    if (!fs.existsSync(coversDir)) {
      fs.mkdirSync(coversDir, { recursive: true });
    }

    // Generate unique filename using a hash of the full file path to avoid collisions
    const crypto = require('crypto');
    const pathHash = crypto.createHash('md5').update(audioFilePath).digest('hex').slice(0, 12);
    const ext = picture.format.split('/')[1] || 'jpg';
    const coverPath = path.join(coversDir, `${pathHash}.${ext}`);

    // Write cover image to file
    fs.writeFileSync(coverPath, picture.data);

    return coverPath;
  } catch (error) {
    console.error('Error saving cover art:', error);
    return null;
  }
}

async function organizeFile(sourcePath, metadata) {
  // Create clean folder names from title and author
  // Use sanitizeName from fileOrganizer for consistency with library scanner
  const author = sanitizeName(metadata.author) || 'Unknown Author';
  const title = sanitizeName(metadata.title) || 'Unknown Title';
  const ext = path.extname(sourcePath);

  // Create Author/Book directory structure
  const authorDir = path.join(audiobooksDir, author);
  const bookDir = path.join(authorDir, title);

  if (!fs.existsSync(bookDir)) {
    fs.mkdirSync(bookDir, { recursive: true });
  }

  // Move file to organized location: Author/Book/book.ext
  const fileName = `${title}${ext}`;
  const finalPath = path.join(bookDir, fileName);

  // If file already exists, append a number
  let counter = 1;
  let actualPath = finalPath;
  while (fs.existsSync(actualPath)) {
    actualPath = path.join(bookDir, `${title}_${counter}${ext}`);
    counter++;
  }

  // Use copy + delete instead of rename to handle cross-filesystem moves
  try {
    fs.copyFileSync(sourcePath, actualPath);
    fs.unlinkSync(sourcePath);
  } catch (error) {
    // If copy fails, try rename as fallback
    try {
      fs.renameSync(sourcePath, actualPath);
    } catch (renameError) {
      console.error('Failed to move file:', error, renameError);
      throw new Error(`Failed to move file: ${error.message}`);
    }
  }

  // Move cover art to the same directory if it exists
  if (metadata.cover_image && fs.existsSync(metadata.cover_image)) {
    const coverExt = path.extname(metadata.cover_image);
    const newCoverPath = path.join(bookDir, `cover${coverExt}`);

    try {
      fs.copyFileSync(metadata.cover_image, newCoverPath);
      // Update metadata to point to new cover location
      metadata.cover_image = newCoverPath;
    } catch (error) {
      console.error('Error moving cover art:', error);
    }
  }

  return actualPath;
}

async function saveToDatabase(metadata, filePath, fileSize, userId) {
  // Generate content hash for stable identification
  const contentHash = generateBestHash(metadata, filePath);

  return new Promise((resolve, reject) => {
    db.run(
      `INSERT INTO audiobooks
       (title, author, narrator, description, duration, file_path, file_size,
        genre, published_year, isbn, series, series_position, cover_image, added_by,
        tags, publisher, copyright_year, asin, language, rating, abridged, subtitle,
        content_hash, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [
        metadata.title,
        metadata.author,
        metadata.narrator,
        metadata.description,
        metadata.duration,
        filePath,
        fileSize,
        metadata.genre,
        metadata.published_year,
        metadata.isbn,
        metadata.series,
        metadata.series_position,
        metadata.cover_image,
        userId,
        metadata.tags,
        metadata.publisher,
        metadata.copyright_year,
        metadata.asin,
        metadata.language,
        metadata.rating,
        metadata.abridged ? 1 : 0,
        metadata.subtitle,
        contentHash,
      ],
      function (err) {
        if (err) {
          reject(err);
        } else {
          db.get('SELECT * FROM audiobooks WHERE id = ?', [this.lastID], (err, audiobook) => {
            if (err) {
              reject(err);
            } else {
              // Broadcast to connected clients
              websocketManager.broadcastLibraryUpdate('library.add', audiobook);
              resolve(audiobook);
            }
          });
        }
      }
    );
  });
}

module.exports = {
  processAudiobook,
  extractFileMetadata,
  organizeFile,
};
