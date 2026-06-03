# Requirements — godoo-mcp-server v1.0

Derived from SEED-002 (charter) and `.planning/research/`. v1.0 is delivered in three waves (W1 minimal → W2 full surface → W3 Code Mode).

REQ-ID format: `CATEGORY-NN`. Each requirement is user/agent-centric and testable.

---

## v1 Requirements

### Foundations (Wave 1)
- [x] **FOUND-01**: Resolve the Odoo client dependency — confirm the correct package name, version pin, and Python floor (SEED says `godoo >=1.1,<1.2`; PyPI shows `godoo-client 0.2.1` / Python ≥3.14). Block coding until resolved.
- [x] **FOUND-02**: Project scaffolds as a single Python package (`pyproject.toml`, `uv`/`hatchling`) with LGPL-3.0 license file and the resolved Python floor.
- [x] **FOUND-03**: CI runs lint + type-check + tests on the pinned Python version against the resolved godoo pin range.

### Transport (Wave 1)
- [x] **TRANS-01**: Server exposes a Streamable HTTP MCP endpoint in stateless mode (`stateless_http=True`), with no `Mcp-Session-Id` emitted.
- [x] **TRANS-02**: A local `quickdoo` (or generic MCP) client can connect, list tools, and call a tool end-to-end.

### Authentication & credentials (Wave 1)
- [x] **AUTH-01**: Server resolves Odoo credentials from per-request `X-Odoo-Url`/`X-Odoo-Database`/`X-Odoo-Username`/`X-Odoo-Password` headers.
- [x] **AUTH-02**: When headers are absent, server falls back to `ODOO_URL`/`ODOO_DATABASE`/`ODOO_USERNAME`/`ODOO_PASSWORD` env vars; headers take precedence over env vars.
- [x] **AUTH-03**: Requests with no resolvable credentials fail with a clear 401-style MCP error.
- [x] **AUTH-04**: Each request builds a fresh Odoo client from its own resolved credentials; no client/connection is shared across requests or users.

### Record primitives (Wave 1)
- [x] **REC-01**: Agent can search records of any model with a domain and return matching ids/records (`record.search`/`search_read`).
- [x] **REC-02**: Agent can read fields of records by id (`record.read`).
- [x] **REC-03**: Agent can create a record of any model (`record.create`).
- [x] **REC-04**: Agent can update fields of existing records (`record.update`/`write`).
- [x] **REC-05**: Agent can delete records (`record.delete`/`unlink`).

### Discovery & identity (Wave 1)
- [x] **DISC-01**: Agent can list available Odoo models (`discovery.list_models`).
- [x] **DISC-02**: Agent can introspect a model's fields and types (`discovery.get_fields`).
- [x] **USER-01**: Agent can confirm the authenticated identity and connectivity (`users.whoami`).

### Error contract (Wave 1)
- [x] **ERR-01**: Odoo errors are surfaced to the agent as structured MCP errors carrying model/field/constraint detail sufficient for self-correction.

### Full tool surface (Wave 2)
- [x] **MAIL-01**: Mail/chatter capabilities exposed via `mail.*` tools (post message, log note, read chatter, manage activities/followers per the salvaged 17-tool surface).
- [x] **ACT-01**: Server-side actions exposed via `action.*` tools.
- [x] **ATT-01**: Attachment capabilities exposed via `attachments.*` tools (list, fetch, create).
- [x] **USER-02**: Agent can search users (`users.search_users`).
- [x] **DISC-03**: Agent can list menus (`discovery.list_menus`).

### Catalog & resources (Wave 2)
- [x] **CAT-01**: Server introspects the Odoo catalog (models, fields, actions, menus) with a schema hash — re-implements `buildCatalogContent`.
- [x] **CAT-02**: Catalog is cached in-process (LRU + TTL) keyed by `(url, database, schema_hash)`, invalidated on schema-hash change; cold-start introspection runs in parallel.
- [x] **RES-01**: MCP resource descriptors at `odoo://model/{name}`, `odoo://action/{id}`, `odoo://menu/{id}` URIs (schema-level addressing only; no record-instance URIs — per D-13). Re-implements `buildResourceDescriptors` URI scheme from odoo-api-proxy.

