---
phase: 04-full-surface-catalog-acl-skills
plan: "05"
subsystem: mcp, resources, skills
tags: [fastmcp, importlib-resources, mcp-resources, skill-md, odoo-mcp]

requires:
  - phase: 04-01
    provides: mail tool handlers registered on mcp instance
  - phase: 04-02
    provides: action + attachment tool handlers registered on mcp instance
  - phase: 04-03
    provides: get_model_entry_from_cache() in catalog.py for resources.py
  - phase: 04-04
    provides: users_search_users, discovery_list_menus tool handlers

provides:
  - resources.py with 4 MCP resource handlers (odoo://model, odoo://action, skill://index.json, skill://odoo/{path*})
  - 4 skill .md files bundled in package (SKILL.md, mail/chatter.md, mail/activities.md, base/properties.md)
  - _load_skills() startup assertion (SKILL-02) — server fails fast if any skill file missing
  - Option B placeholder for odoo://action/{id} per D-13 — error dict directing agents to action_list_actions
  - D-14 compliance — zero literal Odoo field identifiers in all skill files
  - [tool.uv_build] include for skills/** packaging — skills bundled in wheel
  - test_resources.py with 8 tests covering all resource handlers and startup assertion

affects:
  - phase 04-06 (integration tests — resources/list and skill file reads expected in vertical tests)
  - phase 05 (packaging — skills/ must be present in published wheel)

tech-stack:
  added: [importlib.resources (stdlib — wheel-compatible skill file loading)]
  patterns:
    - "importlib.resources.files() traversal for bundled package data — wheel-safe alternative to os.path"
    - "_load_skills() startup assertion — fail-fast on missing bundled data (SKILL-02)"
    - "Option B warm-from-cache placeholder — odoo://action/{id} always returns error dict, no live Odoo probe (D-13)"
    - "dict-lookup safety for wildcard resource paths — _SKILL_FILES pre-populated, no filesystem traversal (T-04-05-05)"
    - "skill .md files as procedural guides — zero literal Odoo field identifiers (D-14/PITFALL-13)"

key-files:
  created:
    - src/godoo_mcp_server/resources.py
    - src/godoo_mcp_server/skills/SKILL.md
    - src/godoo_mcp_server/skills/mail/chatter.md
    - src/godoo_mcp_server/skills/mail/activities.md
    - src/godoo_mcp_server/skills/base/properties.md
    - tests/test_resources.py
  modified:
    - src/godoo_mcp_server/server.py (added resources side-effect import; updated comment)
    - pyproject.toml (added [tool.uv_build] include for skills/**)

key-decisions:
  - "D-13 (Option B adopted): odoo://action/{id} is a warm-from-cache placeholder — always returns action_not_found error dict directing agents to action_list_actions; no live Odoo probe; no get_action_entry_from_cache() added to catalog.py"
  - "D-14 (PITFALL-13 compliance): skill .md files contain zero literal Odoo field identifiers — procedural guidance only; verified by grep -rE returning 0 hits"
  - "importlib.resources.files() traversal adopted for wheel-safe skill loading — works in both editable and installed package modes"

patterns-established:
  - "Resource resolvers read from cache or bundled files only — no get_http_request() call allowed (T-04-05-01)"
  - "Startup assertion on bundled data — _load_skills() asserts all declared paths are loadable at import time"
  - "Skill file dict lookup — _SKILL_FILES pre-populated with 4 fixed keys; wildcard path resolution is a dict.get() call, not filesystem traversal"

requirements-completed: [RES-01, SKILL-01, SKILL-02]

duration: 15min
completed: 2026-06-02
---

# Phase 4 Plan 05: Resources and Skills Summary

**MCP resource handlers for odoo:// catalog and skill:// file discovery wired with 4 procedural skill guides bundled in the wheel via importlib.resources**

## Performance

- **Duration:** 15 min
- **Started:** 2026-06-02T16:15:00Z
- **Completed:** 2026-06-02T16:30:00Z
- **Tasks:** 2
- **Files modified:** 8

## Accomplishments

- resources.py: 4 MCP resource handlers registered on the fastmcp instance via `@mcp.resource` decorators; no credentials accessed in resource resolvers (T-04-05-01 enforced)
- 4 skill .md files written in procedural guide form with zero literal Odoo field identifiers (D-14/PITFALL-13 compliant; verified by grep returning 0 hits)
- `_load_skills()` startup assertion ensures server fails to start if any bundled skill file is missing (SKILL-02)
- odoo://action/{id} registered as Option B warm-from-cache placeholder per D-13 — always returns `action_not_found` error dict pointing agents to `action_list_actions` tool; no `get_action_entry_from_cache()` added (out of scope)
- server.py extended with resources side-effect import; `[tool.uv_build] include` added; packaging smoke test confirmed 3 entries in skills/
- test_resources.py: 8 tests covering all resource handlers, startup assertion, Option B placeholder behavior, and full tool surface smoke test; 62 total tests passing

## Task Commits

1. **Task 1: Create resources.py, skill .md files, and update server.py + pyproject.toml** - `1b726be` (feat)
2. **Task 2: Write unit tests for resource registration and skill serving** - `7e9a139` (feat)

## Files Created/Modified

- `src/godoo_mcp_server/resources.py` — 4 MCP resource handlers: odoo://model/{name}, odoo://action/{id} (Option B), skill://index.json, skill://odoo/{path*}; skill loading and startup assertion
- `src/godoo_mcp_server/skills/SKILL.md` — top-level procedural guide: tool groups, domain syntax, workflow example, skill index links
- `src/godoo_mcp_server/skills/mail/chatter.md` — chatter procedural guide: post message, log note, list messages, error handling
- `src/godoo_mcp_server/skills/mail/activities.md` — activities procedural guide: schedule, list, mark done
- `src/godoo_mcp_server/skills/base/properties.md` — discovery procedural guide: list models, get fields, list menus, discover-before-operate pattern
- `src/godoo_mcp_server/server.py` — added `from godoo_mcp_server import resources as _resources_module`; updated comment to mention `@mcp.resource`
- `pyproject.toml` — added `[tool.uv_build] include = ["src/godoo_mcp_server/skills/**"]`
- `tests/test_resources.py` — 8 tests: skill_resources_in_list, skill_index_read, skill_file_chatter, skill_file_root, model_resource_cold_cache, action_resource_cold_cache, startup_assertion, all_tools_in_list

## Decisions Made

- **Option B for odoo://action/{id}**: D-13 requires the URI scheme to be adopted. Since `catalog.py._build_snapshot` only introspects `ir.model` (not `ir.actions.*`), adding `get_action_entry_from_cache()` would exceed Plan 03's scope. Option B chosen: register the decorator, always return error dict pointing agents to `action_list_actions` tool. Consistent with how odoo://model/{name} handles cold cache. No live Odoo probe in resource resolver.
- **importlib.resources.files() traversal**: Wheel-safe approach — works in both editable installs and installed wheels. `os.path` would fail when the package is installed as a zip/wheel.
- **Procedural-only skill files (D-14/PITFALL-13)**: No literal Odoo field identifiers in any skill .md file. All field references use plain language descriptions. This avoids skill files becoming stale when Odoo field names differ between versions or custom modules.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Removed unnecessary `type: ignore` annotations in resources.py**
- **Found during:** Task 1 (resources.py creation)
- **Issue:** `mypy --strict` emitted `[unused-ignore]` on two `type: ignore[union-attr]` and `type: ignore[assignment]` comments for `importlib.resources` traversal — these suppressions are not needed under Python 3.14 + mypy 2.x
- **Fix:** Removed both `type: ignore` comments; mypy passes cleanly
- **Files modified:** src/godoo_mcp_server/resources.py
- **Verification:** `uv run mypy src/godoo_mcp_server/resources.py --strict` → 0 errors
- **Committed in:** 1b726be (part of Task 1 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 bug — unused type: ignore annotations)
**Impact on plan:** Trivial — mypy strict mode naturally caught these during first run. No scope change.

## Issues Encountered

- server.py already had all 6 tool module imports from prior Wave 1 plans (04-01..04-04) — only the resources import was needed. Plan description of adding mail/actions/attachments imports was already satisfied; confirmed by reading the file before editing.

## Known Stubs

None. All 4 resource handlers return real content (from catalog cache or bundled skill files). Cold cache returns explicit error dicts with actionable hints — this is intentional behavior, not a stub.

## Threat Flags

None. No new network endpoints, auth paths, or trust boundaries introduced beyond those declared in the plan's `<threat_model>`. All threat mitigations confirmed:
- T-04-05-01: No `get_http_request()` import in resources.py (grep: 0 import hits)
- T-04-05-05: `_SKILL_FILES` dict lookup prevents filesystem traversal for `{path*}` wildcard

## Next Phase Readiness

- Plan 04-05 complete: resources.py wired, skill files bundled, 62 tests passing
- Ready for Plan 04-06: integration tests for resources/list, skill reads, two-user cache isolation
- Skills are MCP Resources readable by any MCP client — skill discovery workflow is functional
- uv_build include confirmed — skills will be present in published wheel (Phase 5)

## Self-Check

- [x] resources.py exists at src/godoo_mcp_server/resources.py
- [x] SKILL.md exists at src/godoo_mcp_server/skills/SKILL.md
- [x] mail/chatter.md exists at src/godoo_mcp_server/skills/mail/chatter.md
- [x] mail/activities.md exists at src/godoo_mcp_server/skills/mail/activities.md
- [x] base/properties.md exists at src/godoo_mcp_server/skills/base/properties.md
- [x] tests/test_resources.py exists
- [x] Task 1 commit 1b726be verified in git log
- [x] Task 2 commit 7e9a139 verified in git log
- [x] 62 tests passing (uv run pytest tests/ -x -q)
- [x] mypy --strict: 0 errors on resources.py, server.py, test_resources.py
- [x] D-14 compliance: grep -rE returns 0 hits for literal field identifiers
- [x] Packaging smoke test: 3 entries in skills/ via importlib.resources

## Self-Check: PASSED

---
*Phase: 04-full-surface-catalog-acl-skills*
*Completed: 2026-06-02*
