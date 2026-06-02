# Phase 2: Skeleton Server - Research

**Researched:** 2026-06-02
**Domain:** fastmcp 3.3.1 Streamable HTTP, Starlette middleware, per-request OdooClient, godoo-testcontainers integration testing
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-1:** Phase 2 registers ONE throwaway validation tool: a minimal read-only Odoo probe (e.g. `whoami` or server-version check) that performs a real Odoo round-trip. This is scaffolding replaced/removed in Phase 3.
- **D-2:** When no credentials resolve, reject at the TRANSPORT layer with HTTP 401 from a Starlette middleware, BEFORE the request reaches MCP processing. The 401 body enumerates which credential inputs were missing (which X-Odoo-* headers and/or env vars).
- **D-3:** Extract X-Odoo-* headers in a Starlette Middleware class (NOT FastAPI on top of fastmcp). Resolution precedence: `X-Odoo-Url / X-Odoo-Database / X-Odoo-Username / X-Odoo-Password` headers take precedence; env-var fallback `ODOO_URL / ODOO_DATABASE / ODOO_USERNAME / ODOO_PASSWORD`; neither → 401 (D-2). Middleware stashes resolved credentials on per-request scope/state; tool handlers read them via fastmcp's `Context` object. No module-global state, no contextvars. Each request constructs a FRESH OdooClient from its resolved credentials.
- **D-4:** Use `godoo-testcontainers` for REAL-Odoo integration test. Session-scoped `TestHarness` from `godoo.testcontainers` boots one real Odoo. Integration tests marked `@pytest.mark.integration`; default CI gate runs `-m "not integration"`; separate CI job runs integration tests with Docker available.
- **D-5:** Add `godoo-testcontainers>=0.2,<0.3` as DEV dependency from PyPI. NO path dependency to `../godoo-py`.

### Carried Forward (Locked Upstream)

- Transport: Streamable HTTP only, `stateless_http=True`, no `Mcp-Session-Id` (TRANS-01).
- Framework: `fastmcp` (PrefectHQ 3.3.x); single-process uvicorn; Starlette middleware for credential extraction; no FastAPI.
- Auth boundary absolute: server consumes credentials, never generates/issues tokens, never implements OAuth.
- `godoo-client>=0.2,<0.3`, Python >=3.14, `uv_build`, src-layout, mypy --strict, ruff.
- Phase 1 CI: GitHub Actions, three gates (ruff, mypy --strict, pytest), `uv sync --frozen`, uv.lock committed. Phase 2 adds a separate integration job.

### Claude's Discretion

- Exact `godoo-client` 0.2.1 async lifecycle — whether OdooClient requires `async with` / explicit close.
- fastmcp ASGI wiring details: use `http_app()` to obtain the ASGI app; `FastMCP` server object MUST live in `server.py`.
- Exact identity of the stub validation tool's Odoo call (`whoami` vs version probe) — planner picks.
- Config/env loading shape, server-start CLI command design, logging — planner uses sensible defaults.

### Deferred Ideas (OUT OF SCOPE)

None from discussion. The real raw-primitive toolset (search/read/create/write/call/introspect) is Phase 3.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| TRANS-01 | Server exposes Streamable HTTP MCP endpoint in stateless mode (`stateless_http=True`), no `Mcp-Session-Id` emitted | Verified from MCP SDK source: `mcp_session_id=None` in stateless mode prevents header emission. Confirmed via live test: `mcp-session-id` absent from response headers. |
| TRANS-02 | A local MCP client can connect, list tools, and call a tool end-to-end | Confirmed via live test: `tools/list` returns 200 with valid MCP response. `mcp.http_app(stateless_http=True)` + `app.router.lifespan_context` pattern works. |
| AUTH-01 | Server resolves credentials from per-request `X-Odoo-*` headers | `get_http_headers(include_all=True)` reads all custom headers including `x-odoo-*` from any fastmcp tool or middleware context. `get_http_request()` returns the Starlette Request. |
| AUTH-02 | When headers absent, falls back to env vars; headers take precedence | `godoo.client.config.config_from_env()` reads `ODOO_URL/ODOO_DB(or DATABASE)/ODOO_USER(or USERNAME)/ODOO_PASSWORD`. Header-first logic is custom: check headers first, fall back to env vars per-field. |
| AUTH-03 | Requests with no resolvable credentials fail with a clear 401-style MCP error | Verified: Starlette pure-ASGI middleware passed via `http_app(middleware=[...])` can return HTTP 401 JSONResponse before MCP processing. Enumeration of missing fields in body required. |
| AUTH-04 | Each request builds a fresh Odoo client from its own resolved credentials; no sharing | `OdooClient(OdooClientConfig(...))` is synchronous construction; `async with OdooClient(config) as client:` authenticates and closes per-request. Singleton anti-pattern avoided by constructing inside tool handler. |
</phase_requirements>

---

## Summary

Phase 2 delivers a stateless Streamable HTTP MCP endpoint with per-request credential resolution and a real Odoo round-trip via a throwaway probe tool. The research confirms that `fastmcp` 3.3.1 (PrefectHQ) provides `http_app(stateless_http=True)` which routes each POST to a fresh `StreamableHTTPServerTransport` with `mcp_session_id=None` — verified from MCP SDK source and a live test that confirmed `mcp-session-id` is absent from response headers.

The credential injection architecture has a two-layer design. At the HTTP transport layer, a pure ASGI middleware (passed to `http_app(middleware=[...])` as a `starlette.middleware.Middleware` object) reads `X-Odoo-*` headers, falls back to env vars, and returns HTTP 401 with an enumerated missing-fields body if neither is present. When credentials are resolved, it stores them in `scope["state"]` — the same dict backing `Request.state` — so that tool handlers can access them via `get_http_request().state`. This avoids the `BaseHTTPMiddleware` contextvar propagation issue and works safely with the MCP SDK's internal `Request(scope, receive)` construction.

