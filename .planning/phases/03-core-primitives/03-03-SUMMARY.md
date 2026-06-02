---
phase: 03-core-primitives
plan: "03"
subsystem: tools/discovery
tags: [mcp-tools, odoo-discovery, search_read, fields_get, tdd]
dependency_graph:
  requires: []
  provides: [discovery_list_models, discovery_get_fields]
  affects: [server.py, tests/test_discovery.py]
tech_stack:
  added: []
  patterns: [per-request OdooClientConfig, OdooError->ToolError boundary, TDD RED/GREEN]
key_files:
  created:
    - src/godoo_mcp_server/tools/discovery.py
    - tests/test_discovery.py
  modified:
    - src/godoo_mcp_server/server.py
decisions:
  - "D-01: discovery tools use underscore names (discovery_list_models, discovery_get_fields)"
  - "D-07/D-08/D-09: OdooError caught at tool boundary, raise ToolError(str(e)) — no traceback leak"
  - "D-13 sequencing: probe import kept in server.py (final plan 03-04 removes it)"
  - "Per-request OdooClientConfig — no module-level singleton (T-03-09 cross-user bleed mitigated)"
metrics:
  duration: "~10 minutes"
  completed: "2026-06-02"
  tasks: 2
  files: 3
---

# Phase 03 Plan 03: Discovery Tools Summary

One-liner: Two Odoo discovery tools (model enumeration via search_read on ir.model, field introspection via fields_get) with OdooError-to-ToolError boundary and full TDD coverage.

## What Was Built

### `src/godoo_mcp_server/tools/discovery.py`

Two MCP tools registered via `@mcp.tool`:

- **`discovery_list_models`**: calls `client.search_read("ir.model", [], fields=["model","name","info"], limit=500, order="model")` and returns `{"models": [...]}`. The `limit=500` cap protects against server-side truncation on instances with 400+ models.
- **`discovery_get_fields`**: calls `client.fields_get(model, attributes=attributes or _DEFAULT_FIELD_ATTRS)` and returns `{"model": model, "fields": {...}}`. The default attribute list is `["string", "type", "required", "readonly", "help", "relation"]`, overridable via the optional `attributes` parameter.

Both tools:
- Construct `OdooClientConfig` per-request from `request.state.odoo_creds` (no module-level singleton)
- Wrap the entire `async with OdooClient(config) as client:` block in `try/except OdooError` and raise `ToolError(str(e)) from e`
- Return `dict[str, object]` (mypy-strict-safe per RESEARCH.md Pitfall 6)

### `tests/test_discovery.py`

Four unit tests covering DISC-01, DISC-02, ERR-01:

1. `test_list_models_odoo_error` — fake creds → `isError=True` for `discovery_list_models`
2. `test_get_fields_odoo_error` — fake creds + `{"model": "res.partner"}` → `isError=True` for `discovery_get_fields`
3. `test_list_models_no_traceback` — error content must not contain `"Traceback"` (T-03-08 mitigated)
4. `test_discovery_tools_in_tool_list` — both tool names appear in `tools/list` response

### `src/godoo_mcp_server/server.py` (modified)

Added side-effect import for the discovery module (alphabetically before probe, per ruff I001):

```python
from godoo_mcp_server.tools import discovery as _discovery_module  # noqa: F401, E402
from godoo_mcp_server.tools import probe as _probe_module  # noqa: F401, E402
```

The probe import is intentionally retained (D-13 sequencing constraint — 03-04 handles the swap).

## TDD Gate Compliance

| Gate | Commit | Status |
|------|--------|--------|
| RED  | 58e69be | test file written before discovery.py; `test_discovery_tools_in_tool_list` failed correctly |
| GREEN | a89a1e3 | discovery.py implemented; all 4 tests pass |
| REFACTOR | e4cfa94 | ruff I001 import order fix in server.py |

## Verification Results

```
uv run pytest -m "not integration" --tb=short -q  → 14 passed, 3 deselected
uv run mypy --strict src/                          → Success: no issues found in 7 source files
uv run ruff check .                                → All checks passed!
grep -n "_client" src/godoo_mcp_server/tools/discovery.py  → (empty — no singleton)
grep -n "ir.model" src/godoo_mcp_server/tools/discovery.py → line 48
grep -n "fields_get" src/godoo_mcp_server/tools/discovery.py → line 82
```

## Commits

| Hash | Type | Description |
|------|------|-------------|
| 58e69be | test(03-03) | RED: add failing tests for discovery_list_models and discovery_get_fields |
| a89a1e3 | feat(03-03) | GREEN: implement discovery_list_models and discovery_get_fields tools |
| 9076ad6 | test(03-03) | finalize test_discovery.py — ruff format applied |
| e4cfa94 | chore(03-03) | fix import order in server.py for ruff I001 |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Removed unused `type: ignore[attr-defined]` comments**
- **Found during:** Task 1 mypy --strict run
- **Issue:** PATTERNS.md pattern included `# type: ignore[attr-defined]` on `request.state.odoo_creds` assignments, but mypy does NOT flag these lines in this codebase (probe.py has no such comment and passes). The comments triggered `unused-ignore` errors under mypy `--strict`.
- **Fix:** Removed both `# type: ignore[attr-defined]` comments from discovery.py (lines 38 and 73 in the initial draft). The `OdooCredentials` type annotation is sufficient — mypy resolves it correctly.
- **Files modified:** `src/godoo_mcp_server/tools/discovery.py`
- **Commit:** a89a1e3

**2. [Rule 1 - Bug] Fixed ruff I001 import sort order in server.py**
- **Found during:** Phase gate `ruff check .` after Task 2
- **Issue:** The discovery import was added after the probe import; ruff I001 requires alphabetical order within the import block.
- **Fix:** Reordered to `discovery` before `probe`.
- **Files modified:** `src/godoo_mcp_server/server.py`
- **Commit:** e4cfa94

## Known Stubs

None. Both tools are fully wired to godoo-client; no placeholder data.

## Threat Flags

No new security surface beyond what the plan's threat model covers. Both tools operate under per-user credentials; Odoo ORM enforces `ir.model` access control (T-03-10 accepted). The `ToolError(str(e))` pattern prevents traceback and `e.data["debug"]` leakage (T-03-08 mitigated and verified by `test_list_models_no_traceback`).

## Self-Check: PASSED

- `src/godoo_mcp_server/tools/discovery.py` — FOUND
- `tests/test_discovery.py` — FOUND
- Commit 58e69be (RED) — FOUND
- Commit a89a1e3 (GREEN) — FOUND
- Commit 9076ad6 (test finalize) — FOUND
- Commit e4cfa94 (ruff fix) — FOUND
