# Research Summary — godoo-mcp-server

Synthesis of STACK.md, FEATURES.md, ARCHITECTURE.md, and PITFALLS.md. Feeds roadmap creation.

---

## ⚠ Open Conflict — Resolve with Marc before Wave 1 coding

PROJECT.md states the runtime dependency as `godoo` (godoo-py) pinned `>=1.1,<1.2`. Stack research found on PyPI:

- `godoo-client` **0.2.1** (async, httpx-based, requires **Python >=3.14**)
- `godoo` meta-package 0.2.1 (no importable code)

**Two possibilities — do NOT silently adopt either:**

1. If `godoo-client 0.2.1` *is* the charter's `godoo`: the pip name is `godoo-client`, the pin becomes `>=0.2,<0.3`, and the Python floor is **3.14** (confirmed by the package).
2. If the charter's `godoo>=1.1` is unreleased/private and `godoo-client 0.2.1` is an unrelated package: `pip install` will fail and PyPI publish of `godoo-mcp-server` is blocked until the correct package is published.

**Decision affects:** Python version floor, Docker base image tag, CI matrix, and whether the server is PyPI-publishable at all. This must be resolved as the first task of Wave 1.

---

## Recommended Stack

| Layer | Choice | Notes / Confidence |
|-------|--------|--------------------|
| MCP framework | `fastmcp>=3.3,<4` (PrefectHQ standalone) | Streamable HTTP, `stateless_http=True`, `http_app(middleware=[...])`. The architectural spine. High. |
| Odoo client | `godoo-client>=0.2,<0.3` **(name/version pending — see Open Conflict)** | Async Odoo JSON-RPC; fresh instance per request, never shared. |
| HTTP middleware | `starlette` `BaseHTTPMiddleware` (transitive) | Only viable path to read `X-Odoo-*` headers in tool handlers — MCP SDK issues #750/#1063 confirm no built-in mechanism. High. |
| Catalog cache | `cachetools.TTLCache` + `asyncio.Lock` | In-process LRU+TTL, zero external deps. High. |
| ASGI server | `uvicorn`, single process (no gunicorn) | Stateless design; gunicorn workers fight the design. |
| Python | **3.14** | Floor set by `godoo-client` (pending naming resolution). |
| Packaging | `uv` + `hatchling`; Docker `python:3.14-slim` | Not `-alpine`. |
| Testing | `pytest` + `pytest-asyncio` | Not the anyio plugin — they conflict. |

**Do NOT use:** `RestrictedPython` as the sandbox, `gunicorn`, `FastAPI` layered on FastMCP, the `godoo` meta-package directly, `python:3.14-alpine`, SSE transport.

---

## Feature Landscape

**The design niche is unoccupied.** All six surveyed Odoo MCP servers are single-user, stdio-only, and expose either generic CRUD or hardcoded per-module tools. None implement per-user header auth, ACL probing, skills-as-Resources, or Code Mode. That quartet is the differentiation.

### Wave 1 — Table stakes (9 tools)
- Streamable HTTP skeleton (`stateless_http=True`) — the only production transport
- Credential resolution: `X-Odoo-*` headers → env-var fallback → 401 (root dependency of every tool and cache)
- `record.*` ×5 (search, read, create, update, delete)
- `discovery.list_models` + `discovery.get_fields` (agents discover schema before operating)
- `users.whoami` (identity + connectivity probe)
- Structured Odoo error surfacing (agents cannot self-correct without model/field/constraint detail)
- One passing integration test against a real Odoo

### Wave 2 — Differentiators (full 17-tool surface)
- `mail.*` ×6, `action.*` ×2, `attachments.*` ×3, `users.search_users`, `discovery.list_menus`
- Catalog introspection + schema-hash cache keyed `(url, db, schema_hash)` — re-implements `buildCatalogContent`
- MCP Resource descriptors — `odoo://{model}/record/{id}` URI convention (`buildResourceDescriptors`)
- Per-user ACL probe + `notifications/tools/list_changed` — cached per `(url, db, uid)`, never per-request (`probeAclForCuratedTools`)
- Skills-as-MCP-Resources: 4 Markdown files + `index.json` generated at startup from a filesystem glob (never static)
- Deprecate `@marcfargas/odoo-mcp` (npm 0.1.4)

