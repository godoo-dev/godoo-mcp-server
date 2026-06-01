# Architecture Research

**Domain:** Stateless Python MCP server — agent-facing Odoo RPC gateway
**Researched:** 2026-06-01
**Confidence:** HIGH (godoo-py source read directly; MCP Python SDK verified via official docs and source)

## Standard Architecture

### System Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                       External Boundary                              │
│   Agent (Claude / quickdoo) ──── X-Odoo-* headers ────────────►    │
│                                  or env-var fallback                 │
└──────────────────────────────┬──────────────────────────────────────┘
                               │ HTTP POST /mcp  (Streamable HTTP)
┌──────────────────────────────▼──────────────────────────────────────┐
│                    Transport + ASGI Layer                            │
│  Starlette ASGI app  ◄── CredentialMiddleware (extracts X-Odoo-*)   │
│  FastMCP(stateless_http=True).http_app(middleware=[...])            │
│  Credential stored in request.scope["odoo_creds"] via ContextVar    │
└──────────────────────────────┬──────────────────────────────────────┘
                               │ MCP protocol dispatch
┌──────────────────────────────▼──────────────────────────────────────┐
│                      MCP Server Layer (FastMCP)                      │
│  ┌─────────────────┐  ┌──────────────────┐  ┌───────────────────┐  │
│  │  Tool Registry  │  │ Resource Registry│  │  Tool Handlers    │  │
│  │  @mcp.tool()    │  │ @mcp.resource()  │  │  (per-request)    │  │
│  └────────┬────────┘  └────────┬─────────┘  └────────┬──────────┘  │
│           │                   │                       │             │
└───────────┼───────────────────┼───────────────────────┼─────────────┘
            │                   │                       │
┌───────────▼───────────────────▼───────────────────────▼─────────────┐
│                     Service / Domain Layer                            │
│  ┌──────────────┐  ┌────────────────┐  ┌──────────────────────────┐ │
│  │CredResolver  │  │ CatalogService │  │  SkillsService           │ │
│  │(headers→env) │  │ (introspect +  │  │  (Markdown + index.json) │ │
│  └──────┬───────┘  │  LRU+TTL cache)│  └──────────────────────────┘ │
│         │          └───────┬────────┘                               │
│  ┌──────▼───────┐  ┌───────▼────────┐  ┌──────────────────────────┐ │
│  │ OdooAdapter  │  │ ResourceBuilder│  │  AclProbe                │ │
│  │(godoo client │  │(catalog→MCP    │  │(check_access_rights per  │ │
│  │ factory)     │  │ resource URIs) │  │ user → filtered tool set)│ │
│  └──────┬───────┘  └────────────────┘  └──────────────────────────┘ │
└─────────┼───────────────────────────────────────────────────────────┘
          │ godoo.client.OdooClient  (constructed per-request)
┌─────────▼───────────────────────────────────────────────────────────┐
│                      godoo-py (>=1.1,<1.2)                          │
│  OdooClient.authenticate() → search/read/create/write/call          │
│  introspector (ir.model / ir.model.fields)                          │
└─────────────────────────────────────────────────────────────────────┘
          │ JSON-RPC / HTTPS
┌─────────▼───────────────────────────────────────────────────────────┐
│                          Odoo Instance                               │
└─────────────────────────────────────────────────────────────────────┘

                   ┌─────────────────────────────────┐
                   │  Wave 3 only: Code Mode Sandbox  │
                   │  ┌──────────────────────────────┐│
                   │  │  execute_odoo_code tool      ││
                   │  │   │                          ││
                   │  │  Sandbox runner              ││
                   │  │  (subprocess / Docker sidecar││
                   │  │   — mechanism TBD W3)        ││
                   │  │   │                          ││
                   │  │  OdooRpcProxy (allowlisted)  ││
                   │  │  routes ONLY through godoo   ││
                   │  └──────────────────────────────┘│
                   └─────────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | Layer |
