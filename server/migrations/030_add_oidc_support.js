function runSql(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function(err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

async function up(db) {
  // Check if column already exists (idempotent)
  const cols = await new Promise((resolve, reject) => {
    db.all('PRAGMA table_info(users)', [], (err, rows) => err ? reject(err) : resolve(rows));
  });
  if (!cols.find(c => c.name === 'auth_method')) {
    await runSql(db, "ALTER TABLE users ADD COLUMN auth_method TEXT DEFAULT 'local'");
  }

  await runSql(db, `
    CREATE TABLE IF NOT EXISTS oidc_config (
      id INTEGER PRIMARY KEY,
      provider_name TEXT NOT NULL,
      issuer_url TEXT NOT NULL,
      client_id TEXT NOT NULL,
      client_secret TEXT NOT NULL,
      auto_provision INTEGER DEFAULT 1,
      default_admin INTEGER DEFAULT 0,
      enabled INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  console.log('Added OIDC support (auth_method column + oidc_config table)');
}

async function down(db) {
  await runSql(db, 'DROP TABLE IF EXISTS oidc_config');
  console.log('Cannot remove auth_method column from SQLite');
}

module.exports = { up, down };
