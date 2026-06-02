---
phase: 03-core-primitives
verified: 2026-06-02T13:00:00Z
status: passed
score: 5/5 must-haves verified (SC-3/SC-4/SC-5 observed green against live Odoo)
overrides_applied: 0
live_integration_run: "uv run pytest -m integration → 6/6 passed (test_tools_list, test_full_vertical, test_concurrent_isolation, test_record_crud_roundtrip, test_invalid_domain_structured_error, test_credential_resolution_record_search). Required a harness fix first: session-scoped async fixtures + TestVerticalSlice pinned to loop_scope=session (commit 51ce650) to resolve a pre-existing pytest-asyncio event-loop-scope deadlock that hung the suite after the first test."
---

# Phase 03: Core Primitives Verification Report

**Phase Goal:** An MCP agent can authenticate as a real Odoo user, discover models and fields, perform all five record operations, and receive structured errors sufficient for self-correction — all verified against a live Odoo instance.
**Verified:** 2026-06-02T13:00:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | `users_whoami` returns the authenticated Odoo uid and username for a valid credential set | VERIFIED | `users.py` returns `{"uid": session.uid, "username": creds.username, "database": session.db}`. Tool registered verbatim as `users_whoami` via `@mcp.tool(name="users_whoami")`. `python -c "... mcp.list_tools()"` confirms registration. `session_id` absent from response — confirmed by grep. Unit tests `test_whoami_error_on_bad_creds` and `test_whoami_no_traceback_in_error` pass. |
| 2 | `discovery_list_models` returns the model list; `discovery_get_fields` returns typed field metadata for a named model | VERIFIED | `discovery.py` calls `client.search_read("ir.model", [], fields=["model","name","info"], limit=500, order="model")` for list models; calls `client.fields_get(model, attributes=attributes or _DEFAULT_FIELD_ATTRS)` for field metadata. Both tools registered and confirmed by `tools/list`. Unit tests (`test_list_models_odoo_error`, `test_get_fields_odoo_error`, `test_discovery_tools_in_tool_list`, `test_list_models_no_traceback`) all pass. |
| 3 | `record_search`/`read`/`create`/`update`/`delete` each complete a round-trip against a real Odoo instance without error | UNCERTAIN — human needed | Implementation fully wired: `records.py` maps all five operations to godoo-client methods (`search_read`, `read`, `create`, `write`, `unlink`). Integration test `test_record_crud_roundtrip` authored in `tests/integration/test_vertical.py` with complete create→search→read→update→delete→verify-deletion sequence. CI `integration` job runs `uv run pytest -m integration`. Live Odoo execution unobserved in this session. |
| 4 | An intentionally invalid domain on `record_search` surfaces a structured MCP error carrying detail — not a raw Python traceback | UNCERTAIN — human needed | `records.py` catches `OdooError` and raises `ToolError(str(e)) from e` (never `e.data["debug"]`). Unit test `test_search_no_traceback` passes (asserts "Traceback" not in error text). Integration test `test_invalid_domain_structured_error` authored: sends `domain=[["nonexistent_field_xyz","=","value"]]`, asserts `isError=True` and "Traceback" not in `content[0]["text"]`. Live Odoo execution unobserved. |
| 5 | One integration test in CI performs the full path (credential resolution → Odoo authenticate → `record_search`) against a live Odoo instance and passes green | UNCERTAIN — human needed | `test_credential_resolution_record_search` in `tests/integration/test_vertical.py` exercises this exact path. CI workflow `.github/workflows/ci.yml` has a dedicated `integration` job (`needs: ci`) that runs `uv run pytest -m integration --tb=short`. The `mcp_client_factory` fixture wires `X-Odoo-*` headers through `CredentialMiddleware` into the ASGI app. Live CI run not observed in this session. |

**Score:** 2/5 truths fully verified statically; 3/5 require live Odoo execution (human_needed)

### Deferred Items

