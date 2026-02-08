/**
 * Promisified wrappers around the callback-based sqlite3 API.
 *
 * Usage (factory function for route modules with dependency injection):
 *    const { createDbHelpers } = require('../../utils/db');
 *    const { dbGet, dbAll, dbRun } = createDbHelpers(db);
 */

/**
 * Create promisified DB helpers bound to a specific database instance.
 * @param {Object} database - sqlite3 database instance
 * @returns {{ dbGet, dbAll, dbRun }}
 */
function createDbHelpers(database) {
  function dbGet(sql, params = []) {
    return new Promise((resolve, reject) => {
      database.get(sql, params, (err, row) => {
        if (err) reject(err);
        else resolve(row || null);
      });
    });
  }

  function dbAll(sql, params = []) {
    return new Promise((resolve, reject) => {
      database.all(sql, params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });
  }

  function dbRun(sql, params = []) {
    return new Promise((resolve, reject) => {
      database.run(sql, params, function (err) {
        if (err) reject(err);
        else resolve({ lastID: this.lastID, changes: this.changes });
      });
    });
  }

  return { dbGet, dbAll, dbRun };
}

module.exports = { createDbHelpers };
