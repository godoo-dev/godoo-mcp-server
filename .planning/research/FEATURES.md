# Feature Research

**Domain:** Agent-facing Odoo MCP server (stateless, minimalist, raw-primitives design)
**Researched:** 2026-06-01
**Confidence:** HIGH (stack primitives, auth pattern, Code Mode); MEDIUM (competitor analysis, ACL probe)

---

## Competitor Landscape

Six distinct Odoo MCP server implementations surveyed (all PyPI/GitHub, 2025-2026):

| Project | Tools | Approach | Auth | Transport | Weakness |
|---------|-------|----------|------|-----------|----------|
| `mcp-server-odoo` (ivnvxd, v0.6.0) | 10 generic | Generic primitives + call_model_method | API key / user+pass env | stdio | Single-user, no per-user ACL, no skills |
| `odoo-mcp` (tuanle96, v0.3.1) | 24 mixed | Primitives + domain-specific write guards + prompts | env vars | stdio + Streamable HTTP | 24-tool surface is noisy; domain-specific tools (search_employee, search_holidays) break generality |
| `odoo-18-mcp-server` (nicolasramos) | Unknown | Modular, type-safe | env | stdio | Odoo 18-only |
| `odoo-mcp-server` (sameeroz) | ~8 hardcoded | Module-specific: products, customers, orders | API key | stdio | Exemplar of the anti-pattern this project rejects |
| `odoo-mcp-improved` (hachecito) | ~12 hardcoded | Module-specific: sales, purchase, inventory, accounting | env | stdio | Same anti-pattern; breaks on any non-standard instance |
| `odoo-mcp-multi` | Unknown | Multi-instance routing | env | stdio | Unclear primitives |

**Critical observation:** All surveyed competitors are single-user (env-var credentials), stdio-only, and expose either generic CRUD or hardcoded module tools. None implement per-user header auth, ACL probing, skills-as-MCP-Resources, or Code Mode. The design space this project targets is entirely unoccupied.

**`@marcfargas/odoo-mcp` (predecessor, npm 0.1.4):** Part of `odoo-toolbox` (TypeScript). Provides a minimal MCP surface plus skill Markdown files in `skills/odoo/` as the primary knowledge vehicle. This is the direct design predecessor; `odoo-api-proxy` is the implementation blueprint.

---

## Feature Landscape

### Table Stakes (Agents Expect These)

Features that any useful Odoo MCP server must have. Missing = agent cannot function.

| Feature | Why Expected | Complexity | Wave | Notes |
|---------|--------------|------------|------|-------|
| `record.search_records` | Agents need to query Odoo data. Without search, the server is useless for read workloads. | LOW | 1 | Odoo `search_read` + domain filter; field projection. Core Odoo primitive. |
| `record.read_records` | Fetch specific records by ID. Complement to search. | LOW | 1 | Odoo `read` RPC call. |
| `record.create_record` | Create new records. Basic CRUD completeness. | LOW | 1 | Odoo `create` RPC call. |
| `record.update_record` | Modify existing records. Basic CRUD completeness. | LOW | 1 | Odoo `write` RPC call. |
| `record.delete_record` | Remove records. Basic CRUD completeness. | LOW | 1 | Odoo `unlink` RPC call. |
| `discovery.list_models` | Agents need to discover what models exist before operating. | LOW | 1 | Odoo `fields_get` / `ir.model` search. Required for zero-assumption operation. |
| `discovery.get_fields` | Agents need field names, types, and required flags before constructing records. | MEDIUM | 1 | Odoo `fields_get` per model. Needed to avoid hallucinated field names. |
| `users.whoami` | Auth verification. Agent must confirm identity and ACL context. | LOW | 1 | Odoo `res.users` read for current uid. Doubles as connectivity check. |
| Per-user credential resolution | Without user-scoped auth, the server serves only one user and cannot be shared. | MEDIUM | 1 | `X-Odoo-Url`, `X-Odoo-Database`, `X-Odoo-Username`, `X-Odoo-Password` headers + env-var fallback. This project's core differentiator at the auth layer. |
| Structured error surfacing | Agents must receive Odoo error details (model, field, constraint, access) to self-correct. | LOW | 1 | Wrap Odoo RPC errors as MCP error responses with structured fields. No swallowing. |
| Streamable HTTP transport | Remote connectivity (quickdoo, deployed agents). stdio-only = development toy. | MEDIUM | 1 | MCP Streamable HTTP spec. All competitors are stdio-only; this is the only production transport. |

