---
phase: 03-core-primitives
reviewed: 2026-06-02T12:02:15Z
depth: standard
files_reviewed: 8
files_reviewed_list:
  - src/godoo_mcp_server/server.py
  - src/godoo_mcp_server/tools/users.py
  - src/godoo_mcp_server/tools/records.py
  - src/godoo_mcp_server/tools/discovery.py
  - tests/test_users.py
  - tests/test_records.py
  - tests/test_discovery.py
  - tests/test_transport.py
  - tests/integration/test_vertical.py
findings:
  critical: 2
  warning: 3
  info: 1
  total: 6
status: issues_found
---

# Phase 03: Code Review Report

**Reviewed:** 2026-06-02T12:02:15Z
**Depth:** standard
**Files Reviewed:** 9
**Status:** issues_found

## Summary

Phase 3 delivers eight Odoo primitive tools plus integration tests across three new tool
modules and updated test files. The architecture is correct: per-request `OdooClient`
construction, `ToolError(str(e))` error boundary, no module-level client singletons, no
`session_id` leakage in responses. The core design is sound.

Two blockers: (1) all three tool files omit the `# type: ignore[attr-defined]` suppress
comment on `request.state.odoo_creds`, which is a confirmed mypy --strict failure under
the project configuration (`strict = true`, `warn_return_any = true` in pyproject.toml);
(2) `assert session is not None` in `users_whoami` raises `AssertionError` — not caught
by `except OdooError` — meaning Python runs the low-level MCP handler's `except
Exception` fallback that converts the raw exception to `isError=True`, but only after
the formatted traceback string has been baked into the error message. This is the exact
traceback-leak scenario the error contract (D-08) forbids.

---

## Critical Issues

### CR-01: Missing `# type: ignore[attr-defined]` on all `request.state.odoo_creds` accesses — mypy --strict failure

**Files:**
- `src/godoo_mcp_server/tools/users.py:29`
- `src/godoo_mcp_server/tools/records.py:51` (and lines 79, 99, 120, 140)
- `src/godoo_mcp_server/tools/discovery.py:38` (and line 73)

**Issue:** Every tool handler accesses `request.state.odoo_creds` without the required
`# type: ignore[attr-defined]` suppress comment. Starlette's `State` object is dynamically
typed; mypy --strict correctly flags `.odoo_creds` as an unknown attribute. The deleted
`probe.py` — the canonical template for all three new files — explicitly carried this
comment on the same line (documented in 03-PATTERNS.md "Shared Patterns" section). With
`strict = true` and `warn_return_any = true` in pyproject.toml, `uv run mypy --strict
src/` will fail on all eight affected lines. CI runs mypy as a gate check.

**Fix:** Add `# type: ignore[attr-defined]` to every `request.state.odoo_creds`
assignment. Example for `users.py:29`:

```python
creds: OdooCredentials = request.state.odoo_creds  # type: ignore[attr-defined]
```

Apply identically to all eight occurrences across the three files.

---

### CR-02: `assert session is not None` raises `AssertionError`, not `OdooError` — potential traceback leak

**File:** `src/godoo_mcp_server/tools/users.py:39`

**Issue:** Inside the `try/except OdooError` block, the code calls `client.get_session()`
and then guards with `assert session is not None`. `AssertionError` is not a subclass of
`OdooError`. If this assertion fires (which the research doc notes should not happen
post-`__aenter__`, but is not impossible — e.g., a future godoo-client refactor, or
Python run with `-O` flag silently skipping the assert entirely), the exception bypasses
the `except OdooError` handler entirely and propagates to fastmcp's outer
`except FastMCPError` re-raise and then to mcp lowlevel's `except Exception` catch.

The mcp lowlevel handler converts the raw exception via `str(e)` — but `str(AssertionError())`
is an empty string, giving the agent a useless `isError=True` with empty content. More
critically, if Python is running without `-O`, the `AssertionError` traceback is
formatted and potentially included in fastmcp's logging output or in the exception chain
visible via `__context__`. The D-08 requirement ("never leak tracebacks") is violated by
the pattern.

Additionally, `assert` statements are stripped when Python is run with `-O` (optimize
flag). A Docker image built with `PYTHONOPTIMIZE=1` or `python -O` would skip this guard
entirely, causing `session` to be `None`, and then `session.uid` on line 41 would raise
`AttributeError` with the same uncaught-by-OdooError problem.

**Fix:** Replace the `assert` with an explicit `OdooError`-subclass raise, or restructure
to raise `ToolError` directly:

```python
try:
    async with OdooClient(config) as client:
        session = client.get_session()
        if session is None:
            raise ToolError("Odoo session unavailable after authentication")
        return {
            "uid": session.uid,
            "username": creds.username,
            "database": session.db,
        }
except OdooError as e:
    raise ToolError(str(e)) from e
```

