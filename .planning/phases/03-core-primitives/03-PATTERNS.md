# Phase 3: Core Primitives - Pattern Map

**Mapped:** 2026-06-02
**Files analyzed:** 9 new/modified files
**Analogs found:** 9 / 9 (all have in-repo analogs; probe.py is the primary template)

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/godoo_mcp_server/tools/users.py` | tool handler | request-response | `src/godoo_mcp_server/tools/probe.py` | exact |
| `src/godoo_mcp_server/tools/records.py` | tool handler | request-response | `src/godoo_mcp_server/tools/probe.py` | exact |
| `src/godoo_mcp_server/tools/discovery.py` | tool handler | request-response | `src/godoo_mcp_server/tools/probe.py` | exact |
| `src/godoo_mcp_server/server.py` | provider (ASGI app factory) | request-response | `src/godoo_mcp_server/server.py` (current) | exact — modify only |
| `tests/test_users.py` | test | request-response | `tests/test_credentials.py` + `tests/test_transport.py` | role-match |
| `tests/test_records.py` | test | request-response | `tests/test_credentials.py` + `tests/test_transport.py` | role-match |
| `tests/test_discovery.py` | test | request-response | `tests/test_credentials.py` + `tests/test_transport.py` | role-match |
| `tests/test_transport.py` | test | request-response | `tests/test_transport.py` (current) | exact — modify only |
| `tests/integration/test_vertical.py` | test | request-response | `tests/integration/test_vertical.py` (current) | exact — modify only |

---

## Pattern Assignments

### `src/godoo_mcp_server/tools/users.py` (tool handler, request-response)

**Analog:** `src/godoo_mcp_server/tools/probe.py` (full file, 39 lines)

**Imports pattern** (`probe.py` lines 1–19):
```python
"""users_whoami tool — returns authenticated identity from session."""

from __future__ import annotations

from typing import TYPE_CHECKING

from fastmcp import Context  # noqa: TC002  # required at runtime for pydantic schema generation
from fastmcp.exceptions import ToolError
from fastmcp.server.dependencies import get_http_request
from godoo.client.client import OdooClient, OdooClientConfig
from godoo.client.errors import OdooError

from godoo_mcp_server.server import mcp

if TYPE_CHECKING:
    from godoo_mcp_server.credentials import OdooCredentials
```

**Key difference from probe.py:** probe.py does NOT import `ToolError` or `OdooError` — it has no error handling. All Phase 3 tool modules MUST add both imports.

**Core pattern — tool decorator + credential resolution** (`probe.py` lines 21–38):
```python
@mcp.tool(
    name="users_whoami",
    description="Return the authenticated Odoo user identity (uid, username, database)."
    " username is the Odoo login value from the X-Odoo-Username header.",
)
async def users_whoami(ctx: Context) -> dict[str, object]:
    request = get_http_request()
    creds: OdooCredentials = request.state.odoo_creds  # type: ignore[attr-defined]
    config = OdooClientConfig(
        url=creds.url,
        database=creds.database,
        username=creds.username,
        password=creds.password,
    )
    try:
        async with OdooClient(config) as client:
            session = client.get_session()
            assert session is not None
            return {
                "uid": session.uid,
                "username": creds.username,   # from credentials, no extra RPC (D-12)
                "database": session.db,
            }
    except OdooError as e:
        raise ToolError(str(e)) from e
