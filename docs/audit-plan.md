# Sappho Codebase Audit — Action Plan

**Audit date:** 2026-04-04 (post v0.7.0 schema consolidation release)
**Scope:** Full codebase deep-dive across backend routes, services, client, infrastructure, and CI
**Issues filed:** 44 (#463 – #506)
**Tracking label:** [`audit`](https://github.com/mondominator/sappho/labels/audit)

## Summary Stats

| Severity | Count | Issue numbers |
|----------|-------|---------------|
| **Critical** | 8 | #463, #464, #465, #466, #467, #468, #469, #470 |
| **High** | 16 | #471 – #485, #498 |
| **Medium** | 16 | #486 – #497, #499 – #502 |
| **Low** | 4 | #503, #504, #505, #506 |
| **Total** | **44** | |

### By Category

| Category | Count | Notes |
|----------|-------|-------|
| Security | 13 | OIDC auth (4 critical), SSRF, open redirect, host header injection, traversal, plaintext password email |
| Bugs / logic errors | 12 | Backup corruption, player races, progress type confusion, conversion races, dedup bypass |
| Code quality / tech debt | 10 | God components, duplicated transforms, API shape drift, dead code |
| Infrastructure / CI | 4 | PORT drift, Dockerfile hardening, CI swallowing errors, compose LAN IPs |
| Dependencies | 2 | 17 npm vulns (#467), music-metadata 8→11 (#503) |
| Testing | 2 | Coverage gaps (#502), flaky timers (#483) |
| Documentation / dead code | 1 | Stale comments sweep (#505) |

## Recommended Order

Fix top-to-bottom. Each wave builds on the previous.

### Wave 1 — Critical security + data integrity (do first)

These are the "don't merge anything else until these are done" items.

1. **#467 — 17 production npm vulnerabilities** → run `npm audit fix`, bump `tar`, `path-to-regexp`, `picomatch`, `qs`. Quickest credibility win.
2. **#463 — OIDC auto-provision INSERT uses non-existent column** → trivial one-line fix (`password` → `password_hash`), but completely breaks OIDC auto-provisioning until fixed.
3. **#464 — OIDC ID token signature never verified** → real auth bypass. Must use `jose.jwtVerify` against the JWKS.
4. **#466 — OIDC SSRF via private IPs** → add IP allowlist/denylist before fetching issuer metadata.
5. **#465 — OIDC auth state unbounded** → add TTL + max-size cap on the in-memory state map.
6. **#468 — Backup restore can corrupt live DB** → stream entries to a temp dir and swap atomically on success.
7. **#470 — PORT config drift** → align Dockerfile, compose, and unraid template on one value (probably 3001).
8. **#469 — Notification collection link 404** → one-line fix in `NotificationPanel.jsx` (`/collection/${id}` → `/collections/${id}`).

### Wave 2 — High-severity security + correctness

9. **#476 — Path traversal in backup restore temp dir** → can be bundled with #468 restore fix.
10. **#472 — Cover downloader DNS rebinding** → resolve once, validate IP, fetch by IP.
11. **#479 — OIDC host header injection** → use configured base URL, not `req.headers.host`.
12. **#475 — Gemini API key leaked in URL query strings** → move to headers.
13. **#477 — CI security workflow swallows failures** → remove `continue-on-error: true` from the security job.
14. **#471 — `requirePasswordChanged` middleware non-functional** → wire it up correctly on the protected routes.
15. **#478 — Weak password policy bypassed via Profile page** → share validator between register/change.
16. **#480 — Public collection vandalism** → tighten `canEditCollection` to owner-or-admin.
17. **#484 — Stale 'table may not exist' fallbacks** → remove now that schema is consolidated.
18. **#498 — User-creation email sends initial password in plaintext** → replace with signed invite link.

### Wave 3 — High-severity bugs (bundle with Wave 2 PRs where possible)

19. **#485 — Conversion service ffmpeg race** → use a proper semaphore (p-limit or similar).
20. **#481 — AudioPlayer drag race on fullscreen toggle** → clean up listeners in effect cleanup.
21. **#482 — AuthorDetail book.progress type confusion** → normalize at the API boundary.
22. **#473 — Upload dedup bypass** → hash-based dedup.
23. **#474 — Multi-file upload orphans** → wrap in a transaction + cleanup on rollback.
24. **#483 — Flaky auth.test.js timers** → switch to `jest.useFakeTimers`.

### Wave 4 — Medium priority (can be done in parallel across contributors)

25-40. All Medium-severity items (#486–#497, #499–#502) can be spread across multiple small PRs. No strict order required.

### Wave 5 — Low-priority cleanup (quick wins + sweeping refactors)

41. **#503 — Config/infra cleanup** → 30 min sweep.
42. **#504 — Logging hygiene** → scripted replacement, one PR.
43. **#505 — Stale comments + minor bugs** → file-by-file sweep.
44. **#506 — Transform duplication** → extract utilities.

## Quick Wins (under 5 minutes each)

These should be grabbed immediately — trivial to fix, disproportionate value.

- **#463** — one-column-name fix in `oidcAuth.js:267-271`
- **#469** — one-route-path fix in `NotificationPanel.jsx:75`
- **#470** — align three config files on the same PORT value
- **#467** — `npm audit fix` (may not require manual work at all)
- **#477** — remove three `continue-on-error: true` lines from `security.yml`
- **#484** — delete dead `catch { /* table may not exist */ }` blocks

## Dependency Chain

Some fixes unblock or depend on others:

```
#467 (npm audit) ────┐
                     ├──> ready to merge other PRs without CI warnings
#477 (CI fix) ───────┘

#463 (INSERT column) ─┐
#464 (JWT verify) ────┤
#466 (SSRF) ──────────┼──> must all land together to ship trustworthy OIDC
#465 (state TTL) ─────┤
#479 (host header) ───┘

#468 (restore corruption) ──> enables #476 (same code path)
                               └──> enables #502 (restore test)

#484 (remove stale fallbacks) ──> requires v0.7.0 schema consolidation ✓ (done)

#483 (fake timers) ──> makes CI reliable
                       └──> makes #502 (new tests) easier to write
```

## Estimated Effort

| Group | Effort | Contains |
|-------|--------|----------|
| Wave 1 (Critical) | **Medium** — ~1 focused sprint | Most are localized fixes; OIDC cluster is the big lift |
| Wave 2 (High security) | **Medium** — another sprint | Several touch the same files (auth, OIDC) |
| Wave 3 (High bugs) | **Medium-Large** | Player + conversion fixes need careful testing |
| Wave 4 (Medium) | **Large** — spread over multiple PRs | Many independent items; good for parallel work |
| Wave 5 (Low) | **Small** — opportunistic | Quick wins + sweeping refactors |

## Notes

- The **OIDC module (#463-#466, #479)** is the single highest-risk area. It should be reviewed by at least two people and bundled into one PR with integration tests (addresses #502 at the same time).
- **Backup/restore (#468, #476)** is the #2 risk — a botched restore can wipe the library. Test against a fixture DB before shipping.
- **Test coverage (#502)** should be fixed *alongside* the bugs, not after — writing the test first locks in the fix and prevents regression.
- The **player/UI bugs (#481, #482, #469)** are the most user-visible. Fixing those first improves trust while the bigger security work is in progress.
- All of the issues were filed with specific file paths and (where possible) line numbers. Start with the issue body, not this plan.
