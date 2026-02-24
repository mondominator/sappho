# Deduper Scoring, Auto-Merge & Fuzzy Improvements

## Problem

1. The duplicate detector treats all matches equally — no confidence scoring, so users can't distinguish obvious duplicates from uncertain ones
2. Obvious duplicates (same ISBN, ASIN, content hash) require manual merging via the settings UI
3. The fuzzy matcher produces false positives because it uses substring containment for title bucketing (e.g. "Canticle" matches "Blood Canticle")

## Design

### Confidence Scoring

Each duplicate group gets a numeric score (0-100):

| Match type | Score | Rationale |
|---|---|---|
| Same ISBN | 90 | Published identifier |
| Same ASIN | 90 | Published identifier |
| Same title + author (exact) | 80 | Strong match, could be different editions |
| Fuzzy (title similarity + duration/size) | 50-70 | Calculated from Levenshtein similarity |

Note: Content hash and file path duplicates are already caught during library scan (auto-skip) and never reach the detection endpoint.

Fuzzy score formula: `50 + (titleSimilarity - 0.85) * 133`, capped at 70.

The score is returned in the API response and displayed in the web UI.

### Auto-Merge on Scan (score >= 90)

During library scan, after importing a new book, check for duplicates by ISBN and ASIN against existing books. If a match is found, skip creating a new DB entry (the existing record is kept, preserving playback progress). This extends the existing content_hash dedup in the scanner to also catch ISBN/ASIN matches.

The dedup check fails open: if the database query errors, the import proceeds (a duplicate that can be merged later is better than a silently lost book).

### Fuzzy Matching: Levenshtein Similarity

Replace substring title bucketing with Levenshtein-based similarity. Two books enter fuzzy comparison only if normalized titles have >= 85% similarity (`1 - distance/maxLength`). This eliminates false positives like:

- "Canticle" vs "Blood Canticle" (57% similar — rejected)
- "Skyward ReDawn" vs "Skyward Evershore" (50% similar — rejected)

No external dependencies — Levenshtein distance is ~10 lines.

### Maintenance Endpoint Changes

The existing `GET /maintenance/duplicates` response adds a `score` field to each group. The `POST /maintenance/duplicates/merge` endpoint is unchanged. The web UI displays the score and can sort/filter by confidence.
