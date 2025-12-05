const fs = require('fs');
const path = require('path');
const db = require('../database');
const { scrapeMetadata } = require('./metadataScraper');
const websocketManager = require('./websocketManager');

// music-metadata is ESM only, use dynamic import
let parseFile;
(async () => {
  const mm = await import('music-metadata');
  parseFile = mm.parseFile;
})();

const audiobooksDir = process.env.AUDIOBOOKS_DIR || path.join(__dirname, '../../data/audiobooks');

// Clean chapter listings from description text
function cleanDescription(description) {
  if (!description) return '';

  let cleaned = description;

  // Strip HTML tags
  cleaned = cleaned.replace(/<[^>]*>/g, '');

  // Decode common HTML entities
  cleaned = cleaned
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, num) => String.fromCharCode(num))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));

  // Normalize whitespace (multiple spaces/newlines to single space)
  cleaned = cleaned.replace(/\s+/g, ' ').trim();

  // Strategy 1: Check if the real description is AFTER chapter listings
  // Look for patterns like "End Credits [actual description]" or "Epilogue [actual description]"
  const afterCreditsMatch = cleaned.match(/(?:End\s+Credits|Epilogue|About\s+the\s+Author|Q&A\s+with\s+the\s+Author)\s+(.+)/is);
  if (afterCreditsMatch && afterCreditsMatch[1]) {
    const potentialDescription = afterCreditsMatch[1].trim();
    // Check if this looks like a real description (starts with a capital letter, has reasonable length)
    if (potentialDescription.length >= 50 && /^[A-Z<"]/.test(potentialDescription)) {
      // Remove any trailing "End Credits", "Epilogue", etc.
      cleaned = potentialDescription.replace(/\s*(Opening|End)\s+Credits\s*$/i, '').trim();
      return cleaned;
    }
  }

  // Strategy 2: Remove chapter listings from the beginning (original approach)
  // Remove Opening Credits / End Credits from start and end
  cleaned = cleaned.replace(/^(\s*(Opening|End)\s+Credits\s*)+/i, '');
  cleaned = cleaned.replace(/(\s*(Opening|End)\s+Credits\s*)+$/i, '');

  // Pattern: "Dedication Part 1: Name Chapter 1 Chapter 2..." (common in audiobooks)
  cleaned = cleaned.replace(/^(\s*Dedication\s+)?Part\s+\d+:\s*[A-Za-z\s]+(\s+Chapter\s+\d+)+/i, '');

  // Pattern 1: "Chapter One Chapter Two..." or "Chapter Twenty-One..." (word-based with optional hyphens)
  cleaned = cleaned.replace(/^(\s*Chapter\s+([A-Z][a-z]+(-[A-Z][a-z]+)*)\s*)+/i, '');

  // Pattern 2: "CHAPTER ONE CHAPTER TWO CHAPTER THREE..." (all caps word-based)
  cleaned = cleaned.replace(/^(\s*CHAPTER\s+[A-Z]+(\s+[A-Z]+)*\s*)+/i, '');

  // Pattern 3: "CHAPTER 1 CHAPTER 2 CHAPTER 3..." (number-based)
  cleaned = cleaned.replace(/^(\s*CHAPTER\s+\d+\s*)+/i, '');

  // Pattern 4: "Chapter One, Chapter Two, Chapter Three..." (comma-separated)
  cleaned = cleaned.replace(/^(\s*Chapter\s+[A-Za-z]+(\s+[A-Za-z]+)?,?\s*)+/i, '');

  // Pattern 5: "Ch. 1, Ch. 2, Ch. 3..." (abbreviated)
  cleaned = cleaned.replace(/^(\s*Ch\.\s*\d+,?\s*)+/i, '');

  // Pattern 6: Just numbers separated by spaces/commas at the start
  cleaned = cleaned.replace(/^(\s*\d+[,\s]+)+/, '');

  // Pattern 7: "-1-", "-2-", "-3-" or similar hyphen-wrapped numbers
  cleaned = cleaned.replace(/^(\s*-\d+-?\s*)+/, '');

  // Pattern 8: "1. 2. 3." or "1) 2) 3)" (numbered lists)
  cleaned = cleaned.replace(/^(\s*\d+[.)]\s*)+/, '');

  // Pattern 9: Track listing patterns like "01 - ", "Track 1", etc.
  cleaned = cleaned.replace(/^(\s*(Track\s+)?\d+(\s*-\s*|\s+))+/i, '');

  // Remove repeating "Chapter N" patterns more aggressively
  // This handles cases like "Chapter 1 Chapter 2 Chapter 3..." that slip through
  cleaned = cleaned.replace(/^(.*?Chapter\s+\d+\s*)+/i, '');

  // Remove "Part N: Title" patterns at the beginning
  cleaned = cleaned.replace(/^(\s*Part\s+\d+:\s*[^\n]+\s*)+/gi, '');

  // Clean up any remaining Opening/End Credits
  cleaned = cleaned.replace(/^(\s*(Opening|End)\s+Credits\s*)+/i, '');
  cleaned = cleaned.replace(/(\s*(Opening|End)\s+Credits\s*)+$/i, '');

  // Remove "Dedication" if it's still at the start
  cleaned = cleaned.replace(/^(\s*Dedication\s*)+/i, '');

  return cleaned.trim();
}

