# Phase 2: Skeleton Server - Pattern Map

**Mapped:** 2026-06-02
**Files analyzed:** 9 new/modified files
**Analogs found:** 3 with in-repo analogs / 9 total (6 reference external source)

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/godoo_mcp_server/server.py` | provider (ASGI app factory) | request-response | No in-repo analog — see RESEARCH.md Pattern 2 | no-analog |
| `src/godoo_mcp_server/credentials.py` | middleware + config | request-response | No in-repo analog — see RESEARCH.md Pattern 1 + `godoo.client.config` | no-analog |
| `src/godoo_mcp_server/tools/probe.py` | tool handler | request-response | No in-repo analog — see RESEARCH.md Pattern 3 | no-analog |
| `src/godoo_mcp_server/__main__.py` | entrypoint | request-response | `src/godoo_mcp_server/__main__.py` (Phase 1 skeleton — modify) | role-match |
| `pyproject.toml` | config | — | `pyproject.toml` (Phase 1 — modify) | exact |
| `.github/workflows/ci.yml` | config | — | `.github/workflows/ci.yml` (Phase 1 — modify) | exact |
| `tests/test_transport.py` | test | request-response | `tests/test_placeholder.py` (Phase 1 — new sibling) | role-match |
| `tests/test_credentials.py` | test | request-response | `tests/test_placeholder.py` + godoo-py `tests/integration/test_crud.py` | partial-match |
| `tests/integration/conftest.py` | test fixture | event-driven | `../godoo-py/tests/conftest.py` | role-match |
| `tests/integration/test_vertical.py` | test | request-response | `../godoo-py/tests/integration/test_crud.py` | partial-match |

---

## Pattern Assignments

### `src/godoo_mcp_server/server.py` (provider, request-response)

**Analog:** RESEARCH.md Pattern 2 (no in-repo analog exists)

**Imports pattern** (from RESEARCH.md lines 284-287):
```python
from fastmcp import FastMCP
from starlette.middleware import Middleware
from godoo_mcp_server.credentials import CredentialMiddleware
```

**Core pattern — FastMCP instance + ASGI wiring** (RESEARCH.md lines 289-302):
```python
mcp = FastMCP(
    "godoo-mcp-server",
    instructions="Stateless MCP server for Odoo. Per-request credentials via X-Odoo-* headers.",
)

# Import tools to register them on the mcp instance (side-effect import, not usage)
from godoo_mcp_server.tools import probe  # noqa: F401, E402

def create_app() -> object:  # returns StarletteWithLifespan
    return mcp.http_app(
        stateless_http=True,
        middleware=[Middleware(CredentialMiddleware)],
    )
```

**Critical constraints:**
- `mcp` object MUST live in this module (importable by `__main__.py` and by tool modules that decorate against it)
- `http_app(stateless_http=True)` is mandatory — TRANS-01 requires no `Mcp-Session-Id` emission
- `middleware=` takes `starlette.middleware.Middleware` namedtuples, NOT `fastmcp.server.middleware.Middleware` — these are different types with different semantics (RESEARCH.md lines 619-625)
- `create_app()` return type annotation: `object` is mypy-safe since `StarletteWithLifespan` is a private fastmcp type; alternatively annotate as `Any` with a `# type: ignore` if mypy --strict rejects `object`
- Tool modules import `mcp` from this module to register tools via `@mcp.tool(...)` decorator

**No error handling needed** — `FastMCP()` and `http_app()` do not raise on construction; errors surface at runtime via the ASGI app.

---

### `src/godoo_mcp_server/credentials.py` (middleware + config, request-response)

**Analog:** RESEARCH.md Pattern 1 + `../godoo-py/packages/godoo-client/src/godoo/client/config.py` (lines 14-53)

**Imports pattern** (RESEARCH.md lines 201-207):
```python
from __future__ import annotations

import os
from dataclasses import dataclass
from starlette.types import ASGIApp, Scope, Receive, Send
from starlette.responses import JSONResponse
```

**OdooCredentials dataclass** (RESEARCH.md lines 209-212 + security note from lines 742-743):
```python
@dataclass
class OdooCredentials:
    url: str
    database: str
    username: str
    password: str
    # SECURITY: Do NOT generate __repr__ that includes password.
    # Use @dataclass(repr=False) or override __repr__ to redact.
```

**Core middleware class — pure ASGI pattern** (RESEARCH.md lines 215-277):
```python
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

        scope.setdefault("state", {})
        assert url and database and username and password
        scope["state"]["odoo_creds"] = OdooCredentials(
            url=url, database=database, username=username, password=password
        )
        await self._app(scope, receive, send)
```

