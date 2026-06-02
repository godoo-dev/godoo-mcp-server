---
phase: 02-skeleton-server
plan: 01
subsystem: api
tags: [fastmcp, starlette, mcp, streamable-http, credentials, middleware, pytest-asyncio]

requires:
  - phase: 01-foundations
    provides: src-layout, pyproject.toml with fastmcp+godoo-client deps, uv toolchain, pytest-asyncio asyncio_mode=auto, mypy --strict, ruff

provides:
  - Pure ASGI CredentialMiddleware that resolves X-Odoo-* headers / ODOO_* env vars per-request
  - OdooCredentials dataclass (repr=False, password redacted) injected into scope["state"]["odoo_creds"]
  - FastMCP server instance (mcp) in server.py + create_app() ASGI factory with stateless_http=True
  - odoo_whoami throwaway probe tool registered on mcp
  - HTTP 401 with field enumeration when any credential is absent
  - 9 unit tests covering AUTH-01/02/03 and TRANS-01/02 — all green
  - godoo-testcontainers dev dep pinned, integration marker registered, CI-ready

affects: [03-raw-primitives, 04-skills-resources, 05-integration-tests]

tech-stack:
  added:
    - godoo-testcontainers>=0.2,<0.3 (dev dep for future integration tests)
  patterns:
    - Pure ASGI middleware (not BaseHTTPMiddleware) for scope["state"] injection — avoids contextvar propagation issues
    - FastMCP mcp instance in server.py, imported by tool modules for @mcp.tool registration
    - Side-effect import of tools package in server.py after mcp is defined
    - Per-request OdooClient via async with OdooClient(config) in each tool handler
    - Background-task + asyncio.Event fixture pattern for anyio lifespan in pytest-asyncio
    - SSE response parsing (_parse_sse_json) for MCP Streamable HTTP body in tests

key-files:
  created:
    - src/godoo_mcp_server/credentials.py
    - src/godoo_mcp_server/server.py
    - src/godoo_mcp_server/tools/__init__.py
    - src/godoo_mcp_server/tools/probe.py
    - tests/conftest.py
    - tests/test_credentials.py
    - tests/test_transport.py
  modified:
    - src/godoo_mcp_server/__main__.py
    - pyproject.toml
    - uv.lock

key-decisions:
  - "Pure ASGI middleware (implements __call__ directly) chosen over BaseHTTPMiddleware to preserve contextvar propagation required by MCP SDK internal request handling"
  - "Background asyncio.Task + Event pair used in pytest-asyncio fixtures to enter/exit anyio lifespan cancel scope within the same task — avoids RuntimeError on teardown"
  - "MCP Streamable HTTP always returns text/event-stream (SSE) format when client accepts both application/json and text/event-stream; test helper _parse_sse_json parses data: line"
  - "fastmcp Context used in tool signature requires runtime import (not TYPE_CHECKING) — pydantic schema generation evaluates forward references at decoration time"
  - "create_app() -> object return type is mypy-safe; StarletteWithLifespan is private; __main__.py uses Any cast for uvicorn.run() argument"

requirements-completed:
  - TRANS-01
  - TRANS-02
  - AUTH-01
  - AUTH-02
  - AUTH-03
  - AUTH-04

duration: 11min
completed: 2026-06-02
---

# Phase 2 Plan 01: Skeleton Server Credential Middleware + MCP Transport Summary

**Stateless Streamable HTTP MCP endpoint with pure-ASGI per-request credential middleware injecting X-Odoo-* headers / ODOO_* env vars into scope["state"], returning HTTP 401 with field enumeration on missing creds, verified by 9 unit tests (all green)**

## Performance

- **Duration:** 11 min
- **Started:** 2026-06-02T09:11:24Z
- **Completed:** 2026-06-02T09:22:27Z
- **Tasks:** 2 (TDD RED + GREEN)
- **Files modified:** 10

## Accomplishments

- Credential resolution chain: X-Odoo-{Url,Database,Username,Password} headers → ODOO_{URL,DATABASE,USERNAME,PASSWORD} env vars → HTTP 401 with per-field enumeration (AUTH-01/02/03)
- Stateless MCP Streamable HTTP endpoint: no Mcp-Session-Id header emitted, tools/list returns 200 with odoo_whoami in tool list (TRANS-01/02)
- Pure ASGI CredentialMiddleware injecting OdooCredentials into scope["state"]["odoo_creds"] accessible via get_http_request().state in tool handlers (A1 assumption validated)
- All 9 unit tests GREEN with no teardown errors; mypy --strict and ruff both pass

## Task Commits

Each task was committed atomically:

1. **Task 1: Write failing unit tests (RED)** - `012e9e6` (test)
2. **Task 2: Implement credential middleware + server + probe tool (GREEN)** - `a98b59a` (feat)

## Files Created/Modified

