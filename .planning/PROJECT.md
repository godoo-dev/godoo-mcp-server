# godoo-mcp-server

## What This Is

`godoo-mcp-server` is a FOSS, stateless, MCP-only, agent-facing Odoo server written in
Python. It lets AI agents work with any Odoo instance through a deliberately minimal set
of raw Odoo primitives exposed as MCP tools, plus discoverable skill Markdown files
served as MCP Resources. It is part of the godoo-dev / Odoo Atlas initiative and depends
on `godoo` (the Python client from the godoo-py monorepo) for all Odoo RPC.

**Critical boundary:** This is NOT the auth gateway. It does NOT do OAuth/SSO/SaaS
authentication — that belongs to the separate commercial satellite `godoo-proxy`.
Coupling: `godoo-proxy` (commercial) → injects per-user credential headers →
`godoo-mcp-server` (this repo, FOSS) → Odoo. In self-host/FOSS deployments, headers or
env vars are set directly with no proxy in the path.

**Design philosophy — deliberate minimalism:** Most Odoo MCP servers expose
hardcoded, module-specific tools. An Odoo instance has hundreds of models — you cannot
hardcode a useful toolset. The godoo approach exposes the smallest possible number of MCP
tools (raw Odoo primitives: search, read, create, write, call, introspect), bundles skill
Markdown files so agents acquire domain knowledge via discovery, and supports MCP Code
Mode as the logical extreme of minimal-tools: a single `execute_odoo_code` tool behind
which the agent writes composable Odoo RPC guided by skills.

## Core Value

An AI agent can connect to the Streamable HTTP MCP server, authenticate as a real Odoo
user (per-user credentials), and operate against any Odoo instance through a minimal set
of raw Odoo primitives plus discoverable skill knowledge — with real per-user ACL
enforcement.

## Requirements

### Validated

<!-- Shipped and confirmed valuable. -->

**Phase 1 — Foundations** (Validated in Phase 1: Foundations)

- [x] Odoo client dependency resolved: `godoo-client>=0.2,<0.3`, Python ≥3.14 (FOUND-01)
- [x] Single Python package scaffolded with `pyproject.toml`, `uv`/`hatchling`, LGPL-3.0 (FOUND-02)
- [x] 3-gate CI (ruff / mypy / pytest) green on Python 3.14 (FOUND-03)

**Wave 1 — Skeleton, credentials, core primitives** (Validated in Phases 2–3 + confirmed by Phase 4.1 live e2e 2026-06-02)

- [x] Streamable HTTP MCP server skeleton, connectable by a local quickdoo instance (TRANS-01, TRANS-02)
- [x] Credential resolution: per-user `X-Odoo-Url`, `X-Odoo-Database`,
      `X-Odoo-Username`, `X-Odoo-Password` headers with env-var fallback
      (`ODOO_URL`, `ODOO_DATABASE`, `ODOO_USERNAME`, `ODOO_PASSWORD`); headers take
      precedence; no headers + no env vars = clear error (AUTH-01, AUTH-02, AUTH-03, AUTH-04)
- [x] Minimal tool surface wired end-to-end via godoo client: `record.*` tools
      (search_records, read_records, create_record, update_record, delete_record) +
      `discovery.*` tools + `users.whoami` (REC-01 confirmed by live agent write-flow)
- [x] One passing integration test confirming the end-to-end path against a real Odoo
      instance

### Active

<!-- Current scope. Building toward these. Organized by Wave. -->

**Wave 2 — Full tool surface, catalog, ACL, skills**

- [ ] Full 17-tool surface: `mail.*` (post_message, log_note, list_messages,
      schedule_activity, list_activities, mark_activity_done), `record.*`, `action.*`
      (execute_action, list_actions), `users.*` (whoami, search_users),
      `attachments.*` (list_attachments, upload_attachment, download_attachment),
      `discovery.*` (list_models, get_fields, list_menus)
