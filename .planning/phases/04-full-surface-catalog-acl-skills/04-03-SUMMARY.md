---
phase: 04-full-surface-catalog-acl-skills
plan: "03"
subsystem: api
tags: [cachetools, ttlcache, asyncio, catalog, schema-hash, python]

# Dependency graph
requires:
  - phase: 04-full-surface-catalog-acl-skills
    provides: pyproject.toml with cachetools>=7,<8 dependency (added in Plan 02)

provides:
  - catalog.py: schema-hash computation + TTLCache catalog store + cache-read helper
  - test_catalog.py: 11 unit tests covering CAT-01, CAT-02, D-12 isolation
  - py.typed marker enabling mypy to type-check importers of godoo_mcp_server

affects:
  - 04-04: resources.py will import get_model_entry_from_cache and get_catalog_snapshot
  - 04-05: skill packaging and index assertion will hook into catalog layer
  - 04-06: integration tests will warm catalog cache via real Odoo calls

# Tech tracking
tech-stack:
  added:
    - cachetools.TTLCache (used for first time — cachetools was added as dep in Plan 02)
  patterns:
    - Lazy asyncio.Lock via _get_lock() — never created at module level (Python 3.14 safety)
    - Credential-free cache key: CacheKey = (url, database, schema_hash) — no user/pass
    - 3-parallel write_date probes via asyncio.gather for cheap schema generation token
    - Schema-hash-keyed TTLCache with asyncio.Lock guard against concurrent build races

key-files:
  created:
    - src/godoo_mcp_server/catalog.py
    - src/godoo_mcp_server/py.typed
    - tests/test_catalog.py
  modified: []

key-decisions:
  - "Lazy asyncio.Lock via _get_lock() is required in Python 3.14 — Lock must not be created at module import time"
  - "Cache key is strictly (url, database, schema_hash) — credentials never included; two users on same target share the same cache entry"
  - "compute_schema_hash returns None on any exception — callers degrade gracefully to uncached mode"
  - "py.typed marker added (Rule 2 auto-fix): package declares itself typed so mypy can check importers without --ignore-missing-imports"

patterns-established:
  - "Lazy Lock: _catalog_lock: asyncio.Lock | None = None at module level; asyncio.Lock() only created inside _get_lock() body"
  - "Cache key isolation: CacheKey = tuple[str, str, str] — (url, database, schema_hash) — password/username never in key"
  - "Graceful hash failure: return {'schema_hash': None, 'models': [], 'cached': False} when compute_schema_hash returns None"

requirements-completed: [CAT-01, CAT-02]

# Metrics
duration: 10min
completed: 2026-06-02
---

# Phase 04 Plan 03: Catalog Service Layer Summary

**Lazy schema-hashed catalog store: 3 write_date probes, cachetools TTLCache keyed by (url, database, schema_hash), asyncio-safe lazy Lock, and 11 unit tests covering CAT-01/CAT-02/D-12 credential isolation**

## Performance

- **Duration:** 10 min
- **Started:** 2026-06-02T16:02:38Z
- **Completed:** 2026-06-02T16:12:00Z
- **Tasks:** 2
- **Files modified:** 3 (catalog.py, test_catalog.py, py.typed)

## Accomplishments

- catalog.py: schema-hash computation via 3 parallel write_date probes (asyncio.gather), in-process TTLCache with lazy asyncio.Lock, credential-free cache key, model-entry cache reader for resources.py
- test_catalog.py: 11 unit tests — schema hash success/empty/error, cache hit/miss/hash-change, hash-failure fallback, credential-free key assertion, two-user isolation, model entry cold/warm/miss
- py.typed marker added so mypy can type-check any file importing godoo_mcp_server without --ignore-missing-imports

## Task Commits

Each task was committed atomically:

1. **Task 1: Create catalog.py — schema-hash, TTLCache, lazy Lock** - `15dc2ac` (feat)
2. **Task 2: Write unit tests for catalog** - `af1beae` (test — includes py.typed Rule 2 fix)

**Plan metadata:** *(docs commit follows)*

## Files Created/Modified

- `src/godoo_mcp_server/catalog.py` — schema-hash computation, TTLCache store, lazy Lock, cache-read helper for resources.py
- `src/godoo_mcp_server/py.typed` — PEP 561 typed package marker (Rule 2 deviation)
- `tests/test_catalog.py` — 11 unit tests covering all plan-specified behaviors

## Decisions Made

- Lazy asyncio.Lock via `_get_lock()` — never at module level; Python 3.14 requires Lock to be created inside a running event loop
- Cache key `(url, database, schema_hash)` — no credentials; two users on the same Odoo target share the same cache entry (D-12)
- `compute_schema_hash` returns `None` on any exception; `get_catalog_snapshot` gracefully returns `{schema_hash: None, models: [], cached: False}`

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Added py.typed marker**
- **Found during:** Task 2 (test_catalog.py — running mypy tests/test_catalog.py)
- **Issue:** mypy reported `Skipping analyzing "godoo_mcp_server.catalog": module is installed, but missing library stubs or py.typed marker [import-untyped]` — test file could not be type-checked as specified in acceptance criteria
- **Fix:** Created `src/godoo_mcp_server/py.typed` (empty PEP 561 marker file) declaring the package as typed
- **Files modified:** src/godoo_mcp_server/py.typed
- **Verification:** `uv run mypy tests/test_catalog.py` now exits 0 with zero errors
- **Committed in:** af1beae (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 missing critical — py.typed marker)
**Impact on plan:** Fix was necessary for mypy type-checking of test importers. No scope creep. Benefits all current and future test files importing godoo_mcp_server modules.

## Issues Encountered

None — plan executed cleanly once py.typed was added.

## Known Stubs

None — catalog.py is fully wired. TTLCache is populated by `get_catalog_snapshot`; `get_model_entry_from_cache` returns real data from cache entries.

## Threat Surface Scan

No new network endpoints, auth paths, or trust boundaries introduced. catalog.py reads from Odoo via the existing OdooClient pattern (same trust surface as other tools). T-04-03-01 through T-04-03-05 mitigations all applied as planned.

## Self-Check

Files created:
- src/godoo_mcp_server/catalog.py: EXISTS
- src/godoo_mcp_server/py.typed: EXISTS
- tests/test_catalog.py: EXISTS

Commits:
- 15dc2ac: EXISTS (feat(04-03): add catalog.py)
- af1beae: EXISTS (test(04-03): add test_catalog.py)

## Next Phase Readiness

- catalog.py is ready for resources.py (Plan 04) to import `get_model_entry_from_cache` and `get_catalog_snapshot`
- py.typed marker ensures all future test files can be mypy-checked without overrides
- All 50 unit tests pass; no regressions

---
*Phase: 04-full-surface-catalog-acl-skills*
*Completed: 2026-06-02*
