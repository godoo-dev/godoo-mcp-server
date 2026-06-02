---
phase: 04-full-surface-catalog-acl-skills
plan: "04"
subsystem: tools
tags: [fastmcp, odoo, mcp, search_read, res.users, ir.ui.menu]

# Dependency graph
requires:
  - phase: 04-full-surface-catalog-acl-skills plan 01
    provides: users_whoami + discovery_list_models + discovery_get_fields tool patterns
provides:
  - users_search_users tool (search res.users by domain, returns users + count)
  - discovery_list_menus tool (list ir.ui.menu ordered by sequence, returns menus + count)
  - USER-02 and DISC-03 unit-level test coverage
affects:
  - 04-05 (ACL probe — completes tool surface used for ACL probing)
  - 04-06 (skills + resources — toolset is now complete before skill files are added)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Inline OdooClientConfig (not _make_config) pattern preserved in users.py and discovery.py
    - cast() for json.loads return value in test helpers (per Phase 04-01 D-cast decision)

key-files:
  created: []
  modified:
    - src/godoo_mcp_server/tools/users.py
    - src/godoo_mcp_server/tools/discovery.py
    - tests/test_users.py
    - tests/test_discovery.py

key-decisions:
  - "Inline OdooClientConfig preserved in users.py and discovery.py — not _make_config — per PATTERNS.md deviation note"
  - "Pre-existing type: ignore[return-value] comments in test helpers replaced with cast() to make mypy --strict pass"

patterns-established:
  - "users_search_users: search_read('res.users', domain or [], fields or defaults, limit, offset)"
  - "discovery_list_menus: search_read('ir.ui.menu', domain or [], fields, limit, order='sequence')"

requirements-completed:
  - USER-02
  - DISC-03

# Metrics
duration: 3min
completed: 2026-06-02
---

# Phase 04 Plan 04: users_search_users and discovery_list_menus tools Summary

**users_search_users (res.users search_read) and discovery_list_menus (ir.ui.menu search_read ordered by sequence) completing USER-02 + DISC-03 coverage**

## Performance

- **Duration:** 3 min
- **Started:** 2026-06-02T16:08:42Z
- **Completed:** 2026-06-02T16:11:52Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments

- Extended users.py with users_search_users: searches res.users by domain, returns {"users": records, "count": int}
- Extended discovery.py with discovery_list_menus: lists ir.ui.menu ordered by sequence, returns {"menus": records, "count": int}
- 4 new unit tests added (isError=True + tools/list presence for each new tool); full suite 54 passing

## Task Commits

Each task was committed atomically:

1. **Task 1: Extend users.py with users_search_users and discovery.py with discovery_list_menus** - `22ba976` (feat)
2. **Task 2: Extend test_users.py and test_discovery.py with new tool tests** - `f1e0dfe` (test)

**Plan metadata:** (committed with SUMMARY.md below)

## Files Created/Modified

- `src/godoo_mcp_server/tools/users.py` - Added `Any` to typing imports; appended users_search_users tool
- `src/godoo_mcp_server/tools/discovery.py` - Appended discovery_list_menus tool
- `tests/test_users.py` - Added test_search_users_odoo_error + test_search_users_in_tools_list; fixed pre-existing type issues
- `tests/test_discovery.py` - Added test_list_menus_odoo_error + test_list_menus_in_tools_list; fixed pre-existing type issues

## Decisions Made

- Inline OdooClientConfig pattern preserved in both files — not _make_config — matching the existing style in those files (per PATTERNS.md deviation note line 200)
- Pre-existing `type: ignore[return-value]` comments in `_parse_sse_json` test helpers replaced with `cast()` to satisfy mypy acceptance criteria (per Phase 04-01 decision)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed pre-existing type: ignore comments in test helpers**
- **Found during:** Task 2 (extend test files, acceptance criteria requires mypy to pass)
- **Issue:** Both test_users.py and test_discovery.py had `# type: ignore[return-value]` on `json.loads()` returns but mypy reports `[no-any-return]` as the actual error code; the ignore comments were unused and the error was uncovered; additionally `content[0].get(...)` calls had unused `# type: ignore[union-attr]` comments
- **Fix:** Replaced `type: ignore[return-value]` with `cast(dict[str, object], json.loads(...))` per Phase 04-01 established pattern; removed unused `type: ignore[union-attr]` comments and replaced with `isinstance(first, dict)` narrowing
- **Files modified:** tests/test_users.py, tests/test_discovery.py
- **Verification:** `uv run mypy tests/test_users.py tests/test_discovery.py` — zero errors
- **Committed in:** f1e0dfe (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 — pre-existing type annotation bugs in test files being extended)
**Impact on plan:** Necessary to meet acceptance criteria (mypy must pass). No scope creep — only the files being extended were touched.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- 17-tool surface is now complete across plans 01-04 (mail in 01, actions+attachments in 02, catalog in 03, users+discovery extensions in 04)
- Plan 04-05 (ACL probe) and 04-06 (skills + resources) can proceed
- All 54 unit tests green; mypy --strict clean on all tool modules

## Known Stubs

None — both new tools delegate fully to godoo-client search_read; no hardcoded or placeholder data.

## Threat Flags

None — threat model addressed inline:
- T-04-04-01 (res.users info disclosure): mitigated by Odoo ACL enforcement + default fields exclude password
- T-04-04-02 (spoofing): inline OdooClientConfig per request, no shared client
- T-04-04-03 (ToolError message): ToolError(str(e)) only, no traceback; verified by test

---
*Phase: 04-full-surface-catalog-acl-skills*
*Completed: 2026-06-02*