- [ ] Catalog introspection (models, fields, actions, menus, schema hash) —
      re-implements `buildCatalogContent` pattern from odoo-api-proxy in Python
- [ ] MCP resource descriptors — re-implements `buildResourceDescriptors` pattern;
      carry over MCP resource URI conventions from odoo-api-proxy
- [ ] Per-user ACL probe for curated tool filtering via `check_access_rights` —
      re-implements `probeAclForCuratedTools` pattern in Python
- [ ] Skill Markdown files (`SKILL.md`, `mail/chatter.md`, `mail/activities.md`,
      `base/properties.md` + `index.json` discovery index) ported from
      `odoo-api-proxy/skills/odoo/` and served as MCP Resources
- [ ] In-process LRU + TTL catalog cache with schema-hash invalidation
      (per-process, lost on restart)
- [ ] Deprecate `@marcfargas/odoo-mcp` (npm 0.1.4) pointing to godoo-mcp-server as
      successor (npm deprecate, not unpublish)

**Wave 3 — MCP Code Mode**

- [ ] `execute_odoo_code` tool: agent-authored code runs in a sandboxed
      subprocess/container against a typed Odoo client surface
- [ ] Sandbox: no direct network access; calls route through allowlisted internal Odoo
      RPC via godoo; read-only by default, writes require explicit capability grant
- [ ] Per-invocation session isolation, rate limiting, audit logging for Code Mode
- [ ] Skill files serve as recipes for `execute_odoo_code` code blocks
- [ ] Sandbox isolation mechanism decided and implemented
      (subprocess vs Docker sidecar — mechanism is research-gated, decided at Wave 3
      planning)

### Out of Scope

<!-- Explicit boundaries. Includes reasoning to prevent re-adding. -->

- **OAuth 2.1 / SSO / SaaS auth machinery** — belongs to the separate commercial
  `godoo-proxy` satellite; coupling is one-way (proxy injects headers, this server
  consumes them)
- **Storage abstraction (Drizzle/Memory impls, cache repos, audit log repos,
  rate-limit repos from odoo-api-proxy)** — not salvaged; stateless design eliminates
  the need; persistent state is a gateway concern
- **Admin routes** — gateway concern; `godoo-proxy` handles admin surfaces
- **Kernel/shell DI seam (`KernelDeps`)** — being dismantled upstream in
  odoo-api-proxy anyway; not replicated here
- **Sliding-window rate limiter (odoo-api-proxy impl)** — gateway concern; belongs
  in `godoo-proxy`
- **Direct reuse of odoo-api-proxy TypeScript code** — design is salvaged and
  re-implemented in Python; no code is transferred
