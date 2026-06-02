# Phase 3: Core Primitives - Research

**Researched:** 2026-06-02
**Domain:** godoo-client async API surface, fastmcp 3.3.x tool patterns, Odoo
model/field discovery via RPC, structured error mapping
**Confidence:** HIGH (all godoo-client findings are from installed source at
`.venv/Lib/site-packages/godoo/client/`; all fastmcp findings are from installed
source + live interpreter introspection)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01** — Tool names use underscore separators:
  `record_search`, `record_read`, `record_create`, `record_update`, `record_delete`,
  `discovery_list_models`, `discovery_get_fields`, `users_whoami`.
- **D-02** — Researcher confirms fastmcp 3.3.x accepts these names (see §Standard
  Stack — Tool Name Verification below).
- **D-03** — Record tools use friendly CRUD verbs. Map internally: `update` → `write`,
  `delete` → `unlink`.
- **D-04** — `record_search` is a `search_read` one-shot (domain + fields list → records
  with field values).
- **D-05** — `record_search` accepts raw Odoo domain format (list of triples + `&`/`|`).
- **D-06** — Default `limit = 80`; agent may pass explicit `limit` + `offset`.
- **D-07** — Odoo RPC failures → catch exception → raise `fastmcp.exceptions.ToolError`.
- **D-08** — Sanitize errors: pass through Odoo's human-readable message; never leak
  tracebacks, file paths, or credential/session data.
- **D-09** — This server does NOT build a custom error taxonomy. Surface whatever
  structure godoo-client already exposes; structured categorization is godoo-py's
  responsibility.
- **D-10** — Researcher inspects godoo-client 0.2.1 error surface (done — see §Error
  Contract below).
- **D-11** — `users_whoami` returns `uid + username + database` from
  `client.get_session()` → `OdooSessionInfo(uid, session_id, db)`.
- **D-12** — Company/language included only if free from session info without extra
  RPC. Researcher finding: `OdooSessionInfo` has only `uid`, `session_id`, `db`.
  Company/language require an extra `res.users` read — OMIT them.
- **D-13** — Probe removal sequence: build `users_whoami` → repoint integration
  test → delete `tools/probe.py` and its import in `server.py`.

### Claude's Discretion

- Company/language in `users_whoami` output: OMIT (D-12, researcher-verified — not
  free from session info).
- Exact fastmcp error mechanism (D-07): `raise ToolError(sanitized_message)` from
  `fastmcp.exceptions` (researcher-confirmed).
- Tool name normalization by fastmcp (D-02): PASS-THROUGH — underscores registered
  exactly as given (researcher-verified via live `list_tools()` call).

### Deferred Ideas (OUT OF SCOPE)

- Simplified / agent-friendly domain syntax (friendlier abstraction over raw Odoo
  domains).
- Error categorization in godoo-client (godoo-py backlog item).

</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| REC-01 | Agent can search records of any model with domain + return matching records | `client.search_read(model, domain, *, fields, limit, offset, order)` confirmed in client.py:194-213 |
| REC-02 | Agent can read fields of records by id | `client.read(model, ids, fields)` confirmed in client.py:182-192 |
| REC-03 | Agent can create a record of any model | `client.create(model, values)` → `int` confirmed in client.py:336-358 |
| REC-04 | Agent can update fields of existing records | `client.write(model, ids, values)` → `bool` confirmed in client.py:360-369 |
| REC-05 | Agent can delete records | `client.unlink(model, ids)` → `bool` confirmed in client.py:371-374 |
| DISC-01 | Agent can list available Odoo models | `client.search_read("ir.model", [], fields=["model","name","info"])` — no dedicated method, uses `search_read` |
| DISC-02 | Agent can introspect a model's fields and types | `client.fields_get(model, attributes)` → `dict[str, Any]` confirmed in client.py:280-285 |
| USER-01 | Agent can confirm authenticated identity | `client.get_session()` → `OdooSessionInfo(uid, session_id, db)` — returns uid + db for free |
| ERR-01 | Odoo errors surfaced as structured MCP errors | `OdooError` hierarchy → `ToolError(str(e))` pattern — see §Error Contract |

</phase_requirements>

---

## Summary

Phase 3 delivers the full Wave 1 tool surface on top of the Phase 2 credential
resolution and server scaffold. The implementation is straightforward because
godoo-client 0.2.1 exposes all required CRUD primitives as typed async methods with
clean exception hierarchy, fastmcp 3.3.x provides a `ToolError` mechanism that maps
directly to MCP `isError=True`, and the integration test infrastructure from Phase 2
(TestHarness, `mcp_client_factory`, `odoo_harness` fixtures) is fully reusable.

