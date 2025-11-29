// Migration to add extended metadata fields from Audible/Audnexus

async function up(db) {
  const columns = [
    { name: 'publisher', type: 'TEXT' },
    { name: 'copyright_year', type: 'INTEGER' },
    { name: 'rating', type: 'TEXT' },
    { name: 'abridged', type: 'INTEGER DEFAULT 0' },
    { name: 'tags', type: 'TEXT' },
    { name: 'subtitle', type: 'TEXT' },
  ];

  for (const column of columns) {
    await new Promise((resolve, reject) => {
      db.run(`ALTER TABLE audiobooks ADD COLUMN ${column.name} ${column.type}`, (err) => {
        if (err) {
          if (err.message.includes('duplicate column name')) {
            console.log(`${column.name} column already exists`);
            return resolve();
          }
          console.error(`Error adding ${column.name} column:`, err);
          return reject(err);
        }
        console.log(`Added ${column.name} column to audiobooks table`);
        resolve();
      });
    });
  }
}

async function down(db) {
  console.log('Cannot drop columns in SQLite without table recreation');
  return Promise.resolve();
}

module.exports = { up, down };