**Pattern notes:**
- `scope.setdefault("state", {})` MUST precede any write to `scope["state"]` (Pitfall 6, RESEARCH.md lines 643-646)
- `scope["type"] != "http"` guard: pass WebSocket/lifespan events directly without credential checks
- Enumeration: 401 body lists MISSING field names only — NEVER echo the supplied credential values (security requirement, RESEARCH.md lines 736-737)
- Analog for the missing-field enumeration logic: `../godoo-py/packages/godoo-client/src/godoo/client/config.py` lines 26-41 shows the same "collect missing list, raise if non-empty" pattern (copied here to HTTP 401 instead of an exception)

**mypy --strict note:** Annotate `async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None` explicitly — mypy strict requires explicit return type even for `None` (RESEARCH.md open question 3, line 800).

---

### `src/godoo_mcp_server/tools/probe.py` (tool handler, request-response)

**Analog:** RESEARCH.md Pattern 3 (no in-repo analog exists)

**Imports pattern** (RESEARCH.md lines 325-330):
```python
from godoo.client.client import OdooClient, OdooClientConfig
from fastmcp import Context
from fastmcp.server.dependencies import get_http_request
from godoo_mcp_server.server import mcp
from godoo_mcp_server.credentials import OdooCredentials
```

**Core pattern — per-request OdooClient** (RESEARCH.md lines 332-346):
```python
@mcp.tool(
    name="odoo_whoami",
    description="[Probe] Authenticate and return uid + db. Throwaway — Phase 3 removes this.",
)
async def odoo_whoami(ctx: Context) -> dict[str, object]:
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

**Anti-patterns to never use** (RESEARCH.md lines 350-358):
```python
# WRONG: module-level singleton — all users share the same session
_client: OdooClient | None = None  # NEVER DO THIS

# WRONG: construct without aclose — leaks httpx transport
async def bad_tool() -> None:
    client = OdooClient(config)
    await client.authenticate()
    # no aclose() -> file descriptor leak
```

**OdooClient lifecycle** (confirmed from `../godoo-py/packages/godoo-client/src/godoo/client/client.py` lines 542-565):
- `__aenter__` calls `authenticate()` (line 544) — do NOT call `authenticate()` separately before `async with`
- `__aexit__` calls `aclose()` always, preserves body exception if both fail (lines 558-565)
- `get_session()` returns `OdooSessionInfo | None` — non-None after successful `async with` entry (line 119)
- `OdooSessionInfo` has fields `uid` (int), `session_id` (str), `db` (str) — confirmed from `rpc/__init__.py` re-exports

**mypy --strict note:** `request.state.odoo_creds` requires `# type: ignore[attr-defined]` since `State` is dynamically typed in Starlette. The `OdooCredentials` type annotation on the local variable documents the expected type for mypy's narrowing downstream.

---

### `src/godoo_mcp_server/__main__.py` (entrypoint, request-response) — MODIFY

**Analog:** `src/godoo_mcp_server/__main__.py` (Phase 1, lines 1-18 — full file)

**Current Phase 1 content** (lines 1-18):
```python
"""godoo-mcp-server CLI entrypoint."""

import sys

from godoo_mcp_server import __version__

def main() -> None:
    """Print version and exit (Phase 1 scaffold only)."""
    if "--version" in sys.argv:
        print(f"godoo-mcp-server {__version__}")
        sys.exit(0)
    print("godoo-mcp-server: use --version or start the MCP server (Phase 2+)")
    sys.exit(1)

if __name__ == "__main__":
    main()
```

**Phase 2 modification pattern** (RESEARCH.md lines 305-315):
- Keep the `--version` branch unchanged
- Replace the `else` branch (currently `sys.exit(1)`) with uvicorn startup
- Import `create_app` from `server.py` — NOT the `mcp` object directly
- Do NOT define the `FastMCP` object here

```python
# Phase 2 else branch addition:
import uvicorn
from godoo_mcp_server.server import create_app

# In main():
    app = create_app()
    uvicorn.run(app, host="0.0.0.0", port=8000)
```

**Note:** `uvicorn` is a transitive dependency (pulled by `fastmcp`/`mcp`) — no explicit pyproject.toml entry needed.

---

### `pyproject.toml` (config) — MODIFY

**Analog:** `pyproject.toml` (Phase 1, lines 1-48 — full file)

**Phase 2 additions:**

