const fs = require('fs');
const path = require('path');
const db = require('../database');
const { extractFileMetadata } = require('./fileProcessor');

const audiobooksDir = process.env.AUDIOBOOKS_DIR || path.join(__dirname, '../../data/audiobooks');

// Audio file extensions we support
const audioExtensions = ['.mp3', '.m4a', '.m4b', '.mp4', '.ogg', '.flac'];

/**
 * Recursively scan a directory for audio files
 */
function scanDirectory(dir) {
  const audioFiles = [];

  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        // Recursively scan subdirectories
        audioFiles.push(...scanDirectory(fullPath));
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (audioExtensions.includes(ext)) {
          audioFiles.push(fullPath);
        }
      }
    }
  } catch (error) {
    console.error(`Error scanning directory ${dir}:`, error.message);
  }

  return audioFiles;
}

/**
 * Check if a file already exists in the database
 */
function fileExistsInDatabase(filePath) {
  return new Promise((resolve, reject) => {
    db.get('SELECT id FROM audiobooks WHERE file_path = ?', [filePath], (err, row) => {
      if (err) {
        reject(err);
      } else {
        resolve(!!row);
      }
    });
  });
}

/**
 * Import an audiobook file into the database without moving it
 */
async function importAudiobook(filePath, userId = 1) {
  try {
    // Check if already in database
    const exists = await fileExistsInDatabase(filePath);
    if (exists) {
      console.log(`Skipping ${filePath} - already in database`);
      return null;
    }

    // Extract metadata from the file
    const metadata = await extractFileMetadata(filePath);

    // Get file stats
    const stats = fs.statSync(filePath);

    // Save to database without moving the file
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
          stats.size,
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
                console.log(`Imported: ${metadata.title} by ${metadata.author}`);
                resolve(audiobook);
              }
            });
          }
        }
      );
    });
  } catch (error) {
    console.error(`Error importing ${filePath}:`, error.message);
    return null;
  }
}

/**
 * Scan the entire audiobooks library and import any new files
 */
async function scanLibrary() {
  console.log('Starting library scan...');
  console.log('Scanning directory:', audiobooksDir);

  // Ensure audiobooks directory exists
  if (!fs.existsSync(audiobooksDir)) {
    console.log('Audiobooks directory does not exist, creating it...');
    fs.mkdirSync(audiobooksDir, { recursive: true });
    return { imported: 0, skipped: 0, errors: 0 };
  }

  // Find all audio files
  const audioFiles = scanDirectory(audiobooksDir);
  console.log(`Found ${audioFiles.length} audio files`);

  let imported = 0;
  let skipped = 0;
  let errors = 0;

  // Import each file
  for (const filePath of audioFiles) {
    try {
      const result = await importAudiobook(filePath);
      if (result) {
        imported++;
      } else {
        skipped++;
      }
    } catch (error) {
      console.error(`Failed to import ${filePath}:`, error.message);
      errors++;
    }
  }

  const stats = { imported, skipped, errors, total: audioFiles.length };
  console.log('Library scan complete:', stats);

  return stats;
}

module.exports = {
  scanLibrary,
  importAudiobook,
};
