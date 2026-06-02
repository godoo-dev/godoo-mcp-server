# Phase 4: Full Surface + Catalog + ACL + Skills - Pattern Map

**Mapped:** 2026-06-02
**Files analyzed:** 11 new/modified files
**Analogs found:** 9 / 11 (2 files are novel: catalog.py, resources.py — closest analogs noted)

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/godoo_mcp_server/tools/mail.py` | tool-module | request-response | `src/godoo_mcp_server/tools/records.py` | exact |
| `src/godoo_mcp_server/tools/actions.py` | tool-module | request-response | `src/godoo_mcp_server/tools/records.py` | exact |
| `src/godoo_mcp_server/tools/attachments.py` | tool-module | request-response + file-I/O | `src/godoo_mcp_server/tools/records.py` | role-match |
| `src/godoo_mcp_server/tools/discovery.py` (extend) | tool-module | request-response | `src/godoo_mcp_server/tools/discovery.py` | exact (self) |
| `src/godoo_mcp_server/tools/users.py` (extend) | tool-module | request-response | `src/godoo_mcp_server/tools/users.py` | exact (self) |
| `src/godoo_mcp_server/catalog.py` | service | CRUD + batch | `src/godoo_mcp_server/tools/discovery.py` | partial |
| `src/godoo_mcp_server/resources.py` | provider | request-response | `src/godoo_mcp_server/server.py` | partial |
| `src/godoo_mcp_server/server.py` (extend) | config | — | `src/godoo_mcp_server/server.py` | exact (self) |
| `tests/test_mail.py` | test | — | `tests/test_records.py` | exact |
| `tests/test_catalog.py` | test | — | `tests/test_records.py` | role-match |
| `tests/test_resources.py` | test | — | `tests/test_users.py` | role-match |
| `tests/test_actions.py` | test | — | `tests/test_records.py` | exact |
| `tests/test_attachments.py` | test | — | `tests/test_records.py` | exact |
| `tests/integration/test_vertical.py` (extend) | test | — | `tests/integration/test_vertical.py` | exact (self) |

---

## Pattern Assignments

### `src/godoo_mcp_server/tools/mail.py` (tool-module, request-response)

**Analog:** `src/godoo_mcp_server/tools/records.py`

**Imports pattern** (records.py lines 1-20):
```python
"""Record operation tools.

Provides: record_search, record_read, record_create, record_update, record_delete.
"""

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

**`_make_config` helper** (records.py lines 22-28 — copy verbatim, do NOT inline):
```python
def _make_config(creds: OdooCredentials) -> OdooClientConfig:
    return OdooClientConfig(
        url=creds.url,
        database=creds.database,
        username=creds.username,
        password=creds.password,
    )
```

**Core tool pattern** (records.py lines 31-64 — every tool handler follows this exactly):
```python
@mcp.tool(
    name="record_search",
    description="...",
)
async def record_search(
    ctx: Context,
    model: str,
    domain: list[Any] | None = None,
    ...
) -> dict[str, object]:
    """Docstring."""
    request = get_http_request()
    creds: OdooCredentials = request.state.odoo_creds
    try:
        async with OdooClient(_make_config(creds)) as client:
            records = await client.search_read(...)
            return {"records": records, "count": len(records)}
    except OdooError as e:
        raise ToolError(str(e)) from e
```

**Mail-specific: `client.call()` pattern** (for message_post, activity_schedule, action_feedback):
```python
# Use client.call() for methods that are not search_read/create/write/unlink
result = await client.call(model, "message_post", [res_id], {
    "body": body if "<" in body else f"<p>{body}</p>",
    "message_type": "comment",
    "subtype_xmlid": "mail.mt_note" if is_internal else "mail.mt_comment",
    "is_internal": is_internal,
    "partner_ids": partner_ids or [],
    "attachment_ids": attachment_ids or [],
})
```

**Return shape convention:** All tools return `dict[str, object]`. Singular result: `{"id": int}` or `{"message_id": int}`. List results: `{"records": [...], "count": int}` or domain-specific `{"messages": [...], "count": int}`, `{"activities": [...], "count": int}`. Boolean result: `{"success": bool}`.