The primary research finding is that `OdooSessionInfo` has only three fields (`uid`,
`session_id`, `db`) — confirming D-12 that company/language cannot be included in
`users_whoami` without an extra RPC. Model listing (DISC-01) has no dedicated
godoo-client method; it uses `search_read("ir.model", ...)` with appropriate fields.
The error surface is richer than expected: six typed exception subclasses each carrying
a `.data` dict with Odoo's raw `exception_type`, `name`, and `debug` fields, plus a
`.to_json()` method. The server's sanitization responsibility (D-08) is to pass
`str(e)` as the `ToolError` message — Odoo's human-readable message — and optionally
attach `e.to_json()` as structured context.

The ruff format gap from Phase 2 VERIFICATION.md has already been resolved (verified:
`ruff format --check .` exits 0, 14 files already formatted).

**Primary recommendation:** Follow the probe.py template exactly for all eight new tool
modules. The implementation is mechanical. The only non-trivial decision is the
`discovery_list_models` field selection for `ir.model` — use `["model", "name",
"info"]` as a sensible minimum; the tool description should advise agents to call
`discovery_get_fields` for detailed field metadata.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Credential resolution | API / MCP Server | — | Established in Phase 2 via `CredentialMiddleware`; credentials injected into `scope["state"]["odoo_creds"]` per-request |
| Record CRUD (search/read/create/update/delete) | API / MCP Server | Odoo ORM (via JSON-RPC) | godoo-client wraps Odoo JSON-RPC; server tool handlers are thin adapters |
| Model discovery (list_models) | API / MCP Server | Odoo `ir.model` table | `search_read("ir.model", ...)` — no dedicated godoo-client method; Odoo provides the data |
| Field introspection (get_fields) | API / MCP Server | Odoo `fields_get` ORM method | `client.fields_get(model)` — thin wrapper over Odoo's native `fields_get` |
| Identity confirmation (whoami) | API / MCP Server | Odoo JSON-RPC authenticate | `authenticate()` on `OdooClient.__aenter__` returns `OdooSessionInfo`; no second RPC needed |
| Error categorization | Odoo RPC layer | godoo-client transport | `JsonRpcTransport._categorize_error` maps Odoo JSON-RPC errors to typed subclasses; server passes message through |
| Structured error surfacing | API / MCP Server | — | `ToolError(str(e))` converts godoo exceptions to MCP `isError=True` responses |
| Integration test execution | CI (Docker/TestHarness) | — | Phase 2 infra reused; `@pytest.mark.integration` + `odoo_harness` session fixture |

---

## Standard Stack

### Core (all already pinned in pyproject.toml)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `godoo-client` | 0.2.1 (pinned `>=0.2,<0.3`) | Odoo JSON-RPC — all CRUD + introspection | Only async Odoo client in the godoo family; verified in Phase 1 [VERIFIED: `.venv/Lib/site-packages/godoo/client/client.py`] |
| `fastmcp` | 3.3.1 (pinned `>=3.3,<4`) | MCP tool registration, `ToolError`, Streamable HTTP | Established in Phase 2; `@mcp.tool(name=...)` decorator, `ToolError` from `fastmcp.exceptions` [VERIFIED: `.venv/Lib/site-packages/fastmcp/exceptions.py`] |
| `pydantic` | ≥2.11 (transitive) | Tool input model → JSON Schema auto-inference | fastmcp infers inputSchema from pydantic `BaseModel` fields automatically [VERIFIED: fastmcp `FunctionTool.from_function` source] |

### Tool Name Verification (D-02)

Verified via live `list_tools()` call in the installed fastmcp 3.3.1 environment.
All eight Phase 3 tool names registered and returned verbatim — no normalization,
no rejection:

```
['record_search', 'record_read', 'record_create', 'record_update',
 'record_delete', 'discovery_list_models', 'discovery_get_fields',
 'users_whoami']
```

**Conclusion for D-02:** fastmcp 3.3.x accepts underscore-namespaced tool names
exactly as given. No surprise rejection or silent rename. [VERIFIED: live Python
interpreter with fastmcp 3.3.1 installed]

### No New Packages Required

Phase 3 installs no new runtime dependencies. All required libraries (`fastmcp`,
`godoo-client`, `pydantic`) are already in `pyproject.toml`. No `pip install` step,
no Package Legitimacy Audit needed.

---

## Package Legitimacy Audit

Not applicable — Phase 3 adds no new package dependencies.

---

## Architecture Patterns

### System Architecture Diagram

```
MCP Client (agent)
      │ POST /mcp  (X-Odoo-* headers)
      ▼
CredentialMiddleware
      │ scope["state"]["odoo_creds"] = OdooCredentials(url, db, user, password)
      ▼
fastmcp tool dispatch  (@mcp.tool decorated handlers)
      │
      ├─ users_whoami          ─── async with OdooClient → get_session() → {uid, db, url}
      │
      ├─ record_search         ─── async with OdooClient → search_read(model, domain, fields, limit, offset)
      ├─ record_read           ─── async with OdooClient → read(model, ids, fields)
      ├─ record_create         ─── async with OdooClient → create(model, values)
      ├─ record_update         ─── async with OdooClient → write(model, ids, values)
      ├─ record_delete         ─── async with OdooClient → unlink(model, ids)
      │
      ├─ discovery_list_models ─── async with OdooClient → search_read("ir.model", [], fields=[...])
      └─ discovery_get_fields  ─── async with OdooClient → fields_get(model, attributes)
             │
             │  (on OdooError)
             ▼
         raise ToolError(str(e))   →   MCP isError=True response  (carries Odoo human-readable message)
             │
             │  (on success)
             ▼
         return pydantic model   →   MCP isError=False response  (JSON via structured_content)
```

