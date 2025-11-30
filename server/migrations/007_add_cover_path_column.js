// Migration to add cover_path column to audiobooks table

async function up(db) {
  return new Promise((resolve, reject) => {
    db.run('ALTER TABLE audiobooks ADD COLUMN cover_path TEXT', (err) => {
      if (err) {
        // Column might already exist
        if (err.message.includes('duplicate column name')) {
          console.log('cover_path column already exists');
          return resolve();
        }
        console.error('Error adding cover_path column:', err);
        return reject(err);
      }
      console.log('Added cover_path column to audiobooks table');

      // Try to populate cover_path from cover_image for existing records
      // cover_image contains the filename, we need to construct the full path
      db.run(`
        UPDATE audiobooks
        SET cover_path = CASE
          WHEN cover_image IS NOT NULL AND cover_image != ''
          THEN (
            SELECT SUBSTR(file_path, 1, LENGTH(file_path) - LENGTH(SUBSTR(file_path, -INSTR(REVERSE(file_path), '/')+1))) || '/' || cover_image
          )
          ELSE NULL
        END
      `, (updateErr) => {
        if (updateErr) {
          console.log('Could not auto-populate cover_path:', updateErr.message);
        } else {
          console.log('Attempted to populate cover_path from existing cover_image values');
        }
        resolve();
      });
    });
  });
}

async function down(db) {
  console.log('Cannot drop columns in SQLite without table recreation');
  return Promise.resolve();
}

module.exports = { up, down };
