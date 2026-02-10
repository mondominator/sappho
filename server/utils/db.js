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

  /**
   * Run a function inside a database transaction.
   * Automatically rolls back on error and commits on success.
   * @param {Function} fn - async function receiving { dbGet, dbAll, dbRun }
   * @returns {Promise<*>} - return value of fn
   */
  async function dbTransaction(fn) {
    await dbRun('BEGIN TRANSACTION');
    try {
      const result = await fn({ dbGet, dbAll, dbRun });
      await dbRun('COMMIT');
      return result;
    } catch (err) {
      await dbRun('ROLLBACK');
      throw err;
    }
  }

  return { dbGet, dbAll, dbRun, dbTransaction };
}

module.exports = { createDbHelpers };