### Recommended Project Structure

```
src/godoo_mcp_server/
├── server.py              # FastMCP instance + create_app() — MODIFY: swap probe import
├── credentials.py         # OdooCredentials + CredentialMiddleware — no changes
├── tools/
│   ├── __init__.py        # empty
│   ├── probe.py           # DELETE after users_whoami is live (D-13)
│   ├── users.py           # users_whoami
│   ├── records.py         # record_search, record_read, record_create, record_update, record_delete
│   └── discovery.py       # discovery_list_models, discovery_get_fields
tests/
├── conftest.py            # mcp_client / mcp_client_no_creds — no changes
├── test_transport.py      # update: assert users_whoami in tool list
├── test_credentials.py    # no changes
├── test_records.py        # NEW: unit tests for record tool input validation
├── test_users.py          # NEW: unit tests for users_whoami response shape
├── test_discovery.py      # NEW: unit tests for discovery tools response shapes
└── integration/
    ├── conftest.py        # no changes (odoo_harness, mcp_client_factory, second_user_credentials)
    └── test_vertical.py   # MODIFY: add Phase 3 round-trip tests; repoint whoami assertion
```

### Pattern 1: Per-Request OdooClient with ToolError boundary

Every tool handler follows this exact template (established in `probe.py`). Copy
without deviation.

```python
# Source: src/godoo_mcp_server/tools/probe.py (Phase 2 artifact)
from __future__ import annotations

from typing import TYPE_CHECKING

from fastmcp import Context  # noqa: TC002  (required at runtime for pydantic schema)
from fastmcp.exceptions import ToolError
from fastmcp.server.dependencies import get_http_request
from godoo.client.client import OdooClient, OdooClientConfig
from godoo.client.errors import OdooError

from godoo_mcp_server.server import mcp

if TYPE_CHECKING:
    from godoo_mcp_server.credentials import OdooCredentials


@mcp.tool(name="example_tool", description="...")
async def example_tool(ctx: Context, model: str) -> dict[str, object]:
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
            result = await client.search_read(model, [], fields=["id", "name"], limit=80)
            return {"records": result}
    except OdooError as e:
        raise ToolError(str(e)) from e
```

**Critical notes:**
- `async with OdooClient(config) as client:` calls `authenticate()` on entry and
  `aclose()` on exit — no separate `authenticate()` call needed.
- `OdooError` is the base class for all godoo-client exceptions. Catching it covers all
  Odoo RPC failures including auth, validation, access, and network errors.
- `ToolError(str(e))` passes Odoo's human-readable message. `str(e)` on any
  `OdooRpcError` subclass returns the sanitized `message` string set by
  `_categorize_error` (not a traceback).
- The `try/except OdooError` wraps the entire `async with` block — this catches
  authentication failures in `__aenter__` too.

### Pattern 2: fastmcp ToolError → MCP isError=True mapping

This is the complete chain, verified from source:

1. Tool handler raises `ToolError(message)` — a `FastMCPError` subclass.
2. fastmcp `FastMCP.call_tool()` (server.py line 1274): `except FastMCPError as e: raise`
   — re-raises after logging at `e.log_level`.
3. mcp lowlevel `handler()` (lowlevel/server.py line 582): `except Exception as e:
   return self._make_error_result(str(e))`.
4. `_make_error_result()` returns `CallToolResult(content=[TextContent(text=str(e))],
   isError=True)`.
5. MCP wire: agent sees `result.isError = true` with `content[0].text` = the sanitized
   Odoo message.

**Conclusion:** Raising `ToolError(str(e))` is the correct and complete mechanism. No
additional wrapper or error payload construction is needed. [VERIFIED: fastmcp 3.3.1
and mcp lowlevel server.py source, both from `.venv`]

### Pattern 3: users_whoami — free data from OdooSessionInfo

```python
# OdooSessionInfo fields (confirmed from rpc/types.py):
#   uid: int
#   session_id: str
#   db: str
#
# company and language NOT present — extra res.users read required (D-12: OMIT)

async with OdooClient(config) as client:
    session = client.get_session()
    assert session is not None
    return {
        "uid": session.uid,
        "username": creds.username,   # from OdooCredentials — no extra RPC
        "database": session.db,
    }
```

`username` comes from `creds.username` (the X-Odoo-Username header value), not from
the session. This is correct — Odoo's JSON-RPC authenticate does not return the login
name back; we already have it from the credential resolution.

### Pattern 4: discovery_list_models — ir.model via search_read

