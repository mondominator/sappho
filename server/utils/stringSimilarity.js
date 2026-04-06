/**
 * Calculate Levenshtein distance between two strings.
 * Returns the minimum number of single-character edits needed.
 */
function levenshteinDistance(a, b) {
  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1));

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

/**
 * Calculate similarity between two strings (0-1).
 * 1 = identical, 0 = completely different or both empty.
 */
function levenshteinSimilarity(a, b) {
  a = typeof a === 'string' ? a : '';
  b = typeof b === 'string' ? b : '';
  if (!a && !b) return 0;
  if (!a || !b) return 0;
  const maxLen = Math.max(a.length, b.length);
  return 1 - levenshteinDistance(a, b) / maxLen;
}

/**
 * Normalize a title for comparison.
 * Lowercase, strip non-alphanumeric (keep spaces), collapse whitespace.
 */
function normalizeTitle(title) {
  if (!title) return '';
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Detect titles that look like a chapter/part marker rather than a real
 * book title. Used by upload + consolidation flows to decide whether to
 * fall back to a directory name as the canonical title.
 *
 * Matches:
 *   - "Chapter 1", "chapter_2", "Chapter-3"
 *   - "Part 4", "Part5"
 *   - "Track 1", "Disc 1", "CD 2"
 *   - Bare numeric or punctuated chapter labels ("01.", "Ch 1", "Pt. 2")
 */
function isChapterStyleTitle(title) {
  if (!title) return false;
  return /^(chapter|ch|part|pt|track|disc|cd)[\s._-]*\d+/i.test(title.trim());
}

module.exports = {
  levenshteinSimilarity,
  normalizeTitle,
  isChapterStyleTitle,
};