### Wave 3 — MCP Code Mode
- `execute_odoo_code` with OS-level sandbox (Docker `--network none` + seccomp; mechanism decided at Wave 3 planning)
- Capability grants (read-only default), per-invocation isolation, rate limiting, audit logging — non-negotiable per charter

### Anti-features (deliberately NOT built)
- Hardcoded per-module tools (the thing this project rejects)
- Approve-before-write gating patterns
- OAuth/SSO/SaaS auth (belongs to godoo-proxy)
- Storage/persistence, admin routes

---

## Architecture Spine

- `FastMCP(stateless_http=True)` wrapped in a Starlette middleware stack.
- `CredentialMiddleware` extracts `X-Odoo-*` headers (env fallback) into a per-request `ContextVar`; every tool handler reads it and builds a **fresh** `OdooClient` per call. This is the correct workaround for the verified MCP Python SDK gap (no built-in X-header access in tool handlers — issues #750/#1063).
- Catalog cache keyed `(url, database, schema_hash)` — **DB-scoped, not user-scoped** (schema is per-DB). ACL probe results cached separately per `(url, database, uid)`.
- Code Mode sandbox modeled as five non-negotiable seams behind a `SandboxRunner`: no-network, allowlist, capability grant, per-invocation isolation, audit log. Mechanism (subprocess+seccomp vs Docker sidecar) deferred to Wave 3; note Docker-in-Docker is problematic for the container deployment target.
- Build order: W1 skeleton + creds + core primitives → W2 full surface + catalog + resources + ACL + skills + cache → W3 Code Mode.

---

## Watch Out For (top pitfalls)

1. **Cross-user cache/credential bleed** (#1 risk) — ACL cache key must include `uid`; catalog key uses `schema_hash` not username; `OdooClient` never shared across requests. A two-user integration test is mandatory in Wave 2 (Asana MCP breach is the confirmed template).
2. **Sandbox escape via Python introspection** — `__class__.__mro__` / frame traversal reach `subprocess.Popen` without importing `os`; `RestrictedPython` has documented escapes. OS-level isolation only (CVE-2026-39888, JFSA-2025-001434277 are confirmed production failures of Python-level sandboxes).
3. **Code Mode network egress** — Docker without `--network none` allows outbound from the sandbox; CI test: `socket.connect(("8.8.8.8", 53))` must raise inside the sandbox.
4. **Catalog cold-start cost** — 15–60s sequential on a 200+ module Odoo; use parallel `asyncio.gather` + async warm after startup. Cache is non-optional for production correctness.
5. **Streamable HTTP session-ID conflict** — `stateless_http=True` must not emit `Mcp-Session-Id`; verify quickdoo connects cleanly before Wave 1 is declared done (active python-sdk bug).
6. **Header trust without a proxy** — document in the README (same commit as Wave 1 credential wiring): direct exposure without a header-stripping proxy means the caller controls which Odoo user the server acts as. This is the auth boundary godoo-proxy normally guards.
7. **ACL probe scope** — `check_access_rights` is model-level only; record rules are enforced transparently by the Odoo ORM. Document the scope clearly to avoid a false sense of security.
8. **Skills index drift** — generate `index.json` at startup from a filesystem glob; startup assertion that every `.md` has an index entry and vice versa.
9. **godoo pin drift** — pin per the resolved package (`>=1.1,<1.2` or `>=0.2,<0.3`); CI matrix tests oldest and latest in range.
10. **Tool-list instability** — ACL result cached with TTL, never re-probed per request; emit `notifications/tools/list_changed` on ACL change.

Per-instance reality: every Odoo is customized — never assume model fields; always introspect.

---

*Synthesized 2026-06-01 from 4 parallel research dimensions.*
