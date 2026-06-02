---
phase: 02-skeleton-server
verified: 2026-06-02T10:00:00Z
status: gaps_found
score: 6/6 requirements verified — 1 formatting gap
overrides_applied: 0
gaps:
  - truth: "ruff format --check passes (CI lint step enforces this)"
    status: partial
    reason: "tests/integration/test_vertical.py has a single formatting divergence: slice notation `line[len(\"data:\"):]` should be `line[len(\"data:\") :]` (E203 / ruff E501 slice spacing). ruff check passes; ruff format --check exits 1."
    artifacts:
      - path: "tests/integration/test_vertical.py"
        issue: "Line 50 slice notation `line[len(\"data:\"):].strip()` — ruff format wants a space before the colon: `line[len(\"data:\") :].strip()`"
    missing:
      - "Run `uv run ruff format tests/integration/test_vertical.py` and commit the one-line fix"
---

# Phase 02: skeleton-server Verification Report

**Phase Goal:** Wire a stateless Streamable HTTP MCP endpoint with per-request credential resolution — POST with `X-Odoo-*` headers flows through pure ASGI middleware, resolves to `OdooCredentials`, injects into `scope["state"]`, and a registered MCP tool can read them to build a fresh per-request `OdooClient`. No shared state, no `Mcp-Session-Id`, HTTP 401 with field enumeration on missing credentials.

**Verified:** 2026-06-02T10:00:00Z
**Status:** PASS-WITH-CONCERNS (1 formatting gap, all 6 requirements MET)
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | POST /mcp with valid X-Odoo-* headers returns HTTP 200 | VERIFIED | `test_headers_resolve` PASSED; `test_tools_list_200` PASSED |
| 2 | Response headers never contain `mcp-session-id` | VERIFIED | `test_no_session_id` PASSED; `test_stateless_no_session_id_repeated` PASSED; `stateless_http=True` at `server.py:33` |
| 3 | POST with no credentials returns HTTP 401 listing all four missing fields | VERIFIED | `test_missing_creds_401` PASSED; `credentials.py:80-88` enumerates per field |
| 4 | POST with partial headers returns HTTP 401 listing only missing fields | VERIFIED | `test_partial_missing_creds` PASSED; field check at `credentials.py:79-88` |
| 5 | POST with env vars and no headers resolves from env (non-401) | VERIFIED | `test_env_fallback` PASSED; `credentials.py:74-77` `_env()` fallback |
| 6 | Headers take precedence over env vars | VERIFIED | `test_header_precedence` PASSED; `_header() or _env()` pattern at `credentials.py:74-77` |
| 7 | Two concurrent requests with different headers each get a fresh `OdooCredentials` | VERIFIED | `test_concurrent_isolation` in integration suite; per-request `scope["state"]["odoo_creds"]` at `credentials.py:99-107`; no module-level client singleton |
| 8 | `tools/list` returns `odoo_whoami` in the MCP response body | VERIFIED | `test_tools_list_contains_whoami` PASSED; `probe.py:21-24` registers tool on `mcp` |
| 9 | `godoo-testcontainers>=0.2,<0.3` is a dev dependency | VERIFIED | `pyproject.toml:24` |
| 10 | `ruff format --check .` passes | FAILED | `tests/integration/test_vertical.py:50` slice spacing — 1 file would be reformatted |

**Score:** 9/10 truths verified (all 6 requirements MET; 1 formatting artifact gap)

---

## Requirement Verdicts

| Requirement | Description | Verdict | Evidence (file:line) |
|-------------|-------------|---------|----------------------|
| **TRANS-01** | Streamable HTTP MCP endpoint in stateless mode; no `Mcp-Session-Id` emitted | **MET** | `server.py:33` `stateless_http=True`; `test_no_session_id` + `test_stateless_no_session_id_repeated` PASSED |
| **TRANS-02** | MCP client can connect, list tools, call a tool end-to-end | **MET** | Unit: `test_tools_list_200`, `test_tools_list_contains_whoami` PASSED. Integration: `TestVerticalSlice.test_full_vertical` (full vertical with real Odoo, CI-only). Integration collects correctly. |
| **AUTH-01** | Server resolves credentials from `X-Odoo-*` headers | **MET** | `credentials.py:63-77` header extraction; `test_headers_resolve` PASSED |
| **AUTH-02** | Falls back to `ODOO_*` env vars; headers take precedence | **MET** | `credentials.py:74-77` `_header() or _env()`; `test_env_fallback` + `test_header_precedence` PASSED |
| **AUTH-03** | Missing credentials → clear 401-style error | **MET** | `credentials.py:79-96` enumeration + `JSONResponse(status_code=401)`; `test_missing_creds_401` (4 fields) + `test_partial_missing_creds` (3 fields) PASSED |
| **AUTH-04** | Each request builds a fresh `OdooClient`; no shared client across requests | **MET** | `probe.py:35` `async with OdooClient(config) as client:` per-call; no module-level singleton (grep confirms); `test_concurrent_isolation` in integration suite uses `asyncio.gather` to assert `uid` differs per user |

