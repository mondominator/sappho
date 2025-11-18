const fs = require('fs');
const path = require('path');
const db = require('../database');
const { scrapeMetadata } = require('./metadataScraper');

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

  // Pattern 1: "CHAPTER ONE CHAPTER TWO CHAPTER THREE..." (word-based)
  cleaned = cleaned.replace(/^(\s*CHAPTER\s+[A-Z]+(\s+[A-Z]+)*\s*)+/i, '');

  // Pattern 2: "CHAPTER 1 CHAPTER 2 CHAPTER 3..." (number-based)
  cleaned = cleaned.replace(/^(\s*CHAPTER\s+\d+\s*)+/i, '');

  // Pattern 3: "Chapter One, Chapter Two, Chapter Three..." (comma-separated)
  cleaned = cleaned.replace(/^(\s*Chapter\s+[A-Za-z]+(\s+[A-Za-z]+)?,?\s*)+/i, '');

  // Pattern 4: "Ch. 1, Ch. 2, Ch. 3..." (abbreviated)
  cleaned = cleaned.replace(/^(\s*Ch\.\s*\d+,?\s*)+/i, '');

  // Pattern 5: Just numbers separated by spaces/commas at the start
  cleaned = cleaned.replace(/^(\s*\d+[,\s]+)+/, '');

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
    if (common.picture && common.picture.length > 0) {
      coverImagePath = await saveCoverArt(common.picture[0], filePath);
    }

    // Extract series and series position from various possible tag locations
    // Check native tags first, then fall back to custom/additional tags
    const nativeTags = metadata.native || {};
    let series = null;  // Don't default to album tag - only use explicit series tags
    let seriesPosition = null;

    // Check for MP4/iTunes tags (used in M4A, M4B files)
    if (nativeTags.iTunes || nativeTags.MP4) {
      const mp4Tags = nativeTags.iTunes || nativeTags.MP4 || [];

      // Look for series in various iTunes/MP4 tag fields (AudiobookShelf compatible)
      const seriesTag = mp4Tags.find(tag =>
        tag.id === '----:com.apple.iTunes:SERIES' ||
        tag.id === '----:com.apple.iTunes:series' ||
        tag.id === '----:com.pilabor.tone:SERIES' || // Tone/AudiobookShelf
        tag.id === '----:com.pilabor.tone:series' ||
        tag.id === '©grp' || // Grouping tag (common for series)
        tag.id === 'tvsh' || // TV Show (sometimes used for series)
        tag.id === '©st3' || // Subtitle field (sometimes used for series)
        tag.id === 'sosn' // Sort show name
      );
      if (seriesTag && seriesTag.value) {
        series = Array.isArray(seriesTag.value) ? seriesTag.value[0] : seriesTag.value;
        if (typeof series === 'object' && series.text) {
          series = series.text; // Handle Buffer/object values
        }
        if (Buffer.isBuffer(series)) {
          series = series.toString('utf8');
        }

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
      const posTag = mp4Tags.find(tag =>
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

      const narratorTag = mp4Tags.find(tag =>
        tag.id === '----:com.apple.iTunes:NARRATOR' ||
        tag.id === '----:com.apple.iTunes:narrator' ||
        tag.id === '----:com.pilabor.tone:NARRATOR' || // Tone/AudiobookShelf
        tag.id === '----:com.pilabor.tone:narrator' ||
        tag.id === 'soaa' // Sort album artist (sometimes narrator)
      );
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

    const rawDescription = common.comment ? common.comment.join(' ') : null;

    return {
      title: title,
      author: common.artist || common.albumartist || null,
      narrator: narrator,
      description: cleanDescription(rawDescription),
      duration: format.duration ? Math.round(format.duration) : null,
      genre: common.genre ? common.genre.join(', ') : null,
      published_year: common.year || null,
      isbn: common.isrc || null,
      series: series,
      series_position: seriesPosition,
      cover_image: coverImagePath,
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
