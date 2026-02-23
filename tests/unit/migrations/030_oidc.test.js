const sqlite3 = require('sqlite3').verbose();
const { up } = require('../../../server/migrations/030_add_oidc_support');

function createTestDb() {
  return new Promise((resolve) => {
    const db = new sqlite3.Database(':memory:');
    db.run(`CREATE TABLE users (
      id INTEGER PRIMARY KEY, username TEXT, password_hash TEXT,
      email TEXT, is_admin INTEGER DEFAULT 0
    )`, () => resolve(db));
  });
}

function dbAll(db, sql) {
  return new Promise((resolve, reject) => {
    db.all(sql, [], (err, rows) => err ? reject(err) : resolve(rows));
  });
}

describe('Migration 030: OIDC support', () => {
  let db;

  beforeEach(async () => { db = await createTestDb(); });
  afterEach(() => db.close());

  test('adds auth_method column to users with default local', async () => {
    await up(db);
    const cols = await dbAll(db, "PRAGMA table_info(users)");
    const authMethod = cols.find(c => c.name === 'auth_method');
    expect(authMethod).toBeDefined();
    expect(authMethod.dflt_value).toBe("'local'");
  });

  test('creates oidc_config table', async () => {
    await up(db);
    const tables = await dbAll(db, "SELECT name FROM sqlite_master WHERE type='table' AND name='oidc_config'");
    expect(tables).toHaveLength(1);
  });

  test('oidc_config has required columns', async () => {
    await up(db);
    const cols = await dbAll(db, "PRAGMA table_info(oidc_config)");
    const names = cols.map(c => c.name);
    expect(names).toContain('provider_name');
    expect(names).toContain('issuer_url');
    expect(names).toContain('client_id');
    expect(names).toContain('client_secret');
    expect(names).toContain('auto_provision');
    expect(names).toContain('enabled');
  });

  test('existing users get auth_method = local', async () => {
    await new Promise((resolve) => {
      db.run("INSERT INTO users (username, password_hash) VALUES ('alice', 'hash123')", resolve);
    });
    await up(db);
    const users = await dbAll(db, "SELECT auth_method FROM users");
    expect(users[0].auth_method).toBe('local');
  });
});
