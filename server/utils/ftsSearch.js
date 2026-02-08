/**
 * FTS5 full-text search utilities
 *
 * Provides query sanitization and helper functions for SQLite FTS5
 * full-text search on the audiobooks_fts virtual table.
 */

/**
 * Sanitize and transform a user search query into a safe FTS5 query.
 *
 * - Strips FTS5 special characters that could cause syntax errors
 * - Splits input into individual terms
 * - Wraps each term in double quotes for literal matching
 * - Appends * wildcard for prefix matching (e.g. "bran"* matches "brandon")
 * - Joins terms with implicit AND (FTS5 default)
 *
 * @param {string} query - Raw user search input
 * @returns {string} Sanitized FTS5 query string, or empty string if no valid terms
 *
 * @example
 *   sanitizeFtsQuery('brandon sanderson')  // '"brandon"* "sanderson"*'
 *   sanitizeFtsQuery('the "great" gatsby')  // '"the"* "great"* "gatsby"*'
 *   sanitizeFtsQuery('  ')                  // ''
 *   sanitizeFtsQuery('')                    // ''
 */
function sanitizeFtsQuery(query) {
  if (!query || typeof query !== 'string') {
    return '';
  }

  // Remove FTS5 special/operator characters: " * ( ) { } ^ ~ : OR AND NOT NEAR
  // We strip these to prevent syntax errors and injection
  const escaped = query.replace(/["*(){}^~:]/g, '');

  // Split on whitespace and filter empty terms
  const terms = escaped.trim().split(/\s+/).filter(t => t.length > 0);

  if (terms.length === 0) {
    return '';
  }

  // Remove FTS5 boolean keywords that could alter query semantics
  const reserved = new Set(['AND', 'OR', 'NOT', 'NEAR']);
  const safeterms = terms.filter(t => !reserved.has(t.toUpperCase()));

  if (safeterms.length === 0) {
    return '';
  }

  // Wrap each term in quotes for literal matching, add prefix wildcard
  return safeterms.map(t => `"${t}"*`).join(' ');
}

module.exports = { sanitizeFtsQuery };
