---
phase: 03-core-primitives
plan: "01"
subsystem: tools
tags: [users, whoami, error-boundary, mcp-tools, unit-tests]
dependency_graph:
  requires: []
  provides:
    - users_whoami MCP tool registered via @mcp.tool
    - ERR-01 error boundary: OdooError → ToolError (no traceback leak)
  affects:
    - src/godoo_mcp_server/server.py (users module now registered)
tech_stack:
  added: []
  patterns:
    - per-request OdooClientConfig construction (no module-level singleton)
    - try/except OdooError wrapping entire async with OdooClient block
    - ToolError raised with str(e) only (D-08 sanitization)
key_files:
  created:
    - src/godoo_mcp_server/tools/users.py
    - tests/test_users.py
  modified:
    - src/godoo_mcp_server/server.py
decisions:
  - "State.__getattr__ returns Any — type: ignore[attr-defined] is unused with warn_unused_ignores=true; removed from users.py"
  - "users module registered in server.py alongside probe (D-13 deferral — probe removed in final phase plan)"
metrics:
  duration: 4min
  completed_date: "2026-06-02"
  tasks_completed: 2
  files_changed: 3
---

# Phase 03 Plan 01: users_whoami Tool and Error Boundary Summary

**One-liner:** users_whoami MCP tool returning uid+username+database with OdooError→ToolError error boundary, verified by three unit tests.

## What Was Built

### Task 1: users_whoami tool handler (`src/godoo_mcp_server/tools/users.py`)

New MCP tool registered as `users_whoami`. Extends the probe.py pattern with:
- `ToolError` and `OdooError` imports (absent from probe.py which has no error handling)
- `try/except OdooError` wrapping the entire `async with OdooClient` block — catches `__aenter__` auth failures too
- Return dict: `uid` (from session), `username` (from creds — no extra RPC per D-12), `database` (from session.db)
- `session_id` never returned (D-08)
- No module-level `_client` singleton (T-03-03 per-request isolation)

### Task 2: Unit tests (`tests/test_users.py`) + server registration

Three unit tests covering USER-01 and ERR-01:
- `test_whoami_error_on_bad_creds`: fake credentials → `isError=True` MCP response
- `test_whoami_no_traceback_in_error`: error text never contains "Traceback" (D-08 sanitization verified at test time)
- `test_users_whoami_in_tool_list`: `users_whoami` appears in tools/list

`server.py` updated to import the `users` module alongside `probe` for tool registration.

## Verification Results

All phase gates passed:
- `uv run pytest -m "not integration"`: 13 passed
- `uv run mypy --strict src/`: no issues (7 files)
- `uv run ruff check .`: all checks passed
- `uv run ruff format --check .`: 16 files already formatted
- `grep session_id src/.../users.py`: no matches (D-08 enforced)
- `grep _client src/.../users.py`: no matches (T-03-03 enforced)
- `probe.py` still exists (D-13: deletion is the final act of the phase)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Removed unused `# type: ignore[attr-defined]` from users.py**
- **Found during:** Task 1 mypy verification
- **Issue:** `PATTERNS.md` specified including `# type: ignore[attr-defined]` on `request.state.odoo_creds`. However, Starlette's `State.__getattr__` returns `Any`, so accessing `.odoo_creds` raises no `attr-defined` error. With `warn_unused_ignores = true` in `pyproject.toml`, the suppress comment itself caused `mypy --strict src/` to fail with `Unused "type: ignore" comment [unused-ignore]`. (probe.py has the same comment but escapes detection when checked alone — only surfaces in full `src/` scan.)
- **Fix:** Removed the `# type: ignore[attr-defined]` comment. The assignment `creds: OdooCredentials = request.state.odoo_creds` is valid because `Any` is assignable to any type.
- **Files modified:** `src/godoo_mcp_server/tools/users.py`
- **Commit:** 7c4859b

**2. [Rule 2 - Missing critical functionality] Added users module import to server.py**
- **Found during:** Task 2 test run (`test_users_whoami_in_tool_list` failed)
- **Issue:** The plan's `<action>` for Task 1 did not explicitly call out that `server.py` needs to be updated to import the new `users` module. Without the import, the `@mcp.tool` decorator never executes and `users_whoami` is not registered.
- **Fix:** Added `from godoo_mcp_server.tools import users as _users_module  # noqa: F401, E402` to `server.py` alongside the existing probe import (D-13 deferral — probe kept until final phase cleanup).
- **Files modified:** `src/godoo_mcp_server/server.py`
- **Commit:** ec5051a

## Known Stubs

None. `users_whoami` makes real Odoo RPC calls; unit tests assert real error paths. No hardcoded return values or placeholder data.

## Threat Flags

No new threat surface beyond the plan's threat model. All T-03-01/T-03-02/T-03-03 mitigations are in place and verified by acceptance criteria grep audit and test_whoami_no_traceback_in_error.

## Self-Check: PASSED