```toml
# Add to [dependency-groups] dev:
"godoo-testcontainers>=0.2,<0.3",

# Add to [tool.pytest.ini_options]:
markers = ["integration: marks tests as requiring a live Odoo container (deselect with -m 'not integration')"]
addopts = "--tb=short -m 'not integration'"  # override Phase 1 addopts

# Add to [[tool.mypy.overrides]] (new entry):
[[tool.mypy.overrides]]
module = "godoo.testcontainers.*"
ignore_missing_imports = true
```

**Existing patterns to preserve** (lines 1-48):
- `uv_build` build backend (line 2-3) — do not change
- `requires-python = ">=3.14"` (line 10) — do not change
- `fastmcp>=3.3,<4` and `godoo-client>=0.2,<0.3` already in `dependencies` (lines 13-14)
- `asyncio_mode = "auto"` (line 45) — preserve; all async tests work without per-test decorators
- `testpaths = ["tests"]` (line 46) — preserve; covers both `tests/` and `tests/integration/` transitively

---

### `.github/workflows/ci.yml` (config) — MODIFY

**Analog:** `.github/workflows/ci.yml` (Phase 1, lines 1-41 — full file)

**Phase 2 addition — separate integration job** (CONTEXT.md line 97, RESEARCH.md lines 662-677):

The existing `ci` job remains unchanged. A new `integration` job is added:

```yaml
  integration:
    runs-on: ubuntu-latest
    needs: ci  # only run if unit tests pass
    steps:
      - uses: actions/checkout@v4

      - name: Install uv
        uses: astral-sh/setup-uv@v5
        with:
          version: "latest"

      - name: Set up Python 3.14
        uses: actions/setup-python@v5
        with:
          python-version: "3.14"

      - name: Install dependencies (with dev extras)
        run: uv sync --frozen --dev

      - name: Run integration tests
        run: uv run pytest -m integration --tb=short
```

**Snapshot cache pattern** (CONTEXT.md line 30 — `cache_dir` pointed at GitHub Actions cache):
```yaml
      - name: Cache Odoo snapshots
        uses: actions/cache@v4
        with:
          path: ~/.cache/godoo-testcontainers
          key: odoo-snapshot-${{ hashFiles('pyproject.toml') }}
          restore-keys: odoo-snapshot-
```

---

### `tests/test_transport.py` (test, request-response) — NEW

**Analog:** `tests/test_placeholder.py` (Phase 1, lines 1-8) + RESEARCH.md Pattern 4

**Imports pattern** (RESEARCH.md lines 366-370):
```python
import pytest
from httpx import ASGITransport, AsyncClient
from godoo_mcp_server.server import create_app
```

**Lifespan fixture pattern** (RESEARCH.md lines 366-379 — critical, must not omit lifespan):
```python
@pytest.fixture
async def mcp_client():
    """In-process MCP client with lifespan managed.

    IMPORTANT: lifespan_context must be entered before requests.
    Without it: RuntimeError: Task group is not initialized.
    """
    app = create_app()
    async with app.router.lifespan_context(app):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            yield client
```

**Standard MCP headers** (RESEARCH.md lines 382-387):
```python
STANDARD_MCP_HEADERS = {
    "content-type": "application/json",
    "accept": "application/json, text/event-stream",
    "mcp-protocol-version": "2024-11-05",
}
# Full credential headers for tests that need them:
ODOO_CRED_HEADERS = {
    "x-odoo-url": "http://odoo.test",
    "x-odoo-database": "testdb",
    "x-odoo-username": "admin",
    "x-odoo-password": "admin",
}
```

**Test pattern for TRANS-01** (no `Mcp-Session-Id`):
```python
async def test_no_session_id(mcp_client) -> None:
    resp = await mcp_client.post(
        "/mcp/",
        json={"jsonrpc": "2.0", "method": "tools/list", "params": {}, "id": 1},
        headers={**STANDARD_MCP_HEADERS, **ODOO_CRED_HEADERS},
    )
    assert "mcp-session-id" not in resp.headers
```

**Phase 1 test structure to copy** (`tests/test_placeholder.py` lines 1-8):
- Module docstring explaining coverage
- Plain `def` or `async def` functions (no class grouping needed for small test files)
- Type annotations on all test functions (`-> None`)
- No `@pytest.mark.asyncio` needed — `asyncio_mode = "auto"` handles it

---

### `tests/test_credentials.py` (test, request-response) — NEW

**Analog:** `tests/test_placeholder.py` structure + RESEARCH.md Pattern 1 (credential logic)

