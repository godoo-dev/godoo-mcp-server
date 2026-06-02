---
phase: "04-full-surface-catalog-acl-skills"
plan: "02"
subsystem: "tools/actions + tools/attachments"
tags: ["actions", "attachments", "cachetools", "ACT-01", "ATT-01"]
dependency_graph:
  requires: ["04-01 (mail tools, server.py side-effect import pattern)"]
  provides: ["action_list_actions", "action_execute_action", "attachments_list", "attachments_upload", "attachments_download"]
  affects: ["04-03 (catalog layer uses cachetools)", "04-06 (integration tests cover action + attachment tools)"]
tech_stack:
  added: ["cachetools>=7,<8"]
  patterns: ["records.py _make_config + OdooError→ToolError pattern", "read_binary empty-file guard", "ir.actions.server union with ir.actions.act_window"]
key_files:
  created:
    - src/godoo_mcp_server/tools/actions.py
    - src/godoo_mcp_server/tools/attachments.py
    - tests/test_actions.py
    - tests/test_attachments.py
  modified:
    - pyproject.toml
    - src/godoo_mcp_server/server.py
    - uv.lock
decisions:
  - "action_list_actions unions ir.actions.server and ir.actions.act_window with action_type tag; domain filter applied independently to each model"
  - "attachments_download returns error dict (not empty base64) when datas field is empty — Pitfall 7 guard from RESEARCH.md"
  - "cachetools pinned >=7,<8 as explicit project.dependencies entry (not dev-only) — needed for Plan 03 catalog layer"
metrics:
  duration: "2 minutes"
  completed: "2026-06-02"
  tasks: 2
  files: 7
---

# Phase 4 Plan 2: Action and Attachment Tools Summary

**One-liner:** 5 new MCP tools — action listing/execution against ir.actions models and attachment CRUD with base64 + empty-file guard via ir.attachment; cachetools added as explicit dependency for Plan 03 catalog layer.

## What Was Built

### Task 1: actions.py + attachments.py + pyproject.toml update (003b833)

**`src/godoo_mcp_server/tools/actions.py`** — 2 tools:
- `action_list_actions(domain, limit=80)`: queries `ir.actions.server` (fields: id, name, model_id, binding_model_id, code) and `ir.actions.act_window` (fields: id, name, res_model, view_mode) independently; tags each record with `action_type="server"` or `action_type="window"`; returns `{"actions": combined, "count": total}`
- `action_execute_action(action_id)`: calls `client.call("ir.actions.server", "run", [action_id], {})`; returns `{"result": result or {}}`

**`src/godoo_mcp_server/tools/attachments.py`** — 3 tools:
- `attachments_list(domain, limit, res_model, res_id)`: builds effective domain from base domain + optional res_model/res_id filters; search_read `ir.attachment` with 7 fields
- `attachments_upload(name, content_base64, res_model, res_id, mimetype)`: `client.create("ir.attachment", {...})`; returns `{"id": new_id}`
- `attachments_download(attachment_id)`: `client.read_binary(...)` → empty guard → metadata read → base64 encode; returns `{"id", "name", "mimetype", "content_base64", "size_bytes"}` or `{"error": "attachment_has_no_content", "id": ...}`

**`pyproject.toml`** — added `"cachetools>=7,<8"` to `[project.dependencies]`; `uv.lock` updated (cachetools 7.1.4 already in venv; lockfile already reflected it)

**`src/godoo_mcp_server/server.py`** — added side-effect imports for `actions` and `attachments` modules (same pattern as mail/records/discovery/users)

### Task 2: Unit tests (cc5989a)

**`tests/test_actions.py`** — 3 tests:
- `test_list_actions_odoo_error`: `action_list_actions` with fake creds → `isError=True`
- `test_execute_action_odoo_error`: `action_execute_action` with fake creds → `isError=True`
- `test_action_tools_in_tools_list`: both action tool names in `tools/list` response

**`tests/test_attachments.py`** — 5 tests:
- `test_attachments_list_odoo_error`: `attachments_list` with fake creds → `isError=True`
- `test_attachments_upload_odoo_error`: `attachments_upload` with fake creds → `isError=True`
- `test_attachments_download_odoo_error`: `attachments_download` with fake creds → `isError=True`
- `test_attachment_tools_in_tools_list`: all 3 attachment names in `tools/list`
- `test_no_traceback_attachments_download`: error content has no "Traceback" string

## Verification Results

- `uv run mypy src/godoo_mcp_server/tools/actions.py src/godoo_mcp_server/tools/attachments.py --strict` — 0 errors
- `uv run mypy tests/test_actions.py tests/test_attachments.py` — 0 errors
- `uv run pytest tests/test_actions.py tests/test_attachments.py -x -q` — 8 passed
- `uv run pytest tests/ -x -q` — 39 passed, 6 deselected (no regressions)
- `grep "cachetools" pyproject.toml` — `"cachetools>=7,<8"` confirmed present

## Deviations from Plan

None — plan executed exactly as written.

The plan noted `uv sync` should update the lockfile; cachetools was already present in uv.lock (it had been installed as a transitive dep previously). Running `uv sync` exited 0; `uv run python -c "import cachetools"` confirmed 7.1.4 available.

## Known Stubs

None. Both tool files wire directly to real `OdooClient` calls with no placeholder data.

## Threat Flags

No new security-relevant surface beyond what is captured in the plan's threat model.

All 5 threats from STRIDE register are mitigated per-implementation:
- T-04-02-01: Odoo ACL enforced at `client.call("ir.actions.server", "run", ...)` level
- T-04-02-02: `read_binary` fails with `OdooError` before content returned if access denied; empty guard returns error dict not empty base64
- T-04-02-03: `datas` is a binary field — no path traversal; malformed base64 → OdooError → ToolError
- T-04-02-04: `raise ToolError(str(e)) from e` in all 5 handlers — no repr or traceback
- T-04-02-05: Each call builds fresh `OdooClient(_make_config(creds))` per request — no shared client

## Self-Check: PASSED

- `src/godoo_mcp_server/tools/actions.py` — FOUND
- `src/godoo_mcp_server/tools/attachments.py` — FOUND
- `tests/test_actions.py` — FOUND
- `tests/test_attachments.py` — FOUND
- commit 003b833 — FOUND
- commit cc5989a — FOUND