---

### `src/godoo_mcp_server/tools/actions.py` (tool-module, request-response)

**Analog:** `src/godoo_mcp_server/tools/records.py`

Identical imports + `_make_config` + `get_http_request()` + `OdooError → ToolError` pattern.

**Action-specific method calls:**
```python
# list_actions: search two models and union results
server_actions = await client.search_read("ir.actions.server", domain, fields=["id", "name", "model_id", "binding_model_id", "code"], limit=limit)
window_actions = await client.search_read("ir.actions.act_window", domain, fields=["id", "name", "res_model", "view_mode"], limit=limit)

# execute_action: call "run" on ir.actions.server
result = await client.call("ir.actions.server", "run", [action_id], {})
```

---

### `src/godoo_mcp_server/tools/attachments.py` (tool-module, request-response + file-I/O)

**Analog:** `src/godoo_mcp_server/tools/records.py`

Identical imports + `_make_config` + `get_http_request()` + `OdooError → ToolError` pattern.

**Attachments-specific patterns** (base64 + read_binary + empty-file guard):
```python
import base64  # add to import block

# download tool — read_binary + empty guard + metadata fetch
data = await client.read_binary("ir.attachment", attachment_id, "datas")
if not data:
    return {"error": "attachment_has_no_content", "id": attachment_id}
records = await client.read("ir.attachment", [attachment_id], fields=["name", "mimetype"])
meta = records[0] if records else {}
return {
    "id": attachment_id,
    "name": meta.get("name", ""),
    "mimetype": meta.get("mimetype", "application/octet-stream"),
    "content_base64": base64.b64encode(data).decode(),
    "size_bytes": len(data),
}

# upload tool — caller provides base64 string; store in ir.attachment.datas
new_id = await client.create("ir.attachment", {
    "name": name,
    "datas": content_base64,   # already base64-encoded by caller
    "res_model": res_model,
    "res_id": res_id,
    "mimetype": mimetype or "application/octet-stream",
})
return {"id": new_id}
```

---

### `src/godoo_mcp_server/tools/discovery.py` (extend — add `discovery_list_menus`)

**Analog:** `src/godoo_mcp_server/tools/discovery.py` (existing file, lines 1-88)

**Pattern for the new tool** — copy `discovery_list_models` structure (lines 28-56) and adapt model/fields:
```python
@mcp.tool(
    name="discovery_list_menus",
    description="List Odoo application menus. Returns ir.ui.menu records.",
)
async def discovery_list_menus(
    ctx: Context,
    domain: list[Any] | None = None,
    limit: int = 80,
) -> dict[str, object]:
    request = get_http_request()
    creds: OdooCredentials = request.state.odoo_creds
    config = OdooClientConfig(
        url=creds.url, database=creds.database,
        username=creds.username, password=creds.password,
    )
    try:
        async with OdooClient(config) as client:
            menus = await client.search_read(
                "ir.ui.menu",
                domain or [],
                fields=["id", "name", "complete_name", "parent_id", "action", "sequence"],
                limit=limit,
                order="sequence",
            )
            return {"menus": menus, "count": len(menus)}
    except OdooError as e:
        raise ToolError(str(e)) from e
```

Note: `discovery.py` uses inline `OdooClientConfig(...)` rather than `_make_config()` — follow whichever pattern is already in the file (current file uses inline). New modules (mail, actions, attachments) should use `_make_config()` per records.py pattern.

---

### `src/godoo_mcp_server/tools/users.py` (extend — add `users_search_users`)

**Analog:** `src/godoo_mcp_server/tools/users.py` (existing file, lines 1-46)