|-----------|---------------|-------|
| `CredentialMiddleware` | Extract `X-Odoo-{Url,Database,Username,Password}` headers; fall back to env vars; raise 401 if neither set; store resolved creds in `request.scope` + ContextVar | Transport/ASGI |
| `FastMCP` (stateless) | MCP protocol: tool/resource registration, request dispatch, JSON-RPC frame handling. `stateless_http=True` — no server-side sessions | MCP |
| `CredResolver` | Pure function: `(scope | headers) → OdooCredentials`; precedence logic in one place | Service |
| `OdooAdapter` | Factory for `OdooClient` from resolved credentials; calls `authenticate()`; constructs fresh client per request; no shared clients | Service |
| `CatalogService` | Parallelised introspection of `ir.model`, `ir.model.fields`, `ir.actions.*`, `ir.ui.menu`; computes schema hash; wraps in process-global `LRU+TTL` cache keyed by `(url, database, schema_hash)` | Service |
| `ResourceBuilder` | Transforms catalog snapshot into MCP resource descriptors; assigns URI convention (`odoo://model/{name}`, `odoo://action/{id}`, etc.) | Service |
| `AclProbe` | Calls `check_access_rights` for curated models/tools on behalf of the authenticated user; returns filtered tool/resource set; result cached per `(url, database, uid)` with short TTL | Service |
| `SkillsService` | Serves bundled Markdown files (`SKILL.md`, `mail/*.md`, `base/*.md`) and `index.json` as MCP Resources; stateless — files ship with the package | Service |
| `ToolHandlers` | One module per tool group (`record`, `mail`, `action`, `users`, `attachments`, `discovery`); each handler resolves creds from ContextVar, builds godoo client, executes Odoo RPC, returns result | Service |
| `SandboxRunner` (W3) | Executes agent-authored code in isolated subprocess/container; injects `OdooRpcProxy` as sole networking surface; enforces capability grants (read-only default) | Code Mode |
| `OdooRpcProxy` (W3) | Allowlisted wrapper around godoo client inside sandbox; exposes only approved methods; blocks all other network; logs every call for audit | Code Mode |

## Recommended Project Structure

```
godoo_mcp_server/
├── __init__.py              # package version, public exports
├── __main__.py              # entry point: python -m godoo_mcp_server
├── server.py                # FastMCP app factory + middleware wiring
├── config.py                # OdooCredentials dataclass, env-var names
│
├── transport/
│   ├── __init__.py
│   └── credential_middleware.py  # Starlette BaseHTTPMiddleware; header→scope
│
├── credentials/
│   ├── __init__.py
│   └── resolver.py          # resolve_credentials(scope) → OdooCredentials | error
│
├── odoo/
│   ├── __init__.py
│   └── adapter.py           # build_client(creds) → OdooClient (authenticated)
│
├── catalog/
│   ├── __init__.py
│   ├── introspector.py      # build_catalog_content(client) → CatalogSnapshot (parallel)
│   ├── cache.py             # LRU+TTL store; key=(url, db, schema_hash)
│   └── resource_builder.py  # catalog_to_resources(snapshot) → list[McpResource]
│
├── acl/
│   ├── __init__.py
│   └── probe.py             # probe_acl(client, tools) → FilteredToolSet
│
├── skills/
│   ├── __init__.py
│   ├── loader.py            # reads bundled Markdown + index.json at startup
│   └── data/                # static Markdown (direct port from odoo-api-proxy)
│       ├── index.json
│       ├── SKILL.md
│       ├── mail/
│       │   ├── chatter.md
│       │   └── activities.md
│       └── base/
│           └── properties.md
│
├── tools/                   # one module per tool group
│   ├── __init__.py          # register_all(mcp) helper
│   ├── record.py            # search_records, read_records, create_record, ...
│   ├── mail.py              # post_message, log_note, list_messages, ...
│   ├── action.py            # execute_action, list_actions
│   ├── users.py             # whoami, search_users
│   ├── attachments.py       # list/upload/download_attachment
│   └── discovery.py         # list_models, get_fields, list_menus
│
└── codemode/                # Wave 3 — isolated sub-package
    ├── __init__.py
    ├── tool.py              # execute_odoo_code MCP tool registration
    ├── runner.py            # sandbox lifecycle: spawn, inject proxy, timeout, teardown
    ├── proxy.py             # OdooRpcProxy — allowlist enforcement + audit log
    └── grants.py            # CapabilityGrant enum: READ_ONLY | WRITE_ALLOWED
```