### Per-user ACL (Wave 2)
- [REMOVED] **ACL-01**: ~~Server probes per-user access rights (`check_access_rights`) and filters the exposed tool/resource set accordingly; results cached per `(url, database, uid)`, never re-probed per request.~~ (Removed per D-12: ACL enforcement fully delegated to Odoo; every tool call runs as the requesting user's credentials; Odoo enforces access natively.)
- [REMOVED] **ACL-02**: ~~On ACL-driven tool-set change, server emits `notifications/tools/list_changed`.~~ (Removed per D-12: no ACL-driven tool-surface filtering; no change notifications.)

### Skills as Resources (Wave 2)
- [x] **SKILL-01**: Skill Markdown files (SKILL.md, mail/chatter, mail/activities, base/properties) are served as MCP Resources, ported directly from `odoo-api-proxy`.
- [x] **SKILL-02**: A discovery `index.json` is generated at startup from a filesystem glob; startup asserts every `.md` has an index entry and vice versa.

### MCP Code Mode (Wave 3)
- [ ] **CODE-01**: Server exposes a single `execute_odoo_code` tool that runs agent-authored code against a typed Odoo client surface.
- [ ] **CODE-02**: Code runs in an OS-level sandbox with no direct network egress (mechanism — subprocess+seccomp vs Docker sidecar — decided at Wave 3 planning).
- [ ] **CODE-03**: Sandbox outbound calls route only through an allowlisted internal Odoo RPC layer (via the godoo client).
- [ ] **CODE-04**: Read-only by default; write operations require an explicit capability grant.
- [ ] **CODE-05**: Per-invocation session isolation, rate limiting, and audit logging are enforced.

### Release & deployment (Wave 2 → ship)
- [x] **REL-01**: Package is publishable to PyPI (`pip install`) once the godoo dependency is publicly resolvable.
- [x] **REL-02**: A Docker image (`python:3.14-slim` base) builds and runs the server with parity to the pip install.
- [x] **REL-03**: `@marcfargas/odoo-mcp` (npm 0.1.4) is deprecated with a message pointing to godoo-mcp-server as successor.
- [x] **REL-04**: README documents the header-trust threat model — direct exposure without a header-stripping proxy means the caller chooses the Odoo user; godoo-proxy is the SaaS guard.

---

## v2 / Deferred

- Persistent (cross-restart) catalog cache backend behind a pluggable seam — in-process LRU is the v1.0 default.
- Additional skill files beyond the four ported from odoo-api-proxy.
- Cherry-picking capabilities from `@marcfargas/odoo-mcp` — explicitly skipped this charter pass.

---

## Out of Scope (explicit exclusions)

- **OAuth 2.1 / SSO / SaaS auth** — belongs to the separate commercial `godoo-proxy` satellite. This server is NOT the auth gateway.
- **Storage/persistence layer** (Drizzle/Memory impls, cache/audit/rate-limit repos from odoo-api-proxy) — stateless design.
- **Admin routes** — gateway concern.
- **Kernel/shell DI seam (KernelDeps)** — being dismantled upstream.
- **Direct reuse of odoo-api-proxy TypeScript code** — design is re-implemented in Python; code is not transferred.
- **Odoo server-action Code Mode** (agent Python executed in-transaction inside an Odoo server action) — spike-gated upstream (`spike-code-mode-feasibility.md`), feasibility unresolved. Distinct from MCP Code Mode (CODE-*), which runs outside Odoo. Do not plan until the spike resolves.
- **Dependency on godoo-ts or godoo-stateman** — only the godoo Python client is a runtime dependency.

---

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| FOUND-01 | Phase 1 | Complete |
| FOUND-02 | Phase 1 | Complete |
| FOUND-03 | Phase 1 | Complete |
| TRANS-01 | Phase 2 | Complete |
| TRANS-02 | Phase 2 | Complete |
| AUTH-01 | Phase 2 | Complete |
| AUTH-02 | Phase 2 | Complete |
| AUTH-03 | Phase 2 | Complete |
| AUTH-04 | Phase 2 | Complete |
| REC-01 | Phase 3 | Complete |
| REC-02 | Phase 3 | Complete |
| REC-03 | Phase 3 | Complete |
| REC-04 | Phase 3 | Complete |
| REC-05 | Phase 3 | Complete |
| DISC-01 | Phase 3 | Complete |
| DISC-02 | Phase 3 | Complete |
| USER-01 | Phase 3 | Complete |
| ERR-01 | Phase 3 | Complete |
| MAIL-01 | Phase 4 | Complete |
| ACT-01 | Phase 4 | Complete |
| ATT-01 | Phase 4 | Complete |
| USER-02 | Phase 4 | Complete |
| DISC-03 | Phase 4 | Complete |
| CAT-01 | Phase 4 | Complete |
| CAT-02 | Phase 4 | Complete |
| RES-01 | Phase 4 | Complete |
| ACL-01 | Phase 4 | Removed (D-12) |
| ACL-02 | Phase 4 | Removed (D-12) |
| SKILL-01 | Phase 4 | Complete |
| SKILL-02 | Phase 4 | Complete |
| REL-01 | Phase 5 | Complete |
| REL-02 | Phase 5 | Complete |
| REL-03 | Phase 5 | Complete |
| REL-04 | Phase 5 | Complete |
| CODE-01 | Phase 6 | Pending |
| CODE-02 | Phase 6 | Pending |
| CODE-03 | Phase 6 | Pending |
| CODE-04 | Phase 6 | Pending |
| CODE-05 | Phase 6 | Pending |