```

**Critical notes:**
- `try/except OdooError` MUST wrap the entire `async with OdooClient(config) as client:` block — authentication failures happen in `__aenter__` and would escape an inner-only try/except.
- `session_id` is NEVER returned in the response dict — it is an internal transport token (D-08, Pitfall 4).
- `username` comes from `creds.username`, not the session — `OdooSessionInfo` only has `uid`, `session_id`, `db`.
- No module-level `_client` variable — per-request construction only (AUTH-04).

---

### `src/godoo_mcp_server/tools/records.py` (tool handler, request-response)

**Analog:** `src/godoo_mcp_server/tools/probe.py` (full file, 39 lines)

**Imports pattern** (extend `probe.py` imports with `Any` and `pydantic`):
```python
"""Record operation tools: record_search, record_read, record_create, record_update, record_delete."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from fastmcp import Context  # noqa: TC002
from fastmcp.exceptions import ToolError
from fastmcp.server.dependencies import get_http_request
from godoo.client.client import OdooClient, OdooClientConfig
from godoo.client.errors import OdooError
from pydantic import BaseModel, Field

from godoo_mcp_server.server import mcp

if TYPE_CHECKING:
    from godoo_mcp_server.credentials import OdooCredentials
```

**Per-request client helper** (extract once to avoid repetition across five handlers):
```python
def _make_config(creds: OdooCredentials) -> OdooClientConfig:
    return OdooClientConfig(
        url=creds.url,
        database=creds.database,
        username=creds.username,
        password=creds.password,
    )
```

**record_search core pattern** (D-04, D-05, D-06 — one-shot search_read with default limit=80):
```python
@mcp.tool(
    name="record_search",
    description=(
        "Search records of any Odoo model using a domain filter. Returns matching records"
        " with the requested fields in a single call. domain uses raw Odoo domain syntax:"
        " list of triples, e.g. [['active','=',True]]. Pagination: pass limit + offset."
        " Default limit=80. Pass limit=None to let Odoo apply its server-side default."
    ),
)
async def record_search(
    ctx: Context,
    model: str,
    domain: list[Any] | None = None,
    fields: list[str] | None = None,
    limit: int = 80,
    offset: int = 0,
    order: str | None = None,
) -> dict[str, object]:
    request = get_http_request()
    creds: OdooCredentials = request.state.odoo_creds  # type: ignore[attr-defined]
    try:
        async with OdooClient(_make_config(creds)) as client:
            records = await client.search_read(
                model,
                domain or [],
                fields=fields,
                limit=limit,
                offset=offset,
                order=order,
            )
            return {"records": records, "count": len(records)}
    except OdooError as e:
        raise ToolError(str(e)) from e
```

**record_read core pattern** (REC-02):
```python
@mcp.tool(name="record_read", description="Read fields of specific records by id list.")
async def record_read(
    ctx: Context,
    model: str,
    ids: list[int],
    fields: list[str] | None = None,
) -> dict[str, object]:
    request = get_http_request()
    creds: OdooCredentials = request.state.odoo_creds  # type: ignore[attr-defined]
    try:
        async with OdooClient(_make_config(creds)) as client:
            records = await client.read(model, ids, fields)
            return {"records": records}
    except OdooError as e:
        raise ToolError(str(e)) from e
```

**record_create core pattern** (REC-03 — returns int or list[int]):
```python
@mcp.tool(name="record_create", description="Create a new record. Returns the new record id.")
async def record_create(
    ctx: Context,
    model: str,
    values: dict[str, Any],
) -> dict[str, object]:
    request = get_http_request()
    creds: OdooCredentials = request.state.odoo_creds  # type: ignore[attr-defined]
    try:
        async with OdooClient(_make_config(creds)) as client:
            new_id = await client.create(model, values)
            return {"id": new_id}
    except OdooError as e:
        raise ToolError(str(e)) from e
```

**record_update core pattern** (REC-04, D-03 — maps `update` → `write`):
```python
@mcp.tool(name="record_update", description="Update fields on existing records by id list.")
async def record_update(
    ctx: Context,
    model: str,
    ids: list[int],
    values: dict[str, Any],
) -> dict[str, object]:
    request = get_http_request()
    creds: OdooCredentials = request.state.odoo_creds  # type: ignore[attr-defined]
    try:
        async with OdooClient(_make_config(creds)) as client:
            ok = await client.write(model, ids, values)
            return {"success": ok}
    except OdooError as e:
        raise ToolError(str(e)) from e
```

**record_delete core pattern** (REC-05, D-03 — maps `delete` → `unlink`):
```python
@mcp.tool(name="record_delete", description="Delete records by id list.")
async def record_delete(
    ctx: Context,
    model: str,
    ids: list[int],
) -> dict[str, object]:
    request = get_http_request()
    creds: OdooCredentials = request.state.odoo_creds  # type: ignore[attr-defined]
    try:
        async with OdooClient(_make_config(creds)) as client:
            ok = await client.unlink(model, ids)
            return {"success": ok}
    except OdooError as e:
        raise ToolError(str(e)) from e
```

**Anti-pattern guard:**
- No `_client: OdooClient | None = None` at module scope — grep audit must return empty.
- `limit: int = 80` default is mandatory on `record_search` (D-06, Pitfall 3).
- `domain or []` safely handles `None` from agents that omit the domain argument.

---

### `src/godoo_mcp_server/tools/discovery.py` (tool handler, request-response)

**Analog:** `src/godoo_mcp_server/tools/probe.py` (full file, 39 lines)

**Imports pattern** (same as `records.py` above — `Any` required for `fields_get` return type):
```python
"""Discovery tools: discovery_list_models, discovery_get_fields."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from fastmcp import Context  # noqa: TC002
from fastmcp.exceptions import ToolError
from fastmcp.server.dependencies import get_http_request
from godoo.client.client import OdooClient, OdooClientConfig
from godoo.client.errors import OdooError

