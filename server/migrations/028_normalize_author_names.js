const { normalizeAuthor } = require('../utils/normalizeAuthor');

async function up(db) {
  return new Promise((resolve, reject) => {
    db.all('SELECT id, author FROM audiobooks WHERE author IS NOT NULL', [], (err, rows) => {
      if (err) return reject(err);
      if (!rows || rows.length === 0) return resolve();

      let updated = 0;
      let processed = 0;

      rows.forEach(row => {
        const normalized = normalizeAuthor(row.author);
        if (normalized !== row.author) {
          db.run('UPDATE audiobooks SET author = ? WHERE id = ?', [normalized, row.id], (updateErr) => {
            processed++;
            if (!updateErr) updated++;
            if (processed === rows.length) {
              console.log(`Normalized ${updated} author names`);
              resolve();
            }
          });
        } else {
          processed++;
          if (processed === rows.length) {
            console.log(`Normalized ${updated} author names`);
            resolve();
          }
        }
      });
    });
  });
}

async function down(_db) {
  console.log('Cannot rollback author normalization');
  return Promise.resolve();
}

module.exports = { up, down };