- **Odoo server-action Code Mode (in-transaction Python inside Odoo)** — spike-gated
  on `../godoo-hq/.planning/seeds/spike-code-mode-feasibility.md`; feasibility
  unresolved (no-eval blocker); entirely distinct from MCP Code Mode (which runs
  outside Odoo in the server's own sandbox); do not plan until spike resolves
- **Dependency on godoo-ts or godoo-stateman** — only `godoo` (godoo-py) is a runtime
  dependency from the godoo library family
- **Cherry-picking from `@marcfargas/odoo-mcp`** — explicitly skipped this charter
  pass; odoo-api-proxy design is the sole design source, sufficient on its own
- **Monorepo / multi-package structure** — single package is simplest for a stateless
  server with one deployment target; not needed at this stage

## Context

**Umbrella and initiative.** `godoo-mcp-server` is a satellite under the
`godoo-dev` / Odoo Atlas initiative, coordinated from the spine repo `godoo-hq`. Other
initiative satellites: `godoo-py` (Python RPC client, primary dependency), `godoo-ts`
(TypeScript client), `godoo-stateman` (Python state manager), `quickdoo` (desktop, future
consumer of this server). Generated `CLAUDE.md` must `@`-import
`@../godoo-hq/UMBRELLA_CLAUDE.md` (relative sibling path, imported never copied) so the
repo stays umbrella-aware after a fresh clone.

**Atlas split — what this replaces.** The former `odoo-api-proxy` (TypeScript, Fastify)
is being split into two distinct satellites. This repo takes the FOSS MCP-server half;
`godoo-proxy` (SEED deferred) takes the auth/OAuth/SSO half. The split is clean: this
server is stateless and knows nothing about authentication flows. `odoo-api-proxy`
continues its own v1.2 Stateless Pivot independently; the two repos share no codebase.

**Primary salvage source (design only).** `odoo-api-proxy` at `C:\dev\odoo-api-proxy`
provides the design blueprint: 17 MCP tool descriptors, `buildCatalogContent` catalog
introspection pattern, `buildResourceDescriptors` MCP resource transform, `probeAclForCuratedTools` ACL probe pattern, and MCP resource URI conventions. All are
re-implemented in Python against the `godoo` client — no TypeScript code transferred.

**Direct port (language-agnostic).** Skill Markdown files and `index.json` discovery
index from `odoo-api-proxy/skills/odoo/` port directly (Markdown is language-agnostic).
Files: `SKILL.md`, `mail/chatter.md`, `mail/activities.md`, `base/properties.md`,
`index.json`.

**MCP Code Mode research.** MCP Code Mode (Cloudflare/Anthropic pattern, researched
2026-06-01) is a server-side design pattern — not an external SDK dependency. Full
briefing at `../godoo-hq/.planning/quick/260601-sy2-*/260601-sy2-RESEARCH.md`. The
sandbox isolation mechanism (subprocess vs Docker sidecar) is a Wave 3 planning decision;
security requirements are non-negotiable (no direct network from sandbox, RBAC-enforced
Odoo RPC only, per-invocation session isolation, read-only default, audit logging).

**`@marcfargas/odoo-mcp` succession.** npm package `@marcfargas/odoo-mcp` (0.1.4, in
`odoo-toolbox` at `targets/odoo-mcp`) is the predecessor. v1.0 of this server includes
an explicit deprecation notice pointing users to `godoo-mcp-server` as the successor
(npm deprecate, not unpublish).

**Repo.** `github.com/godoo-dev/godoo-mcp-server` — already created, currently private.
FOSS/public intent at or after v1.0 ship.

**Report-back.** On v1.0 completion, file ONE terminal report: a `## YYYY-MM-DD — <title>`
entry prepended to `godoo-hq/dev-log.md`. Mechanism defined in
`../godoo-hq/.planning/notes/report-back-mechanism.md`. Required outcomes to report:
Streamable HTTP server connectable by quickdoo; minimal tool surface wired; skill files
as MCP Resources functional; catalog introspection and MCP resource descriptors tested;
ACL probe functional; `@marcfargas/odoo-mcp` deprecated; MCP Code Mode shipped or
explicitly deferred with rationale; header/env auth verified in at least one deployment
mode.

## Constraints

- **Tech stack**: Python — godoo-py is the primary Odoo RPC client (publishing v1.1 typed
  models, strongest library momentum in the godoo family); no dependency on godoo-ts or
  godoo-stateman
- **Transport**: Streamable HTTP (MCP) — required for remote quickdoo connectivity and
  self-hosted deployments; no stdio-only fallback in v1.0
- **Deployment**: pip package + Docker image (both) — pip for library/embedded use,
  Docker for self-hosted / remote-quickdoo target
- **godoo pin**: `>=1.1,<1.2` (pin minor, deliberate upgrades); confirm exact version
  once godoo-py v1.1 stabilises
- **License**: LGPL-3.0 — house default for godoo family FOSS libraries; confirmed
- **Stateless**: no persistent state in the server; catalog cache is in-process LRU+TTL
  only (lost on restart); all per-user state lives in Odoo
- **Security (Code Mode)**: sandbox must enforce no direct network, allowlisted Odoo RPC
  only, read-only default, per-invocation isolation, rate limiting, audit logging —
  non-negotiable even for MVP Code Mode
- **Auth boundary**: this server consumes credential headers/env vars; it never generates
  them, never issues tokens, never implements OAuth — that boundary is absolute

## Key Decisions

<!-- Decisions that constrain future work. Add throughout project lifecycle. -->

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Language: Python | godoo-py is the more complete Odoo client (v1.1 typed models publishing); godoo-stateman is Python-only; strongest library momentum in the godoo family. Re-implement odoo-api-proxy design against godoo-py. | ✓ Confirmed |
| License: LGPL-3.0 | House default for godoo family FOSS libraries. | ✓ Confirmed |
| Deployment: pip package + Docker image (both) | pip for library/embedded use; Docker for self-hosted / remote-quickdoo target. Both are needed for the target deployment spread. | ✓ Confirmed |
| Packaging: single package | Simplest for a stateless server with one deployment target. No multi-package complexity at this stage. | ✓ Confirmed |
| v1.0 tool surface: phased (Wave 1→2→3) | Wave 1: `record.*` + `discovery.*` + `users.whoami` end-to-end. Wave 2: full 17-tool surface + ACL probe + skills as MCP Resources. Wave 3: MCP Code Mode. Minimalist philosophy: prove core primitives first. | — Pending |
| MCP Code Mode: in v1.0 as Wave 3; sandbox mechanism research-gated | Sandbox isolation (subprocess vs Docker sidecar) decided at Wave 3 planning after research. Code Mode is in scope for v1.0 but mechanism not locked. | — Pending |
| godoo pin: `>=1.1,<1.2` | Pin minor version, deliberate upgrades. Confirm exact version once godoo-py v1.1 stabilises. | — Pending |
| Catalog cache: in-process LRU + TTL; schema-hash invalidation | Stateless design; per-process cache, lost on restart. No external cache dependency. Schema-hash invalidation avoids stale catalog on model changes. | ✓ Confirmed |
| `@marcfargas/odoo-mcp` (npm 0.1.4): deprecate, point to this repo | npm deprecate (not unpublish) issued as part of v1.0. Successor notice points users here. | — Pending |
| Cherry-pick from odoo-mcp: skip | odoo-api-proxy design is the sole design source, sufficient on its own. Explicitly skipped this charter pass. | ✓ Confirmed |
| Repo: `github.com/godoo-dev/godoo-mcp-server`, private now | Repo already created under godoo-dev org. FOSS/public intent at/after v1.0 ship. | ✓ Done |
| Odoo server-action Code Mode: out of scope | Spike-gated on `spike-code-mode-feasibility.md`; no-eval blocker unresolved. Entirely distinct from MCP Code Mode (client-side sandbox). Do not plan until spike confirms feasibility. | ✓ Confirmed (excluded) |
| CLAUDE.md: @-import `@../godoo-hq/UMBRELLA_CLAUDE.md` | Relative sibling path import keeps repo umbrella-aware after fresh clone. Import, never copy — single-source principle. | ✓ Confirmed |

---

## Evolution

PROJECT.md evolves throughout the project lifecycle via two mechanisms:

**After each phase transition** (triggered by `/gsd-transition` or `/gsd:phase`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase/wave reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions table
5. "What This Is" still accurate? → Update if reality has drifted

**After each milestone** (triggered by `/gsd:complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state (integration test results, deployment feedback,
   upstream godoo-py version status)

---

*Last updated: 2026-06-02 — Phase 4.1 (E2E agent testing over real MCP transport) complete: headless claude -p agent connected over Streamable-HTTP TCP, created a res.partner.category, Odoo search_read verify-back confirmed. TRANS-01, TRANS-02, AUTH-01..04, REC-01 confirmed by live e2e run.*
