---
phase: 03-core-primitives
plan: "04"
subsystem: tools
tags: [probe-removal, integration-tests, server-wiring, d-13, users, records, discovery]

dependency_graph:
  requires:
    - phase: "03-01"
      provides: users_whoami MCP tool
    - phase: "03-02"
      provides: record_search/read/create/update/delete MCP tools
    - phase: "03-03"
      provides: discovery_list_models/discovery_get_fields MCP tools
  provides:
    - server.py wired to all three new tool modules (probe removed)
    - SC-3 CRUD round-trip integration test (test_record_crud_roundtrip)
    - SC-4 invalid-domain structured-error integration test
    - SC-5 credential-resolution path integration test
    - Full unit+type+lint gate green with all 8 tools registered, probe gone
  affects:
    - Phase 04 (catalog cache) — clean server.py with no dead code
    - CI integration test suite — three new integration markers

tech_stack:
  added: []
  patterns:
    - D-13 sequencing: repoint tests before deleting the tool they test (CI stays green throughout)
    - Side-effect imports in server.py sorted alphabetically per ruff I001

key_files:
  created:
    - tests/integration/test_vertical.py (SC-3/SC-4/SC-5 tests added)
  modified:
    - src/godoo_mcp_server/server.py (probe import removed; users/records/discovery remain)
    - tests/test_transport.py (odoo_whoami → users_whoami)
    - tests/integration/test_vertical.py (odoo_whoami → users_whoami; three new integration tests)
  deleted:
    - src/godoo_mcp_server/tools/probe.py (Phase 2 scaffolding artifact retired)

key-decisions:
  - "D-13 completed: probe.py deleted and server.py import swapped in the final task of Phase 3 (after all new tools verified)"
  - "D-02 confirmed: all 8 underscore tool names registered verbatim by fastmcp 3.3.x without silent renaming"
  - "ruff I001 dictates import order (alphabetical): discovery, records, users — plan specified users/records/discovery but ruff auto-fixed"

patterns-established:
  - "Server.py side-effect imports must be alphabetically sorted to satisfy ruff I001"
  - "D-13 repoint-before-delete: update all test assertions before deleting the deprecated module, not after"

requirements-completed:
  - REC-01
  - REC-02
  - REC-03
  - REC-04
  - REC-05
  - DISC-01
  - DISC-02
  - USER-01
  - ERR-01

metrics:
  duration: 12min
  completed_date: "2026-06-02"
  tasks_completed: 2
  files_changed: 5
---

# Phase 03 Plan 04: Probe Retirement and Integration Wiring Summary

**probe.py retired, server.py wired to all 8 new tools, SC-3/SC-4/SC-5 integration tests added — D-13 sequencing complete with full gate green**

## Performance

- **Duration:** ~12 min
- **Started:** 2026-06-02T12:00:00Z (approx)
- **Completed:** 2026-06-02T12:12:00Z (approx)
- **Tasks:** 2 (Task 1 was executed as Task 1; Task 2 was the human-verify checkpoint; Task 3 was the final auto task)
- **Files modified:** 5 (server.py, test_transport.py, test_vertical.py, probe.py deleted, planning config)

## Accomplishments

- SC-3/SC-4/SC-5 integration tests added to tests/integration/test_vertical.py: CRUD round-trip on res.partner.category, invalid-domain structured-error (no Traceback), credential-resolution record_search
- D-13 completed: probe import removed from server.py, probe.py deleted; all 8 new tools confirmed registered
- test_transport.py and test_vertical.py repointed from odoo_whoami → users_whoami before probe deletion (CI stayed green throughout)

## Task Commits

Each task was committed atomically:

1. **Task 1: Repoint tests to users_whoami + add SC-3/SC-4/SC-5** - `3c0d7af` (feat)
2. **Task 2: Human-verify checkpoint** - approved by user (no commit)
3. **Task 3: Swap server.py probe import, delete probe.py** - `076e145` (refactor)

**Plan metadata:** (this commit — docs)

## Files Created/Modified

- `src/godoo_mcp_server/server.py` - Probe import removed; imports now: discovery, records, users (alphabetical per ruff I001)
- `src/godoo_mcp_server/tools/probe.py` - Deleted (Phase 2 scaffolding artifact, retired per D-13)
- `tests/test_transport.py` - odoo_whoami assertion repointed to users_whoami
- `tests/integration/test_vertical.py` - Three repoints (odoo_whoami → users_whoami) + three new integration tests (SC-3/SC-4/SC-5)

## Decisions Made

- **D-13 completed:** probe.py deleted and server.py import swapped after all new tools verified by unit tests (human-verify checkpoint approved before deletion).
- **D-02 confirmed:** fastmcp 3.3.x accepts all 8 underscore tool names verbatim; tools/list returns `['discovery_list_models', 'discovery_get_fields', 'record_search', 'record_read', 'record_create', 'record_update', 'record_delete', 'users_whoami']` — no silent renaming.
- **ruff I001 import order:** The plan specified users/records/discovery order; ruff I001 required alphabetical (discovery, records, users). Applied `ruff check --fix` — auto-fixed, no logic change.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] ruff I001 import order conflict**
- **Found during:** Task 3 full gate
- **Issue:** Plan specified server.py side-effect imports in order: users, records, discovery. ruff I001 requires alphabetical order: discovery, records, users.
- **Fix:** Applied `uv run ruff check --fix src/godoo_mcp_server/server.py` — auto-sorted to discovery, records, users.
- **Files modified:** `src/godoo_mcp_server/server.py`
- **Verification:** `uv run ruff check .` exits 0 after fix.
- **Committed in:** `076e145` (Task 3 commit)

---

**Total deviations:** 1 auto-fixed (Rule 3 - blocking lint error)
**Impact on plan:** Minor cosmetic — import alphabetical order only; no behavior change.

## Issues Encountered

None beyond the ruff I001 deviation above.

## Known Stubs

None. All 8 tools make real Odoo RPC calls. Integration tests assert real Odoo responses.

## Threat Flags

No new threat surface. T-03-13 (probe still registered after swap) is now resolved: odoo_whoami confirmed absent from tool list post-deletion.

## Next Phase Readiness

Phase 3 complete. All 8 tools registered and verified:
- users_whoami: uid + username + database
- record_search, record_read, record_create, record_update, record_delete: full CRUD
- discovery_list_models, discovery_get_fields: model/field introspection

Unit suite: 23 passed. mypy --strict: no issues (8 source files). ruff: clean. probe.py gone.

Phase 4 (catalog cache, skill resources) can proceed on a clean server.py with no dead code.

## Self-Check

Checking created/modified files and commits:

- [x] `src/godoo_mcp_server/server.py` — probe import absent, three new imports present
- [x] `src/godoo_mcp_server/tools/probe.py` — deleted (does not exist)
- [x] `tests/test_transport.py` — users_whoami present, odoo_whoami absent
- [x] `tests/integration/test_vertical.py` — users_whoami present, three new integration test methods
- [x] Task 1 commit `3c0d7af` — verified
- [x] Task 3 commit `076e145` — verified

## Self-Check: PASSED

---
*Phase: 03-core-primitives*
*Completed: 2026-06-02*