### Structure Rationale

- **`transport/`**: Separates HTTP-level concerns (headers, CORS, auth extraction) from MCP semantics. Starlette middleware has a clean interface here.
- **`credentials/`**: Single responsibility for the precedence rule (headers beat env). Pure function — easy to unit test without any network.
- **`odoo/adapter.py`**: The only place that calls `OdooClient(config)` and `.authenticate()`. All tool handlers go through this; swapping transport is one change.
- **`catalog/`**: Groups introspection logic + cache + resource transform. Introspection is slow (multiple Odoo queries), so caching is a co-located concern.
- **`tools/`**: Mirrors the MCP tool naming convention (`record.*`, `mail.*`, etc.) directly in file names. Each file imports `get_current_client()` from a ContextVar accessor.
- **`codemode/`**: Wave 3 only. Physically separated sub-package with its own security boundary. Can be feature-flagged at registration time in `server.py`.

## Architectural Patterns

### Pattern 1: ContextVar-Based Per-Request Credential Flow

**What:** A Starlette `BaseHTTPMiddleware` extracts `X-Odoo-*` headers (or reads env vars) and stores the resolved `OdooCredentials` into a `contextvars.ContextVar` before the request continues. Tool handlers read the ContextVar to build their `OdooClient` without receiving credentials as parameters.

**When to use:** Stateless HTTP servers where every request carries its own credential context. The ContextVar is asyncio-task-scoped — safe for concurrent requests.