### Differentiators (Competitive Advantage)

Features that no existing Odoo MCP server provides. These constitute the project's value proposition beyond raw primitives.

| Feature | Value Proposition | Complexity | Wave | Notes |
|---------|-------------------|------------|------|-------|
| **Skills-as-MCP-Resources** | Agents discover domain knowledge (chatter patterns, property usage, activity workflows) without tool calls — just resource reads. Reduces context consumed and eliminates hallucination on Odoo-specific patterns. | MEDIUM | 2 | Markdown files (`SKILL.md`, `mail/chatter.md`, `mail/activities.md`, `base/properties.md`) + `index.json` served as MCP Resources. Ported directly from `odoo-api-proxy/skills/odoo/`. URI convention: `odoo-skill://mail/chatter.md`. |
| **Catalog introspection with schema-hash caching** | Agents can load the full model/field/action/menu catalog in one resource read, with hash-based invalidation so they only re-fetch when the schema changes. Eliminates repeated `get_fields` calls per operation. | HIGH | 2 | Re-implements `buildCatalogContent` from `odoo-api-proxy`. In-process LRU + TTL cache keyed by schema hash. Schema hash = hash of `ir.model` + `ir.model.fields` counts/names. Lost on restart (stateless design). |
| **MCP Resource descriptors** | Agents see structured resource entries (model URI, schema URI, catalog URI) from the first `list_resources` call, enabling progressive discovery without tool calls. | MEDIUM | 2 | Re-implements `buildResourceDescriptors` from `odoo-api-proxy`. Emits `odoo://{model}/record/{id}`, `odoo://{model}/schema`, `odoo://catalog` URIs. |
| **Per-user ACL probe for dynamic tool filtering** | Tools the agent cannot use (due to Odoo ACL) are hidden from `tools/list`, reducing confusion and preventing predictable authorization errors. | HIGH | 2 | Calls Odoo `check_access_rights` for curated model set after auth; returns filtered tool list per user. Re-implements `probeAclForCuratedTools` from `odoo-api-proxy`. Runs at connection time, cached per session. |
| **`mail.*` tools — chatter and activities** | Odoo's chatter is a core workflow primitive. Agents operating on CRM, helpdesk, project, or any `mail.thread` model need post/log/schedule/read. None of the competitors expose this surface. | MEDIUM | 2 | 6 tools: `mail.post_message`, `mail.log_note`, `mail.list_messages`, `mail.schedule_activity`, `mail.list_activities`, `mail.mark_activity_done`. Requires `mail.thread` mixin on target model. |
| **`action.*` tools** | Agents need to trigger server actions (e.g., confirm sale, post invoice) without knowing the method name. Generic `execute_action` + `list_actions` decouples agent logic from Odoo internals. | MEDIUM | 2 | `action.execute_action`, `action.list_actions`. Wraps `ir.actions.server` execution. |
| **`attachments.*` tools** | File retrieval and upload is required for document-heavy workflows (invoice PDFs, delivery notes, contract documents). | MEDIUM | 2 | `attachments.list_attachments`, `attachments.upload_attachment`, `attachments.download_attachment`. Wraps `ir.attachment` model. |
| **`users.search_users`** | Agents assigning tasks, activities, or sending messages need to resolve user names to IDs. | LOW | 2 | `users.search_users` — `res.users` search with name filter. |
| **`discovery.list_menus`** | Agents navigating Odoo UI-equivalent flows need to know what menus/app areas exist. Enables structured exploration of available modules. | LOW | 2 | Wraps `ir.ui.menu` search. Lower priority than models/fields. |
| **MCP Code Mode (`execute_odoo_code`)** | Token-efficient extreme: instead of 17 tools consuming context, the agent writes typed Odoo RPC code and executes it in one call. Cloudflare achieves 99.9% token reduction; Anthropic measures 98.7%. No competitor has this. Unique capability for complex, multi-step workflows in a single round-trip. | HIGH | 3 | Sandboxed subprocess or Docker sidecar (mechanism research-gated). Agent writes Python against godoo-py typed surface. No direct network from sandbox; Odoo RPC only via godoo allowlist; read-only default; explicit write capability grant; per-invocation isolation; rate limiting; audit logging. |
| **godoo-py typed client integration** | `godoo-py` v1.1 provides typed Odoo models — agents using Code Mode write against a real typed surface, not raw dicts. Reduces hallucination in generated code. | LOW (dependency already chosen) | 3 | Constraint from PROJECT.md, not a feature choice. Mentioned here as a differentiator vs competitors using raw xmlrpc.client. |