No dedicated `list_models` method exists in godoo-client. Use `search_read` on the
standard Odoo `ir.model` model:

```python
results = await client.search_read(
    "ir.model",
    [],
    fields=["model", "name", "info"],
    limit=None,   # fetch all models; ir.model is small (~200-400 rows)
    order="model",
)
# Returns list[dict] — each has {"model": "res.partner", "name": "Contact", "info": "..."}
```

Relevant `ir.model` fields available on a standard Odoo 17 instance [ASSUMED — field
names are standard across Odoo 14-17 but researcher cannot verify against all versions]:
- `model` (str) — technical name, e.g. `res.partner`
- `name` (str) — human label, e.g. `Contact`
- `info` (str) — optional description (may be empty)
- `transient` (bool) — True for wizard models

### Pattern 5: discovery_get_fields — fields_get with attributes filter

```python
# Source: godoo-client client.py:280-285
result = await client.fields_get(
    model,
    attributes=["string", "type", "required", "readonly", "help"],
)
# Returns dict[str, dict] keyed by field name:
# {"name": {"string": "Name", "type": "char", "required": True, ...}, ...}
```

The `attributes` list filters which metadata keys each field dict includes. Without it,
Odoo returns a large dict with all attributes. Using an allow-list keeps the response
concise for agents. [ASSUMED — attribute names are standard Odoo ORM, not verified
against actual running instance in this session]

### Pattern 6: server.py import swap (D-13 sequencing)

After `users_whoami` is registered and integration test is repointed:

```python
# server.py — before (Phase 2):
from godoo_mcp_server.tools import probe as _probe_module  # noqa: F401, E402

# server.py — after (Phase 3, final state):
from godoo_mcp_server.tools import users as _users_module      # noqa: F401, E402
from godoo_mcp_server.tools import records as _records_module  # noqa: F401, E402
from godoo_mcp_server.tools import discovery as _disc_module   # noqa: F401, E402
```

The `noqa: F401, E402` comments are required — F401 (unused import) and E402
(module-level import not at top of file) are suppressed intentionally because the
import exists only for its registration side effect. [VERIFIED: established pattern
from Phase 2 `server.py`]

### Anti-Patterns to Avoid

- **Module-level OdooClient singleton:** Never `_client: OdooClient | None = None` at
  module scope. Confirmed anti-pattern from Phase 2 PATTERNS.md and PITFALLS.md P2
  (cross-user bleed). Audit: `grep -n "_client" tools/*.py` must return empty.
- **Catching `Exception` instead of `OdooError`:** The broader catch would swallow
  fastmcp internal exceptions. Catch only `OdooError` from `godoo.client.errors`.
- **Calling `authenticate()` manually before `async with`:** `OdooClient.__aenter__`
  calls `authenticate()` automatically. Calling it twice causes a double-auth.
- **Using `godoo` meta-package:** Import from `godoo.client.client`, not `godoo`
  directly. The meta-package has no importable code.
- **Omitting `limit` default in `record_search`:** Always default to 80 when agent
  omits `limit` (D-06). Pitfall P-large-records: searches without limit on production
  instances can OOM Odoo workers.
- **Leaking session_id in tool output:** `OdooSessionInfo.session_id` is an internal
  transport token. Never include it in tool responses.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Odoo JSON-RPC CRUD | Custom httpx calls to `/jsonrpc` | `client.search_read`, `client.read`, `client.create`, `client.write`, `client.unlink` | godoo-client handles auth token injection, error categorization, transport lifecycle |
| Odoo JSON-RPC auth | Direct POST to `/web/session/authenticate` | `async with OdooClient(config)` — `__aenter__` calls `authenticate()` | Session management, cookie handling, error detection all encapsulated |
| Error type detection | String-matching on exception messages | `isinstance(e, OdooAuthError/OdooAccessError/OdooValidationError/...)` | godoo-client's `_categorize_error` already maps Odoo's `exception_type` and `data.name` to typed subclasses |
| MCP error response | Custom `{"isError": True, "content": [...]}` construction | `raise ToolError(message)` | fastmcp → mcp lowlevel layer builds the `CallToolResult(isError=True)` automatically |
| Field metadata format | Custom `fields_get` call via `execute_kw` | `client.fields_get(model, attributes=[...])` | Typed wrapper, correct kwargs plumbing |

**Key insight:** godoo-client's design is "thin async wrapper over Odoo JSON-RPC with
typed error hierarchy." Every CRUD primitive is a one-liner. The server's job is to
adapt tool input pydantic models to godoo-client method arguments — nothing more.

---

## Error Contract (D-07 through D-10 implementation guide)

### Exception Hierarchy (from `.venv/Lib/site-packages/godoo/client/errors.py`)