- `src/godoo_mcp_server/credentials.py` — OdooCredentials @dataclass(repr=False) + CredentialMiddleware pure ASGI class
- `src/godoo_mcp_server/server.py` — FastMCP mcp instance at module level + create_app() ASGI factory with stateless_http=True
- `src/godoo_mcp_server/tools/__init__.py` — package marker (empty)
- `src/godoo_mcp_server/tools/probe.py` — odoo_whoami throwaway probe tool; per-request async with OdooClient(config)
- `src/godoo_mcp_server/__main__.py` — replaced sys.exit(1) else branch with uvicorn.run(create_app())
- `tests/conftest.py` — mcp_client + mcp_client_no_creds async fixtures; STANDARD_MCP_HEADERS + FAKE_CRED_HEADERS constants
- `tests/test_credentials.py` — 5 tests: test_headers_resolve, test_missing_creds_401, test_partial_missing_creds, test_env_fallback, test_header_precedence
- `tests/test_transport.py` — 4 tests: test_no_session_id, test_tools_list_200, test_tools_list_contains_whoami, test_stateless_no_session_id_repeated
- `pyproject.toml` — godoo-testcontainers dev dep; integration marker; addopts -m 'not integration'; fixed mypy override godoo_client.* → godoo.client.*; added godoo.testcontainers.* override
- `uv.lock` — updated with godoo-testcontainers

## Decisions Made

1. Pure ASGI middleware chosen over BaseHTTPMiddleware to avoid contextvar propagation issues in the MCP SDK's internal request context.
2. Background asyncio.Task + Event pair fixture pattern: anyio cancel scopes must enter/exit in the same task; pytest-asyncio finalizers run in a different task — the background-task approach keeps the lifespan lifecycle in one task.
3. MCP Streamable HTTP always returns SSE format when client accepts text/event-stream (as required by protocol). RESEARCH.md note that stateless mode returns application/json was incorrect. Added _parse_sse_json helper.
4. fastmcp Context requires runtime import for pydantic schema generation — cannot go in TYPE_CHECKING block despite being annotation-only.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] MCP endpoint path is /mcp not /mcp/ — 307 redirect**
- **Found during:** Task 2 (first test run)
- **Issue:** Tests posted to `/mcp/` (trailing slash) but fastmcp registers the route at `/mcp` — received 307 Temporary Redirect
- **Fix:** Updated all test POST paths from `/mcp/` to `/mcp`
- **Files modified:** tests/test_credentials.py, tests/test_transport.py
- **Verification:** 307 resolved; tests pass with 200
- **Committed in:** a98b59a (Task 2 commit)

**2. [Rule 1 - Bug] anyio cancel scope teardown in different asyncio task**
- **Found during:** Task 2 (fixture teardown errors)
- **Issue:** pytest-asyncio 1.4.0 runs fixture finalizers via `runner.run()` which creates a new asyncio task; anyio cancel scopes (created inside `app.router.lifespan_context`) must be entered and exited in the same task → RuntimeError on teardown
- **Fix:** Restructured mcp_client fixture to run lifespan + client in a background asyncio.Task, synchronized with asyncio.Event pair. Setup sets the event when ready; teardown sets stop_event and awaits the task (same task that entered lifespan)
- **Files modified:** tests/conftest.py
- **Verification:** No teardown errors; all 9 tests pass cleanly
- **Committed in:** a98b59a (Task 2 commit)

**3. [Rule 1 - Bug] MCP response is SSE format (text/event-stream), not application/json**
- **Found during:** Task 2 (test_tools_list_contains_whoami failure)
- **Issue:** resp.json() raised JSONDecodeError because MCP Streamable HTTP always returns SSE format when client accepts text/event-stream (protocol requirement). RESEARCH.md incorrectly stated stateless mode returns application/json
- **Fix:** Added _parse_sse_json() helper that extracts the `data:` line from SSE body and parses it as JSON; updated test_tools_list_contains_whoami to use it
- **Files modified:** tests/test_transport.py
- **Verification:** test_tools_list_contains_whoami PASSED with odoo_whoami found in tools list
- **Committed in:** a98b59a (Task 2 commit)

**4. [Rule 1 - Bug] fastmcp Context requires runtime import (not TYPE_CHECKING)**
- **Found during:** Task 2 (NameError during tool registration)
- **Issue:** With `from __future__ import annotations`, pydantic evaluates odoo_whoami's function signature at `@mcp.tool` decoration time. With Context in TYPE_CHECKING block, it was NameError during schema generation
- **Fix:** Moved `from fastmcp import Context` to runtime import with `# noqa: TC002` comment to suppress ruff's type-checking block suggestion
- **Files modified:** src/godoo_mcp_server/tools/probe.py
- **Verification:** Tool registration succeeds; tests pass
- **Committed in:** a98b59a (Task 2 commit)

---

**Total deviations:** 4 auto-fixed (all Rule 1 — bugs found during first test run)
**Impact on plan:** All fixes were necessary for correctness. Scope matched plan exactly. The fixture pattern and SSE parsing are now established patterns for Wave 2.

## Issues Encountered

None beyond the deviations documented above.

## User Setup Required

None - no external service configuration required for unit tests. Integration tests (Wave 2) require Docker for real Odoo container.

## Next Phase Readiness

- Wave 2 (02-02) can use the mcp_client fixture pattern and _parse_sse_json helper directly
- The scope["state"]["odoo_creds"] → get_http_request().state propagation path is confirmed working (A1 assumption validated by test_headers_resolve)
- godoo-testcontainers dev dep is installed and locked; integration marker registered in pyproject.toml
- Integration tests (tests/integration/) still need to be created in Wave 2

---
*Phase: 02-skeleton-server*
*Completed: 2026-06-02*