### Anti-Features (Deliberately NOT Built)

Features that appear valuable but would destroy the design's integrity or create the problems this project exists to solve.

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| **Hardcoded per-module tools** (e.g., `search_invoices`, `create_sale_order`, `get_stock_levels`) | Feels ergonomic — agents get pre-named tools for common operations | This IS the problem. An Odoo instance has 200–800 models. Hardcoded tools break on any customization, any non-standard module, any vertical. Competitors demonstrate the failure mode: `sameeroz/odoo-mcp-server` and `hachecito/odoo-mcp-improved` are dead on arrival for any non-vanilla Odoo. Cannot be maintained. | Generic `record.*` primitives + skill files that teach domain-specific patterns. |
| **OAuth 2.1 / SSO / SaaS auth** | Multi-user SaaS deployments need token flows | Belongs to the separate commercial `godoo-proxy` satellite. Coupling auth machinery into this FOSS server conflates concerns, breaks the stateless boundary, and creates a maintenance surface that would jeopardize LGPL licensing. | `godoo-proxy` injects `X-Odoo-*` headers after completing OAuth; this server consumes them. |
| **Persistent storage / state** | Session memory, audit log DB, rate-limit counters feel useful | Destroys the stateless design. All competitors with storage become ops burdens (Redis, SQLite, Postgres). Persistent state belongs to the gateway layer. | In-process LRU+TTL cache (lost on restart) is sufficient for catalog. Gateway handles rate limits and audit. |
| **Admin routes** (user management, module installation, `ir.config_parameter` writes) | Agents doing Odoo administration could use this | Admin operations are a gateway concern, expose attack surface, and violate the "agent as a user" model. An agent should operate with real per-user ACL, not elevated admin rights. | `godoo-proxy` exposes admin surfaces behind stricter auth. This server enforces per-user Odoo ACL exclusively. |
| **Odoo server-action Code Mode** (in-transaction Python inside Odoo via `ir.actions.server`) | Feels like the "native" way to run agent code in Odoo | Blocked by Odoo's no-eval policy in versions 16+. Spike-gated, infeasibility likely. Entirely distinct from MCP Code Mode. | MCP Code Mode runs in the server's own sandbox (outside Odoo), calls Odoo via godoo RPC. Same result without the eval problem. |
| **approve-before-write pattern** (preview_write → validate_write → execute_approved_write) | `tuanle96/mcp-odoo` implements this — appears safe | Adds 3 tools per write operation, triples the tool surface, and puts approval logic in the MCP layer instead of the agent's reasoning. Odoo's own ACL + field constraints are the correct guard layer. Agents on frontier models can reason about write safety without protocol-level gates. | Odoo ACL enforcement is the guard. Per-user credentials mean agents can only write what the Odoo user can write. |
| **Aggregate/analytics tools** (`aggregate_records`, financial ratios, turnover metrics) | Agents doing reporting need aggregation | `read_group` can be wrapped in `record.search_records` with groupby parameter, or more cleanly in `execute_odoo_code` (Code Mode). Adding `aggregate_records` as a separate tool bloats the surface for a use case better served by Code Mode. | Expose via Code Mode (Wave 3) or document in skills as a `search_read` + `read_group` pattern. |

---

## Feature Dependencies

```
users.whoami
    └──requires──> credential resolution (X-Odoo-* headers / env vars)

record.* (search, read, create, update, delete)
    └──requires──> credential resolution
    └──requires──> structured error surfacing

discovery.list_models
    └──requires──> credential resolution

discovery.get_fields
    └──requires──> discovery.list_models (need model name to get fields)

catalog introspection (Wave 2)
    └──requires──> discovery.list_models
    └──requires──> discovery.get_fields
    └──enhances──> MCP Resource descriptors (catalog is one resource)

schema-hash caching
    └──requires──> catalog introspection
    └──enhances──> catalog introspection (makes re-fetch cheap)

per-user ACL probe (Wave 2)
    └──requires──> users.whoami (need uid)
    └──requires──> credential resolution
    └──modifies──> tools/list response (filters tools per user)

skills-as-MCP-Resources (Wave 2)
    └──requires──> Streamable HTTP transport (resources only meaningful in HTTP mode)
    └──enhances──> execute_odoo_code (skills serve as Code Mode recipes)

mail.* tools (Wave 2)
    └──requires──> record.* (mail operates on records; model must have mail.thread)

action.* tools (Wave 2)
    └──requires──> discovery.list_models (actions are scoped to models)

attachments.* tools (Wave 2)
    └──requires──> record.* (attachments link to records)

execute_odoo_code (Wave 3)
    └──requires──> credential resolution (sandbox inherits auth context)
    └──requires──> godoo-py client (typed surface for agent code)
    └──enhances──> skills-as-MCP-Resources (skills become executable recipes)
    └──conflicts──> hardcoded per-module tools (Code Mode makes them redundant)
```

