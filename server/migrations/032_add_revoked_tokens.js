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
    CREATE TABLE IF NOT EXISTS revoked_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      token_hash TEXT NOT NULL UNIQUE,
      user_id INTEGER,
      expires_at INTEGER NOT NULL,
      revoked_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  await runSql(db, `
    CREATE INDEX IF NOT EXISTS idx_revoked_tokens_hash
    ON revoked_tokens(token_hash)
  `);

  await runSql(db, `
    CREATE INDEX IF NOT EXISTS idx_revoked_tokens_expires
    ON revoked_tokens(expires_at)
  `);

  // Table to persist per-user token invalidation timestamps
  await runSql(db, `
    CREATE TABLE IF NOT EXISTS user_token_invalidations (
      user_id INTEGER PRIMARY KEY,
      invalidated_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  console.log('Added revoked_tokens and user_token_invalidations tables');
}

async function down(db) {
  await runSql(db, 'DROP TABLE IF EXISTS user_token_invalidations');
  await runSql(db, 'DROP TABLE IF EXISTS revoked_tokens');
  console.log('Removed revoked_tokens and user_token_invalidations tables');
}

module.exports = { up, down };