from godoo_mcp_server.server import mcp

if TYPE_CHECKING:
    from godoo_mcp_server.credentials import OdooCredentials
```

**discovery_list_models core pattern** (DISC-01 — `ir.model` via `search_read`, no dedicated godoo-client method):
```python
@mcp.tool(
    name="discovery_list_models",
    description=(
        "List all available Odoo models (technical name, label, description)."
        " Use discovery_get_fields to inspect a model's fields before operating on it."
    ),
)
async def discovery_list_models(ctx: Context) -> dict[str, object]:
    request = get_http_request()
    creds: OdooCredentials = request.state.odoo_creds  # type: ignore[attr-defined]
    config = OdooClientConfig(
        url=creds.url,
        database=creds.database,
        username=creds.username,
        password=creds.password,
    )
    try:
        async with OdooClient(config) as client:
            models = await client.search_read(
                "ir.model",
                [],
                fields=["model", "name", "info"],
                limit=500,   # safe cap above any realistic model count (Open Question 2)
                order="model",
            )
            return {"models": models}
    except OdooError as e:
        raise ToolError(str(e)) from e
```

**discovery_get_fields core pattern** (DISC-02 — `fields_get` with attributes filter):
```python
@mcp.tool(
    name="discovery_get_fields",
    description=(
        "Return field metadata for an Odoo model. Includes type, label, required,"
        " readonly, help text, and relational target model."
    ),
)
async def discovery_get_fields(
    ctx: Context,
    model: str,
    attributes: list[str] | None = None,
) -> dict[str, object]:
    request = get_http_request()
    creds: OdooCredentials = request.state.odoo_creds  # type: ignore[attr-defined]
    config = OdooClientConfig(
        url=creds.url,
        database=creds.database,
        username=creds.username,
        password=creds.password,
    )
    _default_attrs = ["string", "type", "required", "readonly", "help", "relation"]
    try:
        async with OdooClient(config) as client:
            fields: dict[str, Any] = await client.fields_get(
                model,
                attributes=attributes or _default_attrs,
            )
            return {"model": model, "fields": fields}
    except OdooError as e:
        raise ToolError(str(e)) from e
```

---

### `src/godoo_mcp_server/server.py` (provider, request-response) — MODIFY

**Analog:** `src/godoo_mcp_server/server.py` (current, lines 1–35 — full file)

**Modification — swap probe import for three new tool modules** (RESEARCH.md Pattern 6, D-13):

Current line 22:
```python
from godoo_mcp_server.tools import probe as _probe_module  # noqa: F401, E402
```

Phase 3 final state (replace that single line with three):
```python
from godoo_mcp_server.tools import users as _users_module      # noqa: F401, E402
from godoo_mcp_server.tools import records as _records_module  # noqa: F401, E402
from godoo_mcp_server.tools import discovery as _disc_module   # noqa: F401, E402
```

**Everything else in `server.py` stays unchanged.** `mcp = FastMCP(...)` and `create_app()` are untouched. The `noqa: F401, E402` comments are required — F401 (unused import) and E402 (module-level import not at top of file) are intentionally suppressed because these imports exist only for registration side effects.

**D-13 sequencing constraint:** Do NOT remove the `probe` import until `users_whoami` is registered, `test_vertical.py` is repointed to `users_whoami`, and CI is green. The import swap and `probe.py` deletion are the final act of the phase, not the first.

---

### `tests/test_users.py` (test, request-response) — NEW

**Analog:** `tests/test_transport.py` (lines 1–76) + `tests/test_credentials.py` (lines 1–142)

**File structure pattern** (`test_transport.py` lines 1–20):
```python
"""Unit tests for users_whoami tool (USER-01).

Covers:
  USER-01: users_whoami returns uid + username + database from a fake-creds MCP call
  ERR-01 (whoami path): OdooAuthError on bad credentials → isError=True response
"""