```
OdooError (base, has to_json())
├── OdooRpcError (has .code, .data, .message; has to_json())
│   ├── OdooAuthError      — "access_denied" / "AccessDenied" Odoo exceptions
│   ├── OdooNetworkError   — httpx HTTP errors
│   │   └── OdooTimeoutError — httpx TimeoutException
│   ├── OdooValidationError — "validation_error" / "user_error" / "ValidationError"
│   ├── OdooAccessError    — "access_error" / "AccessError"
│   └── OdooMissingError   — "missing_error" / "MissingError"
└── OdooSafetyError (has .operation OperationInfo; NOT an RPC error — local guard)
```

### What each exception carries

All `OdooRpcError` subclasses (covers all Odoo server-side errors):
- `str(e)` — Odoo's human-readable `message` string (e.g. "You are not allowed to
  access 'Contact' (res.partner). Please contact your administrator.")
- `e.data` — raw Odoo error dict: keys include `exception_type`, `name`, `debug`
  (traceback string), `arguments`, `context`. `debug` contains a Python traceback
  from Odoo's server — **never forward this to the agent** (D-08).
- `e.code` — JSON-RPC error code (usually 200 for Odoo application errors).
- `e.to_json()` — structured dict: `{"error": "VALIDATION_ERROR", "message": "...",
  "details": e.data}`. **Do not forward `details`** — it contains `e.data["debug"]`
  which is a server traceback.

### Sanitization rule (D-08, D-09)

```python
except OdooError as e:
    # D-08: forward message only; never e.data (contains debug traceback)
    # D-09: do not build custom taxonomy — str(e) is Odoo's own message
    raise ToolError(str(e)) from e
```

`str(e)` on any `OdooRpcError` subclass returns the `message` parameter passed to
`__init__` — Odoo's human-readable string, which godoo-client extracts from
`error_dict["message"]` in `_categorize_error`. This message is safe to forward to
the agent: it is Odoo's own user-facing error text (no file paths, no internal tokens).

### Success Criterion 4 (invalid domain → structured error)

When an agent sends an invalid domain to `record_search` (e.g. `[["nonexistent_field",
"=", "value"]]`), Odoo returns a `ValidationError` or `UserError`. godoo-client
categorizes it as `OdooValidationError`. The tool catches it and raises
`ToolError("You cannot use 'nonexistent_field' in a domain.")` — the agent sees a
failed tool call with `isError=True` and the model/field error text in `content[0].text`.

The phrase "model name, field, and constraint detail" in the success criterion refers to
information Odoo embeds in its own error message string — not structured JSON fields
that the server builds. This is consistent with D-09.

---

## godoo-client API Surface (Phase 3 reference)

All signatures verified from `.venv/Lib/site-packages/godoo/client/client.py`.

### Authentication (implicit via async context manager)

```python
# client.py:438-441
async def __aenter__(self) -> OdooClient:
    await self.authenticate()
    return self

# client.py:103-104
async def authenticate(self) -> OdooSessionInfo:
    return await self._transport.authenticate(self._config.username, self._config.password)

# client.py:109-110
def get_session(self) -> OdooSessionInfo | None:
    return self._transport.session
    # Returns None before __aenter__; non-None after successful authentication
```

`OdooSessionInfo` fields (rpc/types.py):
- `uid: int` — numeric Odoo user ID
- `session_id: str` — internal transport token (DO NOT expose in tool output)
- `db: str` — database name

### CRUD Methods

```python
# search_read (REC-01)
async def search_read(
    self,
    model: str,
    domain: list[Any] | None = None,
    *,
    fields: list[str] | None = None,   # None = all fields
    limit: int | None = None,
    offset: int | None = None,
    order: str | None = None,
    **kwargs: Any,
) -> list[dict[str, Any]]:
# Returns: list of record dicts with requested fields

# read (REC-02)
async def read(
    self,
    model: str,
    ids: int | list[int],
    fields: list[str] | None = None,
    **kwargs: Any,
) -> list[dict[str, Any]]:
# Returns: list of record dicts (always a list, even for a single int id)

# create (REC-03) — overloaded
async def create(
    self,
    model: str,
    values: dict[str, Any] | list[dict[str, Any]],
    **kwargs: Any,
) -> int | list[int]:
# Single dict → returns int (new record id)
# List of dicts → returns list[int] (new record ids)
# Raises OdooValidationError locally for empty list (no RPC made)

# write (REC-04, maps to record_update)
async def write(
    self,
    model: str,
    ids: int | list[int],   # accepts single int or list
    values: dict[str, Any],
    **kwargs: Any,
) -> bool:
# Returns True on success; raises OdooError subclass on failure

# unlink (REC-05, maps to record_delete)
async def unlink(
    self,
    model: str,
    ids: int | list[int],   # accepts single int or list
    **kwargs: Any,
) -> bool:
# Returns True on success; raises OdooError subclass on failure

# fields_get (DISC-02)
async def fields_get(
    self,
    model: str,
    attributes: list[str] | None = None,
) -> dict[str, Any]:
# Returns: {field_name: {attribute: value, ...}, ...}
# Example: {"name": {"string": "Name", "type": "char", "required": True}, ...}
```

### No dedicated list_models method

