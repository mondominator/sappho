const { normalizeAuthor } = require('../utils/normalizeAuthor');

async function up(db) {
  // Phase 1: Update author names in the database
  const updated = await new Promise((resolve, reject) => {
    db.all('SELECT id, author FROM audiobooks WHERE author IS NOT NULL', [], (err, rows) => {
      if (err) return reject(err);
      if (!rows || rows.length === 0) return resolve(0);

      let updatedCount = 0;
      let processed = 0;

      rows.forEach(row => {
        const normalized = normalizeAuthor(row.author);
        if (normalized !== row.author) {
          db.run('UPDATE audiobooks SET author = ? WHERE id = ?', [normalized, row.id], (updateErr) => {
            processed++;
            if (!updateErr) {
              updatedCount++;
              console.log(`  "${row.author}" → "${normalized}"`);
            }
            if (processed === rows.length) {
              resolve(updatedCount);
            }
          });
        } else {
          processed++;
          if (processed === rows.length) {
            resolve(updatedCount);
          }
        }
      });
    });
  });

  console.log(`Normalized ${updated} author names (initial spacing)`);

  // Phase 2: Reorganize files on disk to match updated author names
  if (updated > 0) {
    try {
      const { organizeLibrary } = require('../services/fileOrganizer');
      console.log('Reorganizing files to match updated author names...');
      const stats = await organizeLibrary();
      console.log(`File reorganization complete: ${stats.moved} moved, ${stats.skipped} unchanged, ${stats.errors} errors`);
    } catch (e) {
      console.error('File reorganization failed (database was updated successfully):', e.message);
      console.log('Run "Organize Library" from admin panel to complete file reorganization.');
    }
  }
}

async function down(_db) {
  console.log('Cannot rollback author initial normalization');
  return Promise.resolve();
}

module.exports = { up, down };