### Dependency Notes

- **Credential resolution is the root dependency:** Every tool depends on it. Wave 1 cannot ship without it.
- **`discovery.get_fields` depends on `discovery.list_models`:** Agents must know model names before requesting field schemas. Both belong in Wave 1.
- **ACL probe modifies `tools/list`:** The probe runs at connection time and must complete before the first `tools/list` response. This means it must be non-blocking or the tool list must be emittable incrementally.
- **Skills enhance Code Mode:** Skills serve as Markdown recipes that Code Mode uses. Wave 2 skills + Wave 3 Code Mode form a compounding capability.
- **Code Mode makes per-module tools redundant:** Once `execute_odoo_code` exists, any domain-specific tool is expressible as a skill + code block. This is the long-term direction.

---

## MVP Definition (Wave-mapped)

### Wave 1 — Launch With (Skeleton + core primitives)

Minimum to prove the end-to-end path and validate connectivity against a real Odoo instance.

- [ ] Streamable HTTP MCP server skeleton — required for remote connectivity; all competitors are stdio-only
- [ ] Credential resolution (X-Odoo-* headers + env-var fallback) — root dependency for everything
- [ ] `record.search_records` — core read primitive; most agent workflows start here
- [ ] `record.read_records` — complement to search; needed for record detail reads
- [ ] `record.create_record` — write primitive #1
- [ ] `record.update_record` — write primitive #2
- [ ] `record.delete_record` — write primitive #3
- [ ] `discovery.list_models` — agents must know what exists before operating
- [ ] `discovery.get_fields` — agents must know field shapes before constructing records
- [ ] `users.whoami` — identity verification + connectivity probe
- [ ] Structured error surfacing — agents cannot self-correct without Odoo error details
- [ ] One passing integration test against a real Odoo instance — validates the full path

Wave 1 tool count: **9 tools** (record.* x5, discovery.* x2, users.whoami x1) + transport + auth.

### Wave 2 — Full Surface + Intelligence

Add after Wave 1 integration test passes.

- [ ] `mail.*` (6 tools) — chatter and activities; core Odoo workflow primitive
- [ ] `action.*` (2 tools) — server action execution; needed for workflow triggers
- [ ] `users.search_users` (1 tool) — user resolution for assignment/messaging
- [ ] `attachments.*` (3 tools) — document workflows
- [ ] `discovery.list_menus` (1 tool) — structural exploration
- [ ] Catalog introspection + schema-hash caching — single-resource catalog load
- [ ] MCP Resource descriptors — structured discovery surface
- [ ] Per-user ACL probe + dynamic tool filtering — show only what the user can use
- [ ] Skills-as-MCP-Resources (SKILL.md, mail/chatter.md, mail/activities.md, base/properties.md + index.json)
- [ ] Deprecate `@marcfargas/odoo-mcp` npm 0.1.4 → point to this repo

Wave 2 tool count: **17 tools total** (Wave 1 + 13 more).

### Wave 3 — Code Mode

- [ ] `execute_odoo_code` tool with sandboxed execution — MCP Code Mode pattern
- [ ] Sandbox isolation (subprocess vs Docker sidecar — mechanism decided at Wave 3 planning)
- [ ] Per-invocation session isolation, rate limiting, audit logging
- [ ] Skills updated as Code Mode recipes

---

## Feature Prioritization Matrix

