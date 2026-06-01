# Roadmap: godoo-mcp-server v1.0

## Overview

godoo-mcp-server ships in six phases. Phase 1 resolves the blocking godoo dependency
conflict and scaffolds the project. Phase 2 wires the stateless Streamable HTTP transport
with per-request credential resolution. Phase 3 delivers the Wave 1 tool surface (record
primitives, discovery, whoami, error contract) and proves the end-to-end path against a
real Odoo instance. Phase 4 completes the full 17-tool surface, catalog introspection,
MCP resource descriptors, per-user ACL probing, and skill Markdown files as MCP Resources.
Phase 5 packages and ships: pip + Docker, README threat-model documentation, and the
`@marcfargas/odoo-mcp` deprecation notice. Phase 6 implements MCP Code Mode behind an
OS-level sandbox whose isolation mechanism is decided at Wave 3 planning entry.

## Phases

- [ ] **Phase 1: Foundations** - Resolve godoo dependency conflict, scaffold package, wire CI
- [ ] **Phase 2: Skeleton Server** - Stateless Streamable HTTP transport + per-request credential resolution
- [ ] **Phase 3: Core Primitives** - Wave 1 tool surface end-to-end against a real Odoo instance
- [ ] **Phase 4: Full Surface + Catalog + ACL + Skills** - Complete 17-tool surface, catalog, resources, ACL, skill files
- [ ] **Phase 5: Package & Ship** - pip + Docker packaging, threat-model README, npm deprecation
- [ ] **Phase 6: Code Mode** - execute_odoo_code with OS-level sandboxed execution

## Phase Details

### Phase 1: Foundations
**Goal**: The project builds, lints, and passes CI with the correct godoo dependency pinned
**Mode:** mvp
**Depends on**: Nothing (first phase)
**Requirements**: FOUND-01, FOUND-02, FOUND-03
**Success Criteria** (what must be TRUE):
  1. The godoo dependency conflict is resolved: exact PyPI package name, version pin, and Python floor are confirmed in writing and reflected in `pyproject.toml` (this unblocks all coding)
  2. `pip install -e .` succeeds and `python -m godoo_mcp_server --version` (or equivalent) runs without error
  3. CI runs lint, type-check, and an empty test suite on the confirmed Python version — all green
**Plans**: TBD

### Phase 2: Skeleton Server
**Goal**: An MCP client can connect to the stateless Streamable HTTP endpoint and receive a valid tool list; credentials resolve per-request with no cross-user bleed
**Mode:** mvp
**Depends on**: Phase 1
**Requirements**: TRANS-01, TRANS-02, AUTH-01, AUTH-02, AUTH-03, AUTH-04
**Success Criteria** (what must be TRUE):
  1. A generic MCP client (curl or quickdoo) POSTs to `/mcp` and receives a valid JSON-RPC MCP response — no `Mcp-Session-Id` is emitted in any response header (stateless HTTP verified)
  2. A request carrying `X-Odoo-Url` / `X-Odoo-Database` / `X-Odoo-Username` / `X-Odoo-Password` headers resolves those credentials; a request with no headers falls back to env vars; headers take precedence when both are present
  3. A request with neither headers nor env vars returns a clear 401-style MCP error with a human-readable message
  4. Two concurrent requests with different header credentials each resolve to their own isolated credential set — no shared `OdooClient` instance, no cross-user bleed confirmed by test
**Plans**: TBD

### Phase 3: Core Primitives
**Goal**: An MCP agent can authenticate as a real Odoo user, discover models and fields, perform all five record operations, and receive structured errors sufficient for self-correction — all verified against a live Odoo instance
**Mode:** mvp
**Depends on**: Phase 2
**Requirements**: REC-01, REC-02, REC-03, REC-04, REC-05, DISC-01, DISC-02, USER-01, ERR-01
**Success Criteria** (what must be TRUE):
  1. `users.whoami` returns the authenticated Odoo uid and username for a valid credential set
  2. `discovery.list_models` returns the model list; `discovery.get_fields` returns typed field metadata for a named model
  3. `record.search` / `record.read` / `record.create` / `record.update` / `record.delete` each complete a round-trip against a real Odoo instance without error
  4. An intentionally invalid domain on `record.search` surfaces a structured MCP error carrying model name, field, and constraint detail — not a raw Python traceback
  5. One integration test in CI performs the full path (credential resolution → Odoo authenticate → record.search) against the pinned quickdoo/Odoo instance and passes green
**Plans**: TBD