**Pattern for AUTH-03 (missing credentials → 401):**
```python
async def test_missing_creds_401(mcp_client_no_creds) -> None:
    """AUTH-03: Request with no credentials returns HTTP 401 with enumerated missing fields."""
    resp = await mcp_client_no_creds.post(
        "/mcp/",
        json={"jsonrpc": "2.0", "method": "tools/list", "params": {}, "id": 1},
        headers=STANDARD_MCP_HEADERS,  # no X-Odoo-* headers, no env vars
    )
    assert resp.status_code == 401
    body = resp.json()
    assert body["error"] == "missing_credentials"
    assert len(body["missing"]) == 4  # all four fields missing
    assert any("X-Odoo-Url" in m for m in body["missing"])
```

**Pattern for AUTH-02 (env var fallback):**
- Use `monkeypatch.setenv("ODOO_URL", "...")` to set env vars in the test
- Send a request with no `X-Odoo-*` headers
- Assert credentials are accepted (non-401 response from transport layer)

**Pattern for AUTH-04 unit portion (headers take precedence):**
- Set env vars via `monkeypatch`
- Send request with `X-Odoo-*` headers containing different values
- Assert header values win (verifiable via `probe` tool response if mocked, or by observing 401 absence)

**Note on testing credential injection:** Unit tests for AUTH-01/02 that verify `request.state.odoo_creds` is set correctly cannot use a mock Odoo — they verify the middleware injects correctly by making `tools/list` succeed (non-401) with given headers. AUTH-04 concurrency isolation requires integration (real Odoo UIDs).

---

### `tests/integration/conftest.py` (test fixture, event-driven) — NEW

**Analog:** `../godoo-py/tests/conftest.py` (lines 1-21) + RESEARCH.md Pattern 5

**Session fixture pattern** (godoo-py `tests/conftest.py` lines 7-15, adapted for `TestHarness`):
```python
from __future__ import annotations

import pytest
import pytest_asyncio
from godoo.testcontainers import TestHarness
from httpx import ASGITransport, AsyncClient
from godoo_mcp_server.server import create_app

@pytest_asyncio.fixture(scope="session")
async def odoo_harness():
    """Session-scoped real Odoo container — starts once, shared across all integration tests."""
    async with TestHarness(
        modules=["base"],
        snapshot=True,
        database="test_odoo",
        admin_password="admin",
    ) as h:
        yield h
```

**`mcp_client_factory` fixture** (needed by `test_vertical.py`, RESEARCH.md lines 408-425):
```python
@pytest_asyncio.fixture(scope="session")
async def mcp_app_with_lifespan():
    """Session-scoped ASGI app with lifespan started."""
    app = create_app()
    async with app.router.lifespan_context(app):
        yield app

@pytest.fixture
def mcp_client_factory(mcp_app_with_lifespan):
    """Factory: creates an AsyncClient with per-call X-Odoo-* headers."""
    def _make(*, url: str, database: str, username: str, password: str) -> AsyncClient:
        return AsyncClient(
            transport=ASGITransport(app=mcp_app_with_lifespan),
            base_url="http://test",
            headers={
                "x-odoo-url": url,
                "x-odoo-database": database,
                "x-odoo-username": username,
                "x-odoo-password": password,
                **STANDARD_MCP_HEADERS,
            },
        )
    return _make
```

**Key difference from godoo-py conftest:** godoo-py uses `OdooTestContainer.start()` directly (lines 4-15); Phase 2 uses `TestHarness` which wraps that and adds snapshot caching (CONTEXT.md line 29).

**`pytest_asyncio.fixture` vs `pytest.fixture`:** Use `pytest_asyncio.fixture` for all `async def` fixtures — required with `pytest-asyncio` 1.4.x. Plain `pytest.fixture` on `async def` silently does nothing in older asyncio modes; explicit `pytest_asyncio.fixture` is unambiguous.

---

### `tests/integration/test_vertical.py` (test, request-response) — NEW

**Analog:** `../godoo-py/tests/integration/test_crud.py` (lines 1-51) + RESEARCH.md Pattern 5

**Test class structure** (from godoo-py `test_crud.py` lines 11-50):
```python
from __future__ import annotations

import asyncio
import pytest

@pytest.mark.integration
class TestVerticalSlice:
    async def test_tools_list(self, mcp_client_factory, odoo_harness) -> None:
        """TRANS-02: tools/list returns 200 with valid MCP response against real Odoo."""
        ...

    async def test_full_vertical(self, mcp_client_factory, odoo_harness) -> None:
        """TRANS-02: full connect->list->call->Odoo path end-to-end."""
        ...

    async def test_concurrent_isolation(self, mcp_client_factory, odoo_harness) -> None:
        """AUTH-04: Two concurrent requests with different creds see different UIDs."""
        ...
```

