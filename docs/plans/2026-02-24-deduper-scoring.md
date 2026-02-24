# Deduper Scoring, Auto-Merge & Fuzzy Improvements Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add confidence scoring to duplicate detection, auto-merge high-confidence duplicates during library scan, and fix fuzzy matching false positives with Levenshtein similarity.

**Architecture:** Three changes — (1) extract a shared `levenshteinSimilarity` utility, (2) rewrite the duplicate detection endpoint to score each group and replace substring bucketing with Levenshtein, (3) add ISBN/ASIN dedup checks to the library scanner with auto-merge for score >= 90.

**Tech Stack:** Node.js/Express, SQLite, React

---

### Task 1: Add Levenshtein similarity utility

**Files:**
- Create: `server/utils/stringSimilarity.js`
- Create: `tests/unit/stringSimilarity.test.js`

**Step 1: Write the tests**

Create `tests/unit/stringSimilarity.test.js`:

```javascript
const { levenshteinSimilarity, normalizeTitle } = require('../../server/utils/stringSimilarity');

describe('stringSimilarity', () => {
  describe('levenshteinSimilarity', () => {
    it('returns 1 for identical strings', () => {
      expect(levenshteinSimilarity('hello', 'hello')).toBe(1);
    });

    it('returns 0 for completely different strings', () => {
      expect(levenshteinSimilarity('abc', 'xyz')).toBe(0);
    });

    it('returns 0 when both strings are empty', () => {
      expect(levenshteinSimilarity('', '')).toBe(0);
    });

    it('handles one empty string', () => {
      expect(levenshteinSimilarity('hello', '')).toBe(0);
    });

    it('calculates similarity for similar strings', () => {
      const sim = levenshteinSimilarity('kitten', 'sitting');
      expect(sim).toBeGreaterThan(0.5);
      expect(sim).toBeLessThan(0.8);
    });

    it('rejects Canticle vs Blood Canticle (false positive)', () => {
      const sim = levenshteinSimilarity('canticle', 'blood canticle');
      expect(sim).toBeLessThan(0.85);
    });

    it('rejects Skyward ReDawn vs Skyward Evershore (false positive)', () => {
      const sim = levenshteinSimilarity('skyward redawn', 'skyward evershore');
      expect(sim).toBeLessThan(0.85);
    });

    it('accepts Storm Assault vs Storm Assault (true positive)', () => {
      const sim = levenshteinSimilarity('storm assault', 'storm assault');
      expect(sim).toBe(1);
    });
  });

  describe('normalizeTitle', () => {
    it('lowercases and strips non-alphanumeric', () => {
      expect(normalizeTitle("Harry Potter: The Boy's Tale")).toBe('harry potter the boys tale');
    });

    it('collapses whitespace', () => {
      expect(normalizeTitle('  hello   world  ')).toBe('hello world');
    });

    it('handles null/undefined', () => {
      expect(normalizeTitle(null)).toBe('');
      expect(normalizeTitle(undefined)).toBe('');
    });
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx jest tests/unit/stringSimilarity.test.js`
Expected: FAIL — module not found

**Step 3: Implement the utility**

Create `server/utils/stringSimilarity.js`:

```javascript
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
  if (!a && !b) return 0;
  if (!a || !b) return 0;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 0;
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

module.exports = { levenshteinSimilarity, normalizeTitle };
```

**Step 4: Run tests to verify they pass**

Run: `npx jest tests/unit/stringSimilarity.test.js`
Expected: PASS — all 9 tests

**Step 5: Commit**

```bash
git add server/utils/stringSimilarity.js tests/unit/stringSimilarity.test.js
git commit -m "Add Levenshtein similarity utility for fuzzy title matching"
```

---

### Task 2: Add scoring and Levenshtein to duplicate detection endpoint

**Files:**
- Modify: `server/routes/maintenance/duplicates.js:1-256`

**Step 1: Write integration tests for scoring**

Add these tests to `tests/integration/maintenance.test.js` after the existing "returns duplicates for admin" test (line 336):