**Pattern for the new tool** — copy `users_whoami` structure and add `search_read`:
```python
@mcp.tool(
    name="users_search_users",
    description="Search Odoo users by domain filter. Returns res.users records.",
)
async def users_search_users(
    ctx: Context,
    domain: list[Any] | None = None,
    fields: list[str] | None = None,
    limit: int = 80,
    offset: int = 0,
) -> dict[str, object]:
    request = get_http_request()
    creds: OdooCredentials = request.state.odoo_creds
    config = OdooClientConfig(
        url=creds.url, database=creds.database,
        username=creds.username, password=creds.password,
    )
    try:
        async with OdooClient(config) as client:
            users = await client.search_read(
                "res.users",
                domain or [],
                fields=fields or ["id", "name", "login", "active", "share"],
                limit=limit,
                offset=offset,
            )
            return {"users": users, "count": len(users)}
    except OdooError as e:
        raise ToolError(str(e)) from e
```

Note: Add `from typing import Any` to the existing `users.py` imports since the existing file only imports `TYPE_CHECKING`.

---

### `src/godoo_mcp_server/catalog.py` (service, batch)

**Analog:** `src/godoo_mcp_server/tools/discovery.py` (partial — same OdooClient usage, but no tool decorator)

**No existing pure-service analog** — closest is the `discovery.py` `OdooClient` + `search_read` pattern extracted into a standalone function. The catalog adds `cachetools.TTLCache` + `asyncio.Lock`.

**Imports block for catalog.py**:
```python
"""Lazy schema-hashed catalog store with in-process LRU+TTL cache.

Cache key: (url, database, schema_hash) — NEVER includes credentials.
Schema hash: 3 write_date probes on ir.model / ir.model.fields / ir.module.module.
"""

from __future__ import annotations

import asyncio
from typing import Any

from cachetools import TTLCache
from godoo.client.client import OdooClient
```

**TTLCache module-level declaration + lazy lock pattern** (addresses Pitfall 2 — asyncio.Lock must NOT be created at module level in Python 3.14):
```python
_CATALOG_TTL = 3600       # seconds; 1 hour
_CATALOG_MAXSIZE = 32     # max distinct (url, db, hash) tuples

CacheKey = tuple[str, str, str]  # (url, database, schema_hash)

_catalog_cache: TTLCache[CacheKey, dict[str, Any]] = TTLCache(
    maxsize=_CATALOG_MAXSIZE, ttl=_CATALOG_TTL
)
_catalog_lock: asyncio.Lock | None = None  # created lazily inside the event loop

def _get_lock() -> asyncio.Lock:
    global _catalog_lock
    if _catalog_lock is None:
        _catalog_lock = asyncio.Lock()
    return _catalog_lock
```

**Schema hash computation** (adapted from odoo-api-proxy schema-hash.ts):
```python
async def compute_schema_hash(client: OdooClient) -> str | None:
    """3 write_date probes → pipe-joined token. Returns None on any RPC failure."""
    try:
        model_rows, field_rows, module_rows = await asyncio.gather(
            client.search_read("ir.model", [], fields=["write_date"], order="write_date desc", limit=1),
            client.search_read("ir.model.fields", [], fields=["write_date"], order="write_date desc", limit=1),
            client.search_read("ir.module.module", [["state", "=", "installed"]], fields=["write_date"], order="write_date desc", limit=1),
        )
        model_date = (model_rows[0]["write_date"] or "") if model_rows else ""
        field_date = (field_rows[0]["write_date"] or "") if field_rows else ""
        module_date = (module_rows[0]["write_date"] or "") if module_rows else ""
        return f"{model_date}|{field_date}|{module_date}"
    except Exception:
        return None
```

**Cache get-or-build** (asyncio.Lock wraps sync TTLCache access):
```python
async def get_catalog_snapshot(
    client: OdooClient, url: str, database: str
) -> dict[str, Any]:
    """Get or build catalog snapshot. Never keys by credentials."""
    schema_hash = await compute_schema_hash(client)
    if schema_hash is None:
        return {"schema_hash": None, "models": [], "cached": False}

    key: CacheKey = (url, database, schema_hash)
    async with _get_lock():
        if key in _catalog_cache:
            return {**_catalog_cache[key], "cached": True}
        snapshot = await _build_snapshot(client, schema_hash)
        _catalog_cache[key] = snapshot
        return {**snapshot, "cached": False}
```