**AUTH-04 concurrency pattern** (RESEARCH.md lines 689-698):
```python
async def test_concurrent_isolation(self, mcp_client_factory, odoo_harness) -> None:
    results = await asyncio.gather(
        call_whoami(mcp_client_factory(..., username="admin", password="admin")),
        call_whoami(mcp_client_factory(..., username="user2", password="pass2")),
    )
    assert results[0]["uid"] != results[1]["uid"], "Cross-user bleed detected"
```

**`@pytest.mark.integration` on class** (godoo-py `test_crud.py` line 11): applying the marker at class level covers all methods in the class — same approach used here.

---

## Shared Patterns

### Module-level `from __future__ import annotations`
**Source:** `../godoo-py/packages/godoo-client/src/godoo/client/client.py` line 1, `harness.py` line 1
**Apply to:** All new Python modules in `src/godoo_mcp_server/`
```python
from __future__ import annotations
```
This enables PEP 563 postponed evaluation of annotations — required for forward references and consistent with the godoo-py monorepo style observed across all its modules.

### TYPE_CHECKING guard for heavy imports
**Source:** `../godoo-py/packages/godoo-client/src/godoo/client/client.py` lines 22-33
**Apply to:** Any module that only needs a type at annotation time (not runtime)
```python
from __future__ import annotations
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from some.expensive.module import SomeType
```
This avoids circular imports and reduces import-time cost. The `from __future__ import annotations` makes all annotations strings at runtime, so `TYPE_CHECKING` blocks are safe.

### dataclass for config/credentials
**Source:** `../godoo-py/packages/godoo-client/src/godoo/client/client.py` lines 83-91 (`OdooClientConfig`)
**Apply to:** `OdooCredentials` in `credentials.py`
```python
@dataclass
class OdooClientConfig:
    url: str
    database: str
    username: str
    password: str
    # optional fields use field(default=...)
    safety: SafetyContext | None = field(default=None)
```
Phase 2's `OdooCredentials` follows this exact shape (4 required string fields). Add `repr=False` or override `__repr__` to prevent password leakage in logs/tracebacks.

### async context manager for resource lifecycle
**Source:** `../godoo-py/packages/godoo-client/src/godoo/client/client.py` lines 541-565
**Apply to:** `tools/probe.py` (OdooClient usage), `tests/integration/conftest.py` (TestHarness usage)
```python
async with OdooClient(config) as client:
    # __aenter__ called authenticate(); __aexit__ will call aclose()
    session = client.get_session()
    assert session is not None
```

### pytest.mark.integration on all integration tests
**Source:** `../godoo-py/tests/integration/test_crud.py` line 11
**Apply to:** All tests in `tests/integration/`
```python
@pytest.mark.integration
class TestFoo:  # or @pytest.mark.integration on individual async def test_*
    ...
```
The `addopts = "-m 'not integration'"` in `pyproject.toml` means integration tests are skipped by default; the CI integration job passes `-m integration` explicitly.

### Type annotations on all test functions
**Source:** `tests/test_placeholder.py` line 4 (`def test_package_importable() -> None:`)
**Apply to:** All new test functions/methods
```python
async def test_foo(fixture_arg: SomeType) -> None:
    ...
```
Required for mypy --strict on test files if mypy is configured to check `tests/`. Check `pyproject.toml [tool.mypy]` for whether tests are in scope.

---

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `src/godoo_mcp_server/server.py` | provider | request-response | No MCP server or ASGI app factory exists in this repo yet. RESEARCH.md Pattern 2 is the reference. |
| `src/godoo_mcp_server/credentials.py` | middleware | request-response | No Starlette middleware exists in this repo. RESEARCH.md Pattern 1 is the reference; `godoo.client.config.config_from_env` provides the missing-field enumeration analog. |
| `src/godoo_mcp_server/tools/probe.py` | tool handler | request-response | No tool handlers exist yet. RESEARCH.md Pattern 3 is the reference. |
| `tests/integration/` (all files) | test | event-driven | No integration test infrastructure exists in this repo. `../godoo-py/tests/` is the closest external analog. |

---

## Metadata

**Analog search scope:** `src/godoo_mcp_server/`, `tests/`, `.github/workflows/`, `../godoo-py/packages/godoo-client/src/`, `../godoo-py/packages/godoo-testcontainers/src/`, `../godoo-py/tests/`
**Files scanned:** 12 (in-repo: 6; godoo-py sibling: 6)
**Pattern extraction date:** 2026-06-02
**RESEARCH.md patterns consumed:** Pattern 1 (CredentialMiddleware), Pattern 2 (server.py/ASGI wiring), Pattern 3 (per-request OdooClient), Pattern 4 (httpx ASGITransport fixture), Pattern 5 (TestHarness integration fixture)
