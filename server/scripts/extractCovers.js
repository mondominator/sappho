#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const db = require('../database');

// music-metadata is ESM only, use dynamic import
let parseFile;

const audiobooksDir = process.env.AUDIOBOOKS_DIR || path.join(__dirname, '../../data/audiobooks');
const coversDir = path.join(__dirname, '../../data/covers');

async function saveCoverArt(picture, audioFilePath) {
  try {
    // Ensure covers directory exists
    if (!fs.existsSync(coversDir)) {
      fs.mkdirSync(coversDir, { recursive: true });
    }

    const hash = path.basename(audioFilePath, path.extname(audioFilePath));
    const ext = picture.format.split('/')[1] || 'jpg';
    const coverPath = path.join(coversDir, `${hash}.${ext}`);

    fs.writeFileSync(coverPath, picture.data);
    return coverPath;
  } catch (error) {
    console.error('Error saving cover art:', error);
    return null;
  }
}

async function extractCoverFromFile(filePath) {
  try {
    if (!parseFile) {
      const mm = await import('music-metadata');
      parseFile = mm.parseFile;
    }

    const metadata = await parseFile(filePath);
    const common = metadata.common;

    // Extract cover art if available
    if (common.picture && common.picture.length > 0) {
      const coverPath = await saveCoverArt(common.picture[0], filePath);
      return coverPath;
    }

    return null;
  } catch (error) {
    console.error(`Error extracting metadata from ${filePath}:`, error.message);
    return null;
  }
}

async function processAllAudiobooks() {
  return new Promise((resolve, reject) => {
    db.all('SELECT id, file_path FROM audiobooks', async (err, rows) => {
      if (err) {
        reject(err);
        return;
      }

      console.log(`Found ${rows.length} audiobooks to process`);

      let processed = 0;
      let updated = 0;

      for (const book of rows) {
        try {
          console.log(`Processing: ${book.file_path}`);

          const coverPath = await extractCoverFromFile(book.file_path);

          if (coverPath) {
            // Update database with cover path
            db.run(
              'UPDATE audiobooks SET cover_image = ? WHERE id = ?',
              [coverPath, book.id],
              (updateErr) => {
                if (updateErr) {
                  console.error(`Error updating database for ${book.id}:`, updateErr);
                } else {
                  console.log(`✓ Extracted cover for: ${path.basename(book.file_path)}`);
                  updated++;
                }
              }
            );
          } else {
            console.log(`✗ No cover found for: ${path.basename(book.file_path)}`);
          }

          processed++;
        } catch (error) {
          console.error(`Error processing ${book.file_path}:`, error.message);
          processed++;
        }
      }

      // Wait a bit for all database updates to complete
      setTimeout(() => {
        console.log(`\nProcessing complete!`);
        console.log(`Total: ${rows.length}`);
        console.log(`Processed: ${processed}`);
        console.log(`Updated with covers: ${updated}`);
        resolve();
      }, 2000);
    });
  });
}

// Run the script
processAllAudiobooks()
  .then(() => {
    console.log('Done!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