// Ensure audiobooks directory exists
if (!fs.existsSync(audiobooksDir)) {
  fs.mkdirSync(audiobooksDir, { recursive: true });
}

async function processAudiobook(filePath, userId, manualMetadata = {}) {
  try {
    // Extract metadata from file
    const fileMetadata = await extractFileMetadata(filePath);

    // Merge file metadata with manual metadata (manual takes precedence)
    let metadata = {
      ...fileMetadata,
      ...manualMetadata,
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

    return audiobook;
  } catch (error) {
    console.error('Error processing audiobook:', error);
    throw error;
  }
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
      // Priority: movement name (proper audiobook tag) > explicit SERIES tag > show
      // Note: Removed ©grp (grouping) and ©st3 (subtitle) - often contain genres, not series
      const seriesTagPriority = [
        '©mvn',  // Movement Name - standard audiobook series tag (what tone writes)
        'movementName',  // Alternative movement name key
        '----:com.apple.iTunes:SERIES',
        '----:com.apple.iTunes:series',
        '----:com.pilabor.tone:SERIES',
        '----:com.pilabor.tone:series',
        'tvsh',  // TV Show (sometimes used for series)
        'sosn',  // Sort show name
      ];

      // Helper to check if a value looks like genre/category tags rather than a series name
      const looksLikeGenres = (val) => {
        if (!val) return true;
        // If it contains multiple commas or semicolons, likely genre list
        if ((val.match(/,/g) || []).length >= 2) return true;
        if ((val.match(/;/g) || []).length >= 1) return true;
        // Common genre keywords that wouldn't be in a series name
        const genreKeywords = /\b(fiction|non-fiction|nonfiction|thriller|mystery|romance|fantasy|horror|biography|history|science|self-help|audiobook|novel|literature)\b/i;
        if (genreKeywords.test(val)) return true;
        return false;
      };

      for (const tagId of seriesTagPriority) {
        const tag = mp4Tags.find(t => t.id === tagId);
        const val = getTagValue(tag);
        if (val && !looksLikeGenres(val)) {
          series = val;
          break;
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

    // Fallback: Try to extract series from title if not found in tags
    const title = common.title || path.basename(filePath, path.extname(filePath));
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

    const iTunesTags = nativeTags.iTunes || nativeTags.MP4 || [];

    // Extract description from multiple possible sources
    // Priority: iTunes long description (ldes) > common.description > iTunes description (desc)
    // DO NOT use comment tags as they often contain chapter listings
    let rawDescription = null;
    let descriptionSource = null;

    // Check iTunes/MP4 tags for long description or description fields
    if (iTunesTags.length > 0) {
      // Look for long description tag (ldes) - this is the proper description field in M4B files
      const ldesTag = iTunesTags.find(tag => tag.id === 'ldes' || tag.id === '©ldes' || tag.id === 'desc' || tag.id === '©des');
      if (ldesTag && ldesTag.value) {
        const val = Array.isArray(ldesTag.value) ? ldesTag.value[0] : ldesTag.value;
        if (typeof val === 'string') {
          rawDescription = val;
          descriptionSource = 'iTunes:' + ldesTag.id;
        } else if (typeof val === 'object' && val.text) {
          rawDescription = val.text;
          descriptionSource = 'iTunes:' + ldesTag.id;
        } else if (Buffer.isBuffer(val)) {
          rawDescription = val.toString('utf8');
          descriptionSource = 'iTunes:' + ldesTag.id;
        }
      }
    }

    // Fall back to common.description if no iTunes description found
    if (!rawDescription && common.description) {
      rawDescription = Array.isArray(common.description) ? common.description.join(' ') : common.description;
      descriptionSource = 'common.description';
    }
    // DO NOT fall back to comment tags - they often contain chapter listings

    // Clean the description if we have one
    // Check if it looks like chapter listings rather than a real description
    let meaningfulDescription = null;
    if (rawDescription) {
      const cleaned = cleanDescription(rawDescription);
      // Check if this looks like a real description:
      // - At least 50 characters after cleaning
      // - Doesn't start with common chapter patterns
      const looksLikeChapters = /^(Chapter|Part|Track|\d+[.:\-)]|Dedication|Opening|Prologue)/i.test(cleaned.trim());

      if (cleaned && cleaned.length >= 50 && !looksLikeChapters) {
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

    // Fallback for ISBN from common tags
    if (!isbn && common.isrc) {
      isbn = common.isrc;
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

    return {
      title: title,
      author: common.artist || common.albumartist || null,
      narrator: narrator,
      description: meaningfulDescription,
      duration: format.duration ? Math.round(format.duration) : null,
      genre: common.genre ? common.genre.join(', ') : null,
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

    // Generate unique filename based on audio file path
    const hash = path.basename(audioFilePath, path.extname(audioFilePath));
    const ext = picture.format.split('/')[1] || 'jpg';
    const coverPath = path.join(coversDir, `${hash}.${ext}`);

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
  const author = (metadata.author || 'Unknown Author').replace(/[^a-z0-9\s]/gi, '_').trim();
  const title = (metadata.title || 'Unknown Title').replace(/[^a-z0-9\s]/gi, '_').trim();
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
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT INTO audiobooks
       (title, author, narrator, description, duration, file_path, file_size,
        genre, published_year, isbn, series, series_position, cover_image, added_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
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