| Feature | Agent Value | Implementation Cost | Wave | Priority |
|---------|-------------|---------------------|------|----------|
| Credential resolution (header/env) | HIGH | MEDIUM | 1 | P1 |
| record.* (5 tools) | HIGH | LOW | 1 | P1 |
| discovery.list_models + get_fields | HIGH | LOW | 1 | P1 |
| users.whoami | HIGH | LOW | 1 | P1 |
| Streamable HTTP transport | HIGH | MEDIUM | 1 | P1 |
| Structured error surfacing | HIGH | LOW | 1 | P1 |
| mail.* (6 tools) | HIGH | MEDIUM | 2 | P1 |
| Skills-as-MCP-Resources | HIGH | MEDIUM | 2 | P1 |
| Per-user ACL probe | MEDIUM | HIGH | 2 | P2 |
| Catalog introspection + schema-hash cache | MEDIUM | HIGH | 2 | P2 |
| MCP Resource descriptors | MEDIUM | MEDIUM | 2 | P2 |
| action.* (2 tools) | MEDIUM | MEDIUM | 2 | P2 |
| attachments.* (3 tools) | MEDIUM | MEDIUM | 2 | P2 |
| users.search_users | LOW | LOW | 2 | P2 |
| discovery.list_menus | LOW | LOW | 2 | P3 |
| execute_odoo_code (Code Mode) | HIGH | HIGH | 3 | P2 (Wave 3) |
| Sandbox isolation mechanism | HIGH | HIGH | 3 | P1 (Wave 3) |

---

## Competitor Feature Analysis

| Feature | mcp-server-odoo (ivnvxd) | odoo-mcp (tuanle96) | odoo-mcp-server (sameeroz) | godoo-mcp-server (this project) |
|---------|--------------------------|---------------------|----------------------------|---------------------------------|
| Generic CRUD primitives | Yes (10 tools) | Yes (partial) | No (hardcoded) | Yes (record.* x5) |
| Per-user header auth | No | No | No | Yes (X-Odoo-* headers) |
| Multi-user / shared server | No | No | No | Yes |
| Streamable HTTP transport | No (stdio) | Yes (stdio + HTTP) | No (stdio) | Yes (primary) |
| Chatter / mail.* tools | Yes (post_message) | Yes (chatter_post) | No | Yes (6 mail.* tools) |
| Skills / domain knowledge | No | Prompts (5) | No | Yes (MCP Resources) |
| ACL-based tool filtering | No | No | No | Yes (probeAclForCuratedTools) |
| Schema-hash catalog cache | No | schema_catalog (no hash) | No | Yes (LRU+TTL+hash) |
| MCP Code Mode | No | No | No | Yes (Wave 3) |
| Hardcoded module tools | No | Partial (search_employee) | Yes (anti-pattern) | Explicitly rejected |
| Per-user ACL enforcement | No (service account) | No (service account) | No | Yes (real Odoo ACL) |

---

## Sources

- [mcp-server-odoo (ivnvxd) — PyPI](https://pypi.org/project/mcp-server-odoo/) — v0.6.0, 2026-05-02
- [mcp-server-odoo (ivnvxd) — GitHub](https://github.com/ivnvxd/mcp-server-odoo)
- [odoo-mcp (tuanle96) — GitHub](https://github.com/tuanle96/mcp-odoo) — v0.3.1, 2026-05-21
- [odoo-mcp-server (sameeroz) — GitHub](https://github.com/sameeroz/odoo-mcp-server)
- [odoo-mcp-improved (hachecito) — GitHub](https://github.com/hachecito/odoo-mcp-improved)
- [Code Mode: give agents an entire API in 1,000 tokens — Cloudflare blog](https://blog.cloudflare.com/code-mode-mcp/)
- [Code Mode API reference — Cloudflare Agents docs](https://developers.cloudflare.com/agents/api-reference/codemode/)
- [Code execution with MCP — Anthropic Engineering](https://www.anthropic.com/engineering/code-execution-with-mcp) — 98.7% token reduction documented
- [mcp-server-code-execution-mode — GitHub (elusznik)](https://github.com/elusznik/mcp-server-code-execution-mode) — reference implementation
- [Per-request configuration headers for multi-user HTTP deployments — mcp-atlassian issue](https://github.com/sooperset/mcp-atlassian/issues/850)
- [Guidance on per-user credentials for remote MCP server — MCP org discussion #561](https://github.com/orgs/modelcontextprotocol/discussions/561)
- [odoo-toolbox (marcfargas) — GitHub](https://github.com/marcfargas/odoo-toolbox) — predecessor `@marcfargas/odoo-mcp`
- [MCP Skills vs MCP Tools — yeou.dev](https://www.yeou.dev/articles/mcp-skill-vs-mcp-tools-the-right-way)

---
*Feature research for: godoo-mcp-server — agent-facing Odoo MCP server*
*Researched: 2026-06-01*