from __future__ import annotations

import json
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from httpx import AsyncClient
```

**SSE parser** (copy verbatim from `test_transport.py` lines 24–34 — identical in all test files):
```python
def _parse_sse_json(text: str) -> dict[str, object]:
    for line in text.splitlines():
        if line.startswith("data:"):
            return json.loads(line[len("data:") :].strip())  # type: ignore[return-value]
    return json.loads(text)  # type: ignore[return-value]
```

**Tool call body pattern** (from `test_vertical.py` lines 34–39):
```python
_WHOAMI_CALL_BODY = {
    "jsonrpc": "2.0",
    "method": "tools/call",
    "params": {"name": "users_whoami", "arguments": {}},
    "id": 1,
}
```

**Core unit test — isError=True when Odoo auth fails** (uses `mcp_client` fixture which has fake creds → no real Odoo → `OdooAuthError` → `ToolError` → `isError=True`):
```python
async def test_whoami_error_on_bad_creds(mcp_client: AsyncClient) -> None:
    """USER-01 + ERR-01: fake credentials → OdooAuthError → isError=True MCP response."""
    resp = await mcp_client.post("/mcp", json=_WHOAMI_CALL_BODY)
    assert resp.status_code == 200  # MCP transport always 200
    body = _parse_sse_json(resp.text)
    result = body.get("result", {})
    assert isinstance(result, dict)
    assert result.get("isError") is True, f"Expected isError=True, got: {result}"
    content = result.get("content", [])
    assert len(content) > 0
    assert isinstance(content[0].get("text"), str)
```

**Response shape test** — for integration/real-Odoo tests see `test_vertical.py`. Unit tests assert the error boundary only; full shape (`uid`, `username`, `database`) is verified in the integration suite.

**Fixture usage:** `mcp_client` from `tests/conftest.py` — already session-manages lifespan, injects `FAKE_CRED_HEADERS`. No additional fixtures needed.

---

### `tests/test_records.py` (test, request-response) — NEW

**Analog:** `tests/test_credentials.py` (lines 1–142) + `tests/test_transport.py` (lines 37–76)

**File structure pattern** (`test_credentials.py` lines 1–23):
```python
"""Unit tests for record operation tools (REC-01..05, ERR-01).

Covers:
  REC-01: record_search with fake creds → isError=True (OdooAuthError → ToolError)
  ERR-01: OdooError → ToolError → isError=True MCP response for all record tools
"""

from __future__ import annotations

import json
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from httpx import AsyncClient
```

**Tool call body pattern** (adapt `test_vertical.py` lines 34–39):
```python
def _tool_call_body(name: str, arguments: dict[str, object]) -> dict[str, object]:
    return {
        "jsonrpc": "2.0",
        "method": "tools/call",
        "params": {"name": name, "arguments": arguments},
        "id": 1,
    }
```

**ERR-01 unit test pattern** (fake Odoo → auth failure → `isError=True`):
```python
async def test_search_odoo_error(mcp_client: AsyncClient) -> None:
    """ERR-01: record_search with bad creds → OdooAuthError → isError=True."""
    body = _tool_call_body("record_search", {"model": "res.partner"})
    resp = await mcp_client.post("/mcp", json=body)
    assert resp.status_code == 200
    result = _parse_sse_json(resp.text).get("result", {})
    assert isinstance(result, dict)
    assert result.get("isError") is True
```

Apply the same pattern for `record_read`, `record_create`, `record_update`, `record_delete` — one test per tool, all assert `isError=True` when Odoo is unreachable.

**Fixture:** `mcp_client` from `tests/conftest.py` — no additional fixtures.

---

### `tests/test_discovery.py` (test, request-response) — NEW

**Analog:** `tests/test_transport.py` (lines 37–76) — same structure, different tool names

**File structure pattern:**
```python
"""Unit tests for discovery tools (DISC-01, DISC-02).

Covers:
  DISC-01: discovery_list_models with fake creds → isError=True (auth failure → ToolError)
  DISC-02: discovery_get_fields with fake creds → isError=True (auth failure → ToolError)
"""

from __future__ import annotations

