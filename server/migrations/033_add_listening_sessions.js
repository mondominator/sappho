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
    CREATE TABLE IF NOT EXISTS listening_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      audiobook_id INTEGER NOT NULL,
      started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      stopped_at DATETIME,
      start_position INTEGER NOT NULL DEFAULT 0,
      end_position INTEGER,
      device_name TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (audiobook_id) REFERENCES audiobooks(id) ON DELETE CASCADE
    )
  `);

  await runSql(db, `
    CREATE INDEX IF NOT EXISTS idx_listening_sessions_user_book
    ON listening_sessions(user_id, audiobook_id)
  `);

  await runSql(db, `
    CREATE INDEX IF NOT EXISTS idx_listening_sessions_started
    ON listening_sessions(started_at)
  `);

  console.log('Added listening_sessions table');
}

async function down(db) {
  await runSql(db, 'DROP TABLE IF EXISTS listening_sessions');
  console.log('Removed listening_sessions table');
}

module.exports = { up, down };
