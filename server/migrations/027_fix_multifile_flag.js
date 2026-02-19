/**
 * Migration 027: Fix is_multi_file flag for single-file audiobooks
 *
 * Previous code incorrectly set is_multi_file=1 for single files that had
 * embedded chapters (e.g., an M4A with 33 chapter markers). is_multi_file
 * should only be 1 when the audiobook consists of genuinely separate physical
 * files (each chapter record points to a different file_path).
 *
 * This migration finds audiobooks where is_multi_file=1 but all chapter
 * records reference the same file, and corrects them to is_multi_file=0.
 */

async function up(db) {
  return new Promise((resolve, reject) => {
    // Check if is_multi_file column exists (added by migration 001)
    db.all('PRAGMA table_info(audiobooks)', (pragmaErr, columns) => {
      if (pragmaErr) return reject(pragmaErr);

      const hasColumn = columns && columns.some(c => c.name === 'is_multi_file');
      if (!hasColumn) {
        console.log('Migration 027: is_multi_file column not present, skipping');
        return resolve();
      }

      // Find audiobooks marked as multi-file where all chapters point to the same file
      db.all(
        `SELECT a.id, a.title, COUNT(DISTINCT c.file_path) as unique_files, COUNT(c.id) as chapter_count
         FROM audiobooks a
         JOIN audiobook_chapters c ON c.audiobook_id = a.id
         WHERE a.is_multi_file = 1
         GROUP BY a.id
         HAVING unique_files = 1`,
        [],
        (err, rows) => {
          if (err) return reject(err);
          if (!rows || rows.length === 0) {
            console.log('Migration 027: No incorrectly flagged audiobooks found');
            return resolve();
          }

          const ids = rows.map(r => r.id);
          console.log(`Migration 027: Fixing ${rows.length} audiobook(s) incorrectly marked as multi-file:`);
          rows.forEach(r => console.log(`  - "${r.title}" (id=${r.id}, ${r.chapter_count} chapters, 1 file)`));

          db.run(
            `UPDATE audiobooks SET is_multi_file = 0 WHERE id IN (${ids.map(() => '?').join(',')})`,
            ids,
            (updateErr) => {
              if (updateErr) return reject(updateErr);
              console.log(`Migration 027: Updated ${ids.length} audiobook(s) to is_multi_file=0`);
              resolve();
            }
          );
        }
      );
    });
  });
}

async function down(_db) {
  // Cannot reliably reverse — we don't know which books were originally
  // flagged incorrectly vs correctly. The data fix is idempotent anyway.
  return Promise.resolve();
}

module.exports = { up, down };