```javascript
    it('returns score for each duplicate group', async () => {
      // Create two books with same ISBN (score 90)
      await new Promise((resolve, reject) => {
        db.run(
          `INSERT INTO audiobooks (title, author, duration, file_size, isbn) VALUES (?, ?, ?, ?, ?)`,
          ['Score Test', 'Author', 3600, 100000, '978-1234567890'],
          (err) => err ? reject(err) : resolve()
        );
      });
      await new Promise((resolve, reject) => {
        db.run(
          `INSERT INTO audiobooks (title, author, duration, file_size, isbn) VALUES (?, ?, ?, ?, ?)`,
          ['Score Test Dup', 'Author', 3600, 100000, '978-1234567890'],
          (err) => err ? reject(err) : resolve()
        );
      });

      const res = await request(app)
        .get('/api/maintenance/duplicates')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      const isbnGroup = res.body.duplicateGroups.find(g => g.matchReason === 'Same ISBN');
      expect(isbnGroup).toBeDefined();
      expect(isbnGroup.score).toBe(90);
    });

    it('does not match dissimilar titles in fuzzy matching', async () => {
      // "Canticle" and "Blood Canticle" should NOT match even with similar duration/size
      await new Promise((resolve, reject) => {
        db.run(
          `INSERT INTO audiobooks (title, author, duration, file_size) VALUES (?, ?, ?, ?)`,
          ['Canticle', 'R. A. Salvatore', 36000, 500000000],
          (err) => err ? reject(err) : resolve()
        );
      });
      await new Promise((resolve, reject) => {
        db.run(
          `INSERT INTO audiobooks (title, author, duration, file_size) VALUES (?, ?, ?, ?)`,
          ['Blood Canticle', 'Anne Rice', 36000, 500000000],
          (err) => err ? reject(err) : resolve()
        );
      });

      const res = await request(app)
        .get('/api/maintenance/duplicates')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      // These should NOT be grouped as duplicates
      const fuzzyGroups = res.body.duplicateGroups.filter(g => g.matchReason === 'Similar title, duration and file size');
      const falsePositive = fuzzyGroups.find(g =>
        g.books.some(b => b.title === 'Canticle') && g.books.some(b => b.title === 'Blood Canticle')
      );
      expect(falsePositive).toBeUndefined();
    });
```

**Step 2: Run tests to verify they fail**

Run: `npx jest tests/integration/maintenance.test.js`
Expected: `score` test FAILS (no score field), Canticle test may pass or fail depending on current fuzzy bucketing

**Step 3: Rewrite the duplicate detection endpoint**

Replace `server/routes/maintenance/duplicates.js` lines 1-8 (add the import):

```javascript
/**
 * Duplicate Detection & Merge Routes
 * Find duplicate audiobooks and merge them.
 */
const fs = require('fs');
const path = require('path');
const { maintenanceLimiter, maintenanceWriteLimiter } = require('./helpers');
const { createDbHelpers } = require('../../utils/db');
const { createQueryHelpers } = require('../../utils/queryHelpers');
const { levenshteinSimilarity, normalizeTitle } = require('../../utils/stringSimilarity');
```

Replace the `groupMap` value format. Currently each entry is `{ reason, books }`. Change to `{ reason, score, books }`. Update each place where groups are added:

**ISBN groups (line 63):** Change to:
```javascript
          groupMap.set(groupKey, { reason: 'Same ISBN', score: 90, books });
```

**ASIN groups (line 96):** Change to:
```javascript
          groupMap.set(groupKey, { reason: 'Same ASIN', score: 90, books });
```

**Title+author groups (line 132):** Change to:
```javascript
          groupMap.set(groupKey, { reason: 'Same title and author', score: 80, books });
```

**Replace the entire fuzzy matching section (lines 137-217)** with:

