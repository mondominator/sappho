/**
 * Promisified wrappers around the callback-based sqlite3 API.
 *
 * Two usage patterns:
 *
 * 1. Direct import (services that use the default database):
 *    const { dbGet, dbAll, dbRun } = require('../utils/db');
 *    const row = await dbGet('SELECT * FROM users WHERE id = ?', [1]);
 *
 * 2. Factory function (route modules with dependency injection):
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

// Default helpers using the main database (for services)
const defaultDb = require('../database');
const { dbGet, dbAll, dbRun } = createDbHelpers(defaultDb);

module.exports = { dbGet, dbAll, dbRun, createDbHelpers };
