#!/usr/bin/env node

/**
 * Script to fix existing multi-file audiobooks in the database
 *
 * This script:
 * 1. Finds audiobooks that are in the same directory
 * 2. Groups them as chapters of a single audiobook
 * 3. Updates the database to reflect the new structure
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const dbPath = process.env.DATABASE_PATH || path.join(__dirname, '../../data/sapho.db');
const db = new sqlite3.Database(dbPath);

async function findMultiFileAudiobooks() {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT id, title, author, file_path, duration, file_size, cover_image,
              narrator, description, genre, published_year, isbn, series, series_position, added_by
       FROM audiobooks
       WHERE is_multi_file IS NULL OR is_multi_file = 0
       ORDER BY file_path`,
      (err, audiobooks) => {
        if (err) {
          reject(err);
        } else {
          resolve(audiobooks);
        }
      }
    );
  });
}

async function groupByDirectory(audiobooks) {
  const groups = new Map();

  for (const book of audiobooks) {
    if (!fs.existsSync(book.file_path)) {
      console.log(`Skipping missing file: ${book.file_path}`);
      continue;
    }

    const dir = path.dirname(book.file_path);

    if (!groups.has(dir)) {
      groups.set(dir, []);
    }
    groups.get(dir).push(book);
  }

  // Filter to only directories with multiple files
  const multiFileGroups = new Map();
  for (const [dir, books] of groups.entries()) {
    if (books.length > 1) {
      multiFileGroups.set(dir, books);
    }
  }

  return multiFileGroups;
}

async function consolidateGroup(books) {
  return new Promise((resolve, reject) => {
    // Sort by filename to ensure correct chapter order
    const sortedBooks = books.sort((a, b) => a.file_path.localeCompare(b.file_path));

    // Use first book as the base
    const primaryBook = sortedBooks[0];
    const directory = path.dirname(primaryBook.file_path);
    const dirName = path.basename(directory);

    // Calculate total duration and size
    let totalDuration = 0;
    let totalSize = 0;
    for (const book of sortedBooks) {
      totalDuration += book.duration || 0;
      totalSize += book.file_size || 0;
    }

    // Use directory name as title if primary book title looks like a chapter
    let title = primaryBook.title;
    if (title && /chapter|part|\d+/i.test(title)) {
      title = dirName;
    }

    console.log(`\nConsolidating ${sortedBooks.length} books into: ${title}`);
    console.log(`  Directory: ${directory}`);
    console.log(`  Total duration: ${Math.round(totalDuration / 60)} minutes`);

    db.serialize(() => {
      // Update the first book to be the multi-file audiobook
      db.run(
        `UPDATE audiobooks
         SET title = ?, duration = ?, file_size = ?, is_multi_file = 1
         WHERE id = ?`,
        [title, totalDuration, totalSize, primaryBook.id],
        (err) => {
          if (err) {
            console.error(`Error updating primary book:`, err);
            return reject(err);
          }

          console.log(`  Updated book ID ${primaryBook.id} as multi-file parent`);

          // Create chapter records for all files
          let completed = 0;
          let hasError = false;

          sortedBooks.forEach((book, index) => {
            db.run(
              `INSERT OR IGNORE INTO audiobook_chapters
               (audiobook_id, chapter_number, file_path, duration, file_size, title)
               VALUES (?, ?, ?, ?, ?, ?)`,
              [
                primaryBook.id,
                index + 1,
                book.file_path,
                book.duration,
                book.file_size,
                book.title,
              ],
              (err) => {
                if (err && !hasError) {
                  hasError = true;
                  console.error(`Error creating chapter ${index + 1}:`, err);
                  reject(err);
                } else {
                  completed++;
                  console.log(`  Created chapter ${index + 1}: ${path.basename(book.file_path)}`);

                  if (completed === sortedBooks.length && !hasError) {
                    // Delete the other book entries (keep only the primary)
                    const idsToDelete = sortedBooks.slice(1).map(b => b.id);

                    if (idsToDelete.length > 0) {
                      db.run(
                        `DELETE FROM audiobooks WHERE id IN (${idsToDelete.join(',')})`,
                        (err) => {
                          if (err) {
                            console.error(`Error deleting duplicate entries:`, err);
                            reject(err);
                          } else {
                            console.log(`  Deleted ${idsToDelete.length} duplicate entries`);
                            resolve({
                              consolidated: true,
                              bookId: primaryBook.id,
                              chapterCount: sortedBooks.length,
                              deletedIds: idsToDelete,
                            });
                          }
                        }
                      );
                    } else {
                      resolve({
                        consolidated: true,
                        bookId: primaryBook.id,
                        chapterCount: sortedBooks.length,
                        deletedIds: [],
                      });
                    }
                  }
                }
              }
            );
          });
        }
      );
    });
  });
}

async function main() {
  console.log('=== Multi-File Audiobook Consolidation Script ===\n');
  console.log('Scanning database for multi-file audiobooks...\n');

  try {
    // Get all audiobooks
    const audiobooks = await findMultiFileAudiobooks();
    console.log(`Found ${audiobooks.length} audiobooks in database`);

    // Group by directory
    const groups = await groupByDirectory(audiobooks);
    console.log(`Found ${groups.size} directories with multiple audio files\n`);

    if (groups.size === 0) {
      console.log('No multi-file audiobooks to consolidate!');
      db.close();
      return;
    }

    // Show what will be consolidated
    console.log('The following groups will be consolidated:');
    for (const [dir, books] of groups.entries()) {
      console.log(`\n${path.basename(dir)} (${books.length} files):`);
      books.forEach((book, i) => {
        console.log(`  ${i + 1}. ${book.title} - ${path.basename(book.file_path)}`);
      });
    }

    console.log('\n=== Starting consolidation ===\n');

    let consolidated = 0;
    let totalChapters = 0;

    for (const [dir, books] of groups.entries()) {
      try {
        const result = await consolidateGroup(books);
        if (result.consolidated) {
          consolidated++;
          totalChapters += result.chapterCount;
        }
      } catch (error) {
        console.error(`Failed to consolidate ${dir}:`, error);
      }
    }

    console.log('\n=== Summary ===');
    console.log(`Consolidated ${consolidated} multi-file audiobooks`);
    console.log(`Total chapters created: ${totalChapters}`);
    console.log('\nDone!');

    db.close();
  } catch (error) {
    console.error('Error:', error);
    db.close();
    process.exit(1);
  }
}

// Run the script
main();