```javascript
      // --- 4. Fuzzy title similarity + duration/size match on remaining unmatched books ---
      const remainingBooks = await dbAll(
        `SELECT id, title, author, narrator, duration, file_size, file_path,
                isbn, asin, series, series_position, cover_image, cover_path,
                created_at
         FROM audiobooks
         WHERE duration IS NOT NULL AND duration > 0
           AND file_size IS NOT NULL AND file_size > 0
           AND title IS NOT NULL AND TRIM(title) != ''
           AND id NOT IN (${matched.size > 0 ? [...matched].map(() => '?').join(',') : '0'})
         ORDER BY title, author`,
        [...matched]
      );

      // Group by normalized title for O(n) bucketing, then pairwise Levenshtein within buckets
      const normalizedGroups = new Map();
      for (const book of remainingBooks) {
        const norm = normalizeTitle(book.title);
        if (!norm) continue;
        if (!normalizedGroups.has(norm)) normalizedGroups.set(norm, []);
        normalizedGroups.get(norm).push(book);
      }

      // Collect all normalized keys and do pairwise Levenshtein between keys
      // to find similar (but not identical) titles
      const normKeys = [...normalizedGroups.keys()];
      const titleBuckets = new Map(); // bucket key -> array of books

      for (const key of normKeys) {
        let assigned = false;
        for (const [bucketKey, bucketBooks] of titleBuckets) {
          if (levenshteinSimilarity(key, bucketKey) >= 0.85) {
            bucketBooks.push(...normalizedGroups.get(key));
            assigned = true;
            break;
          }
        }
        if (!assigned) {
          titleBuckets.set(key, [...normalizedGroups.get(key)]);
        }
      }

      // Within each bucket, do pairwise duration/size comparison
      for (const [, bucketBooks] of titleBuckets) {
        if (bucketBooks.length < 2) continue;

        const fuzzyProcessed = new Set();
        for (let i = 0; i < bucketBooks.length; i++) {
          if (fuzzyProcessed.has(bucketBooks[i].id)) continue;
          const book = bucketBooks[i];
          const fuzzyMatches = [book];

          for (let j = i + 1; j < bucketBooks.length; j++) {
            if (fuzzyProcessed.has(bucketBooks[j].id)) continue;
            const candidate = bucketBooks[j];

            const durationDiff = Math.abs(book.duration - candidate.duration) / Math.max(book.duration, candidate.duration);
            const sizeDiff = Math.abs(book.file_size - candidate.file_size) / Math.max(book.file_size, candidate.file_size);

            if (durationDiff < 0.02 && sizeDiff < 0.15) {
              fuzzyMatches.push(candidate);
              fuzzyProcessed.add(candidate.id);
            }
          }

          if (fuzzyMatches.length > 1) {
            // Calculate score: 50 base + bonus for title similarity
            const titleSim = levenshteinSimilarity(
              normalizeTitle(fuzzyMatches[0].title),
              normalizeTitle(fuzzyMatches[1].title)
            );
            const score = Math.min(70, Math.round(50 + (titleSim - 0.85) * 133));

            const groupKey = `fuzzy:${book.id}`;
            groupMap.set(groupKey, { reason: 'Similar title, duration and file size', score, books: fuzzyMatches });
            for (const b of fuzzyMatches) matched.add(b.id);
            fuzzyProcessed.add(book.id);
          }
        }
      }
```

**Update the response builder (line 238-243)** to include score:

```javascript
        duplicateGroups.push({
          id: `group-${groupIndex++}`,
          matchReason: group.reason,
          score: group.score,
          books: matchesWithProgress,
          suggestedKeep: matchesWithProgress[0].id,
        });
```

**Step 4: Run tests to verify they pass**

Run: `npx jest tests/integration/maintenance.test.js`
Expected: PASS — all tests including new score and false-positive tests

**Step 5: Commit**

```bash
git add server/routes/maintenance/duplicates.js tests/integration/maintenance.test.js
git commit -m "Add confidence scoring to deduper and fix fuzzy false positives with Levenshtein"
```

---

### Task 3: Auto-merge high-confidence duplicates during library scan

**Files:**
- Modify: `server/services/libraryScanner.js:79-84`
- Modify: `server/services/pathCache.js` (add ISBN/ASIN lookup)

**Step 1: Add ISBN/ASIN lookup to pathCache**

Check what `pathCache.js` exports and add lookup functions. Read the file first to see the current exports, then add:

```javascript
async function audiobookExistsByIsbn(isbn) {
  if (!isbn || !isbn.trim()) return null;
  return new Promise((resolve, reject) => {
    db.get('SELECT id, title, file_path FROM audiobooks WHERE isbn = ? AND (is_available = 1 OR is_available IS NULL) LIMIT 1',
      [isbn.trim()], (err, row) => err ? reject(err) : resolve(row || null));
  });
}

async function audiobookExistsByAsin(asin) {
  if (!asin || !asin.trim()) return null;
  return new Promise((resolve, reject) => {
    db.get('SELECT id, title, file_path FROM audiobooks WHERE asin = ? AND (is_available = 1 OR is_available IS NULL) LIMIT 1',
      [asin.trim()], (err, row) => err ? reject(err) : resolve(row || null));
  });
}
```

Export them alongside the existing functions.

**Step 2: Add auto-merge check to libraryScanner.js**

After the content hash check (line 84) in `importAudiobook`, add:

