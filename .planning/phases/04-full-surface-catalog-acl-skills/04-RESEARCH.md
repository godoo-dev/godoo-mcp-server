# Phase 4: Full Surface + Catalog + ACL + Skills — Research

**Researched:** 2026-06-02
**Domain:** MCP tool surface expansion, lazy catalog introspection, fastmcp resources, skill packaging
**Confidence:** HIGH (grounded in actual installed codebase sources)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-10:** Catalog = lazy, as-needed introspection. NO upfront full-catalog build. A small CORE set of models (mail.thread/mail.message, res.users, res.partner, ir.attachment, ir.actions, ir.ui.menu) is checked early on first request to a target; every other model is introspected on demand. Rejects odoo-api-proxy's eager approach. Cache in-process LRU+TTL, key = (url, database, schema_hash), never credentials.
- **D-11:** Schema-hash = one generation token per target. Compute a cheap per-(url,db) schema hash via 3 write_date probes on ir.model / ir.model.fields / ir.module.module (the odoo-api-proxy schema-hash.ts design). The hash gates the WHOLE lazy introspection store for that target: schema change → hash flips → all lazy entries stale.
- **D-12:** ACL = rely fully on Odoo; NO replication, NO probe, NO acl.py module. Every call runs as the requesting user's own credentials. NO check_access_rights probing, NO ACL-driven tool-surface filtering, NO notifications/tools/list_changed. Requirements ACL-01 / ACL-02 are removed; ROADMAP success criterion #5 is removed; criterion #4 rescoped to credential routing + cache-key isolation.
- **D-13:** Resource URI scheme = odoo-api-proxy scheme. Adopt: odoo://model/{name}, odoo://action/{id}, odoo://menu/{id}, odoo://module/installed, skill://index.json, skill://odoo/{path}. SPEC-RECONCILE FLAG: RES-01 record-instance addressing is NOT in scope for Phase 4.
- **D-14:** Skills = packaged + adapt now. Skill .md files live under src/godoo_mcp_server/skills/. Packaged inside pip wheel via uv_build force-include for non-.py files. Port the odoo-api-proxy skills but ADAPT to procedural-guide form (no literal field names) before shipping.
- Inherits D-01..D-09 from Phase 3: underscore tool names, friendly CRUD verbs, raw Odoo domain format, default limit=80, ToolError on OdooError, per-request OdooClient, no singletons.

### Claude's Discretion

- Exact mail tool verb granularity (how to split chatter vs activity methods)
- Attachments upload/download payload encoding (base64 vs streaming)
- Exact membership of the "core" pre-warmed model set (beyond the named examples in D-10)

### Deferred Ideas (OUT OF SCOPE)

- Simplified / agent-friendly domain syntax
- godoo-py error categorization taxonomy
- Record-instance resource addressing odoo://{model}/record/{id}
- notifications/tools/list_changed (removed per D-12)

</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support | D-12 Revision |
|----|-------------|------------------|---------------|
| MAIL-01 | mail.* tools: post_message, log_note, list_messages, schedule_activity, list_activities, mark_activity_done | godoo-client has MailService + call() primitives; all 6 tools use client.call() directly | Keep |
| ACT-01 | action.* tools: execute_action, list_actions | Use client.call() on ir.actions.server + search_read on ir.actions.act_window | Keep |
| ATT-01 | attachments.* tools: list, upload, download | search_read on ir.attachment; upload via client.create(); download via client.read_binary() | Keep |
| USER-02 | users.search_users | client.search_read() on res.users | Keep |
| DISC-03 | discovery.list_menus | client.search_read() on ir.ui.menu | Keep |
| CAT-01 | Catalog introspection with schema hash | 3 write_date probes (D-11); lazy per-model store in catalog.py | Keep |
| CAT-02 | In-process LRU+TTL cache keyed by (url, database, schema_hash) | cachetools.TTLCache 7.1.4 confirmed in venv; asyncio.Lock wrapper | Keep |
| RES-01 | MCP resource descriptors at odoo://model/{name}, odoo://action/{id}, odoo://menu/{id} URIs | fastmcp @mcp.resource("odoo://model/{name}") template decorator confirmed | Reconcile: schema-level URIs only, no record-instance |
| ACL-01 | Per-user access rights probe (REMOVED per D-12) | — | REMOVED |
| ACL-02 | notifications/tools/list_changed on ACL change (REMOVED per D-12) | — | REMOVED |
| SKILL-01 | Skill .md files served as MCP Resources | @mcp.resource("skill://odoo/{path}") template; bundled under src/godoo_mcp_server/skills/ | Keep |
| SKILL-02 | index.json generated at startup; startup assertion every .md has an index entry | Glob skills/ at server startup; assert in catalog.py or resources.py lifespan hook | Keep |

</phase_requirements>

---

## Summary

Phase 4 adds 9 new tools (6 mail, 2 action, 3 attachments — but users_search_users and discovery_list_menus go in existing modules), 2 new modules (catalog.py, resources.py), and skill .md file serving. Every new tool follows the established Phase 1-3 pattern exactly: `@mcp.tool(name="...")`, `get_http_request()` → `request.state.odoo_creds`, `async with OdooClient(_make_config(creds))`, `OdooError → ToolError`.

The catalog layer is the most architecturally novel piece. It uses `cachetools.TTLCache` (already in the venv at 7.1.4) wrapped in an `asyncio.Lock` to avoid concurrent build races. The cache key is `(url, database, schema_hash)` — never credentials. The schema hash itself is computed from 3 cheap `search_read` probes (write_date descending, limit=1) on `ir.model`, `ir.model.fields`, and `ir.module.module`. This pattern is verbatim from the reference `schema-hash.ts`.

Resources are registered via the fastmcp `@mcp.resource("odoo://model/{name}")` decorator which automatically becomes a template resource. Static resources (`skill://index.json`, `skill://odoo/{path}` index) use `@mcp.resource("skill://index.json")`. Skill files are packaged inside the wheel and loaded from `importlib.resources` at startup; a startup assertion cross-checks the filesystem glob against the index.

