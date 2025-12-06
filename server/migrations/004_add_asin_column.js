// Migration to add ASIN (Audible Standard Identification Number) column to audiobooks table

async function up(db) {
  return new Promise((resolve, reject) => {
    db.run('ALTER TABLE audiobooks ADD COLUMN asin TEXT', (err) => {
      if (err) {
        // Column might already exist
        if (err.message.includes('duplicate column name')) {
          console.log('ASIN column already exists');
          return resolve();
        }
        console.error('Error adding ASIN column:', err);
        return reject(err);
      }
      console.log('Added ASIN column to audiobooks table');
      resolve();
    });
  });
}

async function down(_db) {
  // SQLite doesn't support DROP COLUMN directly, so we'd need to recreate the table
  // For simplicity, we'll just leave the column
  console.log('Cannot drop ASIN column in SQLite without table recreation');
  return Promise.resolve();
}

module.exports = { up, down };