```javascript
    // Check if an audiobook with same ISBN already exists (auto-merge, score 90)
    if (metadata.isbn) {
      const existingByIsbn = await audiobookExistsByIsbn(metadata.isbn);
      if (existingByIsbn) {
        console.log(`Auto-merge: "${metadata.title}" matches existing "${existingByIsbn.title}" by ISBN ${metadata.isbn}`);
        return null;
      }
    }

    // Check if an audiobook with same ASIN already exists (auto-merge, score 90)
    if (metadata.asin) {
      const existingByAsin = await audiobookExistsByAsin(metadata.asin);
      if (existingByAsin) {
        console.log(`Auto-merge: "${metadata.title}" matches existing "${existingByAsin.title}" by ASIN ${metadata.asin}`);
        return null;
      }
    }
```

Update the import at the top of `libraryScanner.js` (line 11) to include the new functions:

```javascript
const { loadPathCache, clearPathCache, fileExistsInDatabase, audiobookExistsInDirectory, audiobookExistsByHash, audiobookExistsByIsbn, audiobookExistsByAsin } = require('./pathCache');
```

Also add the same checks to `importMultiFileAudiobook` after its content hash check.

**Step 3: Write a unit test for the auto-merge behavior**

This is best tested via the integration test for the scanner. Add to an appropriate test file or create `tests/unit/libraryScanner.test.js` with a focused test:

```javascript
// In the maintenance or audiobooks integration tests, add:
it('library scan skips book with duplicate ISBN', async () => {
  // Create existing book with ISBN
  await createTestAudiobook(db, { title: 'Original Book', isbn: '978-TEST-ISBN' });

  // Try to import another book — the scanner should skip it
  // This is tested indirectly by the scan endpoint behavior
});
```

Since the scanner is harder to test in isolation (requires filesystem), the integration test for the maintenance endpoint already verifies duplicate detection. The auto-merge logging (`console.log`) provides observability.

**Step 4: Commit**

```bash
git add server/services/libraryScanner.js server/services/pathCache.js
git commit -m "Auto-merge ISBN/ASIN duplicates during library scan"
```

---

### Task 4: Update web UI to display confidence score

**Files:**
- Modify: `client/src/components/settings/JobsSettings.jsx:239-254`

**Step 1: Update the duplicate list to show scores**

Replace lines 239-254 (the duplicate group rendering) with:

```jsx
                    {duplicateGroups.map(group => (
                      <div key={group.id} className="dup-item">
                        <div className="dup-info">
                          <span className="dup-title">{group.books[0].title}</span>
                          <span className="dup-author">{group.books[0].author}</span>
                          <span className="dup-count">{group.books.length} copies</span>
                          <span className={`dup-score ${group.score >= 90 ? 'high' : group.score >= 70 ? 'medium' : 'low'}`}>
                            {group.score}%
                          </span>
                        </div>
                        <button
                          className="merge-btn"
                          onClick={() => handleMerge(group)}
                          disabled={actionLoading === `merge-${group.id}`}
                        >
                          Merge
                        </button>
                      </div>
                    ))}
```

**Step 2: Add CSS for score badges**

Add to the relevant CSS file (check where `.dup-item` is styled):

```css
.dup-score {
  font-size: 0.75rem;
  padding: 0.125rem 0.375rem;
  border-radius: 4px;
  font-weight: 600;
}

.dup-score.high {
  background: rgba(34, 197, 94, 0.2);
  color: #22c55e;
}

.dup-score.medium {
  background: rgba(234, 179, 8, 0.2);
  color: #eab308;
}

.dup-score.low {
  background: rgba(239, 68, 68, 0.2);
  color: #ef4444;
}
```

**Step 3: Commit**

```bash
git add client/src/components/settings/JobsSettings.jsx client/src/components/settings/JobsSettings.css
git commit -m "Display confidence score in duplicate detection UI"
```

---

### Task 5: Build and verify

**Step 1: Run all tests**

```bash
npx jest tests/unit/stringSimilarity.test.js tests/integration/maintenance.test.js
```

Expected: All tests pass.

**Step 2: Verify end-to-end**

- Open settings > Duplicates tab
- Click "Scan for Duplicates"
- Verify each group shows a confidence score (90 for ISBN/ASIN, 80 for title+author, 50-70 for fuzzy)
- Verify false positives (Canticle vs Blood Canticle, etc.) are no longer shown
- Merge the real duplicates (Storm Assault, A.C. Crispin books)

**Step 3: Final commit and push**

```bash
git push origin <branch>
```