The `if session is None: raise ToolError(...)` is outside the `except OdooError` but
inside the `try` — fastmcp's outer layer catches `ToolError` correctly since `ToolError`
is a `FastMCPError` subclass.

---

## Warnings

### WR-01: `record_search` description promises `limit=None` passthrough, but parameter type is `int` — agents cannot pass `None`

**File:** `src/godoo_mcp_server/tools/records.py:37`

**Issue:** The tool description says "Pass limit=None to let Odoo apply its server-side
default." But the function signature is `limit: int = 80` — not `int | None`. fastmcp
infers the JSON Schema from the Python signature: `limit` will have `"type": "integer"`
with no `null` variant. An agent that reads the description and sends `limit: null` will
get a schema-validation error from fastmcp before the tool handler is ever called. The
description creates a false contract.

**Fix:** Either (a) change the type to `int | None = 80` and pass `limit` directly to
`client.search_read` (which already accepts `None`), or (b) remove the misleading
sentence from the description. Option (a) is more useful:

```python
async def record_search(
    ctx: Context,
    model: str,
    domain: list[Any] | None = None,
    fields: list[str] | None = None,
    limit: int | None = 80,
    offset: int = 0,
    order: str | None = None,
) -> dict[str, object]:
```

The tool body already passes `limit=limit` to `client.search_read` which accepts `None`
directly — no other change needed.

---

### WR-02: `discovery_list_models` silently truncates at 500 models — no indication to caller

**File:** `src/godoo_mcp_server/tools/discovery.py:51`

**Issue:** `limit=500` is a hardcoded cap. The research notes this is "above any realistic
model count" but a fully customized enterprise Odoo instance (many installed apps +
custom modules) can reach 600-800 models. When the actual count exceeds 500, the tool
returns a truncated list with no indication that it is incomplete — the agent has no
signal to paginate. The returned `{"models": [...]}` dict contains no `total` count, no
`truncated` flag, and no pagination metadata.

**Fix:** Include a `truncated` flag so agents detect the limit was hit:

```python
models = await client.search_read(
    "ir.model",
    [],
    fields=["model", "name", "info"],
    limit=500,
    order="model",
)
return {
    "models": models,
    "truncated": len(models) == 500,
}
```

This costs nothing and prevents silent data loss when the cap is reached.

---

### WR-03: Integration test SC-4 assertions execute outside the `async with client:` context manager

**File:** `tests/integration/test_vertical.py:343-358`

**Issue:** In `test_invalid_domain_structured_error`, the `async with client:` block
closes at line 342, but `resp` is first checked on line 343 outside it. While `resp` is
technically still in scope (Python does not erase local variables on `with` block exit),
the `async with client:` block on line 328-342 makes one HTTP call and assigns to `resp`
inside it. The response object is a completed httpx response and remains valid after the
context exits — so this is not a runtime crash.

However, the pattern diverges from every other test method in the same file (all others
assert inside or immediately after the final `async with` block, with `assert
resp.status_code == 200` at the top of the assertion block). The structural mismatch
creates a readability risk: a maintainer adding a second request inside this test would
not notice the assertions are already outside the client context, potentially introducing
a genuine use-after-close error. Furthermore, the `content[0].get("text", "")` on
line 352 accesses `content[0]` without an `isinstance(content[0], dict)` guard — if
the MCP response shape changes and `content[0]` is not a dict, this raises `AttributeError`,
masking the actual error.

**Fix:** Move all assertions inside the `async with` block (consistent with the rest of
the test class) and add the `isinstance` guard:

```python
async with client:
    resp = await client.post(_MCP_PATH, json={...})
    assert resp.status_code == 200
    body = _parse_sse_json(resp.text)
    result = body.get("result", {})
    assert isinstance(result, dict)
    assert result.get("isError") is True, ...
    content = result.get("content", [])
    assert len(content) > 0
    item = content[0]
    error_text = item.get("text", "") if isinstance(item, dict) else ""
    assert isinstance(error_text, str) and len(error_text) > 0
    assert "Traceback" not in error_text, ...
```

---

## Info

### IN-01: `_parse_sse_json` duplicated verbatim across four test files with no shared utility

**Files:**
- `tests/test_users.py:31-40`
- `tests/test_records.py:22-32`
- `tests/test_discovery.py:18-28`
- `tests/test_transport.py:24-34`
- `tests/integration/test_vertical.py:45-54`

**Issue:** The five-line `_parse_sse_json` helper is copy-pasted across all five test
files. The PATTERNS.md explicitly notes "Copy verbatim — this function is duplicated
across test files (no shared test util module exists)" — so this was an intentional
design choice for Phase 3. Documenting it here because the duplication will compound
with every additional test module: a fix to SSE parsing (e.g., supporting multi-event
streams) requires editing five files.

**Fix:** Extract to `tests/conftest.py` or a `tests/_helpers.py` module. Not urgent for
Phase 3 but worth consolidating before Phase 4 adds more test modules.

---

_Reviewed: 2026-06-02T12:02:15Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