import json
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from httpx import AsyncClient
```

**Tool call patterns** (same `_parse_sse_json` helper, same `_tool_call_body` helper, same `isError=True` assertion structure as `test_records.py`):
```python
async def test_list_models_odoo_error(mcp_client: AsyncClient) -> None:
    """DISC-01 + ERR-01: bad creds → isError=True for discovery_list_models."""
    body = {
        "jsonrpc": "2.0",
        "method": "tools/call",
        "params": {"name": "discovery_list_models", "arguments": {}},
        "id": 1,
    }
    resp = await mcp_client.post("/mcp", json=body)
    assert resp.status_code == 200
    result = _parse_sse_json(resp.text).get("result", {})
    assert result.get("isError") is True


async def test_get_fields_odoo_error(mcp_client: AsyncClient) -> None:
    """DISC-02 + ERR-01: bad creds → isError=True for discovery_get_fields."""
    body = {
        "jsonrpc": "2.0",
        "method": "tools/call",
        "params": {"name": "discovery_get_fields", "arguments": {"model": "res.partner"}},
        "id": 1,
    }
    resp = await mcp_client.post("/mcp", json=body)
    assert resp.status_code == 200
    result = _parse_sse_json(resp.text).get("result", {})
    assert result.get("isError") is True
```

---

### `tests/test_transport.py` — MODIFY (tool name update only)

**Analog:** `tests/test_transport.py` (current, lines 51–64)

**Single change:** line 62 `assert "odoo_whoami" in tool_names` → `assert "users_whoami" in tool_names`. Also update the docstring on `test_tools_list_contains_whoami` to reference `users_whoami`. No structural changes.

---

### `tests/integration/test_vertical.py` — MODIFY (add Phase 3 tests, repoint whoami)

**Analog:** `tests/integration/test_vertical.py` (current, lines 1–136 — full file)

**Changes to existing code (D-13 repoint):**
- Line 35: `"params": {"name": "odoo_whoami", ...}` → `"params": {"name": "users_whoami", ...}`
- Line 37 (variable name): `_WHOAMI_CALL_BODY` body — update tool name in params
- Line 77: `assert "odoo_whoami" in tool_names` → `assert "users_whoami" in tool_names`
- Lines 99–102: update assertions to match `users_whoami` response shape: `uid`, `username`, `database` (not the old `uid`, `db`, `url` from probe).

**New test method additions** (append to `TestVerticalSlice` class, keeping `@pytest.mark.integration`):

SC-3 round-trip pattern (five record operations against live Odoo):
```python
async def test_record_crud_roundtrip(
    self,
    mcp_client_factory: Callable[..., Any],
    odoo_harness: StartedOdooContainer,
) -> None:
    """SC-3: create → search → read → update → delete round-trip on res.partner.tag."""
    client = mcp_client_factory(
        url=odoo_harness.url,
        database=odoo_harness._database,
        username="admin",
        password="admin",
    )
    async with client:
        # create
        resp = await client.post(_MCP_PATH, json={
            "jsonrpc": "2.0", "method": "tools/call",
            "params": {"name": "record_create", "arguments": {
                "model": "res.partner.category", "values": {"name": "Phase3TestTag"}
            }}, "id": 10,
        })
        assert resp.status_code == 200
        create_body = _parse_sse_json(resp.text)
        create_result = json.loads(create_body["result"]["content"][0]["text"])
        assert "id" in create_result
        new_id: int = create_result["id"]
        assert isinstance(new_id, int) and new_id > 0
        # ... (search, read, update, delete follow same tool call → parse → assert pattern)
```

SC-4 invalid domain → structured error (copy the error assertion pattern from unit tests):
```python
async def test_invalid_domain_structured_error(
    self,
    mcp_client_factory: Callable[..., Any],
    odoo_harness: StartedOdooContainer,
) -> None:
    """SC-4: invalid domain → OdooValidationError → isError=True with Odoo message."""
    client = mcp_client_factory(
        url=odoo_harness.url,
        database=odoo_harness._database,
        username="admin",
        password="admin",
    )
    async with client:
        resp = await client.post(_MCP_PATH, json={
            "jsonrpc": "2.0", "method": "tools/call",
            "params": {"name": "record_search", "arguments": {
                "model": "res.partner",
                "domain": [["nonexistent_field_xyz", "=", "value"]],
            }}, "id": 20,
        })
    assert resp.status_code == 200
    body = _parse_sse_json(resp.text)
    result = body.get("result", {})
    assert isinstance(result, dict)
    assert result.get("isError") is True
    error_text = result["content"][0]["text"]
    assert isinstance(error_text, str) and len(error_text) > 0