**Cache read without OdooClient** (for resources.py — reads cache, never calls Odoo):
```python
def get_model_entry_from_cache(model_name: str) -> dict[str, Any] | None:
    """Read model entry from any cached snapshot. No OdooClient, no await needed.
    
    Iterates all current cache entries looking for the model.
    Returns None if cache is cold or model not found.
    """
    for snapshot in _catalog_cache.values():
        models: list[dict[str, Any]] = snapshot.get("models", [])
        for entry in models:
            if entry.get("model") == model_name:
                return entry
    return None
```

---

### `src/godoo_mcp_server/resources.py` (provider, request-response)

**Analog:** `src/godoo_mcp_server/server.py` (partial — same `mcp` instance import, but uses `@mcp.resource` not `@mcp.tool`)

**CRITICAL CONSTRAINT (from RESEARCH.md Pattern 4 / Pitfall 1):** Resources MUST NOT call `get_http_request()` or `OdooClient`. Resource resolvers run outside the per-request ASGI scope — there is no `X-Odoo-*` header available. Resources read from the catalog cache only; if cold, they return a not-found descriptor.

**Imports block for resources.py**:
```python
"""MCP resource registration: odoo:// catalog resources + skill:// file resources.

IMPORTANT: Resource resolvers cannot use get_http_request() — no per-request
credentials are available in the resources/read dispatch path. Resolvers read
from the catalog cache (warmed by prior tool calls) or from bundled skill files.
"""

from __future__ import annotations

import importlib.resources
import json as _json
from typing import Any

from godoo_mcp_server.catalog import get_model_entry_from_cache
from godoo_mcp_server.server import mcp
```

**Resource decorator pattern** (`@mcp.resource` with template URI):
```python
@mcp.resource(
    "odoo://model/{name}",
    name="Odoo Model",
    description="Model metadata + fields for a named Odoo model. Cache-served: call discovery_get_fields first to warm.",
    mime_type="application/json",
)
async def read_model_resource(name: str) -> dict[str, object] | None:
    entry = get_model_entry_from_cache(name)
    if entry is None:
        return {"error": "model_not_found", "model": name, "hint": "call discovery_get_fields to warm the catalog"}
    return entry
```

**Skill file loading at module import time** (importlib.resources, not os.path — required for wheel packaging):
```python
_SKILL_PATHS = [
    "SKILL.md",
    "mail/chatter.md",
    "mail/activities.md",
    "base/properties.md",
]
_SKILL_FILES: dict[str, str] = {}  # populated at import; never mutated after

def _load_skills() -> None:
    pkg = importlib.resources.files("godoo_mcp_server") / "skills"
    for p in _SKILL_PATHS:
        node = pkg
        for part in p.split("/"):
            node = node / part
        _SKILL_FILES[p] = node.read_text(encoding="utf-8")
    # SKILL-02 startup assertion: every declared path must be loadable
    assert set(_SKILL_FILES.keys()) == set(_SKILL_PATHS), (
        f"Skill file mismatch: loaded={set(_SKILL_FILES.keys())} expected={set(_SKILL_PATHS)}"
    )

_load_skills()  # runs at side-effect import time (server.py imports this module)
```

**Skill resources (static + wildcard template)**:
```python
@mcp.resource("skill://index.json", name="Skill Discovery Index", mime_type="application/json")
def read_skill_index() -> dict[str, object]:
    return {
        "$schema": "https://schemas.agentskills.io/discovery/0.2.0/schema.json",
        "skills": [{"type": "skill-md", "name": "odoo", "description": "Odoo ERP integration over MCP.", "url": "skill://odoo/SKILL.md"}],
    }

@mcp.resource("skill://odoo/{path*}", name="Odoo Skill File", mime_type="text/markdown")
def read_skill_file(path: str) -> str:
    content = _SKILL_FILES.get(path)
    if content is None:
        return f"# Not Found\n\nSkill file '{path}' not found."
    return content
```

Note: `{path*}` RFC 6570 wildcard — confirmed in fastmcp `template.py`. Allows `skill://odoo/mail/chatter.md` to match `path="mail/chatter.md"`.