`OdooClient` has no `list_models()` or `get_models()` method. DISC-01 uses
`search_read("ir.model", ...)` directly.

---

## Common Pitfalls

### Pitfall 1: Forgetting the OdooError try/except wraps __aenter__

**What goes wrong:** `async with OdooClient(config) as client:` raises `OdooAuthError`
if credentials are invalid. If the `try/except OdooError` block only wraps the inner
RPC calls (not the `async with`), authentication failures propagate as unhandled
exceptions and crash the tool with a Python traceback instead of a `ToolError`.

**How to avoid:** Wrap the entire `async with OdooClient(config) as client:` block in
the `try/except OdooError` — see Pattern 1 above.

### Pitfall 2: Cross-user bleed from per-request OdooClient

**What goes wrong:** Module-level or cached `OdooClient` instance shared across
requests. Violates AUTH-04 and PITFALL P2. `search_read` returns User A's results to
User B.

**How to avoid:** Construct `OdooClient` inside the tool handler from `request.state.
odoo_creds` every time. Grep audit: no `_client` or `_odoo_client` module-level
variable in any `tools/*.py`.

### Pitfall 3: record_search without default limit

**What goes wrong:** Agent omits `limit`, tool passes `limit=None` to `search_read`.
On a large production Odoo instance (res.partner with 100K records), this OOMs Odoo's
worker (PITFALL P-large-records, PITFALLS.md).

**How to avoid:** `limit: int = 80` in the pydantic input model. `search_read` receives
`limit=80` when agent omits it. Document the pagination pattern in the tool description.

### Pitfall 4: Exposing session_id or raw e.data in responses

**What goes wrong:** `OdooSessionInfo.session_id` or `e.data["debug"]` (server-side
Python traceback) leaks to the MCP client. Violates D-08.

**How to avoid:** Return only `uid`, `username`, `database` in `users_whoami`. Use
`str(e)` in `ToolError`, never `str(e.data)` or `e.data["debug"]`.

### Pitfall 5: probe.py deletion order (D-13)

**What goes wrong:** Delete `probe.py` before `users_whoami` is wired. `server.py` tries
to import `tools.probe` → `ImportError` at startup. CI goes red.

**How to avoid:** D-13 order: build `users_whoami` → repoint `test_vertical.py` from
`odoo_whoami` to `users_whoami` and confirm green → remove `tools.probe` import from
`server.py` → delete `probe.py`. Never red.

### Pitfall 6: mypy strict failures on tool return types

**What goes wrong:** `@mcp.tool` on `async def tool(...) -> dict[str, object]:` with
`mypy --strict` may flag `dict[str, object]` as overly broad when pydantic models are
used. Alternatively, returning a pydantic model directly requires the output_schema
annotation.

**How to avoid:** Use `dict[str, Any]` for simple returns (with `from typing import
Any`); or declare a `BaseModel` output type (fastmcp will auto-generate output_schema).
Both patterns are mypy-strict-safe. [ASSUMED — based on probe.py pattern which uses
`dict[str, object]`; verify with `uv run mypy --strict src/` after each new tool module]

---

## Phase 2 Status — Ruff Format Gap Resolved

The Phase 2 VERIFICATION.md gap (`tests/integration/test_vertical.py:50` slice
notation) has been fixed. Verified:

```
uv run ruff format --check .
→ 14 files already formatted (exit 0)
```

No wave-0 fix needed for this item. [VERIFIED: local check, 2026-06-02]

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | pytest 9.x + pytest-asyncio 1.4.x |
| Config file | `pyproject.toml [tool.pytest.ini_options]` |
| Quick run command | `uv run pytest -m "not integration" --tb=short` |
| Full suite command | `uv run pytest -m "not integration" --tb=short` (unit); `uv run pytest -m integration --tb=short` (integration, Docker required) |
| Async mode | `asyncio_mode = "auto"` — no `@pytest.mark.asyncio` needed |
| Integration marker | `@pytest.mark.integration` — excluded from default run |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File |
|--------|----------|-----------|-------------------|------|
| USER-01 | `users_whoami` returns uid + username + db | unit | `uv run pytest tests/test_users.py -x` | Wave 0 |
| USER-01 | `users_whoami` real Odoo round-trip | integration | `uv run pytest -m integration tests/integration/test_vertical.py -x` | modify existing |
| REC-01 | `record_search` pydantic model validates domain/limit | unit | `uv run pytest tests/test_records.py -x` | Wave 0 |
| REC-01 | `record_search` real round-trip | integration | `uv run pytest -m integration` | Wave 0 (add test) |
| REC-02 | `record_read` accepts ids list | unit | `uv run pytest tests/test_records.py -x` | Wave 0 |
| REC-03 | `record_create` returns int id | unit | `uv run pytest tests/test_records.py -x` | Wave 0 |
| REC-04 | `record_update` maps to write | unit | `uv run pytest tests/test_records.py -x` | Wave 0 |
| REC-05 | `record_delete` maps to unlink | unit | `uv run pytest tests/test_records.py -x` | Wave 0 |
| DISC-01 | `discovery_list_models` returns model list | unit | `uv run pytest tests/test_discovery.py -x` | Wave 0 |
| DISC-02 | `discovery_get_fields` returns field metadata dict | unit | `uv run pytest tests/test_discovery.py -x` | Wave 0 |
| ERR-01 | `OdooError` → `ToolError` → `isError=True` | unit | `uv run pytest tests/test_records.py::test_search_odoo_error -x` | Wave 0 |
| ERR-01 | Invalid domain → structured error (SC-4) | integration | `uv run pytest -m integration` | Wave 0 (add test) |