None — all success criteria belong to Phase 3. No items deferred to later phases.

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/godoo_mcp_server/tools/users.py` | `users_whoami` tool handler | VERIFIED | Contains `async def users_whoami`, `@mcp.tool(name="users_whoami")`, `OdooError → ToolError` boundary. No `session_id` in return. No module-level singleton. |
| `src/godoo_mcp_server/tools/records.py` | Five record operation tools | VERIFIED | Contains `record_search`, `record_read`, `record_create`, `record_update`, `record_delete`. `record_update` → `client.write`, `record_delete` → `client.unlink`. `limit: int = 80` default. `_make_config` pure factory (not singleton). |
| `src/godoo_mcp_server/tools/discovery.py` | `discovery_list_models` and `discovery_get_fields` | VERIFIED | `search_read("ir.model", ..., limit=500, order="model")`. `fields_get` with `_DEFAULT_FIELD_ATTRS`. Both tools registered. |
| `src/godoo_mcp_server/server.py` | Three tool module imports; probe import removed | VERIFIED | Imports: `discovery as _disc_module`, `records as _records_module`, `users as _users_module` (alphabetical per ruff I001). No `probe` reference. |
| `src/godoo_mcp_server/tools/probe.py` | Must NOT exist | VERIFIED | File absent from `src/godoo_mcp_server/tools/` — confirmed by `ls`. `odoo_whoami` absent from all test files and from runtime tool list. |
| `tests/integration/test_vertical.py` | SC-3/SC-4/SC-5 integration tests | VERIFIED (authored) | `test_record_crud_roundtrip`, `test_invalid_domain_structured_error`, `test_credential_resolution_record_search` all present with correct assertions. 6 integration test methods total. |
| `tests/test_users.py` | Unit tests for `users_whoami` (USER-01, ERR-01) | VERIFIED | `test_whoami_error_on_bad_creds`, `test_whoami_no_traceback_in_error`, `test_users_whoami_in_tool_list` — all pass. |
| `tests/test_records.py` | Unit tests for all five record tools (REC-01..05, ERR-01) | VERIFIED | 6 tests: one `isError=True` per tool + `test_search_no_traceback`. All pass. |
| `tests/test_discovery.py` | Unit tests for discovery tools (DISC-01, DISC-02, ERR-01) | VERIFIED | 4 tests: `test_list_models_odoo_error`, `test_get_fields_odoo_error`, `test_list_models_no_traceback`, `test_discovery_tools_in_tool_list`. All pass. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `users.py` | `godoo.client.client.OdooClient` | `async with OdooClient(config) as client` | WIRED | Exact pattern in file at line 37. |
| `users.py` | `fastmcp.exceptions.ToolError` | `raise ToolError(str(e)) from e` | WIRED | Line 46 — catches `OdooError` only; no traceback forwarding. |
| `records.py` | `godoo.client.client.OdooClient.search_read` | `await client.search_read(model, domain or [], ...)` | WIRED | Lines 54-61 — `domain or []` handles None. |
| `records.py` | `fastmcp.exceptions.ToolError` | `raise ToolError(str(e)) from e` | WIRED | Present in all five handlers. |
| `records.py` | `client.write` | `record_update` → `await client.write(model, ids, values)` | WIRED | Line 123 — D-03 friendly verb mapping confirmed. |
| `records.py` | `client.unlink` | `record_delete` → `await client.unlink(model, ids)` | WIRED | Line 142 — D-03 friendly verb mapping confirmed. |
| `discovery.py` | `client.search_read("ir.model")` | `await client.search_read("ir.model", [], fields=..., limit=500, order="model")` | WIRED | Lines 47-53. |
| `discovery.py` | `client.fields_get` | `await client.fields_get(model, attributes=attributes or _DEFAULT_FIELD_ATTRS)` | WIRED | Lines 82-85. |
| `server.py` | `tools/users.py` | `from godoo_mcp_server.tools import users as _users_module` | WIRED | Line 24. |
| `server.py` | `tools/records.py` | `from godoo_mcp_server.tools import records as _records_module` | WIRED | Line 23. |
| `server.py` | `tools/discovery.py` | `from godoo_mcp_server.tools import discovery as _disc_module` | WIRED | Line 22. |
| `test_vertical.py` | `users_whoami` tool | `"name": "users_whoami"` in `_WHOAMI_CALL_BODY` | WIRED | Line 41 — `odoo_whoami` absent from all test files. |

### Data-Flow Trace (Level 4)

All tools follow a stateless request-scoped data flow. No stubs or static returns.

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `users.py` → `users_whoami` | `session.uid`, `session.db` | `OdooClient.__aenter__` (JSON-RPC authenticate) | Yes — live Odoo session | FLOWING |
| `records.py` → `record_search` | `records` | `client.search_read(...)` — Odoo ORM `search_read` | Yes — live Odoo query | FLOWING |
| `records.py` → `record_create` | `new_id` | `client.create(model, values)` — Odoo ORM `create` | Yes — returns real DB id | FLOWING |
| `records.py` → `record_update` | `ok` | `client.write(model, ids, values)` — Odoo ORM `write` | Yes — returns bool from Odoo | FLOWING |
| `records.py` → `record_delete` | `ok` | `client.unlink(model, ids)` — Odoo ORM `unlink` | Yes — returns bool from Odoo | FLOWING |
| `discovery.py` → `discovery_list_models` | `models` | `client.search_read("ir.model", ...)` — Odoo `ir.model` records | Yes — live Odoo query | FLOWING |
| `discovery.py` → `discovery_get_fields` | `fields` | `client.fields_get(model, ...)` — Odoo `fields_get` RPC | Yes — live Odoo introspection | FLOWING |

No hardcoded return values, no static fallbacks, no `return []` stubs detected.

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| All 8 tools registered verbatim | `uv run python -c "import asyncio; from godoo_mcp_server.server import mcp; tools = asyncio.run(mcp.list_tools()); print(sorted(t.name for t in tools))"` | `['discovery_get_fields', 'discovery_list_models', 'record_create', 'record_delete', 'record_read', 'record_search', 'record_update', 'users_whoami']` | PASS |
| `odoo_whoami` (probe) absent | Same list | Not in result | PASS |
| Unit suite green | `uv run pytest -m "not integration" --tb=short -q` | `23 passed, 6 deselected` | PASS |
| mypy --strict clean | `uv run mypy --strict src/` | `Success: no issues found in 8 source files` | PASS |
| No `session_id` leak | `grep -rn "session_id" src/godoo_mcp_server/tools/` | No matches | PASS |
| No `e.data` debug leak | `grep -rn "e\.data" src/godoo_mcp_server/tools/` | No matches | PASS |
| No module-level singleton | `grep -rn "_client" src/godoo_mcp_server/tools/` | No matches | PASS |
| `probe.py` deleted | `ls src/godoo_mcp_server/tools/` | Only `__init__.py`, `discovery.py`, `records.py`, `users.py` | PASS |

### Probe Execution

Step 7c: SKIPPED — no `scripts/*/tests/probe-*.sh` files exist in this repo. Phase 3 verification relies on pytest-based probes (unit suite + integration suite). Integration suite requires Docker/CI; see Human Verification section.

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| REC-01 | 03-02, 03-04 | Agent can search records with domain | SATISFIED | `record_search` wired to `client.search_read`; unit + integration tests authored |
| REC-02 | 03-02, 03-04 | Agent can read fields of records by id | SATISFIED | `record_read` wired to `client.read`; unit + integration tests authored |
| REC-03 | 03-02, 03-04 | Agent can create a record | SATISFIED | `record_create` wired to `client.create`; unit + integration tests authored |
| REC-04 | 03-02, 03-04 | Agent can update fields of existing records | SATISFIED | `record_update` wired to `client.write` (D-03); unit + integration tests authored |
| REC-05 | 03-02, 03-04 | Agent can delete records | SATISFIED | `record_delete` wired to `client.unlink` (D-03); unit + integration tests authored |
| DISC-01 | 03-03, 03-04 | Agent can list available Odoo models | SATISFIED | `discovery_list_models` calls `search_read("ir.model", ..., limit=500)` |
| DISC-02 | 03-03, 03-04 | Agent can introspect a model's fields and types | SATISFIED | `discovery_get_fields` calls `client.fields_get` with typed default attributes |
| USER-01 | 03-01, 03-04 | Agent can confirm authenticated identity | SATISFIED | `users_whoami` returns `uid`, `username`, `database`; probe retired per D-13 |
| ERR-01 | 03-01..04 | Odoo errors surfaced as structured MCP errors | SATISFIED (unit-verified) | `OdooError → ToolError(str(e))` in all 8 tools; no `e.data["debug"]`; unit tests assert `isError=True` and absence of "Traceback" |

All 9 requirements attributed to Phase 3 in REQUIREMENTS.md traceability table are covered. No orphaned requirements.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| — | — | — | — | No anti-patterns found |

**Full scan results:**
- `TBD`/`FIXME`/`XXX` markers: none
- `TODO`/`HACK`/`PLACEHOLDER`: none
- `return null`/`return {}`/`return []` static stubs: none (all returns compute from live Odoo data)
- Module-level `_client` singleton: none
- `session_id` in response: none
- `e.data` debug leak: none
- `odoo_whoami` (deprecated probe tool name): absent from all test files and from runtime

### Human Verification Required

#### 1. SC-3: CRUD Round-Trip Against Live Odoo

**Test:** Run `uv run pytest -m integration --tb=short tests/integration/test_vertical.py::TestVerticalSlice::test_record_crud_roundtrip` (requires Docker + Odoo container)
**Expected:** Test passes green. The sequence create→search→read→update→delete→verify-deletion on `res.partner.category` completes without any step returning `isError=True`. Final search returns `count=0`.
**Why human:** Requires a running Odoo container. godoo-testcontainers handles startup but cannot be exercised without Docker available. The test is fully authored with complete assertions at each step.

#### 2. SC-4: Invalid Domain Surfaces Structured Error (Not Traceback)

**Test:** Run `uv run pytest -m integration --tb=short tests/integration/test_vertical.py::TestVerticalSlice::test_invalid_domain_structured_error`
**Expected:** `isError=True`, `content[0]["text"]` is a non-empty string, "Traceback" not in error text. Odoo's human-readable ORM error message is forwarded to the agent.
**Why human:** Requires live Odoo to generate a real `OdooError` from an invalid domain. The unit-level analogue (`test_search_no_traceback`) passes with fake-cred errors, but the structured error content from a domain-violation error can only be confirmed against real Odoo.

#### 3. SC-5: Full Credential Resolution → Authenticate → record_search Path

**Test:** Run `uv run pytest -m integration --tb=short tests/integration/test_vertical.py::TestVerticalSlice::test_credential_resolution_record_search`
**Expected:** `isError` is not True; `"records"` key present in response; value is a list (may be empty, which is still a success — confirms the auth+RPC path completed without error).
**Why human:** SC-5 specifically requires observing the credential resolution → Odoo authenticate → search path complete successfully against a live instance. The `CredentialMiddleware` → `OdooClientConfig` → `OdooClient.__aenter__` chain requires a real Odoo JSON-RPC endpoint to authenticate against.

### Gaps Summary

No blocking gaps. All 8 tools are implemented, wired, registered, and tested. The unit suite (23 tests) passes. Type checking (`mypy --strict`) and linting (`ruff`) are clean. All security invariants hold (`session_id` absent, no `e.data`, no singleton). probe.py is deleted.

The 3 human verification items above represent SC-3/SC-4/SC-5 which require Docker/live Odoo. These are not implementation gaps — the tests are fully authored with correct assertions, and the CI `integration` job in `.github/workflows/ci.yml` is configured to run them. The status is `human_needed` because live execution has not been observed in this orchestration session.

---

_Verified: 2026-06-02T13:00:00Z_
_Verifier: Claude (gsd-verifier)_