The `OdooClient` async lifecycle is confirmed: `OdooClient(OdooClientConfig(...))` is synchronous construction; `async with client:` calls `authenticate()` on entry and `aclose()` on exit. This `async with` pattern inside each tool handler is the canonical per-request isolation pattern — no singleton, no shared transport.

**Primary recommendation:** Pure ASGI Starlette middleware for transport-layer 401 + scope state injection; `get_http_request().state` in tool handlers for credential access; `async with OdooClient(config) as client:` per tool invocation; `authenticate()` result is `OdooSessionInfo(uid, session_id, db)` — use this as the cheapest `whoami` probe.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Credential extraction (X-Odoo-* headers) | HTTP transport middleware | env var fallback | Must fire before MCP protocol processing to enable real HTTP 401 |
| Missing-credentials rejection (HTTP 401) | HTTP transport middleware | — | D-2 requires HTTP 401, not MCP error; must be at transport layer |
| Per-request OdooClient construction | Tool handler | — | Each tool builds its own client from state injected by middleware |
| Odoo authentication (session) | Tool handler (via OdooClient.__aenter__) | — | `authenticate()` is part of the OdooClient lifecycle, not middleware |
| Stateless MCP session management | fastmcp / MCP SDK | — | `stateless_http=True` + `StreamableHTTPSessionManager.stateless=True` |
| MCP tool registration | FastMCP server object (server.py) | — | Tools declared on the FastMCP instance, not in __main__.py |
| ASGI app wiring + lifespan | FastMCP `http_app()` | uvicorn (runner) | `http_app()` returns `StarletteWithLifespan`; lifespan must be honored |
| Integration test Odoo container | godoo-testcontainers (TestHarness) | CI Docker job | Session-scoped fixture boots real Odoo once per test session |

---

## Standard Stack

### Core (all locked upstream — do not re-litigate)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `fastmcp` | 3.3.1 | MCP server framework — tools, resources, Streamable HTTP | [VERIFIED: installed + inspected source] |
| `mcp` | 1.27.x (transitive) | MCP protocol — `StreamableHTTPSessionManager`, `StreamableHTTPServerTransport` | [VERIFIED: installed + inspected source] |
| `starlette` | transitive | ASGI middleware, `Request`, `Middleware` namedtuple, `Response` | [VERIFIED: installed] |
| `godoo-client` | 0.2.1 | Async Odoo JSON-RPC — `OdooClient`, `OdooClientConfig`, `OdooSessionInfo` | [VERIFIED: source-inspected in godoo-py monorepo] |
| `uvicorn` | 0.48.0 (transitive) | ASGI runner | [VERIFIED: installed] |

### Dev (Phase 2 additions)

| Library | Version | Purpose | Notes |
|---------|---------|---------|-------|
| `godoo-testcontainers` | `>=0.2,<0.3` | Real-Odoo integration tests | [VERIFIED: PyPI 0.2.1 latest, marcfargas-authored] |
| `httpx` | `>=0.27` (transitive) | In-process HTTP testing via `ASGITransport` | [VERIFIED: installed 0.28.1] |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Pure ASGI middleware for credentials | `BaseHTTPMiddleware` | `BaseHTTPMiddleware` breaks contextvar propagation — documented issue; pure ASGI is the safer choice |
| Pure ASGI middleware | `fastmcp.server.middleware.Middleware` + `add_middleware()` | FastMCP Middleware fires at MCP protocol layer, cannot return HTTP 401; wrong tier for D-2 |
| `get_http_request().state` in tool | `ctx.set_state(serializable=False)` | Both are viable; `request.state` is cleaner for Starlette-middleware-injected data and avoids set_state async overhead per request |

**Installation (Phase 2 additions to pyproject.toml):**
```toml
[dependency-groups]
dev = [
    # existing entries preserved ...
    "godoo-testcontainers>=0.2,<0.3",
]
```

---

## Package Legitimacy Audit

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| `godoo-testcontainers` | PyPI | active (0.2.1 latest) | low (internal) | github.com/godoo-dev/godoo-py | [ASSUMED — slopcheck unavailable] | Approved — marcfargas-authored package, same org as godoo-client |
| `godoo-client` | PyPI | 0.2.1 installed | internal use | github.com/godoo-dev/godoo-py | [ASSUMED — slopcheck unavailable] | Approved — locked upstream, source-inspected in monorepo |
| `fastmcp` | PyPI | active (3.3.1) | 1M/day per repo | github.com/PrefectHQ/fastmcp | [ASSUMED — slopcheck unavailable] | Approved — locked upstream |

