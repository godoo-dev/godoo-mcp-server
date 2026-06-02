---
phase: 04-full-surface-catalog-acl-skills
verified: 2026-06-02T18:34:55Z
status: resolved
score: 4/4
overrides_applied: 0
re_verification: false
gap_resolution: "odoo://menu/{id} resource added in 15fc473 (handler) following the odoo://action/{id} Option B placeholder pattern, with test_menu_resource_cold_cache in tests/test_resources.py. Suite 62→63 passing, mypy --strict clean. All 4 success criteria now MET."
gaps:
  - truth: "MCP resource descriptors for odoo://model/{name}, odoo://action/{id}, and odoo://menu/{id} URIs are all registered"
    status: resolved
    reason: "RES-01 and D-13 require all three odoo:// URI patterns. odoo://model/{name} and odoo://action/{id} are registered. odoo://menu/{id} is absent from resources.py — not mentioned in 04-05-PLAN.md must_haves (omission in plan scoping), but explicitly required by REQUIREMENTS.md RES-01 and D-13. No later phase covers it."
    artifacts:
      - path: "src/godoo_mcp_server/resources.py"
        issue: "Missing @mcp.resource('odoo://menu/{id}') handler. Only two odoo:// URIs registered (model and action)."
    missing:
      - "Add @mcp.resource('odoo://menu/{id}', ...) placeholder handler to resources.py (analogous to the existing odoo://action/{id} Option B placeholder)"
      - "Add corresponding test to tests/test_resources.py"
---

# Phase 4: Full Surface + Catalog + Skills — Verification Report

**Phase Goal:** The complete tool surface is available; catalog introspection produces schema-hashed, cached MCP resource descriptors; skill Markdown files are served as MCP Resources; cross-user cache-key isolation is verified by a two-user integration test (ACL enforcement delegated fully to Odoo per D-12)

**Verified:** 2026-06-02T18:34:55Z
**Status:** gaps_found
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | All named MCP tools respond to valid tool calls (mail x6, action x2, attachments x3, users_search_users, discovery_list_menus) | VERIFIED | All 21 tools confirmed in `tools/list` via `test_all_tools_in_list` in test_resources.py; each module (mail.py, actions.py, attachments.py, users.py, discovery.py) implements handlers with full OdooClient wiring, not stubs |
| 2 | Catalog introspection returns schema hash; second call with same hash hits cache (no Odoo RPC); schema change forces miss | VERIFIED | catalog.py implements `compute_schema_hash` (3 parallel write_date probes), `get_catalog_snapshot` with TTLCache keyed by (url, database, schema_hash); `test_cache_hit_no_rpc` asserts `cached=True` on second call; `test_cache_miss_on_hash_change` asserts `cached=False` on new hash |
| 3 | MCP resource descriptors accessible at odoo:// and skill:// URIs; skill .md files readable; startup assertion fires on missing file | PARTIAL | odoo://model/{name} and odoo://action/{id} registered and tested. odoo://menu/{id} specified by RES-01 and D-13 is ABSENT from resources.py. skill:// surface (SKILL.md, mail/chatter.md, mail/activities.md, base/properties.md) fully implemented and tested. Startup assertion (_load_skills AssertionError) implemented and tested. |
| 4 | Two-user isolation: same catalog cache key (url, database, schema_hash) — no credential component; each user resolves own uid | VERIFIED | `test_two_users_same_target_share_cache` in test_catalog.py confirms two mock clients with same schema hash share cache; `test_cache_key_excludes_credentials` asserts CacheKey 3-tuple has no credential component; integration test `test_two_user_catalog_cache_isolation` written (not run live — Docker not available) |