### Phase 4: Full Surface + Catalog + ACL + Skills
**Goal**: The complete 17-tool MCP surface is available; catalog introspection produces schema-hashed, cached MCP resource descriptors; per-user ACL filtering is applied with change notifications; skill Markdown files are served as MCP Resources; cross-user cache isolation is verified by a two-user integration test
**Mode:** mvp
**Depends on**: Phase 3
**Requirements**: MAIL-01, ACT-01, ATT-01, USER-02, DISC-03, CAT-01, CAT-02, RES-01, ACL-01, ACL-02, SKILL-01, SKILL-02
**Success Criteria** (what must be TRUE):
  1. `mail.*` (post_message, log_note, list_messages, schedule_activity, list_activities, mark_activity_done), `action.*` (execute_action, list_actions), `attachments.*` (list, upload, download), `users.search_users`, and `discovery.list_menus` all respond to valid MCP tool calls
  2. Catalog introspection returns a snapshot with schema hash; a second call with the same schema hash is served from the in-process LRU+TTL cache (no Odoo RPC fired on hit); a schema change forces a cache miss
  3. MCP resource descriptors for models are accessible at `odoo://model/{name}` URIs; skill Markdown files (`SKILL.md`, `mail/chatter.md`, `mail/activities.md`, `base/properties.md`) are readable as MCP Resources; `index.json` is generated at startup and startup assertion confirms every `.md` has an index entry and vice versa
  4. Two-user isolation test: User A's ACL probe result (cached under User A's uid) is never returned for User B; catalog cache keys never include credentials (only `(url, database, schema_hash)`) — both confirmed by test
  5. When the ACL probe result changes, the server emits `notifications/tools/list_changed` to the connected MCP client
**Plans**: TBD
**UI hint**: no

### Phase 5: Package & Ship
**Goal**: godoo-mcp-server is installable from PyPI and runnable from a Docker image; the README documents the header-trust threat model; `@marcfargas/odoo-mcp` is formally deprecated pointing users here
**Mode:** mvp
**Depends on**: Phase 4
**Requirements**: REL-01, REL-02, REL-03, REL-04
**Success Criteria** (what must be TRUE):
  1. `pip install godoo-mcp-server` (from PyPI test index or final index) installs successfully and `python -m godoo_mcp_server` starts the server
  2. `docker build` produces an image based on `python:3.14-slim`; `docker run` starts the server with env-var credentials and responds to an MCP tool call — behaviour is identical to the pip install path
  3. README contains a "Security: Header Trust Model" section explaining that direct exposure without a header-stripping proxy gives the caller full Odoo user impersonation power, and names `godoo-proxy` as the SaaS-safe guard
  4. `npm deprecate @marcfargas/odoo-mcp "Deprecated: use godoo-mcp-server (PyPI) as successor"` has been run and the deprecation message is visible on the npm registry
**Plans**: TBD

### Phase 6: Code Mode
**Goal**: An MCP agent can invoke `execute_odoo_code` to run agent-authored code against Odoo through an OS-level sandbox that enforces no network egress, allowlisted Odoo RPC only, read-only-by-default, per-invocation isolation, rate limiting, and audit logging
**Mode:** mvp
**Depends on**: Phase 5
**Requirements**: CODE-01, CODE-02, CODE-03, CODE-04, CODE-05
**Success Criteria** (what must be TRUE):
  1. Sandbox isolation mechanism is decided at the start of this phase (subprocess+seccomp vs Docker sidecar) — the decision is documented in PROJECT.md Key Decisions before implementation begins
  2. `execute_odoo_code` with a read-only code block (e.g., `odoo.search_read("res.partner", [], limit=5)`) returns a valid result
  3. A network-egress test inside the sandbox — `socket.connect(("8.8.8.8", 53))` — raises an exception, confirming OS-level network isolation is enforced (not just Python-level restriction)
  4. A code block that attempts a write operation (`odoo.create(...)`) without the `write` capability grant returns a permission error before any Odoo RPC is made
  5. Every sandbox invocation produces an audit log entry (timestamp, credential identity hash, model, method, args summary); the rate limiter rejects a burst of more than N invocations per credential per minute
**Plans**: TBD

## Progress

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Foundations | 0/TBD | Not started | - |
| 2. Skeleton Server | 0/TBD | Not started | - |
| 3. Core Primitives | 0/TBD | Not started | - |
| 4. Full Surface + Catalog + ACL + Skills | 0/TBD | Not started | - |
| 5. Package & Ship | 0/TBD | Not started | - |
| 6. Code Mode | 0/TBD | Not started | - |