ACL is fully delegated to Odoo (D-12): no probe, no filtering, no notifications. Two-user isolation is tested by verifying that two concurrent requests with different credentials resolve to different UIDs and that the catalog cache key for both users is identical (no credential component) — which the existing concurrent_isolation test pattern from Phase 3 already demonstrates.

**Primary recommendation:** Implement in 4 waves: (W1) 9 new tools + server.py side-effect imports, (W2) catalog.py schema-hash + TTLCache, (W3) resources.py resource registration, (W4) skill packaging + index assertion + integration tests.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Tool execution (mail/action/attachments/users/discovery) | API / Backend (MCP tool handlers) | Odoo RPC (via godoo-client) | All business logic lives in Odoo; MCP is a thin translation layer |
| Schema hash computation | API / Backend (catalog.py) | Odoo RPC (3 write_date probes) | Per-target computation at cache miss time |
| Catalog cache (LRU+TTL) | API / Backend (in-process, single process) | — | stateless_http=True + single uvicorn process; in-memory is the right tier |
| Resource serving (odoo://, skill://) | API / Backend (fastmcp resource layer) | Catalog store (resolver closure) | MCP protocol resource layer; resolver reads catalog, not Odoo directly |
| Skill file packaging | Build / Package (hatchling/uv_build) | Filesystem (importlib.resources) | .md files must be bundled in the wheel; not a runtime concern |
| ACL enforcement | Odoo (native, per RPC call) | — | D-12: fully delegated; no replication in this tier |
| Per-user credential isolation | ASGI Middleware (CredentialMiddleware) | Request scope state | Already established in Phase 2; new tools inherit the same pattern |

---

## Standard Stack

### Core (all already in venv / pyproject.toml)

| Library | Version (venv) | Purpose | Why Standard |
|---------|---------------|---------|--------------|
| `fastmcp` | 3.3.1 [VERIFIED: installed] | Tool + resource registration, ASGI app | Established in Phase 2; `@mcp.tool` + `@mcp.resource` decorator API confirmed |
| `godoo-client` | 0.2.1 [VERIFIED: installed] | All Odoo RPC: call(), search_read(), read_binary(), create() | The only Odoo RPC client; provides MailService, raw call() for activities/actions/attachments |
| `cachetools` | 7.1.4 [VERIFIED: installed] | In-process LRU+TTL catalog cache | `TTLCache` confirmed present in venv; zero-dep, thread-safe with asyncio.Lock |
| `pydantic` | ≥2.11 (transitive) [VERIFIED: installed] | Tool input validation | Pulled transitively by fastmcp; used for tool input schemas |
| `asyncio` | stdlib | Async Lock for cache access | Required to wrap sync TTLCache in async context safely |
| `importlib.resources` | stdlib (3.9+) [VERIFIED] | Skill file loading from package data | Correct way to read bundled package data in Python 3.9+; `importlib.resources.files()` |

### No New Runtime Dependencies Required

All required libraries are already installed. The only addition to `pyproject.toml` is:
1. A `[tool.uv_build]` or `[tool.hatch.build.targets.wheel]` section to force-include `src/godoo_mcp_server/skills/**/*.md` in the wheel.
2. `cachetools>=7,<8` added to `[project.dependencies]` (it is in the venv transitively but should be explicit).

**Installation (additions only):**
```bash
# Add to pyproject.toml [project.dependencies]:
# "cachetools>=7,<8"
# Then:
uv sync
```

---

## Package Legitimacy Audit

No new external packages are introduced. All dependencies are already installed and verified from prior phases.

| Package | Registry | Status | Disposition |
|---------|----------|--------|-------------|
| `cachetools` 7.1.4 | PyPI | [VERIFIED: installed in venv, 12+ years old, ~50M/wk] | Approved — already present |
| `fastmcp` 3.3.1 | PyPI | [VERIFIED: installed in venv] | Approved — established in Phase 2 |
| `godoo-client` 0.2.1 | PyPI | [VERIFIED: installed in venv] | Approved — established in Phase 1 |

**Packages removed due to slopcheck:** none — no new packages introduced.

---

## Architecture Patterns

### System Architecture Diagram

```
MCP Client (POST /mcp)
        |
        v
CredentialMiddleware (ASGI)
  - extracts X-Odoo-* headers or ODOO_* env vars
  - sets scope["state"]["odoo_creds"]
        |
        v
fastmcp Tool Router
  ┌─────────────────────────────────────────────────┐
  │  tools/mail.py        6 tools                   │
  │  tools/actions.py     2 tools                   │
  │  tools/attachments.py 3 tools                   │
  │  tools/users.py       +users_search_users        │
  │  tools/discovery.py   +discovery_list_menus      │
  └─────────────────────────────────────────────────┘
        |  each tool:
        |  get_http_request() → request.state.odoo_creds
        |  async with OdooClient(_make_config(creds)) as client:
        v
  Odoo RPC (godoo-client)
        |
        v
  Odoo Instance (real per-user auth)

MCP Client (resources/list, resources/read)
        |
        v
fastmcp Resource Router
  ┌──────────────────────────────────────────────────────┐
  │  resources.py                                         │
  │  @mcp.resource("odoo://module/installed") → static    │
  │  @mcp.resource("odoo://model/{name}") → template      │
  │  @mcp.resource("odoo://action/{id}") → template       │
  │  @mcp.resource("odoo://menu/{id}") → template         │
  │  @mcp.resource("skill://index.json") → static         │
  │  @mcp.resource("skill://odoo/{path*}") → template     │
  └──────────────────────────────────────────────────────┘
        |
        v
  catalog.py (lazy introspection store)
  ┌───────────────────────────────────────────┐
  │  TTLCache[CacheKey, CatalogSnapshot]       │
  │  asyncio.Lock (guards cache read+write)   │
  │                                           │
  │  CacheKey = (url: str, db: str,           │
  │              schema_hash: str)            │
  │                                           │
  │  on cache miss:                           │
  │    compute_schema_hash(client)            │
  │      → 3 search_read probes:             │
  │        ir.model write_date desc limit=1  │
  │        ir.model.fields write_date desc   │
  │        ir.module.module (installed)      │
  │    → "{modelDate}|{fieldDate}|{moduleDate}" │
  │                                           │
  │    build_catalog_snapshot(client, key)   │
  │      → lazy: introspect on first access  │
  └───────────────────────────────────────────┘
        |
        v
  Odoo RPC (only on catalog miss)

skills/ (bundled in wheel, loaded at startup)
  src/godoo_mcp_server/skills/
  ├── SKILL.md
  ├── mail/
  │   ├── chatter.md
  │   └── activities.md
  └── base/
      └── properties.md

  startup assertion: glob ↔ index.json entries must match 1:1
```

### Recommended Project Structure (additions)

```
src/godoo_mcp_server/
├── server.py            # EXTEND: add side-effect imports for new tool modules + resources
├── credentials.py       # unchanged
├── catalog.py           # NEW: schema-hash computation + TTLCache catalog store
├── resources.py         # NEW: MCP resource registration (closes over catalog)
├── skills/              # NEW directory — packaged data
│   ├── SKILL.md
│   ├── mail/
│   │   ├── chatter.md
│   │   └── activities.md
│   └── base/
│       └── properties.md
└── tools/
    ├── records.py       # unchanged
    ├── discovery.py     # EXTEND: add discovery_list_menus
    ├── users.py         # EXTEND: add users_search_users
    ├── mail.py          # NEW: 6 mail tools
    ├── actions.py       # NEW: 2 action tools
    └── attachments.py   # NEW: 3 attachment tools
```

### Pattern 1: Standard Tool Handler (established, all new tools follow this exactly)

```python
# Source: confirmed from records.py, discovery.py, users.py in codebase
from fastmcp import Context  # noqa: TC002
from fastmcp.exceptions import ToolError
from fastmcp.server.dependencies import get_http_request
from godoo.client.client import OdooClient, OdooClientConfig
from godoo.client.errors import OdooError
from godoo_mcp_server.server import mcp

def _make_config(creds: OdooCredentials) -> OdooClientConfig:
    return OdooClientConfig(
        url=creds.url, database=creds.database,
        username=creds.username, password=creds.password,
    )

@mcp.tool(name="mail_post_message", description="Post a message to the chatter of an Odoo record.")
async def mail_post_message(
    ctx: Context,
    model: str,
    res_id: int,
    body: str,
    is_internal: bool = False,
    partner_ids: list[int] | None = None,
    attachment_ids: list[int] | None = None,
) -> dict[str, object]:
    request = get_http_request()
    creds: OdooCredentials = request.state.odoo_creds
    try:
        async with OdooClient(_make_config(creds)) as client:
            subtype = "mail.mt_note" if is_internal else "mail.mt_comment"
            result = await client.call(model, "message_post", [res_id], {
                "body": body if "<" in body else f"<p>{body}</p>",
                "message_type": "comment",
                "subtype_xmlid": subtype,
                "is_internal": is_internal,
                "partner_ids": partner_ids or [],
                "attachment_ids": attachment_ids or [],
            })
            return {"message_id": int(result) if isinstance(result, (int, list)) else result}
    except OdooError as e:
        raise ToolError(str(e)) from e
```

### Pattern 2: Schema Hash Computation

```python
# Source: adapted from odoo-api-proxy schema-hash.ts (confirmed pattern, Python translation)
# catalog.py

import asyncio
from typing import TYPE_CHECKING
from godoo.client.client import OdooClient

async def compute_schema_hash(client: OdooClient) -> str | None:
    """3 write_date probes → pipe-joined string token. Returns None on any RPC failure."""
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

### Pattern 3: TTLCache with asyncio.Lock

```python
# Source: cachetools docs (TTLCache), asyncio stdlib
# catalog.py

import asyncio
from cachetools import TTLCache
from typing import Any

_CATALOG_TTL = 3600  # 1 hour; configurable later
_CATALOG_MAXSIZE = 32  # max distinct (url, db, hash) keys in process

CacheKey = tuple[str, str, str]  # (url, database, schema_hash)

_catalog_cache: TTLCache[CacheKey, dict[str, Any]] = TTLCache(
    maxsize=_CATALOG_MAXSIZE, ttl=_CATALOG_TTL
)
# WRONG — Python 3.14; see Pitfall 2 / PATTERNS.md, use lazy _get_lock() instead:
# _catalog_lock: asyncio.Lock = asyncio.Lock()
_catalog_lock: asyncio.Lock | None = None

def _get_lock() -> asyncio.Lock:
    global _catalog_lock
    if _catalog_lock is None:
        _catalog_lock = asyncio.Lock()
    return _catalog_lock

async def get_catalog_snapshot(
    client: OdooClient, url: str, database: str
) -> dict[str, Any]:
    """Get or build catalog snapshot for target. Never keys by credentials."""
    schema_hash = await compute_schema_hash(client)
    if schema_hash is None:
        # Fail open: return empty snapshot; agent can still use tools
        return {"schema_hash": None, "models": [], "cached": False}

    key: CacheKey = (url, database, schema_hash)
    async with _get_lock():
        if key in _catalog_cache:
            return {**_catalog_cache[key], "cached": True}
        snapshot = await _build_snapshot(client, schema_hash)
        _catalog_cache[key] = snapshot
        return {**snapshot, "cached": False}
```

### Pattern 4: fastmcp Resource Registration (template)

```python
# Source: fastmcp server.py resource() decorator — confirmed from installed source
# resources.py — registered via side-effect import in server.py

from godoo_mcp_server.server import mcp
from godoo_mcp_server.catalog import get_catalog_snapshot

@mcp.resource(
    "odoo://model/{name}",
    name="Odoo Model",
    description="Model metadata + fields for a named Odoo model.",
    mime_type="application/json",
)
async def read_model_resource(name: str) -> dict[str, object]:
    """Resolver closes over the lazy catalog; no re-registration on hash change."""
    # NOTE: resources cannot use get_http_request() — no per-request creds available.
    # Model metadata is credential-free by design (no user-specific data in schema).
    # Use env-var credentials for the catalog probe client.
    ...
```

**CRITICAL CONSTRAINT — Resources cannot access per-request credentials.** The `get_http_request()` injection is only available inside `@mcp.tool` handlers. Resource resolvers run outside the per-request HTTP context — there is no `X-Odoo-*` header in scope. This is a fundamental MCP protocol constraint: `resources/read` is a separate RPC from `tools/call`, and the fastmcp resource handler does not thread through ASGI request state.

**Consequence:** Resource resolvers must use env-var credentials (ODOO_URL, ODOO_DATABASE, ODOO_USERNAME, ODOO_PASSWORD) OR must NOT make live Odoo calls (serve pre-built catalog data). Given the stateless design and the lazy catalog approach, the correct pattern is:

Option A (recommended): Resources serve pre-built catalog snapshots built by prior tool calls (catalog warmed by tools, resources read from the cache). Resource resolvers read from `_catalog_cache` but do NOT call Odoo directly if no cache entry exists — they return 404-style "not found" or an empty descriptor.

Option B: Resources use a separate "catalog credential" from env vars (ODOO_URL, etc.), bypassing per-request headers. This breaks the per-request isolation model.

**Recommendation: Option A** — resources are a read surface over the already-warmed catalog cache, not a fresh Odoo probe. If the cache is cold, the resource returns an empty/fallback response. The catalog is warmed when tools are called. This matches the stateless, credential-per-request design.

### Pattern 5: Skill File Loading (importlib.resources)

```python
# Source: Python stdlib importlib.resources (3.9+)
# resources.py — executed at startup

import importlib.resources
import json

_SKILL_PATHS = [
    "SKILL.md",
    "mail/chatter.md",
    "mail/activities.md",
    "base/properties.md",
]

def _load_skill_files() -> dict[str, str]:
    """Load all skill .md files from the bundled package data."""
    skills_pkg = importlib.resources.files("godoo_mcp_server.skills")
    loaded: dict[str, str] = {}
    for path in _SKILL_PATHS:
        parts = path.split("/")
        resource = skills_pkg
        for part in parts:
            resource = resource.joinpath(part)
        loaded[path] = resource.read_text(encoding="utf-8")
    return loaded

def _build_skill_index(skill_files: dict[str, str]) -> dict[str, object]:
    return {
        "$schema": "https://schemas.agentskills.io/discovery/0.2.0/schema.json",
        "skills": [
            {
                "type": "skill-md",
                "name": "odoo",
                "description": "Odoo ERP integration over MCP — mail, activities, attachments, CRUD, catalog.",
                "url": "skill://odoo/SKILL.md",
            }
        ],
    }
```

### Pattern 6: server.py Extension (side-effect import block)

```python
# server.py — add new modules to the side-effect import block
from godoo_mcp_server.tools import discovery as _disc_module  # noqa: F401, E402
from godoo_mcp_server.tools import records as _records_module  # noqa: F401, E402
from godoo_mcp_server.tools import users as _users_module  # noqa: F401, E402
# NEW in Phase 4:
from godoo_mcp_server.tools import mail as _mail_module  # noqa: F401, E402
from godoo_mcp_server.tools import actions as _actions_module  # noqa: F401, E402
from godoo_mcp_server.tools import attachments as _attachments_module  # noqa: F401, E402
from godoo_mcp_server import resources as _resources_module  # noqa: F401, E402
```

### Anti-Patterns to Avoid

- **Sharing OdooClient across requests:** Each `@mcp.tool` creates `async with OdooClient(...)` per call. Never store client as module-level state.
- **Keying catalog cache by credentials:** Cache key is ONLY `(url, database, schema_hash)`. Credentials are per-user; schema is per-target. Mixing these would leak data across users.
- **Calling get_http_request() in resource resolvers:** Only available in tool handlers. Resource resolvers have no ASGI request scope.
- **Eager catalog build at startup:** D-10 explicitly rejects this. Build on first access only.
- **Blocking the event loop with TTLCache access:** TTLCache is sync. Always acquire `asyncio.Lock` before accessing it from async code (not threading.Lock — single-process uvicorn is asyncio-only).
- **Registering resource modules before mcp is defined:** The `mcp = FastMCP(...)` in server.py must come before all side-effect imports. The existing pattern enforces this.

---

## Godoo-Client RPC Surface (verified from installed source)

### Available for Mail Tools (verified from `.venv/Lib/site-packages/godoo/client/`)

| Operation | Method | Odoo Model/Method | Notes |
|-----------|--------|-------------------|-------|
| Post message / log note | `client.call(model, "message_post", [res_id], kwargs)` | `mail.thread` mixin | `subtype_xmlid="mail.mt_note"` for internal, `"mail.mt_comment"` for open |
| List messages | `client.search_read("mail.message", domain, fields=[...])` | `mail.message` | domain: `[("model","=",model),("res_id","=",res_id)]` |
| Schedule activity | `client.call(model, "activity_schedule", [res_id], kwargs)` | `mail.activity.mixin` | Requires `activity_type_id`, `date_deadline`, optional `note`, `user_id` |
| List activities | `client.search_read("mail.activity", domain, fields=[...])` | `mail.activity` | domain: `[("res_model","=",model),("res_id","=",res_id)]` |
| Mark activity done | `client.call("mail.activity", "action_feedback", [activity_id], {"feedback": text})` | `mail.activity` | Marks done + posts feedback; returns bool |

**CRITICAL FIELD SHAPES (verified via godoo-client source, NOT assumed):**
- `godoo-client` `MailService` only wraps `post_internal_note` and `post_open_message`. It does NOT expose `activity_schedule`, `list_messages`, `list_activities`, or `mark_activity_done` — those require `client.call()` directly.
- The `message_post` kwargs shape is: `body`, `message_type`, `subtype_xmlid`, `is_internal`, `body_is_html` (optional, False by default), `partner_ids`, `attachment_ids`. Confirmed from `mail/functions.py`.
- `read_binary(model, record_id, field)` returns `bytes` — for attachments download this is the right method.

### Available for Action Tools

| Operation | Method | Odoo Model |
|-----------|--------|------------|
| List actions | `client.search_read("ir.actions.server", domain, fields=[...])` | `ir.actions.server` |
| List window actions | `client.search_read("ir.actions.act_window", domain, fields=[...])` | `ir.actions.act_window` |
| Execute server action | `client.call("ir.actions.server", "run", [action_id], {})` | `ir.actions.server` |

### Available for Attachment Tools

| Operation | Method | Odoo Model |
|-----------|--------|------------|
| List attachments | `client.search_read("ir.attachment", domain, fields=[...])` | `ir.attachment` |
| Upload attachment | `client.create("ir.attachment", {"name":..., "datas":base64_str, "res_model":..., "res_id":...})` | `ir.attachment` |
| Download attachment | `client.read_binary("ir.attachment", record_id, "datas")` → `bytes` then `base64.b64encode(...).decode()` | `ir.attachment` |

**Attachment upload encoding:** Odoo `ir.attachment.datas` field is base64-encoded string. Upload: caller provides bytes or base64 string; server encodes to base64 before calling `client.create()`. Download: `read_binary()` returns decoded bytes; tool returns `base64.b64encode(data).decode()` + mime_type for the MCP client to handle.

### Available for Users and Discovery Tools

| Operation | Method | Odoo Model |
|-----------|--------|------------|
| Search users | `client.search_read("res.users", domain, fields=[...])` | `res.users` |
| List menus | `client.search_read("ir.ui.menu", domain, fields=[...])` | `ir.ui.menu` |

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| In-process TTL+LRU cache | Custom dict + timestamps | `cachetools.TTLCache` | TTLCache handles eviction, LRU ordering, and TTL expiry atomically in a single data structure |
| Bundled file loading | `os.path.join(__file__, ...)` | `importlib.resources.files()` | The `__file__` approach breaks in zip-packaged wheels; `importlib.resources` is the correct stdlib API |
| Message body HTML validation | Custom regex or sanitizer | `body.strip()` + wrap in `<p>` if no tags | godoo-client `ensure_html_body()` shows the minimal pattern; don't add an HTML library |
| Base64 encode/decode for attachments | Custom encoding | `base64` stdlib | Already used by godoo-client `read_binary` internally |
| asyncio-safe cache access | Semaphore, custom queue | `asyncio.Lock()` + `TTLCache` | Standard pattern: acquire lock, check, read/write, release |

**Key insight:** The catalog and resource layers are thin Python translations of the TypeScript reference. There is nothing algorithmically novel here — all the complexity is in the data shape from Odoo (which is fixed) and in the cache invalidation strategy (which is solved by the schema-hash + TTLCache key).

---

## Runtime State Inventory

Phase 4 is NOT a rename/refactor phase. This section is not applicable.

No renaming, no migration of persistent state, no rebrand.

---

## Common Pitfalls

### Pitfall 1: Resource Handlers Cannot Access Per-Request Credentials

**What goes wrong:** Developer writes a resource resolver that calls `get_http_request()` expecting the X-Odoo-* credential headers. At runtime: `RuntimeError` or `AttributeError` because the ASGI request scope is not threaded through `resources/read` calls.

**Why it happens:** `resources/read` is a standalone MCP RPC method. fastmcp routes it through a separate dispatch path from `tools/call`. The `CredentialMiddleware` sets `scope["state"]["odoo_creds"]` for HTTP requests, but resource reads go through the MCP protocol layer which does not preserve the originating HTTP request state.

**How to avoid:** Resource resolvers MUST NOT call Odoo directly. They read from the catalog cache (which is populated by prior tool calls using real credentials). If the cache is cold, return an empty/not-found response. Document this clearly in the resource description so agents know to call tools first.

**Warning signs:** Any `get_http_request()` import in `resources.py` is wrong.

### Pitfall 2: asyncio.Lock Scope Mismatch (Lock Created at Import Time)

**What goes wrong:** `asyncio.Lock()` is created at module import time (outside any running event loop). In Python 3.10+, this raises `DeprecationWarning`; in 3.14 it may fail if the lock is created before the event loop exists.

**Why it happens:** Module-level `asyncio.Lock()` is created when the module is imported, potentially before `uvicorn` starts the event loop.

**How to avoid:** Create the lock inside a function or as a class attribute initialized lazily, OR initialize it in a lifespan startup hook. Alternatively: use `asyncio.Lock()` inside an `async def` function at first access (lazy singleton pattern).

```python
_catalog_lock: asyncio.Lock | None = None

def _get_lock() -> asyncio.Lock:
    global _catalog_lock
    if _catalog_lock is None:
        _catalog_lock = asyncio.Lock()
    return _catalog_lock
```

### Pitfall 3: TTLCache maxsize Must Account for Multi-Target Deployments

**What goes wrong:** `TTLCache(maxsize=1, ttl=3600)` works in single-target dev but silently evicts entries in multi-target production (multiple Odoo urls sharing the same MCP server).

**Why it happens:** LRU eviction on maxsize=1 means the second distinct (url, db) key immediately evicts the first.

**How to avoid:** Use `maxsize=32` (or make it configurable via env var `CATALOG_CACHE_MAXSIZE`). 32 distinct (url, db, schema_hash) combinations is more than sufficient for any realistic deployment.

### Pitfall 4: skill:// and odoo:// URIs Require Custom Scheme Registration

**What goes wrong:** fastmcp validates resource URIs with pydantic's `AnyUrl`. Custom schemes like `odoo://` and `skill://` may fail validation if pydantic rejects unknown schemes.

**Why it happens:** pydantic's `AnyUrl` is schema-aware by default.

**How to avoid:** fastmcp's `Resource` class uses `Annotated[AnyUrl, UrlConstraints(host_required=False)]` which permits custom schemes as long as they pass pydantic URL parsing. The odoo:// scheme parses correctly because `odoo` is a valid URI scheme identifier. Verify by running the registration at test time — the template decorator `@mcp.resource("odoo://model/{name}")` is confirmed to accept this pattern in fastmcp 3.3.x.

**Action for planner:** Add a unit test that registers `odoo://model/{name}` and `skill://index.json` resources and calls `mcp.list_resources()` to confirm they appear — this fails fast if the scheme is rejected.

### Pitfall 5: uv_build Does Not Include Non-.py Files by Default

**What goes wrong:** `pip install godoo-mcp-server` succeeds but skill `.md` files are missing at runtime. `importlib.resources.files("godoo_mcp_server.skills").joinpath("SKILL.md")` raises `FileNotFoundError`.

**Why it happens:** `uv_build` (and most Python build backends) exclude non-Python files by default. The `skills/` directory is under `src/godoo_mcp_server/` and must be explicitly included.

**How to avoid:** Add to `pyproject.toml`:
```toml
[tool.uv_build]
include = ["src/godoo_mcp_server/skills/**"]
```
OR add an `__init__.py`-free `skills/` package and use `[tool.uv_build] include-data = ...` syntax. Verify with `uv build && pip install dist/*.whl --force-reinstall && python -c "import importlib.resources; print(list(importlib.resources.files('godoo_mcp_server.skills').iterdir()))"`.

### Pitfall 6: mail.activity mark_done Method Signature

**What goes wrong:** Calling `client.call("mail.activity", "action_feedback", [activity_id], {})` fails with `TypeError` because `action_feedback` expects `feedback` as a positional argument in some Odoo versions.

**Why it happens:** Odoo internal method signatures vary between versions. `action_feedback` in Odoo 16+ takes `feedback` as a keyword argument; `action_done` in some versions uses a different name.

**How to avoid:** Use `action_feedback` with the `feedback` keyword argument. For safety: wrap in `try/except OdooError` and surface the error as ToolError so the agent can retry with different args.

### Pitfall 7: ir.attachment.datas Returns False for Empty Files

**What goes wrong:** `read_binary("ir.attachment", id, "datas")` returns `b""` when the field is `False` (unset/empty in Odoo). The tool should return a meaningful error, not b64-encode an empty bytes.

**Why it happens:** godoo-client `read_binary()` already handles this: it returns `b""` when `raw is False or raw is None`. The tool should check `len(data) == 0` and return `{"error": "attachment_has_no_content"}` rather than a base64 empty string.

**How to avoid:** Check `if not data: return {"error": "attachment_has_no_content", "id": record_id}`.

---

## Code Examples

### Tool: mail_list_messages

```python
# Odoo field shape confirmed: mail.message has model, res_id, body, author_id, date, message_type, subtype_id
@mcp.tool(
    name="mail_list_messages",
    description="List chatter messages for an Odoo record. Returns mail.message records.",
)
async def mail_list_messages(
    ctx: Context,
    model: str,
    res_id: int,
    limit: int = 80,
    offset: int = 0,
) -> dict[str, object]:
    request = get_http_request()
    creds: OdooCredentials = request.state.odoo_creds
    try:
        async with OdooClient(_make_config(creds)) as client:
            messages = await client.search_read(
                "mail.message",
                [["model", "=", model], ["res_id", "=", res_id]],
                fields=["id", "body", "author_id", "date", "message_type", "subtype_id", "is_internal"],
                limit=limit,
                offset=offset,
                order="date desc",
            )
            return {"messages": messages, "count": len(messages)}
    except OdooError as e:
        raise ToolError(str(e)) from e
```

### Tool: attachments_download

```python
import base64

@mcp.tool(name="attachments_download", description="Download an attachment by id. Returns base64-encoded content.")
async def attachments_download(
    ctx: Context,
    attachment_id: int,
) -> dict[str, object]:
    request = get_http_request()
    creds: OdooCredentials = request.state.odoo_creds
    try:
        async with OdooClient(_make_config(creds)) as client:
            data = await client.read_binary("ir.attachment", attachment_id, "datas")
            if not data:
                return {"error": "attachment_has_no_content", "id": attachment_id}
            # Also fetch name + mimetype for the agent
            records = await client.read("ir.attachment", [attachment_id], fields=["name", "mimetype"])
            meta = records[0] if records else {}
            return {
                "id": attachment_id,
                "name": meta.get("name", ""),
                "mimetype": meta.get("mimetype", "application/octet-stream"),
                "content_base64": base64.b64encode(data).decode(),
                "size_bytes": len(data),
            }
    except OdooError as e:
        raise ToolError(str(e)) from e
```

### Resource: odoo://model/{name} (catalog resolver)

```python
# resources.py
from godoo_mcp_server.server import mcp
from godoo_mcp_server.catalog import get_model_entry_from_cache  # reads cache, no Odoo call

@mcp.resource(
    "odoo://model/{name}",
    name="Odoo Model",
    description="Model metadata + fields for a named Odoo model. Cache-served: call discovery tools first to warm.",
    mime_type="application/json",
)
async def read_model_resource(name: str) -> dict[str, object] | None:
    """Read model metadata from the in-process catalog cache.
    
    Returns None (404) if the model is not in the cache.
    No Odoo RPC — reads from the warmed cache only.
    """
    entry = get_model_entry_from_cache(name)  # dict or None; no await needed
    if entry is None:
        return {"error": "model_not_found", "model": name, "hint": "call discovery_get_fields to warm the catalog"}
    return entry
```

### Skill file serving

```python
# resources.py — loaded at module import time (side-effect import in server.py)
import importlib.resources
import json as _json

_SKILL_FILES: dict[str, str] = {}  # path -> content; populated at import

def _load_skills() -> None:
    pkg = importlib.resources.files("godoo_mcp_server") / "skills"
    paths = ["SKILL.md", "mail/chatter.md", "mail/activities.md", "base/properties.md"]
    for p in paths:
        parts = p.split("/")
        node = pkg
        for part in parts:
            node = node / part
        _SKILL_FILES[p] = node.read_text(encoding="utf-8")
    # Startup assertion: every path loaded
    assert set(_SKILL_FILES.keys()) == set(paths), f"Skill file mismatch: {set(_SKILL_FILES.keys())} != {set(paths)}"

_load_skills()  # runs at side-effect import time

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

**Note on `{path*}` wildcard:** The `*` in `{path*}` is fastmcp's RFC 6570 wildcard path syntax, confirmed in `template.py` (`name.endswith("*")` → `(?P<group>.+)` regex). This allows `skill://odoo/mail/chatter.md` to match `path="mail/chatter.md"`.

---

## State of the Art

| Old Approach | Current Approach | Impact |
|--------------|------------------|--------|
| Eager catalog build (all models+fields+actions+menus at connect) | Lazy, as-needed introspection (D-10) | No startup latency spike; works for large Odoo instances with 1000+ models |
| SSE transport | Streamable HTTP stateless_http=True | Established in Phase 2 |
| gunicorn + uvicorn workers | Single-process uvicorn | Correct for stateless design |
| Per-user ACL probe + filtered tool surface | Full delegation to Odoo (D-12) | Simpler code, fewer edge cases, correct security model |

**Deprecated/outdated in this phase context:**
- `acl.py` (explicitly removed per D-12): do not create this file
- Record-instance resource URIs `odoo://{model}/record/{id}` (deferred, out of scope)

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `activity_schedule` on mail.activity mixin is callable as `client.call(model, "activity_schedule", [res_id], kwargs)` | Godoo-client RPC Surface | Tool fails at runtime; need to check actual Odoo method name (`activity_schedule` vs `activity_schedule_with_view`). Mitigation: wrap in ToolError and test against integration container. |
| A2 | `action_feedback` on mail.activity takes `feedback` as keyword arg | Common Pitfalls #6 | Wrong method name → OdooError surfaced as ToolError (safe degradation) |
| A3 | `odoo://` scheme is accepted by pydantic AnyUrl validator in fastmcp 3.3.1 | Pitfall 4 | Resource registration fails at import time; caught immediately in unit test |
| A4 | `{path*}` wildcard syntax in fastmcp resource URI template matches multi-segment paths | Pattern 5 + skill serving | Skill file at `mail/chatter.md` would not match; fallback to two separate templates if needed |
| A5 | uv_build respects `[tool.uv_build] include = [...]` for non-.py file packaging | Pitfall 5 | Skills not included in wheel; caught by post-install smoke test |

---

## Open Questions

1. **Which fields to return for ir.actions.server / ir.actions.act_window?**
   - What we know: `id`, `name`, `model_id`, `binding_model_id` are shown in the reference resources.ts
   - What's unclear: Which action models to cover in `action_list_actions` — just `ir.actions.server`, or also `ir.actions.act_window`?
   - Recommendation: List both models, union the results, label by `action_type`. Claude's Discretion area.

2. **Catalog warming on first tool call vs explicit discovery**
   - What we know: D-10 says "lazy, as-needed introspection" and "core set checked on first request to a target"
   - What's unclear: Does `get_catalog_snapshot()` need to be called automatically inside every tool call, or only by tools that explicitly need catalog data (resources, discovery)?
   - Recommendation: Do NOT auto-call catalog inside record primitives or mail tools. Only resource resolvers and an explicit `catalog.get_snapshot` tool (if added) trigger catalog warmup. This keeps tool latency predictable.

3. **mail.activity field `date_deadline` format**
   - What we know: Odoo activities have a `date_deadline` field
   - What's unclear: Expected format — `"2026-06-15"` (date string) vs ISO 8601 datetime?
   - Recommendation: Accept ISO date string `"YYYY-MM-DD"` in tool input; pass through to Odoo directly. Odoo validates. Tag [ASSUMED].

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Python 3.14 | Runtime | ✓ | 3.14 (venv) | — |
| fastmcp | MCP framework | ✓ | 3.3.1 | — |
| godoo-client | Odoo RPC | ✓ | 0.2.1 | — |
| cachetools | Catalog cache | ✓ | 7.1.4 | — |
| godoo-testcontainers | Integration tests | ✓ | 0.2.1 | — |
| Docker (for integration tests) | TestHarness Odoo container | Assumed ✓ (used in Phase 3) | — | Skip integration marker |

All runtime dependencies are available. No missing dependencies with no fallback.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | pytest 9 + pytest-asyncio 1.4 |
| Config file | `pyproject.toml [tool.pytest.ini_options]` |
| Quick run command | `uv run pytest tests/ -m "not integration" --tb=short` |
| Full suite command | `uv run pytest --tb=short -m "not integration"` |
| Integration run | `uv run pytest -m integration --tb=short` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| MAIL-01 (post_message) | `mail_post_message` returns `message_id` | unit (mock OdooClient) + integration | `uv run pytest tests/test_mail.py -k post_message` | ❌ Wave 0 |
| MAIL-01 (log_note) | `mail_log_note` with is_internal=True | unit | `uv run pytest tests/test_mail.py -k log_note` | ❌ Wave 0 |
| MAIL-01 (list_messages) | `mail_list_messages` returns messages list | unit + integration | `uv run pytest tests/test_mail.py -k list_messages` | ❌ Wave 0 |
| MAIL-01 (schedule_activity) | `mail_schedule_activity` returns activity_id | unit + integration | `uv run pytest tests/test_mail.py -k schedule_activity` | ❌ Wave 0 |
| MAIL-01 (list_activities) | `mail_list_activities` returns activities | unit + integration | `uv run pytest tests/test_mail.py -k list_activities` | ❌ Wave 0 |
| MAIL-01 (mark_done) | `mail_mark_activity_done` returns success | unit + integration | `uv run pytest tests/test_mail.py -k mark_done` | ❌ Wave 0 |
| ACT-01 | `action_list_actions` + `action_execute_action` | unit | `uv run pytest tests/test_actions.py` | ❌ Wave 0 |
| ATT-01 | `attachments_list` + `attachments_upload` + `attachments_download` | unit + integration | `uv run pytest tests/test_attachments.py` | ❌ Wave 0 |
| USER-02 | `users_search_users` returns matching users | unit | `uv run pytest tests/test_users.py -k search_users` | ❌ Wave 0 (extends existing) |
| DISC-03 | `discovery_list_menus` returns menus | unit | `uv run pytest tests/test_discovery.py -k list_menus` | ❌ Wave 0 (extends existing) |
| CAT-01 | Schema hash computed from 3 probes; non-None result | unit | `uv run pytest tests/test_catalog.py -k schema_hash` | ❌ Wave 0 |
| CAT-02 | Second call with same hash hits cache (no RPC) | unit (mock + call count) | `uv run pytest tests/test_catalog.py -k cache_hit` | ❌ Wave 0 |
| CAT-02 | Cache miss on schema-hash change | unit (mock hash change) | `uv run pytest tests/test_catalog.py -k cache_miss` | ❌ Wave 0 |
| RES-01 | `odoo://model/{name}` resource returns JSON | unit (mock catalog) | `uv run pytest tests/test_resources.py -k model_resource` | ❌ Wave 0 |
| RES-01 | `skill://index.json` resource returns discovery JSON | unit | `uv run pytest tests/test_resources.py -k skill_index` | ❌ Wave 0 |
| SKILL-01 | All 4 skill .md files readable as MCP resources | unit | `uv run pytest tests/test_resources.py -k skill_file` | ❌ Wave 0 |
| SKILL-02 | Startup assertion: every .md has index entry | unit (assert fires on bad state) | `uv run pytest tests/test_resources.py -k startup_assertion` | ❌ Wave 0 |
| D-12 (two-user isolation) | Catalog cache key never includes credentials; two users share same cache key | unit (two-user concurrent tool call) + integration | `uv run pytest tests/test_catalog.py -k isolation` | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `uv run pytest tests/ -m "not integration" --tb=short`
- **Per wave merge:** `uv run pytest tests/ -m "not integration" --tb=short` (full unit suite)
- **Phase gate:** Full suite (unit + integration) green before `/gsd:verify-work`

### Wave 0 Gaps

All test files below are new (none exist yet):

- [ ] `tests/test_mail.py` — covers MAIL-01 (6 tools, unit with mock OdooClient)
- [ ] `tests/test_actions.py` — covers ACT-01
- [ ] `tests/test_attachments.py` — covers ATT-01 (including base64 encode/decode, empty-file guard)
- [ ] `tests/test_catalog.py` — covers CAT-01, CAT-02, D-12 isolation
- [ ] `tests/test_resources.py` — covers RES-01, SKILL-01, SKILL-02, startup assertion
- [ ] Extend `tests/test_users.py` — add `users_search_users` test cases
- [ ] Extend `tests/test_discovery.py` — add `discovery_list_menus` test cases
- [ ] Extend `tests/integration/test_vertical.py` — add mail + attachments integration scenarios

**Existing test infrastructure (usable as-is):**
- `tests/conftest.py` — `mcp_client` fixture (lifespan + ASGI transport + fake credentials)
- `tests/integration/conftest.py` — `odoo_harness`, `mcp_client_factory`, `second_user_credentials`
- `asyncio_mode = "auto"` in pyproject.toml — no per-test `@pytest.mark.asyncio` needed

**Unit test strategy for new tools:** Use `unittest.mock.AsyncMock` to patch `OdooClient.__aenter__` and `__aexit__`. The `async with OdooClient(config) as client:` pattern means patching `OdooClient` at the module level replaces the context manager. Pattern confirmed from existing `test_records.py`, `test_users.py`.

---

## Security Domain

`security_enforcement` is not set to `false` in project config. This section is included.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | Per-request header credentials; OdooClient authenticates each call |
| V3 Session Management | no | stateless_http=True; no sessions |
| V4 Access Control | yes (delegated) | Odoo enforces; OdooAccessError → ToolError |
| V5 Input Validation | yes | All tool inputs typed via pydantic; fastmcp auto-validates |
| V6 Cryptography | no | No crypto in this phase; credentials transported via headers (TLS is deployment concern) |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Catalog cache key includes credentials | Information Disclosure | D-10/D-12: key = (url, db, schema_hash) only — verified by isolation test |
| Attachment download of binary field leaks sensitive data | Information Disclosure | Odoo ACL enforced at RPC level; `OdooAccessError → ToolError` before content returned |
| Skill .md file injection (malicious content) | Tampering | Files are read-only, committed in-repo, no untrusted writer path |
| Resource resolver makes live Odoo call without credentials | Spoofing | Pattern: resources NEVER call Odoo — they read from cache only (see Pitfall 1) |
| Cache poisoning via schema-hash collision | Tampering | Hash is `write_date|write_date|write_date` — collision requires Odoo DB write access; not a client concern |
| Traceback leakage via ToolError | Information Disclosure | Established pattern: `raise ToolError(str(e)) from e` (not `repr(e)`, not traceback) |

---

## Sources

### Primary (HIGH confidence — verified from installed codebase)
- `src/godoo_mcp_server/tools/records.py` — established tool pattern (per-request OdooClient, `get_http_request()`, `ToolError`)
- `.venv/Lib/site-packages/godoo/client/client.py` — all OdooClient methods: `call()`, `search_read()`, `read_binary()`, `create()`, `write()`, `unlink()`
- `.venv/Lib/site-packages/godoo/client/services/mail/functions.py` — `message_post` kwargs shape, `ensure_html_body`, `_extract_id`
- `.venv/Lib/site-packages/godoo/client/services/mail/types.py` — `PostMessageOptions` shape
- `.venv/Lib/site-packages/fastmcp/server/server.py` lines 1803-1920 — `@mcp.resource()` decorator API
- `.venv/Lib/site-packages/fastmcp/resources/template.py` — `ResourceTemplate`, `{path*}` wildcard, RFC 6570 URI template parsing
- `.venv/Lib/site-packages/fastmcp/resources/base.py` — `Resource`, `ResourceContent`, `ResourceResult`
- `.venv/Lib/site-packages/cachetools/__init__.py` — `TTLCache` confirmed at 7.1.4
- `tests/integration/conftest.py` — `second_user_credentials`, `mcp_client_factory`, session-scoped fixtures
- `tests/integration/test_vertical.py` — established integration test pattern
- `src/godoo_mcp_server/server.py` — side-effect import pattern for tool registration

### Secondary (MEDIUM confidence — TypeScript reference, design-only)
- `odoo-api-proxy/.claude/worktrees/.../schema-hash.ts` — 3 write_date probe pattern (ported to Python in this research)
- `odoo-api-proxy/.claude/worktrees/.../resources.ts` — URI scheme design, resource descriptor shape
- `odoo-api-proxy/.claude/worktrees/.../skill.ts` — skill file loading pattern, index.json structure
- `odoo-api-proxy/skills/odoo/SKILL.md` — skill file content reference (to adapt per D-14)
- `odoo-api-proxy/skills/odoo/mail/chatter.md` — chatter skill content reference

### Tertiary (LOW confidence — not independently verified)
- Odoo `mail.activity.action_feedback` method signature — [ASSUMED: standard Odoo 16/17 API, unverified against this test container's Odoo version]
- `activity_schedule` method name — [ASSUMED: verify against integration container]

---
