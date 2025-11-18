// Migration to clean chapter listings from existing audiobook descriptions

function cleanDescription(description) {
  if (!description) return '';

  let cleaned = description;

  // Pattern 1: "CHAPTER ONE CHAPTER TWO CHAPTER THREE..." (word-based)
  cleaned = cleaned.replace(/^(\s*CHAPTER\s+[A-Z]+(\s+[A-Z]+)*\s*)+/i, '');

  // Pattern 2: "CHAPTER 1 CHAPTER 2 CHAPTER 3..." (number-based)
  cleaned = cleaned.replace(/^(\s*CHAPTER\s+\d+\s*)+/i, '');

  // Pattern 3: "Chapter One, Chapter Two, Chapter Three..." (comma-separated)
  cleaned = cleaned.replace(/^(\s*Chapter\s+[A-Za-z]+(\s+[A-Za-z]+)?,?\s*)+/i, '');

  // Pattern 4: "Ch. 1, Ch. 2, Ch. 3..." (abbreviated)
  cleaned = cleaned.replace(/^(\s*Ch\.\s*\d+,?\s*)+/i, '');

  // Pattern 5: Just numbers separated by spaces/commas at the start
  cleaned = cleaned.replace(/^(\s*\d+[,\s]+)+/, '');

  return cleaned.trim();
}

async function up(db) {
  return new Promise((resolve, reject) => {
    db.all('SELECT id, description FROM audiobooks WHERE description IS NOT NULL AND description != ""', [], (err, rows) => {
      if (err) {
        console.error('Error fetching audiobooks:', err);
        return reject(err);
      }

      if (!rows || rows.length === 0) {
        console.log('No audiobooks with descriptions found');
        return resolve();
      }

      console.log(`Cleaning descriptions for ${rows.length} audiobooks...`);
      let updated = 0;
      let processed = 0;

      rows.forEach((row) => {
        const cleanedDescription = cleanDescription(row.description);

        // Only update if the description actually changed
        if (cleanedDescription !== row.description) {
          db.run(
            'UPDATE audiobooks SET description = ? WHERE id = ?',
            [cleanedDescription, row.id],
            (updateErr) => {
              processed++;
              if (updateErr) {
                console.error(`Error updating audiobook ${row.id}:`, updateErr);
              } else {
                updated++;
              }

              if (processed === rows.length) {
                console.log(`Successfully cleaned ${updated} audiobook descriptions`);
                resolve();
              }
            }
          );
        } else {
          processed++;
          if (processed === rows.length) {
            console.log(`Successfully cleaned ${updated} audiobook descriptions`);
            resolve();
          }
        }
      });
    });
  });
}

async function down(db) {
  // No way to rollback cleaned descriptions, so this is a no-op
  console.log('Cannot rollback description cleaning migration');
  return Promise.resolve();
}

module.exports = { up, down };