```

---

## Shared Patterns

### Per-Request OdooClient — The Core Template
**Source:** `src/godoo_mcp_server/tools/probe.py` (full file, lines 1–39)
**Apply to:** `tools/users.py`, `tools/records.py`, `tools/discovery.py`

Every tool handler follows this skeleton without deviation:
```python
request = get_http_request()
creds: OdooCredentials = request.state.odoo_creds  # type: ignore[attr-defined]
config = OdooClientConfig(
    url=creds.url,
    database=creds.database,
    username=creds.username,
    password=creds.password,
)
try:
    async with OdooClient(config) as client:
        # ... RPC calls ...
        return { ... }
except OdooError as e:
    raise ToolError(str(e)) from e
```

The two deviations from `probe.py` are intentional:
1. Add `from fastmcp.exceptions import ToolError` and `from godoo.client.errors import OdooError` (probe.py omits both — it has no error handling).
2. The `try/except OdooError` block wraps the entire `async with` (catching `__aenter__` auth failures too).

### `# type: ignore[attr-defined]` on `request.state.odoo_creds`
**Source:** `src/godoo_mcp_server/tools/probe.py` line 28
**Apply to:** Every tool handler
```python
creds: OdooCredentials = request.state.odoo_creds  # type: ignore[attr-defined]
```
Starlette's `State` object is dynamically typed; mypy --strict requires this suppress comment permanently.

### `from __future__ import annotations` + `TYPE_CHECKING` guard
**Source:** `src/godoo_mcp_server/tools/probe.py` lines 7–18, `src/godoo_mcp_server/credentials.py` lines 1–17
**Apply to:** All new Python modules
```python
from __future__ import annotations
from typing import TYPE_CHECKING
# ...
if TYPE_CHECKING:
    from godoo_mcp_server.credentials import OdooCredentials
```

### SSE JSON parser (`_parse_sse_json`)
**Source:** `tests/test_transport.py` lines 24–34 and `tests/integration/test_vertical.py` lines 42–51
**Apply to:** `tests/test_users.py`, `tests/test_records.py`, `tests/test_discovery.py`

Copy verbatim — this function is duplicated across test files (no shared test util module exists). Match the exact import-free signature:
```python
def _parse_sse_json(text: str) -> dict[str, object]:
    for line in text.splitlines():
        if line.startswith("data:"):
            return json.loads(line[len("data:") :].strip())  # type: ignore[return-value]
    return json.loads(text)  # type: ignore[return-value]
```

### `@pytest.mark.integration` on class
**Source:** `tests/integration/test_vertical.py` line 55 (`@pytest.mark.integration` on `class TestVerticalSlice`)
**Apply to:** All new integration test methods — add to the existing `TestVerticalSlice` class body, not as a separate class (marker inherited from class).

### `async def test_*() -> None` with plain `async def` (no decorator)
**Source:** `tests/test_transport.py` lines 37, 45, 51, 67; `tests/test_credentials.py` lines 26, 36, 50
**Apply to:** All new unit test functions
```python
async def test_foo(mcp_client: AsyncClient) -> None:
    ...
```
`asyncio_mode = "auto"` in `pyproject.toml` means `@pytest.mark.asyncio` is never needed.

### `noqa: F401, E402` on side-effect tool module imports
**Source:** `src/godoo_mcp_server/server.py` line 22
**Apply to:** The three new import lines added to `server.py`
```python
from godoo_mcp_server.tools import users as _users_module      # noqa: F401, E402
from godoo_mcp_server.tools import records as _records_module  # noqa: F401, E402
from godoo_mcp_server.tools import discovery as _disc_module   # noqa: F401, E402
```

---

## No Analog Found

None. Every file in Phase 3 has a direct in-repo analog. `probe.py` is the exact template for all three new tool modules. Existing test files (`test_transport.py`, `test_credentials.py`, `test_vertical.py`) cover all test patterns needed.

---

## Metadata

**Analog search scope:** `src/godoo_mcp_server/`, `tests/`, `tests/integration/`, `.planning/phases/02-skeleton-server/02-PATTERNS.md`
**Files scanned:** 10 source files + Phase 2 PATTERNS.md
**Pattern extraction date:** 2026-06-02
**Primary template:** `src/godoo_mcp_server/tools/probe.py` — all three new tool modules copy this exactly, adding only `ToolError`/`OdooError` imports and the `try/except OdooError` wrapper.