---

## Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/godoo_mcp_server/credentials.py` | `OdooCredentials` dataclass + `CredentialMiddleware` pure ASGI | VERIFIED | `@dataclass(repr=False)` at line 20; custom `__repr__` redacts password (`***`) at line 32; `CredentialMiddleware.__call__` at line 53 |
| `src/godoo_mcp_server/server.py` | `FastMCP` instance + `create_app()` ASGI factory | VERIFIED | `mcp = FastMCP(...)` at line 15; `create_app()` returns `mcp.http_app(stateless_http=True, ...)` at line 32 |
| `src/godoo_mcp_server/tools/probe.py` | `odoo_whoami` tool registered on `mcp` | VERIFIED | `@mcp.tool(name="odoo_whoami")` at line 21; `async with OdooClient(config)` at line 35 |
| `src/godoo_mcp_server/__main__.py` | `create_app()` + `uvicorn.run()` in else branch | VERIFIED | `uvicorn.run(app, host="0.0.0.0", port=8000)` at line 20 |
| `tests/conftest.py` | `mcp_client` + `mcp_client_no_creds` async fixtures | VERIFIED | Background-task + Event pattern fixtures at lines 52, 75 |
| `tests/test_credentials.py` | 5 unit tests for AUTH-01/02/03 | VERIFIED | `test_headers_resolve`, `test_missing_creds_401`, `test_partial_missing_creds`, `test_env_fallback`, `test_header_precedence` — all PASSED |
| `tests/test_transport.py` | 4 unit tests for TRANS-01/02 | VERIFIED | `test_no_session_id`, `test_tools_list_200`, `test_tools_list_contains_whoami`, `test_stateless_no_session_id_repeated` — all PASSED |
| `tests/integration/__init__.py` | Package marker | VERIFIED | File exists (empty) |
| `tests/integration/conftest.py` | `odoo_harness` + `mcp_client_factory` session fixtures | VERIFIED | 3 session-scoped async fixtures (`odoo_harness`, `mcp_app_with_lifespan`, `second_user_credentials`) at lines 29, 53, 75; `mcp_client_factory` at line 94 |
| `tests/integration/test_vertical.py` | `TestVerticalSlice` with 3 integration tests | VERIFIED | `@pytest.mark.integration` class; 3 tests collected with `-m integration` |
| `.github/workflows/ci.yml` | CI integration job (`needs: ci`, Docker runner, snapshot cache) | VERIFIED | `integration:` job at line 43; `needs: ci` at line 45; `actions/cache@v4` with `odoo-snapshot-` key/restore-keys; `uv run pytest -m integration` |
| `pyproject.toml` | `godoo-testcontainers>=0.2,<0.3` dev dep; integration marker; `addopts -m 'not integration'`; `godoo.client.*` + `godoo.testcontainers.*` mypy overrides | VERIFIED | All present at lines 24, 41-47, 52-55 |

---

## Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `CredentialMiddleware.__call__` | `scope["state"]["odoo_creds"]` | `scope.setdefault("state", {}); scope["state"]["odoo_creds"] = OdooCredentials(...)` | WIRED | `credentials.py:99-107`; `test_headers_resolve` confirms end-to-end propagation |
| `probe.py:odoo_whoami` | `request.state.odoo_creds` | `get_http_request().state.odoo_creds` | WIRED | `probe.py:27-28`; Starlette `Request.state` reads `scope["state"]` — validated by passing tests |
| `server.py:create_app` | `CredentialMiddleware` | `mcp.http_app(stateless_http=True, middleware=[Middleware(CredentialMiddleware)])` | WIRED | `server.py:32-35`; `Middleware` imported from `starlette.middleware` (line 11), not FastMCP |
| `tests/integration/conftest.py:odoo_harness` | `TestHarness(...)` | `async with TestHarness(modules=["base"], snapshot=True, ...)` | WIRED | `conftest.py:29-38`; collects under `-m integration` |
| `test_concurrent_isolation` | `asyncio.gather` | Two concurrent POST `/mcp` calls with different `X-Odoo-*` headers | WIRED | `test_vertical.py:129-134` |
| `CI integration job` | `uv run pytest -m integration` | `needs: ci` gate on unit CI | WIRED | `ci.yml:43-71`; `needs: ci` line 45 |

---

## Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `probe.py:odoo_whoami` | `session.uid`, `session.db` | `async with OdooClient(config)` → `client.get_session()` after auth | Yes — authenticated against real Odoo (integration test); no hardcoded return | FLOWING (CI-only) |
| `credentials.py:CredentialMiddleware` | `OdooCredentials` | ASGI `scope["headers"]` + `os.environ` | Yes — per-request extraction, no static values | FLOWING |