**Note on unit test approach for tool handlers:** Tool handlers require a live
`OdooClient` for most operations. Unit tests for record tools mock the underlying RPC
call or verify that the tool correctly raises `ToolError` when `OdooClient.__aenter__`
raises `OdooAuthError`. The `mcp_client` fixture (from `tests/conftest.py`) provides
an in-process MCP client with fake credentials; calling a record tool through it will
reach `OdooClient` which will fail with `OdooAuthError` (no real Odoo) — the unit test
asserts the response has `isError=True`, verifying the error boundary.

### Sampling Rate

- **Per task commit:** `uv run pytest -m "not integration" --tb=short`
- **Per wave merge:** `uv run pytest -m "not integration" --tb=short` + mypy + ruff
- **Phase gate:** Full integration suite green in CI before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `tests/test_users.py` — unit tests for `users_whoami` response shape and error
  path
- [ ] `tests/test_records.py` — unit tests for record tool input validation and
  error-boundary (ERR-01)
- [ ] `tests/test_discovery.py` — unit tests for discovery tool response shapes
- The three integration tests to add to `test_vertical.py`: SC-3 (all five record
  operations), SC-4 (invalid domain → structured error), SC-5 (credential resolution →
  authenticate → record_search full path)

---

## Security Domain

`security_enforcement: true`, `security_asvs_level: 1` (L1).

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | Yes | Per-request `OdooClient(config)` — Odoo authenticates on every call; no session reuse across requests |
| V3 Session Management | Partial | `stateless_http=True` — no MCP session state; Odoo auth token is per-request and short-lived |
| V4 Access Control | Yes (Odoo-side) | Odoo ORM enforces record rules and ACL on every RPC call — the server does not bypass `sudo` |
| V5 Input Validation | Yes | Pydantic input models on all tool handlers; fastmcp validates against JSON Schema automatically |
| V6 Cryptography | No | No key management in this phase; credentials passed through from headers/env, not stored |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Credential leak via tool output | Information Disclosure | Never return `OdooSessionInfo.session_id`; never return `e.data["debug"]` (server traceback) |
| Cross-user bleed via shared OdooClient | Information Disclosure | Per-request `OdooClient` construction from `request.state.odoo_creds` (AUTH-04 pattern) |
| Traceback exposure in ToolError | Information Disclosure | `raise ToolError(str(e))` — `str(e)` returns message string only, not repr with traceback |
| Unbounded search result set | DoS | Default `limit=80`; agent must explicitly pass higher value to exceed |
| Odoo injection via raw domain | Tampering | Odoo's ORM does not allow SQL injection through domain values; domain is parameterized by the ORM |

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| SSE transport | Streamable HTTP | MCP 2024-11-05 spec | Phase 2 established `stateless_http=True` — stays |
| Module-level OdooClient | Per-request OdooClient | Phase 2 anti-pattern audit | AUTH-04 requirement — enforced |
| Custom error dict in tool response | `raise ToolError(message)` → MCP `isError=True` | Phase 3 design decision | Agent sees proper failed tool call, not a fake success dict |

**Deprecated/outdated:**
- `probe.py` / `odoo_whoami` tool: throwaway Phase 2 probe, to be retired in Phase 3
  (D-13).
- `# type: ignore[attr-defined]` on `request.state.odoo_creds`: established pattern
  from Phase 2; required permanently due to Starlette's dynamic `State` type.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `ir.model` fields `model`, `name`, `info` exist on all target Odoo versions | Architecture Patterns §Pattern 4 | `discovery_list_models` returns missing field errors; mitigation: use `fields=["model", "name"]` without `info` as fallback |
| A2 | `fields_get` attributes `["string", "type", "required", "readonly", "help"]` are valid on all target Odoo versions | Architecture Patterns §Pattern 5 | Odoo may return an error for unknown attribute names; mitigation: pass `attributes=None` (returns all) as fallback |
| A3 | `dict[str, object]` return type for tool handlers is mypy --strict-safe | Common Pitfalls §Pitfall 6 | `uv run mypy --strict src/` fails; mitigation: switch to `Any` or pydantic output model |

**Empty assumptions for critical claims:** All godoo-client API signatures, all error
class names, all `OdooSessionInfo` fields, all `OdooRpcError` attributes, fastmcp
`ToolError` import path, fastmcp `list_tools()` tool name pass-through, and the
ruff-format-gap resolution are VERIFIED from installed package source.