---

### `src/godoo_mcp_server/server.py` (extend — add side-effect imports)

**Analog:** `src/godoo_mcp_server/server.py` lines 21-24 (existing side-effect import block)

**Existing block** (lines 22-24):
```python
from godoo_mcp_server.tools import discovery as _disc_module  # noqa: F401, E402
from godoo_mcp_server.tools import records as _records_module  # noqa: F401, E402
from godoo_mcp_server.tools import users as _users_module  # noqa: F401, E402
```

**Lines to append** (after the existing three lines, order matters: tool modules before resources):
```python
from godoo_mcp_server.tools import mail as _mail_module  # noqa: F401, E402
from godoo_mcp_server.tools import actions as _actions_module  # noqa: F401, E402
from godoo_mcp_server.tools import attachments as _attachments_module  # noqa: F401, E402
from godoo_mcp_server import resources as _resources_module  # noqa: F401, E402
```

Note: `resources` is at the package level, not under `tools/`, hence `from godoo_mcp_server import resources`. The comment block on line 21 (`# Side-effect imports: register @mcp.tool decorators...`) should be updated to mention `@mcp.resource` as well.

---

### `pyproject.toml` (extend — add cachetools dep + uv_build include)

**Existing `[project.dependencies]`** (pyproject.toml lines 12-15):
```toml
dependencies = [
    "fastmcp>=3.3,<4",
    "godoo-client>=0.2,<0.3",
]
```

**Change:** Add `"cachetools>=7,<8"` to the list. Then add a new section for skills packaging:
```toml
[tool.uv_build]
include = ["src/godoo_mcp_server/skills/**"]
```

---

## Test Pattern Assignments

### `tests/test_mail.py` (new, unit)

**Analog:** `tests/test_records.py` (lines 1-107)

**Copy these helpers verbatim from test_records.py**:
- `_parse_sse_json(text)` (lines 22-32) — SSE body parser
- `_tool_call_body(name, arguments)` (lines 35-41) — MCP JSON-RPC builder

**Test structure** (from test_records.py lines 44-51 — replicate for each mail tool):
```python
async def test_post_message_odoo_error(mcp_client: AsyncClient) -> None:
    """MAIL-01: mail_post_message with bad creds -> isError=True."""
    body = _tool_call_body("mail_post_message", {"model": "res.partner", "res_id": 1, "body": "Hi"})
    resp = await mcp_client.post("/mcp", json=body)
    assert resp.status_code == 200
    result = _parse_sse_json(resp.text).get("result", {})
    assert isinstance(result, dict)
    assert result.get("isError") is True, f"Expected isError=True, got: {result}"
```

---

### `tests/test_catalog.py` (new, unit)

**Analog:** `tests/test_records.py` for structure; catalog tests require `unittest.mock.AsyncMock`

**Mock pattern for OdooClient** (referenced in RESEARCH.md — confirmed pattern for patching the context manager):
```python
from unittest.mock import AsyncMock, patch, MagicMock

# Patch OdooClient as context manager
mock_client = AsyncMock()
mock_client.search_read = AsyncMock(return_value=[{"write_date": "2026-01-01 00:00:00"}])
mock_cm = MagicMock()
mock_cm.__aenter__ = AsyncMock(return_value=mock_client)
mock_cm.__aexit__ = AsyncMock(return_value=False)

with patch("godoo_mcp_server.catalog.OdooClient", return_value=mock_cm):
    hash_result = await compute_schema_hash(mock_client)
    assert hash_result is not None
    assert "|" in hash_result
```

**Two-user cache isolation test** (D-12 rescoped test — catalog key never includes creds):
```python
async def test_cache_key_excludes_credentials() -> None:
    """D-12: Verify cache key is (url, db, hash) — no credential component."""
    from godoo_mcp_server.catalog import CacheKey
    key_user1: CacheKey = ("http://odoo", "db", "hash1")
    key_user2: CacheKey = ("http://odoo", "db", "hash1")
    # Same URL+DB+hash → same key regardless of which user computed it
    assert key_user1 == key_user2
```