---

## Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| All unit tests pass | `uv run pytest -m "not integration" --tb=short -v` | 10 passed, 3 deselected in 0.15s | PASS |
| mypy strict clean | `uv run mypy --strict src/` | Success: no issues found in 6 source files | PASS |
| ruff lint clean | `uv run ruff check .` | Exit 0, no issues | PASS |
| ruff format check | `uv run ruff format --check .` | Exit 1 — 1 file would be reformatted (`tests/integration/test_vertical.py`) | FAIL |
| Integration tests collectable (no Docker needed) | `uv run pytest tests/integration/ --collect-only -q` | 0 collected, 3 deselected — marker exclusion works | PASS |
| Integration tests visible under marker | `uv run pytest tests/integration/ --collect-only -q -m integration` | 3 tests collected | PASS |
| CI YAML valid | `uv run python -c "import yaml; yaml.safe_load(open('.github/workflows/ci.yml').read())"` | Valid — no exception | PASS |
| `stateless_http=True` present | `grep -c "stateless_http=True" server.py` | 1 | PASS |
| No `BaseHTTPMiddleware` | `grep -c "BaseHTTPMiddleware" credentials.py` | 0 | PASS |
| No module-level OdooClient singleton | `grep -n "_client" tools/probe.py` | (empty) | PASS |
| Middleware from starlette (not fastmcp) | `grep -c "starlette.middleware" server.py` | 1 | PASS |
| CI `needs: ci` gate | `grep -c "needs: ci" ci.yml` | 1 | PASS |

---

## Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| TRANS-01 | 02-01 | Streamable HTTP stateless mode, no `Mcp-Session-Id` | SATISFIED | `server.py:33`; 2 passing tests |
| TRANS-02 | 02-01, 02-02 | Client can list tools + call end-to-end | SATISFIED | Unit: 2 tests; Integration: 3 tests (CI-only) |
| AUTH-01 | 02-01 | `X-Odoo-*` header resolution | SATISFIED | `credentials.py:63-77`; 2 passing tests |
| AUTH-02 | 02-01 | Env var fallback; header precedence | SATISFIED | `credentials.py:74-77`; 2 passing tests |
| AUTH-03 | 02-01 | 401 with field enumeration | SATISFIED | `credentials.py:79-96`; 2 passing tests |
| AUTH-04 | 02-01, 02-02 | Per-request fresh `OdooClient`; no shared state | SATISFIED | `probe.py:35`; no singleton; integration concurrency test |

---

## Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `tests/integration/test_vertical.py` | 50 | `line[len("data:"):]` — missing space before colon in slice (ruff E203) | Warning | CI `ruff format --check` exits 1; would block if the lint step enforced `ruff format --check` (it currently does: `ci.yml:34`) |

No `TBD`, `FIXME`, or `XXX` debt markers found in any modified file.

---

## Gaps Summary

**One gap, one line:**

`tests/integration/test_vertical.py:50` has a slice-notation formatting divergence (`line[len("data:"):]` vs the ruff-preferred `line[len("data:") :]`). This is a whitespace-only issue with no logic impact. However, the CI `lint (ruff)` step explicitly runs `uv run ruff format --check .`, so this will cause the CI job to fail on the integration test file on the next push to `develop` or `main`.

**Fix:** `uv run ruff format tests/integration/test_vertical.py` — one-line change, re-commit.

---

## Human Verification Required

Integration tests (`TestVerticalSlice`) require Docker + a live Odoo container and cannot be run locally without Docker. The following must be confirmed in CI (ubuntu-latest with Docker):

### 1. Full vertical slice against real Odoo

**Test:** Push to `develop` and monitor the `integration` CI job.
**Expected:** `test_tools_list`, `test_full_vertical`, `test_concurrent_isolation` all PASS; `test_full_vertical` returns `uid > 0` and `db` in the response; `test_concurrent_isolation` asserts two distinct UIDs.
**Why human:** Requires a running Odoo container — not available locally, runs only in CI.

---

## Overall Verdict

**PASS-WITH-CONCERNS**

All six Phase 02 requirements (TRANS-01, TRANS-02, AUTH-01, AUTH-02, AUTH-03, AUTH-04) are MET by actual code verified against the live test suite (10/10 unit tests pass, mypy --strict clean, ruff lint clean). The phase goal — stateless Streamable HTTP MCP endpoint with per-request credential resolution and no cross-user state — is achieved.

One formatting gap: `tests/integration/test_vertical.py:50` fails `ruff format --check`, which is enforced in the CI `lint (ruff)` step. This will block CI on the next push unless fixed. The fix is a single whitespace change.

The integration test suite (3 tests) is structurally correct and collection-verified locally; actual execution against a live Odoo container is CI-only and requires human confirmation.

---

_Verified: 2026-06-02T10:00:00Z_
_Verifier: Claude (gsd-verifier)_
