// Migration: Add content_hash for stable audiobook identification
const crypto = require('crypto');

function generateContentHash(title, author, duration) {
  const input = `${(title || '').toLowerCase().trim()}|${(author || '').toLowerCase().trim()}|${Math.floor(duration || 0)}`;
  return crypto.createHash('sha256').update(input).digest('hex').substring(0, 16);
}

module.exports = {
  up: (db) => {
    return new Promise((resolve) => {
      db.serialize(() => {
        // Add content_hash column
        db.run(`
          ALTER TABLE audiobooks ADD COLUMN content_hash VARCHAR(16)
        `, (err) => {
          if (err && !err.message.includes('duplicate column')) {
            console.error('Error adding content_hash column:', err.message);
          } else {
            console.log('Added content_hash column to audiobooks');
          }
        });

        // Backfill existing audiobooks with computed hashes
        db.all('SELECT id, title, author, duration FROM audiobooks WHERE content_hash IS NULL', [], (err, rows) => {
          if (err) {
            console.error('Error fetching audiobooks for backfill:', err.message);
            resolve();
            return;
          }

          if (!rows || rows.length === 0) {
            console.log('No audiobooks to backfill');
            // Create index after backfill
            db.run('CREATE UNIQUE INDEX IF NOT EXISTS idx_audiobooks_content_hash ON audiobooks(content_hash)', (indexErr) => {
              if (indexErr) console.warn('Index creation warning:', indexErr.message);
              else console.log('Created unique index on content_hash');
              resolve();
            });
            return;
          }

          console.log(`Backfilling content_hash for ${rows.length} audiobooks...`);

          let completed = 0;
          const hashCounts = {};

          rows.forEach((row) => {
            let hash = generateContentHash(row.title, row.author, row.duration);

            // Handle duplicates by appending counter
            if (hashCounts[hash]) {
              hashCounts[hash]++;
              hash = hash.substring(0, 12) + hashCounts[hash].toString().padStart(4, '0');
              console.warn(`Duplicate hash detected for audiobook ${row.id}, using ${hash}`);
            } else {
              hashCounts[hash] = 1;
            }

            db.run('UPDATE audiobooks SET content_hash = ? WHERE id = ?', [hash, row.id], (updateErr) => {
              if (updateErr) {
                console.error(`Error updating audiobook ${row.id}:`, updateErr.message);
              }
              completed++;

              if (completed === rows.length) {
                console.log(`Backfilled ${completed} audiobooks with content_hash`);
                // Create index after backfill
                db.run('CREATE UNIQUE INDEX IF NOT EXISTS idx_audiobooks_content_hash ON audiobooks(content_hash)', (indexErr) => {
                  if (indexErr) console.warn('Index creation warning:', indexErr.message);
                  else console.log('Created unique index on content_hash');
                  resolve();
                });
              }
            });
          });
        });
      });
    });
  },

  down: (db) => {
    return new Promise((resolve) => {
      db.run('DROP INDEX IF EXISTS idx_audiobooks_content_hash', (err) => {
        if (err) console.warn('Drop index warning:', err.message);
        // Note: SQLite doesn't support DROP COLUMN easily
        resolve();
      });
    });
  }
};