---

## Open Questions (RESOLVED)

1. **D-12 username from credentials vs session**
   - What we know: `OdooSessionInfo` has only `uid`, `session_id`, `db`. `username`
     must come from `creds.username`.
   - What's unclear: `creds.username` is the login sent to Odoo; Odoo may have a
     different "display name" on `res.users`. D-11 says return `uid + username +
     database` — returning the login string as `username` is correct and costs no
     extra RPC.
   - RESOLVED: return `creds.username` as `username`. Document in tool
     description: "username is the Odoo login (same value as X-Odoo-Username header)."

2. **`ir.model` pagination**
   - What we know: `search_read` with `limit=None` fetches all records in one call.
     Odoo imposes a server-side limit (default 80 on many instances; configurable).
   - What's unclear: does the Odoo instance's `ir.model` table exceed the server's
     default limit? A fully loaded instance may have 400+ models.
   - RESOLVED: pass `limit=500` (safe cap above any realistic model count) in
     `discovery_list_models` to avoid server-side truncation. Do NOT pass `limit=None`
     blindly.

3. **`fields_get` response size**
   - What we know: without `attributes` filter, `fields_get` returns all metadata per
     field, which can be large.
   - What's unclear: whether agents need the full metadata or a subset.
   - RESOLVED: use `attributes=["string", "type", "required", "readonly", "help",
     "relation"]` (add `relation` for relational field targets). Keep the list
     concise. Agents can always call `fields_get` with `attributes=None` via
     `call` if they need more.

---

## Environment Availability

All dependencies are already installed in `.venv`. Phase 3 adds no new external tools.

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Python 3.14 | All | Yes | 3.14 (cpython) | — |
| godoo-client | All tool handlers | Yes | 0.2.1 | — |
| fastmcp | Server, ToolError | Yes | 3.3.1 | — |
| pytest + pytest-asyncio | Unit tests | Yes | 9.x + 1.4.x | — |
| godoo-testcontainers | Integration tests | Yes | ≥0.2,<0.3 | — |
| Docker | Integration CI | CI-only | n/a locally | Integration tests only run in CI |
| uv | Build + test runner | Yes | latest | — |

**Missing with no fallback:** None.

---

## Sources

### Primary (HIGH confidence — all verified from installed package source)

- `.venv/Lib/site-packages/godoo/client/client.py` — `OdooClient` all CRUD methods,
  `fields_get`, `get_session`, `__aenter__`/`__aexit__` lifecycle
- `.venv/Lib/site-packages/godoo/client/errors.py` — `OdooError` hierarchy, all
  subclasses, `.to_json()`, `.data` attribute
- `.venv/Lib/site-packages/godoo/client/rpc/types.py` — `OdooSessionInfo` fields
  (`uid`, `session_id`, `db`)
- `.venv/Lib/site-packages/godoo/client/rpc/transport.py` — `_categorize_error`
  mapping logic
- `.venv/Lib/site-packages/fastmcp/exceptions.py` — `ToolError` class, `FastMCPError`
  base
- `.venv/Lib/site-packages/fastmcp/server/server.py` — `@mcp.tool(name=...)`, tool
  dispatch, `FastMCPError` re-raise at line 1274
- `.venv/Lib/site-packages/mcp/server/lowlevel/server.py` — `_make_error_result`,
  `CallToolResult(isError=True)` at line 466-472, `except Exception → _make_error_result`
  at line 582-583
- `.planning/phases/02-skeleton-server/02-PATTERNS.md` — established patterns from
  Phase 2 (probe.py template, lifespan fixture, mcp_client_factory)
- `.planning/phases/02-skeleton-server/VERIFICATION.md` — Phase 2 PASS, ruff gap
  resolved
- `src/godoo_mcp_server/tools/probe.py` — canonical tool handler template
- `tests/integration/conftest.py` — reusable fixtures (odoo_harness,
  mcp_client_factory, second_user_credentials)
- Live Python introspection: `fastmcp.FastMCP.list_tools()` call confirmed underscore
  tool names pass through verbatim (D-02 resolved)

### Secondary (MEDIUM confidence)

- `.planning/research/PITFALLS.md` — P2 (cross-user bleed), P6 (catalog cost), P13
  (field variance) — directly applicable to Phase 3 tool design

---

## Metadata

**Confidence breakdown:**
- godoo-client API surface: HIGH — verified from installed source, every signature
  exact
- fastmcp ToolError mechanism: HIGH — traced through source from raise to wire
- Error taxonomy: HIGH — errors.py read in full
- OdooSessionInfo fields: HIGH — dataclass definition read, live introspection
- ir.model field names: ASSUMED — standard across Odoo versions but not
  verified against running instance
- fields_get attributes: ASSUMED — standard Odoo ORM metadata keys

**Research date:** 2026-06-02
**Valid until:** 2026-07-02 (godoo-client 0.2.x stable; fastmcp 3.3.x stable)