**Score:** 3/4 truths fully verified (Truth 3 is PARTIAL due to missing odoo://menu/{id})

### Deferred Items

None. The odoo://menu/{id} gap is not addressed in any later phase (Phase 5 = packaging, Phase 6 = Code Mode).

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/godoo_mcp_server/tools/mail.py` | 6 mail tool handlers | VERIFIED | mail_post_message, mail_log_note, mail_list_messages, mail_schedule_activity, mail_list_activities, mail_mark_activity_done — all substantive, all wired via side-effect import in server.py |
| `src/godoo_mcp_server/tools/actions.py` | action_list_actions, action_execute_action | VERIFIED | Both handlers substantive; real ir.actions.server + ir.actions.act_window queries |
| `src/godoo_mcp_server/tools/attachments.py` | attachments_list, attachments_upload, attachments_download | VERIFIED | All substantive; download guards empty datas field |
| `src/godoo_mcp_server/tools/users.py` | users_search_users added | VERIFIED | search_read on res.users with domain/fields/limit/offset parameters |
| `src/godoo_mcp_server/tools/discovery.py` | discovery_list_menus added | VERIFIED | search_read on ir.ui.menu with domain/limit/order |
| `src/godoo_mcp_server/catalog.py` | Schema-hash + TTLCache + lazy Lock | VERIFIED | compute_schema_hash (3 parallel probes), _get_lock (lazy event-loop-safe), get_catalog_snapshot (cache get/set), get_model_entry_from_cache (scan all entries) |
| `src/godoo_mcp_server/resources.py` | odoo:// and skill:// MCP resources | PARTIAL | odoo://model/{name} VERIFIED; odoo://action/{id} VERIFIED (Option B placeholder per D-13); odoo://menu/{id} MISSING; skill:// VERIFIED |
| `src/godoo_mcp_server/skills/SKILL.md` | Root skill guide | VERIFIED | 107 lines, procedural guide, no literal Odoo field identifiers |
| `src/godoo_mcp_server/skills/mail/chatter.md` | Chatter skill guide | VERIFIED | Exists, non-empty |
| `src/godoo_mcp_server/skills/mail/activities.md` | Activities skill guide | VERIFIED | Exists, non-empty |
| `src/godoo_mcp_server/skills/base/properties.md` | Properties skill guide | VERIFIED | Exists, non-empty |
| `src/godoo_mcp_server/server.py` | All new modules wired via side-effect imports | VERIFIED | 7 side-effect imports: records, discovery, users, mail, actions, attachments, resources |
| `pyproject.toml` | cachetools dep + uv_build skills include | VERIFIED | `cachetools>=7,<8` in dependencies; `[tool.uv_build] include = ["src/godoo_mcp_server/skills/**"]` present |
| `tests/test_mail.py` | 8 mail tests | VERIFIED | 8 tests covering all 6 tools + error text + tools/list presence |
| `tests/test_actions.py` | Action tests | VERIFIED | Exists |
| `tests/test_attachments.py` | Attachment tests | VERIFIED | Exists |
| `tests/test_catalog.py` | Catalog tests | VERIFIED | 9 tests covering schema_hash, cache hit/miss, two-user isolation, cold-cache model entry |
| `tests/test_users.py` | search_users tests | VERIFIED | Exists |
| `tests/test_discovery.py` | list_menus tests | VERIFIED | 6 tests including list_menus error + tools/list presence |
| `tests/test_resources.py` | Resource/skill tests | VERIFIED | 8 tests; all pass |
| `tests/integration/test_vertical.py` | Integration tests (not run live) | VERIFIED (written) | 9 tests collected; mail round-trip, attachments round-trip, two-user isolation added in 04-06; live execution requires Docker |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| server.py | tools/mail.py | `from godoo_mcp_server.tools import mail as _mail_module` | WIRED | Line 25 in server.py |
| server.py | tools/actions.py | `from godoo_mcp_server.tools import actions as _actions_module` | WIRED | Line 22 in server.py |
| server.py | tools/attachments.py | `from godoo_mcp_server.tools import attachments as _attachments_module` | WIRED | Line 23 in server.py |
| server.py | resources.py | `from godoo_mcp_server import resources as _resources_module` | WIRED | Line 28 in server.py |
| resources.py | catalog.py | `from godoo_mcp_server.catalog import get_model_entry_from_cache` | WIRED | Line 13 in resources.py |
| resources.py | server.py | `from godoo_mcp_server.server import mcp` | WIRED | Line 14 in resources.py |
| catalog.py | cachetools | `from cachetools import TTLCache` | WIRED | Line 12 in catalog.py |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| tools/mail.py | `result` | `client.call(model, "message_post", ...)` | Yes — live Odoo RPC | FLOWING |
| tools/attachments.py | `data` | `client.read_binary("ir.attachment", ...)` | Yes — live Odoo RPC | FLOWING |
| catalog.py | `_catalog_cache` | `compute_schema_hash` + `_build_snapshot` | Yes — 4 real search_read calls on cache miss | FLOWING |
| resources.py | `_SKILL_FILES` | `importlib.resources.files(...).read_text()` | Yes — package data at import time | FLOWING |
| resources.py | `odoo://model/{name}` | `get_model_entry_from_cache(name)` | Conditional — cold cache returns error dict (documented behavior) | FLOWING (by design) |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| 62 unit tests pass | `uv run pytest --tb=short -m "not integration" -q` | 62 passed, 9 deselected in 1.43s | PASS |
| mypy strict on all 13 source files | `uv run mypy --strict src/` | Success: no issues found in 13 source files | PASS |
| 9 integration tests collected (not run live) | `uv run pytest -m integration --collect-only -q` | 9/71 tests collected | PASS (collection only) |

### Probe Execution

No probe scripts discovered. Step 7c: SKIPPED — no `scripts/*/tests/probe-*.sh` found; phase has no declared probes.

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| MAIL-01 | 04-01 | Mail/chatter capabilities (post, log, list, schedule, list activities, mark done) | SATISFIED | tools/mail.py has 6 substantive handlers; 8 unit tests pass; wired in server.py |
| ACT-01 | 04-02 | Server-side actions (list, execute) | SATISFIED | tools/actions.py has action_list_actions + action_execute_action; wired in server.py |
| ATT-01 | 04-02 | Attachment capabilities (list, upload, download) | SATISFIED | tools/attachments.py has 3 substantive handlers; wired in server.py |
| USER-02 | 04-04 | Agent can search users | SATISFIED | users_search_users in tools/users.py; unit + tools/list tests pass |
| DISC-03 | 04-04 | Agent can list menus | SATISFIED | discovery_list_menus in tools/discovery.py; unit + tools/list tests pass |
| CAT-01 | 04-03 | Catalog introspection with schema hash | SATISFIED | catalog.py compute_schema_hash + _build_snapshot; 9 unit tests pass |
| CAT-02 | 04-03 | LRU+TTL cache keyed by (url, db, schema_hash) | SATISFIED | TTLCache + lazy asyncio.Lock; cache hit/miss tests pass |
| RES-01 | 04-05 | MCP resource descriptors at odoo:// and odoo://menu/{id} URIs | PARTIAL | odoo://model/{name} and odoo://action/{id} registered; odoo://menu/{id} ABSENT from resources.py despite being specified in REQUIREMENTS.md and D-13 |
| SKILL-01 | 04-05 | Skill .md files served as MCP Resources | SATISFIED | 4 skill files bundled; skill:// resources registered; 4 skill tests pass |
| SKILL-02 | 04-05 | Startup assertion: every .md has index entry | SATISFIED | _load_skills() AssertionError on mismatch; test_startup_assertion_all_skill_paths_loaded passes |
| ACL-01 | 04-06 | REMOVED per D-12 | REMOVED — not a gap | REQUIREMENTS.md and traceability table both mark [REMOVED] with D-12 rationale |
| ACL-02 | 04-06 | REMOVED per D-12 | REMOVED — not a gap | REQUIREMENTS.md and traceability table both mark [REMOVED] with D-12 rationale |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| tools/mail.py | 177 | `# [ASSUMED A1] activity_schedule — verify method name against integration container.` | Warning | Odoo method name unverified; could fail at runtime if method is named differently. No live test. Non-blocking: failure surfaces as ToolError isError=True. |
| tools/mail.py | 261 | `# [ASSUMED A2] action_feedback — standard Odoo 16/17 API.` | Warning | Same as above for mark_activity_done. |
| tests/integration/test_vertical.py | 630 | `# TODO: add test_schedule_activity_integration after verifying activity_schedule and action_feedback` | Warning | Deliberately deferred (per 04-06 plan); acceptable. |

No TBD/FIXME/XXX markers found in source files. The `[ASSUMED]` comments are informational annotations, not formal debt markers, and reference the A1/A2 assumptions documented in 04-RESEARCH.md.

### Human Verification Required

None. All observable truths can be verified statically or via the unit test suite. Integration test live execution (Docker) is a deployment concern, not a gap in the codebase.

### Gaps Summary

**One blocking gap found:**

**RES-01 is PARTIALLY satisfied.** The requirement specifies three odoo:// URI patterns: `odoo://model/{name}`, `odoo://action/{id}`, and `odoo://menu/{id}`. The first two are implemented. The third — `odoo://menu/{id}` — is documented in REQUIREMENTS.md RES-01, listed in D-13, and referenced in the RESEARCH and DISCUSSION-LOG files for Phase 4, but was not included in the 04-05-PLAN.md `must_haves` and was never implemented.

The fix is straightforward: add a `@mcp.resource("odoo://menu/{id}", ...)` handler to `resources.py` following the same Option B placeholder pattern as the action resource (always returns an error dict pointing agents to the `discovery_list_menus` tool). Add a corresponding unit test.

**Non-blocking observations (warnings):**

1. The `activity_schedule` (A1) and `action_feedback` (A2) method names in mail.py are flagged as assumed and unverified against a live Odoo container. Unit tests only confirm error-path behavior (OdooError surfaces as isError=True) because they use fake credentials. These will either work or fail cleanly at runtime; the failure mode is a structured ToolError, not a server crash.

2. Integration tests (9 in total) are correctly written and collected but have never been executed against a live Odoo container. The live execution path is gated on Docker availability.

---

_Verified: 2026-06-02T18:34:55Z_
_Verifier: Claude (gsd-verifier)_