---

### `tests/test_resources.py` (new, unit)

**Analog:** `tests/test_users.py` (tool-list verification pattern, lines 72-83)

**Resource list verification** (analogous to tools/list check in test_users.py):
```python
_RESOURCES_LIST_BODY: dict[str, object] = {
    "jsonrpc": "2.0",
    "method": "resources/list",
    "params": {},
    "id": 1,
}

async def test_skill_resources_in_list(mcp_client: AsyncClient) -> None:
    """SKILL-01/RES-01: skill://index.json must appear in resources/list."""
    resp = await mcp_client.post("/mcp", json=_RESOURCES_LIST_BODY)
    assert resp.status_code == 200
    body = _parse_sse_json(resp.text)
    result = body.get("result", {})
    resources = result.get("resources", []) if isinstance(result, dict) else []
    uris = [r.get("uri") for r in resources if isinstance(r, dict)]
    assert "skill://index.json" in uris, f"skill://index.json not in resources: {uris}"
```

---

### `tests/integration/test_vertical.py` (extend)

**Analog:** existing `test_concurrent_isolation` (lines 110-141) — copy the `asyncio.gather` + `mcp_client_factory` pattern for the two-user catalog isolation test.

**Two-user catalog isolation extension** (D-12 rescoped to integration):
```python
@pytest.mark.asyncio(loop_scope="session")
@pytest.mark.integration
async def test_two_user_catalog_cache_isolation(
    self,
    mcp_client_factory: Callable[..., Any],
    odoo_harness: StartedOdooContainer,
    second_user_credentials: tuple[str, str],
) -> None:
    """D-12 (rescoped): Two users querying discovery_list_models see the same models
    (schema is per-target, not per-user) but resolve different UIDs.
    Cache key isolation: neither user's credentials appear in the catalog cache key.
    """
    user2_login, user2_password = second_user_credentials

    async def _call_list_models(username: str, password: str) -> dict[str, Any]:
        client = mcp_client_factory(
            url=odoo_harness.url, database=odoo_harness._database,
            username=username, password=password,
        )
        async with client:
            resp = await client.post(_MCP_PATH, json={
                "jsonrpc": "2.0", "method": "tools/call",
                "params": {"name": "discovery_list_models", "arguments": {}}, "id": 50,
            })
        return _parse_sse_json(resp.text)

    results = await asyncio.gather(
        _call_list_models("admin", "admin"),
        _call_list_models(user2_login, user2_password),
    )
    # Both users get a non-error response
    assert results[0].get("result", {}).get("isError") is not True
    assert results[1].get("result", {}).get("isError") is not True
```

---

## Shared Patterns

### Tool Registration (side-effect import)
**Source:** `src/godoo_mcp_server/server.py` lines 20-24
**Apply to:** All new tool modules (mail.py, actions.py, attachments.py) + resources.py
```python
# Pattern: each module imports mcp from server and uses @mcp.tool / @mcp.resource decorators.
# server.py triggers registration by importing the module after mcp is defined.
from godoo_mcp_server.server import mcp  # in each new module
```

### Per-Request Credential Resolution
**Source:** `src/godoo_mcp_server/tools/records.py` lines 22-64
**Apply to:** ALL new tool handlers in mail.py, actions.py, attachments.py, and extended functions in discovery.py and users.py
```python
request = get_http_request()
creds: OdooCredentials = request.state.odoo_creds
```

### OdooError to ToolError
**Source:** `src/godoo_mcp_server/tools/records.py` lines 63-64
**Apply to:** ALL new tool handlers (every `async def` decorated with `@mcp.tool`)
```python
except OdooError as e:
    raise ToolError(str(e)) from e
```
Note: `str(e)` only — never `repr(e)`, never `traceback.format_exc()`. D-08 sanitization.

### Per-Request OdooClient (no singletons)
**Source:** `src/godoo_mcp_server/tools/records.py` lines 52-62
**Apply to:** ALL new tool handlers
```python
async with OdooClient(_make_config(creds)) as client:
    # ALL Odoo RPC calls inside this block
    # client is NOT stored outside this block
    # No module-level OdooClient instance
```