**Packages removed due to slopcheck [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

*slopcheck was unavailable at research time. All packages are author-known (`godoo-*`) or locked upstream decisions with millions of downloads (`fastmcp`). No checkpoint:human-verify required for these specific packages given the provenance certainty.*

---

## Architecture Patterns

### System Architecture Diagram

```
HTTP POST /mcp
      |
      v
[Pure ASGI Credential Middleware]  <-- starlette.middleware.Middleware, passed to http_app()
  Read X-Odoo-{Url,Database,Username,Password} headers
  Fallback to ODOO_{URL,DATABASE,USERNAME,PASSWORD} env vars
  If missing any field --> HTTP 401 JSON (enumerate which fields missing)
  Else: scope["state"]["odoo_config"] = OdooClientConfig(url, database, username, password)
      |
      v
[fastmcp StreamableHTTPSessionManager (stateless=True)]
  Creates fresh StreamableHTTPServerTransport(mcp_session_id=None)
  No Mcp-Session-Id in response headers
      |
      v
[MCP Protocol Dispatch]
  tools/list  -->  returns registered tool descriptors
  tools/call  -->  dispatches to tool handler
      |
      v
[Tool Handler: odoo_whoami (validation probe)]
  config = get_http_request().state.odoo_config  # OdooClientConfig from middleware
  async with OdooClient(config) as client:       # authenticates + closes per call
      session = client.get_session()
      return {"uid": session.uid, "db": session.db}
      |
      v
[Real Odoo Instance]  <-- via httpx JSON-RPC
```

### Recommended Module Structure (Phase 2 additions)

```
src/godoo_mcp_server/
├── __init__.py          # existing — no change
├── __main__.py          # existing — wire server start in the else branch
├── server.py            # NEW — FastMCP instance + http_app() ASGI wiring
├── credentials.py       # NEW — OdooCredentials dataclass, resolve_credentials(), Pure ASGI middleware class
└── tools/
    └── probe.py         # NEW — odoo_whoami validation tool (throwaway, Phase 3 removes this)

tests/
├── __init__.py          # existing
├── test_placeholder.py  # existing (Phase 1 — keep)
├── test_transport.py    # NEW — TRANS-01 (no Mcp-Session-Id), TRANS-02 (tools/list 200)
├── test_credentials.py  # NEW — AUTH-01, AUTH-02, AUTH-03, AUTH-04 (unit, no Odoo)
└── integration/
    ├── conftest.py      # NEW — session-scoped TestHarness fixture
    └── test_vertical.py # NEW — full connect→list→call→Odoo (TRANS-02 integration), AUTH-04 concurrency
```

### Pattern 1: Pure ASGI Credential Middleware

**What:** A pure-ASGI middleware class that reads `X-Odoo-*` headers, falls back to env vars, injects an `OdooClientConfig` into `scope["state"]`, and returns HTTP 401 if any credential field is missing.

**When to use:** Only one instance, wrapping the entire fastmcp ASGI app via `http_app(middleware=[...])`.

**Why pure ASGI (not `BaseHTTPMiddleware`):** `BaseHTTPMiddleware` breaks `contextvar` propagation in Starlette — this is a documented limitation. Since the MCP SDK sets request context via `ContextVar` inside the request handler, using `BaseHTTPMiddleware` upstream can prevent contextvars set by the MCP SDK from propagating correctly. Pure ASGI middleware writes directly into the `scope["state"]` dict, which is the same dict that `Request.state` reads — this propagates naturally without any contextvar involvement. [VERIFIED: Starlette source `Request.state` reads from `self.scope["state"]`]

```python
# Source: starlette ASGI middleware docs + verified Starlette Request.state source
from __future__ import annotations

import os
from dataclasses import dataclass
from starlette.types import ASGIApp, Scope, Receive, Send
from starlette.responses import JSONResponse

@dataclass
class OdooCredentials:
    url: str
    database: str
    username: str
    password: str

class CredentialMiddleware:
    """Pure ASGI middleware: resolves Odoo credentials per-request.

    Precedence: X-Odoo-* headers > ODOO_* env vars.
    Returns HTTP 401 with enumerated missing fields if any credential is absent.
    Stores OdooCredentials in scope["state"]["odoo_creds"] for tool handlers.
    """

    def __init__(self, app: ASGIApp) -> None:
        self._app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self._app(scope, receive, send)
            return

        # Build headers dict (ASGI: list of (name_bytes, value_bytes))
        raw_headers: dict[bytes, bytes] = {
            name.lower(): value
            for name, value in scope.get("headers", [])
        }

        def _header(name: str) -> str | None:
            val = raw_headers.get(name.encode("latin-1"), b"").decode("latin-1")
            return val or None

        def _env(*names: str) -> str | None:
            for name in names:
                val = os.environ.get(name, "")
                if val:
                    return val
            return None

        url      = _header("x-odoo-url")      or _env("ODOO_URL")
        database = _header("x-odoo-database") or _env("ODOO_DATABASE", "ODOO_DB")
        username = _header("x-odoo-username") or _env("ODOO_USERNAME", "ODOO_USER")
        password = _header("x-odoo-password") or _env("ODOO_PASSWORD")

        missing: list[str] = []
        if not url:
            missing.append("X-Odoo-Url (or ODOO_URL)")
        if not database:
            missing.append("X-Odoo-Database (or ODOO_DATABASE / ODOO_DB)")
        if not username:
            missing.append("X-Odoo-Username (or ODOO_USERNAME / ODOO_USER)")
        if not password:
            missing.append("X-Odoo-Password (or ODOO_PASSWORD)")

        if missing:
            response = JSONResponse(
                {"error": "missing_credentials", "missing": missing},
                status_code=401,
            )
            await response(scope, receive, send)
            return

        # Inject resolved credentials into scope["state"] (backs Request.state)
        scope.setdefault("state", {})
        assert url and database and username and password  # mypy: all non-None after missing check
        scope["state"]["odoo_creds"] = OdooCredentials(
            url=url, database=database, username=username, password=password
        )
        await self._app(scope, receive, send)
```

### Pattern 2: FastMCP Server Object and ASGI Wiring

**What:** The `FastMCP` instance lives in `server.py` and is importable. `http_app()` returns the ASGI app. Middleware is passed at app creation time.

```python
# src/godoo_mcp_server/server.py
from fastmcp import FastMCP
from starlette.middleware import Middleware
from godoo_mcp_server.credentials import CredentialMiddleware

mcp = FastMCP(
    "godoo-mcp-server",
    instructions="Stateless MCP server for Odoo. Per-request credentials via X-Odoo-* headers.",
)

# Import tools to register them on the mcp instance
from godoo_mcp_server.tools import probe  # noqa: F401, E402

def create_app() -> object:  # returns StarletteWithLifespan
    return mcp.http_app(
        stateless_http=True,
        middleware=[Middleware(CredentialMiddleware)],
    )
```

```python
# src/godoo_mcp_server/__main__.py  (Phase 2 else branch)
import uvicorn
from godoo_mcp_server.server import create_app

def main() -> None:
    if "--version" in sys.argv:
        print(f"godoo-mcp-server {__version__}")
        sys.exit(0)
    app = create_app()
    uvicorn.run(app, host="0.0.0.0", port=8000)
```

### Pattern 3: Per-Request OdooClient (NO Singleton)

**What:** Inside a tool handler, read credentials from `request.state`, construct a fresh `OdooClient`, use `async with` for lifecycle.

**Why `async with`:** `OdooClient.__aenter__` calls `authenticate()` and returns `self`; `__aexit__` calls `aclose()` which closes the underlying `httpx.AsyncClient` transport. Without `aclose()`, the transport leaks file descriptors. [VERIFIED: godoo-client source `client.py`]

```python
# src/godoo_mcp_server/tools/probe.py
from godoo.client.client import OdooClient, OdooClientConfig
from fastmcp import Context
from fastmcp.server.dependencies import get_http_request
from godoo_mcp_server.server import mcp
from godoo_mcp_server.credentials import OdooCredentials

@mcp.tool(name="odoo_whoami", description="[Probe] Authenticate and return uid + db. Throwaway — Phase 3 removes this.")
async def odoo_whoami(ctx: Context) -> dict:
    """Validates the full credential->OdooClient->RPC chain against a live Odoo instance."""
    request = get_http_request()
    creds: OdooCredentials = request.state.odoo_creds  # type: ignore[attr-defined]
    config = OdooClientConfig(
        url=creds.url,
        database=creds.database,
        username=creds.username,
        password=creds.password,
    )
    async with OdooClient(config) as client:
        session = client.get_session()
        assert session is not None
        return {"uid": session.uid, "db": session.db, "url": creds.url}
```

**Anti-pattern to never use:**
```python
# WRONG: module-level singleton — all users share same session, no isolation
_client: OdooClient | None = None  # NEVER DO THIS

# WRONG: construct but don't close — leaks httpx transport
async def bad_tool():
    client = OdooClient(config)
    await client.authenticate()
    # no aclose() -> transport leak
```

### Pattern 4: Testing with httpx ASGITransport + Lifespan

**What:** In-process HTTP tests require the app's lifespan to be started (initializes the `StreamableHTTPSessionManager` task group). Without lifespan, every request raises `RuntimeError: Task group is not initialized`. [VERIFIED: live test]

```python
# tests/conftest.py (unit test fixture)
import pytest
from httpx import ASGITransport, AsyncClient
from godoo_mcp_server.server import create_app

@pytest.fixture
async def mcp_client():
    """In-process MCP client with lifespan managed."""
    app = create_app()
    async with app.router.lifespan_context(app):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            yield client
```

```python
# Standard headers for MCP requests:
STANDARD_MCP_HEADERS = {
    "content-type": "application/json",
    "accept": "application/json, text/event-stream",
    "mcp-protocol-version": "2024-11-05",
}
```

### Pattern 5: Integration Test with TestHarness

```python
# tests/integration/conftest.py
import pytest
from godoo.testcontainers import TestHarness

@pytest.fixture(scope="session")
async def odoo_harness():
    """Session-scoped real Odoo container — starts once, shared across integration tests."""
    async with TestHarness(modules=["base"], snapshot=True) as h:
        yield h
```

```python
# tests/integration/test_vertical.py
import pytest

@pytest.mark.integration
async def test_full_vertical(odoo_harness, mcp_client_factory):
    """TRANS-02: list tools and call odoo_whoami against a real Odoo."""
    client = mcp_client_factory(
        url=odoo_harness.url,
        database=odoo_harness._database,
        username="admin",
        password="admin",
    )
    # list tools
    tools_resp = await client.post("/mcp", json={"jsonrpc": "2.0", "method": "tools/list", "params": {}, "id": 1},
                                   headers=HEADERS)
    assert tools_resp.status_code == 200
    # call probe
    call_resp = await client.post("/mcp", json={"jsonrpc": "2.0", "method": "tools/call",
                                                 "params": {"name": "odoo_whoami", "arguments": {}}, "id": 2},
                                  headers=HEADERS)
    assert call_resp.status_code == 200
```

### Anti-Patterns to Avoid

- **Module-level OdooClient singleton:** Causes cross-user bleed — user A's session is reused for user B's request. Always construct inside the tool handler.
- **`BaseHTTPMiddleware` for credential injection:** Breaks contextvar propagation in Starlette. Use pure ASGI middleware instead.
- **`mcp.add_middleware(FastMCPMiddleware(...))` for HTTP 401:** FastMCP middleware fires at the MCP protocol layer AFTER the HTTP transport is set up — it cannot return an HTTP 401 response, only an MCP error. Use Starlette middleware for D-2.
- **`async with OdooClient(config):` without `await client.authenticate()` first when using explicit construction:** The `async with` pattern calls `authenticate()` in `__aenter__` — do not call it separately before the context block or authentication runs twice.
- **Starlette `Middleware` namedtuple confusion:** `http_app(middleware=[...])` accepts `starlette.middleware.Middleware` objects (transport layer). `mcp.add_middleware(...)` accepts `fastmcp.server.middleware.Middleware` objects (MCP protocol layer). These are different types with different semantics.
- **`gunicorn` + uvicorn workers:** The server is stateless by design; gunicorn multi-worker adds shared-memory complexity with no benefit. Single-process uvicorn is correct.
- **SSE transport:** Deprecated for remote deployments. Use `transport="http"` (alias for `"streamable-http"`).

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| ASGI Streamable HTTP | Custom JSON-RPC handler | `fastmcp.http_app(stateless_http=True)` | Protocol compliance, session lifecycle, SSE response formatting — all handled |
| MCP protocol framing | Custom JSON-RPC dispatch | fastmcp tool decorators | Handles schema generation, type coercion, error framing |
| Real Odoo connection pooling | Custom httpx client pool | `OdooClient` per request with `aclose()` | godoo-client manages the httpx.AsyncClient lifecycle; per-request is correct for stateless |
| Odoo JSON-RPC | Custom requests/httpx calls | `godoo.client.client.OdooClient` | Session management, error wrapping, field coercion — complex and fragile to hand-roll |
| Integration test Odoo container | Custom Docker compose | `godoo.testcontainers.TestHarness` | Snapshot caching, module install, readiness probing — already built |
| In-process HTTP testing | Real uvicorn subprocess | `httpx.ASGITransport` | Fast, deterministic, no port conflicts; requires `app.router.lifespan_context` |

**Key insight:** The MCP protocol, Streamable HTTP framing, and Odoo JSON-RPC each have non-obvious edge cases (session negotiation, SSE event formatting, CSRF tokens, binary field encoding). None of these should be hand-rolled.

---

## OdooClient Async Lifecycle (Discretion Item — RESOLVED)

**Question:** Does OdooClient require `async with` / explicit close?

**Answer (VERIFIED from source):**

- `OdooClient(config)` — synchronous construction. Creates `JsonRpcTransport` internally (wraps an `httpx.AsyncClient`). No I/O.
- `await client.authenticate()` — makes the `/web/session/authenticate` HTTP call. Returns `OdooSessionInfo(uid, session_id, db)`.
- `await client.aclose()` — closes the underlying `httpx.AsyncClient`. Must be called or the transport leaks.
- `async with OdooClient(config) as client:` — calls `authenticate()` on entry, `aclose()` on exit. This is the canonical per-request pattern.
- `client.get_session()` — returns `OdooSessionInfo | None` (None before authenticate; non-None after).
- Import path: `from godoo.client.client import OdooClient, OdooClientConfig` or `from godoo.client import OdooClient, OdooClientConfig`.

**Recommendation:** Use `async with OdooClient(config) as client:` in every tool handler. Never store `OdooClient` in module scope or in fastmcp `set_state`.

---

## godoo-client Import Paths (VERIFIED from source)

```python
# Correct:
from godoo.client.client import OdooClient, OdooClientConfig
from godoo.client import OdooClient, OdooClientConfig       # also valid (re-exported)
from godoo.client.rpc import OdooSessionInfo
from godoo.client.config import config_from_env             # env-var helper

# Wrong:
import godoo_client  # no module named godoo_client
from godoo import OdooClient  # meta-package, no importable code
```

`config_from_env(prefix="ODOO")` reads:
- `ODOO_URL`
- `ODOO_DB` or `ODOO_DATABASE` (either accepted)
- `ODOO_USER` or `ODOO_USERNAME` (either accepted)
- `ODOO_PASSWORD`

This matches the REQUIREMENTS.md naming (`ODOO_URL / ODOO_DATABASE / ODOO_USERNAME / ODOO_PASSWORD`). [VERIFIED from `godoo.client.config` source]

---

## fastmcp 3.3.1 Key APIs (VERIFIED from installed package)

### `FastMCP.__init__` (relevant params)

```python
FastMCP(
    name: str | None = None,
    instructions: str | None = None,
    *,
    middleware: Sequence[Middleware] | None = None,  # FastMCP Middleware, not Starlette
    # ... other params
)
```

### `FastMCP.http_app` (VERIFIED signature)

```python
def http_app(
    self,
    path: str | None = None,               # endpoint path, default "/mcp/"
    middleware: list[Middleware] | None = None,  # Starlette Middleware namedtuple
    json_response: bool | None = None,
    stateless_http: bool | None = None,    # True = no session tracking, no Mcp-Session-Id
    transport: Literal["http", "streamable-http", "sse"] = "http",
    event_store: EventStore | None = None,
    retry_interval: int | None = None,
) -> StarletteWithLifespan
```

Note: The `Middleware` in `http_app` signature is `starlette.middleware.Middleware` (confirmed from `fastmcp.server.http` module imports). [VERIFIED from source]

### Accessing HTTP headers in tool handlers

```python
# Option A: function call (returns empty dict if no HTTP context)
from fastmcp.server.dependencies import get_http_headers
headers = get_http_headers(include_all=True)  # include_all needed for x-odoo-* headers

# Option B: full request object (raises RuntimeError if no HTTP context)
from fastmcp.server.dependencies import get_http_request
request = get_http_request()
# request.state.odoo_creds  <-- set by Starlette middleware via scope["state"]

# IMPORTANT: get_http_headers() by default EXCLUDES "authorization" header.
# X-Odoo-* headers are NOT in the exclusion list and are returned normally.
```

### Stateless mode — Mcp-Session-Id suppression

From `mcp.server.streamable_http_manager` source (line 179 in transport):
```python
**({MCP_SESSION_ID_HEADER: self.mcp_session_id} if self.mcp_session_id else {})
```
In stateless mode, `mcp_session_id=None` → the header is omitted entirely. [VERIFIED from MCP SDK source AND live test]

### set_state / get_state (fastmcp Middleware, NOT used in D-3 approach)

For completeness — this is NOT the chosen approach for this phase, but documented to prevent confusion:

```python
# In FastMCP Middleware.on_request:
await context.fastmcp_context.set_state("key", value)                   # JSON-serializable
await context.fastmcp_context.set_state("key", obj, serializable=False) # non-serializable, request-scoped only

# In tool handler:
value = await ctx.get_state("key")
```

This fires at the MCP layer, after HTTP transport — cannot return HTTP 401. Not used for D-2/D-3.

---

## godoo-testcontainers API (VERIFIED from source)

```python
from godoo.testcontainers import TestHarness, StartedOdooContainer

async with TestHarness(
    modules=["base"],          # list[str] — Odoo modules to install
    snapshot=True,             # bool — cache snapshots for reuse
    cache_dir=None,            # Path | None — snapshot cache location
    database="test_odoo",      # str
    admin_password="admin",    # str
) as h:
    h.url        # str — Odoo base URL (e.g. "http://localhost:12345")
    h.client     # OdooClient (already authenticated as admin)
    h._database  # str — database name (internal, but accessible)
    h.modules    # ModuleManager
    h.properties # ConfigParameterHelper
```

`StartedOdooContainer` dataclass fields: `odoo_container, postgres_container, client, module_manager, url, database, _network`.

Note: `TestHarness.client` is an OdooClient already authenticated as admin. Tests that need to verify a DIFFERENT user's credentials should construct a separate `OdooClient(config)` pointing to `h.url`.

---

## Common Pitfalls

### Pitfall 1: Lifespan Not Started — RuntimeError on First Request

**What goes wrong:** `RuntimeError: FastMCP's StreamableHTTPSessionManager task group was not initialized.`

**Why it happens:** `create_streamable_http_app` creates a `StarletteWithLifespan`; the `lifespan()` async generator initializes `StreamableHTTPSessionManager` and its anyio task group. Without calling lifespan, the session manager has no task group.

**How to avoid:**
- Production: `uvicorn` calls lifespan automatically.
- Tests: Use `async with app.router.lifespan_context(app):` before making requests.
- If mounting as ASGI sub-app: pass `lifespan=mcp_app.lifespan` to parent Starlette.

**Warning signs:** `RuntimeError: Task group is not initialized` in test output.

### Pitfall 2: BaseHTTPMiddleware Breaks ContextVars

**What goes wrong:** Values set in a `BaseHTTPMiddleware.dispatch()` via `contextvars.ContextVar` are not visible to request handlers downstream. This is a documented Starlette limitation.

**Why it happens:** `BaseHTTPMiddleware` wraps the ASGI app in a way that breaks contextvar propagation upwards.

**How to avoid:** Use pure ASGI middleware (class with `__init__(self, app)` + `async def __call__(self, scope, receive, send)`). Write data into `scope["state"]` instead of contextvars — the scope dict propagates naturally since it's the same object passed through the chain.

**Warning signs:** `request.state.odoo_creds` is None or AttributeError inside a tool handler even though middleware ran.

### Pitfall 3: Wrong Middleware Type Passed to http_app

**What goes wrong:** Passing a `fastmcp.server.middleware.Middleware` subclass to `http_app(middleware=[...])` instead of a `starlette.middleware.Middleware` namedtuple.

**Why it happens:** fastmcp has TWO unrelated `Middleware` classes — one for the Starlette transport layer (`starlette.middleware.Middleware`) and one for the MCP protocol layer (`fastmcp.server.middleware.Middleware`). Both are in scope, and the names collide.

**How to avoid:** Always `from starlette.middleware import Middleware` for `http_app`. For MCP-layer hooks, use `mcp.add_middleware()` with a `fastmcp.server.middleware.Middleware` subclass.

### Pitfall 4: OdooClient Session Leak

**What goes wrong:** Constructing an `OdooClient` and calling `authenticate()` but not calling `aclose()` — the underlying `httpx.AsyncClient` is never closed, leaking file descriptors/connections.

**Why it happens:** The `godoo.testcontainers` cleanup log explicitly notes this: "logout() only clears the in-memory session; aclose() releases the underlying httpx.AsyncClient pool."

**How to avoid:** Always use `async with OdooClient(config) as client:`. If explicit construction is needed, use `try/finally: await client.aclose()`.

### Pitfall 5: Accessing `x-odoo-*` Headers via `get_http_headers()` Without `include_all=True`

**What goes wrong:** `get_http_headers()` by default excludes `authorization` and several protocol headers. Custom `X-Odoo-*` headers are NOT excluded but will be returned lowercased as `x-odoo-url`, `x-odoo-database`, etc.

**Why it happens:** The exclusion list only targets specific protocol headers. X-Odoo-* headers pass through normally. However, the dict keys are always lowercase.

**How to avoid:** Use `get_http_headers(include_all=True)` when you want to read ALL custom headers, or rely on the documented behavior that `x-odoo-*` headers are not excluded. Always look up headers with lowercase keys: `headers.get("x-odoo-url")` not `headers.get("X-Odoo-Url")`.

### Pitfall 6: scope["state"] Key Not Initialized Before Middleware Sets It

**What goes wrong:** `scope.setdefault("state", {})` — if omitted, `scope["state"]` may not exist and assignment raises `KeyError`.

**How to avoid:** Always call `scope.setdefault("state", {})` before writing to `scope["state"]` in pure ASGI middleware.

---

## Validation Architecture

> `nyquist_validation: true` — this section is required.

### Test Framework

| Property | Value |
|----------|-------|
| Framework | pytest 9.0.3 + pytest-asyncio 1.4.0 |
| Config file | `pyproject.toml [tool.pytest.ini_options]` |
| Quick run command | `uv run pytest -m "not integration" --tb=short` |
| Full suite command (no Docker) | `uv run pytest -m "not integration"` |
| Integration suite command | `uv run pytest -m integration --tb=short` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File |
|--------|----------|-----------|-------------------|------|
| TRANS-01 | No `Mcp-Session-Id` in any response header | unit | `uv run pytest tests/test_transport.py::test_no_session_id -x` | Wave 0 |
| TRANS-01 | `stateless_http=True` verified in app config | unit | `uv run pytest tests/test_transport.py::test_stateless_mode -x` | Wave 0 |
| TRANS-02 | `POST /mcp` with `tools/list` returns 200 + valid MCP response | unit | `uv run pytest tests/test_transport.py::test_tools_list -x` | Wave 0 |
| TRANS-02 | Full connect→list→call→Odoo vertical | integration | `uv run pytest tests/integration/test_vertical.py -m integration -x` | Wave 0 |
| AUTH-01 | `X-Odoo-*` headers resolve credentials in tool handler | unit | `uv run pytest tests/test_credentials.py::test_headers_resolve -x` | Wave 0 |
| AUTH-02 | Env var fallback when no headers | unit | `uv run pytest tests/test_credentials.py::test_env_fallback -x` | Wave 0 |
| AUTH-02 | Headers take precedence over env vars | unit | `uv run pytest tests/test_credentials.py::test_header_precedence -x` | Wave 0 |
| AUTH-03 | Missing all creds → HTTP 401 with enumerated missing fields | unit | `uv run pytest tests/test_credentials.py::test_missing_creds_401 -x` | Wave 0 |
| AUTH-03 | Partial missing creds (e.g. only URL set) → HTTP 401 listing the missing ones | unit | `uv run pytest tests/test_credentials.py::test_partial_missing_creds -x` | Wave 0 |
| AUTH-04 | Two concurrent requests with different creds see isolated OdooClient | integration | `uv run pytest tests/integration/test_vertical.py::test_concurrent_isolation -m integration -x` | Wave 0 |

### Test Strategy for AUTH-04 (Concurrency Isolation)

AUTH-04 cannot be fully validated without a real Odoo (unit-level mock would only prove the test, not the isolation). The integration test approach:

1. Boot TestHarness with real Odoo (session fixture).
2. Create a second Odoo user with different credentials.
3. Fire two concurrent `asyncio.gather()` calls each passing different `X-Odoo-*` headers.
4. Assert each response contains the UID matching the respective user.

```python
@pytest.mark.integration
async def test_concurrent_isolation(odoo_harness, mcp_client):
    """AUTH-04: Two concurrent requests with different creds see different UIDs."""
    # ... create second user in Odoo ...
    results = await asyncio.gather(
        call_whoami(mcp_client, url=odoo_harness.url, db="test_odoo", username="admin", password="admin"),
        call_whoami(mcp_client, url=odoo_harness.url, db="test_odoo", username="user2", password="pass2"),
    )
    assert results[0]["uid"] != results[1]["uid"], "Cross-user bleed detected"
```

### Sampling Rate

- **Per task commit:** `uv run pytest -m "not integration" --tb=short`
- **Per wave merge:** `uv run pytest -m "not integration"` (full non-integration suite)
- **Phase gate:** Full non-integration suite green locally; integration suite green in CI

### Wave 0 Gaps (files to create before implementation)

- [ ] `tests/test_transport.py` — covers TRANS-01, TRANS-02 (unit)
- [ ] `tests/test_credentials.py` — covers AUTH-01, AUTH-02, AUTH-03 (unit, no Odoo)
- [ ] `tests/integration/__init__.py` — package marker
- [ ] `tests/integration/conftest.py` — `TestHarness` session fixture, `mcp_client_factory`
- [ ] `tests/integration/test_vertical.py` — covers TRANS-02 (integration), AUTH-04

---

## Security Domain

> `security_enforcement: true`, `security_asvs_level: 1`

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | Yes — Odoo creds validated per-request | `OdooClient.authenticate()` with real Odoo — no custom auth logic |
| V3 Session Management | No — explicitly stateless; no session state | `stateless_http=True` eliminates sessions |
| V4 Access Control | No — Odoo enforces ACL; server trusts incoming creds | Auth boundary: server consumes creds, never generates them |
| V5 Input Validation | Yes — credential fields from headers/env | `OdooClientConfig` constructor validates non-empty strings; missing fields caught in middleware |
| V6 Cryptography | No | No crypto in this server; credentials transmitted via HTTPS in production |

### Known Threat Patterns for this Stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Header spoofing (attacker sends `X-Odoo-*` with victim's creds) | Spoofing | Documented in threat model (REL-04); godoo-proxy strips/rewrites headers in SaaS deployments; out of scope for FOSS server |
| Credential logging in error messages | Information Disclosure | Never log password values; enumerate missing fields, not present values |
| Transport-layer credential sniffing | Tampering | HTTPS enforced in production by reverse proxy; not godoo-mcp-server's responsibility |
| Cross-user bleed via shared OdooClient | Elevation of Privilege | Per-request `OdooClient` construction; no module-global state |
| Denial of Service via expensive Odoo calls | Denial of Service | Rate limiting is Phase 6 (CODE-05); not in scope for Phase 2 |

### Phase 2 Security Checklist

- [ ] Credentials NEVER logged (including in `__repr__` of `OdooCredentials` — override or use `@dataclass(eq=False)` without `__repr__`)
- [ ] HTTP 401 body enumerates MISSING fields only — never echo back supplied credential values
- [ ] `X-Odoo-Password` treated as sensitive: never appear in logs, tracebacks, or error messages
- [ ] mypy --strict enforced — type annotations prevent accidental credential leakage through untyped dicts

---

## Runtime State Inventory

Phase 2 is a greenfield addition to the skeleton — no rename, no migration. No runtime state items apply.

**None found in all categories** — Phase 2 adds new modules with no existing runtime state to migrate.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Python 3.14 | godoo-client >= 3.14 | Yes | 3.14.5 | — |
| Docker | Integration tests (TestHarness) | Installed but NOT running | 29.3.0 CLI | Integration tests run in CI where Docker is available |
| fastmcp | MCP server | Yes (in .venv) | 3.3.1 | — |
| uvicorn | ASGI runner | Yes (transitive) | 0.48.0 | — |
| godoo-client | Odoo RPC | Yes (in .venv) | 0.2.1 | — |
| httpx | In-process testing | Yes (in .venv) | 0.28.1 | — |
| godoo-testcontainers | Integration tests | Not yet installed | 0.2.1 on PyPI | CI integration job adds Docker runner |

**Missing dependencies with no fallback:** none — Docker not running locally is acceptable since integration tests run in CI.

**Missing dependencies with fallback:** godoo-testcontainers (not yet in pyproject.toml dev deps — added in Wave 0 pyproject changes).

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `get_http_request()` inside a fastmcp tool handler returns the same Starlette `Request` object whose `scope["state"]` was written by upstream Starlette middleware | Architecture Patterns, Pattern 1 | If wrong: tool handlers cannot read `request.state.odoo_creds`; fallback is `fastmcp.Middleware` + `ctx.set_state(serializable=False)` approach |
| A2 | `godoo-testcontainers 0.2.1` on PyPI has the same API as the source in `../godoo-py` | Standard Stack, Pattern 5 | If wrong: import paths or `TestHarness` constructor signature differ; fix by pinning exact version and reading PyPI wheel contents |
| A3 | `http_app(middleware=[Middleware(PureASGIClass)])` fires middleware BEFORE the MCP protocol handler processes the request body | Architecture Patterns | If wrong: HTTP 401 may not be achievable before MCP processing; fallback is FastMCP middleware + `AuthorizationError` (MCP-level error instead of HTTP 401) |

**Notes on A1 (highest risk):** The evidence is strong — `Request.state` reads from `scope["state"]` (Starlette source verified), and the MCP SDK builds `Request(scope, receive)` from the same ASGI `scope`. However, this is not tested end-to-end with Phase 2's specific middleware setup. Wave 1 should include a unit test that asserts `request.state.odoo_creds` is set correctly from a middleware-injected scope, using `httpx.ASGITransport`.

---

## Open Questions (RESOLVED)

1. **`scope["state"]` propagation end-to-end validation**
   - What we know: Starlette `Request.state` reads from `scope["state"]`; MCP SDK creates `Request(scope, receive)` from the ASGI scope.
   - What's unclear: No live end-to-end test in research session confirmed that `get_http_request().state.odoo_creds` is accessible in a tool handler after middleware injection.
   - Recommendation: Wave 0 must include a `test_credentials.py::test_headers_resolve` that asserts this end-to-end before any tool logic is built.

2. **`godoo-testcontainers` vs local PyPI version**
   - What we know: Local source is `0.2.0`; PyPI is `0.2.1`.
   - What's unclear: Whether the API changed between 0.2.0 and 0.2.1.
   - Recommendation: Pin to `>=0.2.1,<0.3` and use PyPI (D-5). Do not path-depend on `../godoo-py`.

3. **mypy --strict on pure ASGI middleware class**
   - What we know: `Scope`, `Receive`, `Send` from `starlette.types` are typed.
   - What's unclear: Whether mypy --strict requires explicit return type annotations on `__call__` (returns `None` implicitly).
   - Recommendation: Annotate `async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None`.

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| SSE transport (Server-Sent Events) | Streamable HTTP (`transport="http"`) | MCP 2025 spec | SSE is deprecated for remote deployments; Streamable HTTP is bidirectional and resumable |
| FastMCP 1.x (bundled in `mcp` SDK) | PrefectHQ/fastmcp 3.x (standalone) | 2024 fork | Standalone has richer feature set: composition, middleware, proxy, auth hooks |
| Stateful sessions (Mcp-Session-Id) | `stateless_http=True` | fastmcp 3.x | Required for horizontal scaling; single-process uvicorn makes this trivial |
| `base64` module for binary fields | `OdooClient.read_binary()` | godoo-client 0.2.x | Handles False→b"" conversion and validation |

**Deprecated/outdated:**

- `BaseHTTPMiddleware` for contextvar-sensitive middleware — use pure ASGI instead.
- `gunicorn` + uvicorn workers — stateless design makes this unnecessary and harmful.
- `godoo` meta-package as a dependency — no importable code; use `godoo-client` directly.

---

## Sources

### Primary (HIGH confidence — verified from source or live execution)

- `fastmcp` 3.3.1 installed package — `http_app()`, `add_middleware()`, `Middleware`, `MiddlewareContext`, `Context.set_state/get_state`, `get_http_headers()`, `get_http_request()` — inspected via `inspect.getsource()` in this session
- `mcp` SDK installed package — `StreamableHTTPSessionManager._handle_stateless_request()`, `mcp_session_id=None` → no session ID header — inspected via source
- `starlette` installed package — `Request.state` reads from `scope["state"]` — inspected via source
- `godoo.client.client` source at `../godoo-py/packages/godoo-client/src/godoo/client/client.py` — `OdooClient` lifecycle, `OdooClientConfig` fields, `aclose()`, `__aenter__`/`__aexit__` — read directly
- `godoo.client.config` source — `config_from_env()` env var names — read directly
- `godoo.testcontainers` source at `../godoo-py/packages/godoo-testcontainers/src/` — `TestHarness`, `StartedOdooContainer`, `OdooTestContainer` — read directly
- Live test — `mcp.http_app(stateless_http=True)` with `httpx.ASGITransport` — confirmed HTTP 200, no `mcp-session-id` header, valid MCP response

### Secondary (MEDIUM confidence — official docs fetched in session)

- `gofastmcp.com/deployment/http` — `http_app()` parameters, `stateless_http`, middleware list, uvicorn deployment
- `gofastmcp.com/servers/context` — `Context.set_state()`, `serializable=False`, async API
- `gofastmcp.com/servers/middleware` — `Middleware` base class, `MiddlewareContext`, `add_middleware()`, hooks
- `gofastmcp.com/servers/dependency-injection` — `get_http_request()`, `get_http_headers()`, `CurrentRequest()`
- `starlette.io/middleware/` — pure ASGI middleware pattern, `scope["state"]`, contextvar propagation difference

### Tertiary (MEDIUM — GitHub issues, confirmed real problems)

- `github.com/PrefectHQ/fastmcp/issues/3156` — `set_state` v3 breaking change (async, serializable=False)
- `github.com/PrefectHQ/fastmcp/issues/3397` — context state from parent middleware not visible in mounted child tools
- `github.com/jlowin/fastmcp/issues/817` — `BaseHTTPMiddleware` header propagation issue

---

## Metadata

**Confidence breakdown:**

- Standard stack: HIGH — all packages inspected from installed source or PyPI metadata
- fastmcp API surface: HIGH — inspected from installed package in project venv
- OdooClient lifecycle: HIGH — read from source in godoo-py monorepo
- Pure ASGI credential injection: HIGH (pattern) / MEDIUM (end-to-end propagation not live-tested)
- godoo-testcontainers integration: HIGH — source-read; PyPI 0.2.1 confirmed
- Pitfalls: HIGH — most confirmed from live error or GitHub issues

**Research date:** 2026-06-02
**Valid until:** 2026-07-02 (fastmcp 3.x active development; re-verify if 3.4+ releases)
