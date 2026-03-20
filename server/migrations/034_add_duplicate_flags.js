function runSql(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function(err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

async function up(db) {
  await runSql(db, `
    CREATE TABLE IF NOT EXISTS duplicate_flags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      audiobook_id INTEGER NOT NULL,
      existing_audiobook_id INTEGER NOT NULL,
      match_type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      resolved_at TEXT,
      FOREIGN KEY (audiobook_id) REFERENCES audiobooks(id) ON DELETE CASCADE,
      FOREIGN KEY (existing_audiobook_id) REFERENCES audiobooks(id) ON DELETE CASCADE
    )
  `);

  await runSql(db, `
    CREATE INDEX IF NOT EXISTS idx_duplicate_flags_status
    ON duplicate_flags(status)
  `);

  await runSql(db, `
    CREATE INDEX IF NOT EXISTS idx_duplicate_flags_audiobook
    ON duplicate_flags(audiobook_id)
  `);

  console.log('Added duplicate_flags table');
}

async function down(db) {
  await runSql(db, 'DROP TABLE IF EXISTS duplicate_flags');
  console.log('Removed duplicate_flags table');
}

module.exports = { up, down };