**Important caveat (verified via SDK source and issue #750/#1063):** The official MCP Python SDK `FastMCP` does NOT provide a built-in mechanism for tool handlers to access X-* custom HTTP headers. The `request_context` in `Context` carries MCP session metadata, not the raw HTTP request. The Starlette middleware approach is the correct workaround: inject into scope AND into a ContextVar in the middleware `dispatch()` method before `await call_next(request)`, so the ContextVar is set for the duration of the asyncio task that processes the MCP tool call.

**Example:**
```python
# transport/credential_middleware.py
import contextvars
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from godoo_mcp_server.credentials.resolver import resolve_credentials

_current_creds: contextvars.ContextVar["OdooCredentials"] = contextvars.ContextVar(
    "godoo_mcp_current_creds"
)

class CredentialMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        creds = resolve_credentials(request.headers)  # headers beat env
        token = _current_creds.set(creds)
        try:
            return await call_next(request)
        finally:
            _current_creds.reset(token)

def get_current_creds() -> "OdooCredentials":
    creds = _current_creds.get(None)
    if creds is None:
        raise RuntimeError("No credential context — call outside request?")
    return creds
```

```python
# tools/record.py
from godoo_mcp_server.transport.credential_middleware import get_current_creds
from godoo_mcp_server.odoo.adapter import build_client

@mcp.tool()
async def search_records(model: str, domain: list, limit: int = 80) -> list[dict]:
    creds = get_current_creds()
    client = await build_client(creds)
    return await client.search_read(model, domain, limit=limit)
```

**Trade-offs:** Requires Starlette middleware knowledge; the ContextVar token must be reset in `finally`. This pattern is well-established in the Python async ecosystem (starlette-context uses the same approach). PrefectHQ's FastMCP package provides `get_http_headers()` as an alternative if the project switches packages, but the official `mcp` package requires this middleware pattern.

### Pattern 2: Process-Global LRU+TTL Catalog Cache

**What:** A single in-process cache (e.g. `cachetools.TTLCache` wrapped with `asyncio.Lock`) holds catalog snapshots keyed by `(url, database, schema_hash)`. The schema hash is computed from the introspection result itself — a hash over sorted model names + field counts. On every catalog request, the introspector first fetches a lightweight hash probe (models list only), then serves from cache if the hash matches.

**When to use:** Catalog introspection touches multiple Odoo models (`ir.model`, `ir.model.fields`, `ir.actions.*`, `ir.ui.menu`) and is expensive. A TTL of ~5 minutes with schema-hash invalidation is appropriate.

**Cache key design:**
```
key = (odoo_url, database_name, schema_hash)
```
The `schema_hash` is a SHA-256 of sorted model names joined with field counts. This ensures that when a new module installs a model or field, the next request after the TTL expires gets a fresh catalog, and the old key is naturally evicted.

**Stateless safety:** Cache is per-process, lost on restart. Multiple Docker replicas each have their own cache — that is acceptable for this use case. No distributed cache dependency.

**Trade-offs:** Schema hash probe requires one Odoo call even on cache hits (models list only, cheap). Cache is unbounded in entry count per URL/DB combination if deployments cycle through many instances — bound with `maxsize`.

### Pattern 3: ACL-Filtered Tool Registration

**What:** Rather than filtering tools at call time, the server probes `check_access_rights` for a curated model set on first use of a user session (or per request, with a short TTL cache), then returns a filtered `list_tools` response. This mirrors `probeAclForCuratedTools` from `odoo-api-proxy`.

**When to use:** MCP clients cache the tool list. Returning only tools the user can actually use prevents confusing errors at call time.

**Cache key:** `(url, database, uid)` with TTL of ~60 seconds. The `uid` comes from `client.get_session().uid` after `authenticate()`.

**Trade-offs:** Requires one extra set of Odoo calls per unique user (cheap — `check_access_rights` is a single JSON-RPC call per model). ACL changes in Odoo are not reflected until TTL expiry.

### Pattern 4: Parallelised Catalog Introspection

**What:** `build_catalog_content` fires `ir.model.search_read`, `ir.model.fields.search_read`, `ir.actions.*.search_read`, and `ir.ui.menu.search_read` as concurrent `asyncio.gather` tasks. Mirrors the TypeScript `Promise.all` pattern in `odoo-api-proxy`.

**When to use:** Always — introspection is the primary latency bottleneck. Sequential calls would take 4–8× longer.

**Example skeleton:**
```python
async def build_catalog_content(client: OdooClient) -> CatalogSnapshot:
    models_task = client.search_read("ir.model", fields=["name", "model", "transient"])
    fields_task = client.search_read("ir.model.fields", fields=["name", "ttype", "model_id", ...])
    actions_task = client.search_read("ir.actions.act_window", fields=["name", "res_model", ...])
    menus_task = client.search_read("ir.ui.menu", fields=["name", "action", "parent_id"])
    models, fields, actions, menus = await asyncio.gather(
        models_task, fields_task, actions_task, menus_task
    )
    schema_hash = compute_schema_hash(models, fields)
    return CatalogSnapshot(models=models, fields=fields, actions=actions, menus=menus, schema_hash=schema_hash)
```

## Data Flow

### Request Flow (Wave 1+2 — standard tool call)

```
Agent HTTP POST /mcp
  │
  ▼
CredentialMiddleware.dispatch()
  ├─ Extract X-Odoo-{Url,Database,Username,Password} from headers
  ├─ Fall back to ODOO_{URL,DATABASE,USERNAME,PASSWORD} env vars
  ├─ Raise 401 / McpError if neither set
  └─ Set _current_creds ContextVar for this asyncio task
  │
  ▼
FastMCP protocol dispatch → tool handler (e.g. search_records)
  │
  ├─ get_current_creds()  → OdooCredentials
  ├─ build_client(creds)  → OdooClient (authenticated, per-request)
  ├─ [optional] probe_acl(client) → confirm access
  └─ client.search_read(...) → list[dict]
  │
  ▼
JSON-RPC → Odoo → response
  │
  ▼
MCP tool result → agent
```

### Request Flow (catalog / resource read)

```
Agent reads resource odoo://model/sale.order
  │
  ▼
CredentialMiddleware (same credential extraction)
  │
  ▼
Resource handler
  ├─ get_current_creds()
  ├─ build_client(creds)
  ├─ CatalogService.get_catalog(client)
  │     ├─ compute lightweight schema_hash probe (1 Odoo call)
  │     ├─ cache hit? → return CatalogSnapshot
  │     └─ cache miss → build_catalog_content(client) [parallel introspection]
  │                     → store in cache, return snapshot
  └─ ResourceBuilder.build(snapshot) → MCP resource content
```

### Per-Request vs Process-Global State

| State | Scope | How |
|-------|-------|-----|
| `OdooCredentials` | Per-request (asyncio task) | ContextVar set by middleware |
| `OdooClient` | Per-request | Constructed in tool handler via `build_client(creds)` — NOT cached |
| Catalog snapshot | Process-global, per (url, db, schema_hash) | LRU+TTL cache in `CatalogService` |
| ACL probe result | Process-global, per (url, db, uid), short TTL | LRU+TTL cache in `AclProbe` |
| Skills Markdown | Process-global (loaded at startup) | Module-level dict in `SkillsService` |
| Session auth token | Per-request (inside `OdooClient._transport.session`) | Lives and dies with the client object |

**Why a new `OdooClient` per request?** godoo's `OdooClient` is not thread-safe for credential mixing, and the credential set differs per caller. The cost of `authenticate()` is one JSON-RPC call (Odoo session establishment) — acceptable. If this proves a bottleneck, the adapter can be extended to pool authenticated sessions per credential tuple, but that is NOT in scope for v1.0.

### MCP Tool and Resource Registration Lifecycle

**Verified against official Python MCP SDK (v1.12.4):**

Tools and resources are registered at import time via decorators on a `FastMCP` instance:

```python
# server.py
from mcp.server.fastmcp import FastMCP
from godoo_mcp_server.tools import register_all

mcp = FastMCP("godoo-mcp-server", stateless_http=True)
register_all(mcp)  # calls @mcp.tool() decorators in each tools/*.py module

def create_app():
    from godoo_mcp_server.transport.credential_middleware import CredentialMiddleware
    from starlette.middleware import Middleware
    return mcp.http_app(
        stateless_http=True,
        middleware=[Middleware(CredentialMiddleware)],
    )
```

The `http_app()` call returns a Starlette `Router` that is ASGI-compatible. The `CredentialMiddleware` wraps it. Tool handlers registered with `@mcp.tool()` are called within the asyncio context established by the middleware, so the ContextVar is visible.

Resources (`@mcp.resource("odoo://model/{name}")`) work identically — the same ContextVar is available.

**Stateless HTTP (`stateless_http=True`):** Each POST to `/mcp` creates a fresh `StreamableHTTPServerTransport` with no session tracking. No `Mcp-Session-Id` is required from clients. This matches the project constraint: per-user, not per-session state.

## Code Mode Sandbox Boundary (Wave 3)

The sandbox boundary is the most security-sensitive architectural seam. All decisions here are non-negotiable even at MVP.

### Boundary Model

```
┌─────────────────────────────────────────────────────────┐
│                  godoo-mcp-server process                │
│                                                          │
│  execute_odoo_code tool handler                          │
│    │                                                     │
│    ▼                                                     │
│  SandboxRunner.run(code, creds, grants)                  │
│    │                                                     │
│    ├── spawn subprocess / Docker sidecar                 │
│    │     (mechanism: TBD at W3 planning)                 │
│    │                                                     │
│    │   ┌─────────────────────────────────────────────┐  │
│    │   │            Sandbox process                  │  │
│    │   │                                             │  │
│    │   │  agent_code.py  imports only:               │  │
│    │   │    odoo = OdooRpcProxy(socket/pipe)          │  │
│    │   │                                             │  │
│    │   │  OdooRpcProxy methods:                      │  │
│    │   │    search, read, search_read                │  │
│    │   │    [create, write, unlink if WRITE grant]   │  │
│    │   │    call (allowlisted methods only)          │  │
│    │   │                                             │  │
│    │   │  Network: BLOCKED (no socket(), no http)    │  │
│    │   │  File system: read-only tmpdir only         │  │
│    │   │  Timeout: hard kill after N seconds         │  │
│    │   └─────────────────────────────────────────────┘  │
│    │                                                     │
│    │   OdooRpcProxy server (in main process or sidecar)  │
│    │     receives calls over IPC pipe / Unix socket      │
│    │     validates method against allowlist              │
│    │     validates capability grant (READ_ONLY default)  │
│    │     logs every call to audit log                    │
│    │     forwards to godoo OdooClient                    │
│    │     returns result to sandbox                       │
│    │                                                     │
│    └── collect stdout/stderr, enforce timeout           │
│        return result or raise SandboxError              │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

### Architectural Seams (Code Mode)

| Seam | Description | Non-Negotiable |
|------|-------------|----------------|
| **No direct network** | Sandbox process has no internet access; all Odoo calls go through `OdooRpcProxy` IPC | Yes |
| **Allowlist enforcement** | `OdooRpcProxy` validates method name against `ALLOWED_METHODS` set before forwarding | Yes |
| **Capability grant** | `READ_ONLY` by default; `WRITE_ALLOWED` requires explicit `grants=["write"]` in tool invocation; checked in proxy before forwarding mutating calls | Yes |
| **Per-invocation isolation** | Sandbox process spawned fresh per tool call; no shared state between code executions | Yes |
| **Audit log** | Every proxy call logged: timestamp, user credentials hash, model, method, args summary | Yes |
| **Rate limiting** | Per-credential, per-unit-time invocation counter in main process; reject before spawning sandbox | Yes (at W3) |
| **Hard timeout** | `subprocess.wait(timeout=N)` + `SIGKILL`; prevents infinite loops eating resources | Yes |
| **Mechanism TBD** | `subprocess` (simpler, less isolation) vs Docker sidecar (stronger isolation) — research-gated | Decide at W3 |

### Sandbox Mechanism Comparison (preliminary)

| Aspect | subprocess | Docker sidecar |
|--------|-----------|----------------|
| Network isolation | OS-level: no (requires seccomp/namespaces) | Yes (no network mode) |
| File isolation | Limited without chroot | Yes (tmpfs only) |
| Complexity | Low | Medium (requires Docker daemon) |
| Cold start | ~10ms | ~200-500ms |
| Deployment | Works in pip install | Requires Docker |
| Recommendation | Use for W3 MVP if seccomp available; else Docker | Preferred for production |

**Preliminary recommendation:** Start W3 with `subprocess` + `restrictedpython` or `exec` into a pre-built isolated environment, with seccomp filter blocking socket(). If Docker is available in the deployment, prefer Docker sidecar. The seam is designed so the mechanism is swappable behind `SandboxRunner.run()`.

## Scaling Considerations

| Scale | Architecture Adjustments |
|-------|--------------------------|
| 1-10 users | Single Uvicorn worker; process-global cache sufficient |
| 10-100 users | 2-4 Uvicorn workers; cache duplicated per worker (acceptable — Odoo itself is the bottleneck) |
| 100-1K users | Multiple Docker replicas behind a load balancer; stateless design allows any replica to handle any request without sticky sessions |
| 1K+ users | Odoo instance is the bottleneck, not this server; consider connection pooling at the godoo adapter layer; this server adds negligible overhead |

### Scaling Priorities

1. **First bottleneck:** Odoo RPC latency per request (`authenticate()` + actual RPC). Mitigation: credential-keyed session pool (deferred, not in v1.0 scope).
2. **Second bottleneck:** Catalog introspection on cold start per process. Mitigation: existing LRU+TTL cache.
3. **Third bottleneck (Code Mode only):** Sandbox process spawn latency. Mitigation: pre-warmed process pool (deferred).

## Anti-Patterns

### Anti-Pattern 1: Shared OdooClient Across Requests

**What people do:** Cache `OdooClient` objects in a process-global dict keyed by credential tuple to avoid re-authenticating.
**Why it's wrong:** If credentials rotate, the cached client uses stale auth. If two users share a URL+database with different passwords, a dict keyed by `(url, db)` only would serve the wrong client. godoo's `OdooClient` is not designed as a thread-safe connection pool.
**Do this instead:** Build a fresh client per request. Add a session pool only if profiling proves `authenticate()` is the bottleneck, with explicit TTL and credential-exact key `(url, db, username, password_hash)`.

### Anti-Pattern 2: Storing Credentials in the Catalog Cache Key

**What people do:** Key the catalog cache by `(url, database, username, password)` to ensure per-user catalog isolation.
**Why it's wrong:** The Odoo catalog (model/field schema) is per-database, not per-user. Caching per-user multiplies cache entries by user count — N×10MB entries instead of one. Schema is identical for all users of the same database.
**Do this instead:** Key catalog cache by `(url, database, schema_hash)`. Perform ACL filtering separately in `AclProbe` which is user-scoped but lightweight (one `check_access_rights` call per model).

### Anti-Pattern 3: Reading X-Odoo-* Headers Inside Tool Handlers

**What people do:** Use `get_http_headers(include_all=True)` from PrefectHQ fastmcp (or attempt raw header reads) inside `@mcp.tool()` handlers.
**Why it's wrong:** (a) The official `mcp` package does NOT expose raw HTTP headers to tool handlers as of v1.12.4 (issue #750 is open); (b) relying on PrefectHQ's `fastmcp` package instead of the official `mcp` package adds an unvetted dependency; (c) puts credential extraction logic scattered across all handlers.
**Do this instead:** Extract once in `CredentialMiddleware`, store in ContextVar, read from ContextVar in handlers. Single extraction point, testable in isolation.

### Anti-Pattern 4: Registering Tools Dynamically per Request

**What people do:** Register different tool sets per request based on ACL, to let the MCP client see only permitted tools.
**Why it's wrong:** FastMCP registers tools at server startup. There is no per-request tool list mutation in the official SDK. Attempting this would require low-level Server API and is fragile.
**Do this instead:** Register all tools at startup. Gate execution inside handlers with a quick `check_access_rights` call, or return a filtered `list_tools` via the ACL probe pattern (return McpError with "permission denied" when the user lacks access). The MCP spec allows servers to return capability-based errors.

### Anti-Pattern 5: Putting OAuth/Token Issuance in This Server

**What people do:** Add a `/token` endpoint or OAuth 2.1 flow to this server because it already handles HTTP.
**Why it's wrong:** This server's boundary is absolute: it consumes credentials, never generates them. Adding auth flows creates coupling to `godoo-proxy` (the commercial satellite) that would make this FOSS server non-deployable without the proxy.
**Do this instead:** `godoo-proxy` injects headers. Self-hosted users set env vars or pass headers directly. This server is stateless with respect to auth — intentionally.

## Integration Points

### External Services

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| Odoo (any version) | godoo-py JSON-RPC; `OdooClient.authenticate()` per request | Pin `godoo>=1.1,<1.2`; do not call `xmlrpc` directly |
| Docker daemon (W3) | `docker run --network none --rm ...` via subprocess or Docker SDK | Optional; only if Docker sidecar chosen for sandbox |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| `CredentialMiddleware` → tool handlers | ContextVar (`_current_creds`) | Set in middleware, read in handlers |
| `CatalogService` → `ResourceBuilder` | Function call: `CatalogSnapshot` dataclass | Pure data, no shared mutable state |
| `CatalogService` → `AclProbe` | Separate calls; both use same `OdooClient` | Do NOT share; ACL is user-scoped, catalog is DB-scoped |
| `SandboxRunner` → `OdooRpcProxy` | IPC (Unix socket or stdin/stdout pipe) | Sandbox can only reach proxy via this channel |
| `OdooRpcProxy` → `OdooClient` | Direct function call (in main process) | Proxy enforces allowlist BEFORE calling client |

## Build Order / Dependency Graph

### Wave 1: Skeleton + Credentials + Core Tools

Dependencies must be satisfied in order:

```
[1a] config.py + credentials/resolver.py
      (pure functions, no external deps — test first)
      ↓
[1b] transport/credential_middleware.py
      (depends on resolver; tests with mock scope)
      ↓
[1c] odoo/adapter.py
      (depends on godoo-py + credentials; needs live Odoo for integration tests)
      ↓
[1d] server.py skeleton
      (wire FastMCP + middleware; run() with uvicorn)
      ↓
[1e] tools/record.py + tools/discovery.py + tools/users.py (whoami)
      (depends on adapter + server skeleton)
      ↓
[1f] Integration test: connect quickdoo → server → real Odoo
```

**Parallel opportunity in W1:** `[1a]` and studying godoo-py API can proceed before `[1b]`.

### Wave 2: Full Surface + Catalog + Resources + ACL + Skills + Cache

```
[2a] tools/mail.py + tools/action.py + tools/attachments.py
      (extends W1 tool pattern — straightforward, do in parallel)
      ↓
[2b] catalog/introspector.py
      (depends on godoo-py introspection package; parallel implementation)
      ↓
[2c] catalog/cache.py
      (depends on introspector; pure cachetools wrapper)
      ↓
[2d] catalog/resource_builder.py
      (depends on introspector output; pure transform)
      ↓
[2e] acl/probe.py
      (depends on adapter; parallel with 2b-2d)
      ↓
[2f] skills/loader.py + skills/data/ (port Markdown files)
      (no dependencies — can land in W1 branch if convenient)
      ↓
[2g] Resource registration in server.py
      (wires resource_builder + skills into @mcp.resource() calls)
      ↓
[2h] Deprecation notice: @marcfargas/odoo-mcp npm package
```

**Parallel opportunities in W2:** `[2a]`, `[2b+2c+2d]`, `[2e]`, and `[2f]` can all proceed in parallel.

### Wave 3: Code Mode

```
[3a] codemode/grants.py — CapabilityGrant enum
      ↓
[3b] codemode/proxy.py — OdooRpcProxy allowlist + audit log
      (depends on adapter for upstream client construction)
      ↓
[3c] codemode/runner.py — SandboxRunner
      (depends on proxy; sandbox mechanism decided here)
      ↓
[3d] codemode/tool.py — execute_odoo_code MCP tool registration
      (depends on runner + grants)
      ↓
[3e] Rate limiting (invocation counter per credential, in main process)
      ↓
[3f] Skill files updated with execute_odoo_code code block recipes
```

**Prerequisite for W3:** Sandbox isolation mechanism decided (subprocess vs Docker). This is research-gated — do not start [3c] until mechanism is chosen.

## Sources

- godoo-py source: `C:\dev\godoo-dev\godoo-py\packages\godoo-client\src\godoo\client\client.py` (read directly — HIGH confidence)
- godoo-py `OdooClientConfig` and `config_from_env`: `C:\dev\godoo-dev\godoo-py\packages\godoo-client\src\godoo\client\config.py` (read directly — HIGH confidence)
- godoo-py introspector: `C:\dev\godoo-dev\godoo-py\packages\godoo-introspection\src\godoo\introspection\introspector.py` (read directly — HIGH confidence)
- MCP Python SDK v1.12.4 — README via WebFetch: streamable HTTP, FastMCP, lifespan, Context (HIGH confidence)
- MCP SDK `StreamableHTTPServerTransport` ASGI structure — `streamable_http.py` via WebFetch: header extraction pattern, `ServerMessageMetadata.request_context` (HIGH confidence)
- MCP SDK issue #750: "how to get http request headers in mcp tools" — open, no built-in solution (HIGH confidence — confirms the gap)
- MCP SDK issue #1063: custom headers not received by FastMCP tool handlers (HIGH confidence — confirms middleware approach needed)
- gofastmcp.com/deployment/http: CredentialMiddleware + `mcp.http_app(middleware=[...])` pattern (MEDIUM confidence — PrefectHQ FastMCP, not official mcp package, but pattern is Starlette-standard)
- gofastmcp.com context docs: `set_state`/`get_state` for request-scoped non-serializable objects (MEDIUM confidence)
- gelembjuk.com: `on_call_tool` middleware auth pattern with FastMCP (MEDIUM confidence — independent corroboration of middleware approach)

---
*Architecture research for: godoo-mcp-server (stateless Python MCP server for Odoo)*
*Researched: 2026-06-01*