### Test SSE Parser
**Source:** `tests/test_records.py` lines 22-32 (also in test_users.py lines 31-39, test_discovery.py lines 18-29)
**Apply to:** ALL new test files (test_mail.py, test_actions.py, test_attachments.py, test_catalog.py, test_resources.py)
```python
def _parse_sse_json(text: str) -> dict[str, object]:
    for line in text.splitlines():
        if line.startswith("data:"):
            return json.loads(line[len("data:") :].strip())
    return json.loads(text)
```

### Test Tool Call Builder
**Source:** `tests/test_records.py` lines 35-41
**Apply to:** test_mail.py, test_actions.py, test_attachments.py
```python
def _tool_call_body(name: str, arguments: dict[str, object]) -> dict[str, object]:
    return {
        "jsonrpc": "2.0",
        "method": "tools/call",
        "params": {"name": name, "arguments": arguments},
        "id": 1,
    }
```

### Integration Test Class + Fixtures
**Source:** `tests/integration/test_vertical.py` lines 57-141
**Apply to:** Extended `test_vertical.py` two-user tests
```python
@pytest.mark.asyncio(loop_scope="session")
@pytest.mark.integration
class TestVerticalSlice:  # add new test methods inside this class
    async def test_new_scenario(self, mcp_client_factory, odoo_harness, ...) -> None:
        client = mcp_client_factory(
            url=odoo_harness.url, database=odoo_harness._database,
            username="admin", password="admin",
        )
        async with client:
            resp = await client.post(_MCP_PATH, json={...})
        assert resp.status_code == 200
```

---

## No Analog Found

Files where the pattern is architecturally novel — planner should use RESEARCH.md patterns directly:

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `src/godoo_mcp_server/catalog.py` | service | batch | No existing service layer in codebase — all logic is currently inline in tool handlers. The TTLCache+asyncio.Lock pattern has no codebase analog; use RESEARCH.md Pattern 2+3 directly. |
| `src/godoo_mcp_server/resources.py` | provider | — | `@mcp.resource` decorator pattern has no codebase analog (only `@mcp.tool` exists). Use RESEARCH.md Pattern 4+5 directly. Resource credential constraint (no `get_http_request()`) is load-bearing — see RESEARCH.md Pitfall 1. |
| `src/godoo_mcp_server/skills/` | data | — | New directory with static .md files. No packaging config exists yet. pyproject.toml must add `[tool.uv_build] include = ["src/godoo_mcp_server/skills/**"]` — see RESEARCH.md Pitfall 5. |

---

## Key Deviations and Flags for Planner

1. **asyncio.Lock lazy initialization** (Pitfall 2): Do NOT write `_catalog_lock: asyncio.Lock = asyncio.Lock()` at module level. Use the `_get_lock()` lazy singleton pattern shown above — Python 3.14 may fail if the lock is created before the event loop.

2. **discovery.py uses inline OdooClientConfig** (not `_make_config`): The existing file (lines 39-44 and 73-79) constructs `OdooClientConfig` inline. New functions added to `discovery.py` and `users.py` should follow the existing file's style. New standalone modules (mail.py, actions.py, attachments.py) should use `_make_config()` per records.py.

3. **resources.py import restriction**: Any `from fastmcp.server.dependencies import get_http_request` import in `resources.py` is wrong. This import must only appear in tool modules.

4. **cachetools not in pyproject.toml**: It is in the venv transitively but must be added explicitly to `[project.dependencies]` as `"cachetools>=7,<8"`.

5. **uv_build build backend** (pyproject.toml line 2: `build-backend = "uv_build"`): Skills include syntax is `[tool.uv_build] include = ["src/godoo_mcp_server/skills/**"]` not `[tool.hatch.build.targets.wheel]`.

---

## Metadata

**Analog search scope:** `src/godoo_mcp_server/`, `tests/`, `tests/integration/`
**Files scanned:** 11 source files, 8 test files
**Pattern extraction date:** 2026-06-02
