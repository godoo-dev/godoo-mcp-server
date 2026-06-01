---
id: SEED-002
status: first-commit
planted: 2026-06-01
scope: Medium-Large
---

# godoo-mcp-server — Project Seed

> FOSS agent-facing MCP-only server for Odoo — minimal-tool + skill-discovery + MCP Code Mode
> surface, probably in Python (godoo-py as the Odoo RPC client), Streamable HTTP transport.
> NOT the auth gateway — that is the separate commercial `godoo-proxy` satellite.

**Seed written:** 2026-06-01
**Status:** Pre-charter. This document is the input to a `/gsd:new-project` pass.

---

## 0. Orientation — read this first

You may be reading this in a freshly-cloned repo with no other context. Here is what
you need to know before anything else.

**The `godoo-dev` umbrella / Odoo Atlas initiative.** `godoo-dev` is a multi-repo
initiative — the *godoo / Odoo Atlas initiative* — to consolidate scattered Odoo
tooling into a coherent, independently shippable family of repos, all coordinated from
a single vantage-point repo (the *spine*, `godoo-hq`). The godoo library family
(godoo-ts, godoo-py, godoo-stateman) forms the core; godoo-mcp-server and quickdoo are
Atlas surfaces built on top of those libraries.

**What this document is — a charter seed.** This `SEED.md` is a *charter seed*: a
self-orienting document that seeds this satellite repo. It is committed as
`godoo-mcp-server`'s first commit and is consumed directly as the `/gsd:new-project`
input that bootstraps `godoo-mcp-server`'s own Layer-1 GSD project. It states what the
satellite is for, what it must deliver, and how it relates to the rest of the initiative
— enough to plan the satellite's work without consulting any other repo first.

**What godoo-mcp-server is.** A FOSS, MCP-only, agent-facing Odoo server. It is a
greenfield satellite that salvages the *design* of `odoo-api-proxy` — not its
TypeScript code, which is re-implemented in Python — plus the language-agnostic skill
Markdown files that port directly. It is deliberately minimal: it is NOT the auth
gateway, NOT the SaaS layer, and NOT responsible for OAuth/SSO. That is the separate
commercial satellite `godoo-proxy`.

**The Atlas split.** The former `odoo-api-proxy` (a TypeScript Fastify service) is
being split into two distinct satellites:
- `godoo-mcp-server` — this repo — FOSS, MCP-only, Python, depends on `godoo` (godoo-py).
- `godoo-proxy` — a separate commercial satellite — OAuth 2.1 / SSO in front of Odoo;
  injects per-user headers consumed by this server. SEED for `godoo-proxy` is deferred.

Coupling: `godoo-proxy` (commercial) → injects per-user credential headers →
`godoo-mcp-server` (this repo, FOSS) → Odoo. In self-host/FOSS deployments, headers
or env vars are set directly with no proxy in the path.

**Umbrella context.** This brief assumes the shared umbrella context and does not
restate it. Load it: `@../godoo-hq/UMBRELLA_CLAUDE.md` — the single-sourced "what
every umbrella project must know" file (initiative goal, three-layer architecture, the
spine, full topology, and the load-bearing coordination rules), imported by every
project under the `godoo-dev` umbrella.

The permanent trace of this seed in the spine is the 2026-06-01 entry in
`godoo-hq/dev-log.md`. No copy of this file lives in the spine — consistent with the
no-copies / vantage-point principle, the full charter lives here, in the satellite repo.

---

## 1. Vision — what this satellite holds

`godoo-mcp-server` is the FOSS Atlas MCP surface: a stateless, MCP-only Odoo server
that lets AI agents work with any Odoo instance with minimal configuration and maximal
leverage. It depends on `godoo` (the Python client from the godoo-py monorepo) for Odoo
RPC.

**Language: probably Python.** godoo-py will be the more complete Odoo client (it is
already publishing v1.1 typed models); godoo-stateman is Python-only. The godoo library
family has stronger Python momentum. Final language confirmation is an open question for
satellite planning — see §6.

**Design philosophy: deliberate minimalism.**
Most Odoo MCP servers expose hardcoded, module-specific tools. An Odoo instance has
hundreds of models; you cannot hardcode a useful toolset. The godoo approach:

- Expose the *smallest possible* number of MCP tools — raw Odoo primitives
  (search, read, create, write, call, introspect).
- Bundle **skill files** (Markdown, served as MCP Resources) so agents acquire
  Odoo domain knowledge via discovery rather than from the tool schema alone.
- Support **MCP Code Mode** (see §2.3) as the logical extreme of minimal-tools:
  a single `execute_odoo_code` tool behind which the agent writes composable
  Odoo RPC in one code block guided by skills.

**Transport:** Streamable HTTP. This is what a remote `quickdoo` desktop will connect
to; it is also the natural self-hosted deployment target.

**Auth:** Per-user credential headers (`X-Odoo-Url`, `X-Odoo-Database`,
`X-Odoo-Username`, `X-Odoo-Password`), falling back to env vars
(`ODOO_URL`, `ODOO_DATABASE`, `ODOO_USERNAME`, `ODOO_PASSWORD`) when headers are
absent. Headers take precedence over env vars. ACL probing is per-user — the agent
acts as the real authenticated Odoo user. In a SaaS deployment, `godoo-proxy` injects
these headers after authenticating the end user via OAuth 2.1/SSO; in self-host/FOSS,
the headers or env vars are set directly.

**Dependencies:** `godoo` (the Python client from the godoo-py monorepo) is the primary
runtime dependency on the godoo library family. No dependency on godoo-ts or
godoo-stateman. Future runtime dependency of `quickdoo`.

**Licensing:** probably LGPL-3.0 (house default for godoo family FOSS libraries).
Confirm at satellite planning — see §6.

---

## 2. Salvage sources and fresh-design scope

### 2.1 Primary salvage: odoo-api-proxy (design only — re-implement in Python)

`odoo-api-proxy` (`C:\dev\odoo-api-proxy`) is the primary salvage source. It is a
TypeScript Fastify service. Because `godoo-mcp-server` is Python, the TypeScript code
is **re-implemented** — not transferred. What is salvaged is the *design*: the tool
surface, the catalog introspection logic, the ACL probe pattern, and the MCP resource
URI conventions.

**Salvage with high confidence — design re-implemented in Python:**

| Component (odoo-api-proxy) | What to salvage | Notes |
|---------------------------|-----------------|-------|
| 17 MCP tool descriptors (`mail.*`, `record.*`, `action.*`, `users.*`, `attachments.*`, `discovery.*`) | Tool names, descriptions, input schemas, output contracts | Pure interface definitions; re-implement against `godoo` Python client |
| `buildResourceDescriptors` pattern | Catalog-to-MCP-resource transform | Re-implement; logic is straightforward |
| `buildCatalogContent` pattern | Parallelised Odoo introspection (models, fields, actions, menus, schema hash) | Re-implement using `godoo` async; introspection approach carries over |
| `probeAclForCuratedTools` pattern | Per-user tool filtering via `check_access_rights` | Re-implement; the Odoo RPC call is the same |
| MCP resource URI patterns | URI conventions for catalog/skill resources | Carry over directly |

**Salvage directly — language-agnostic:**

| Component | Location | Notes |
|-----------|----------|-------|
| Skill Markdown files + discovery index | `skills/odoo/` | SKILL.md, mail/chatter.md, mail/activities.md, base/properties.md + index.json pattern | Port directly — Markdown is language-agnostic |

**Do NOT salvage (auth/gateway — those go to `godoo-proxy`):**

- Auth/SSO/OAuth machinery
- Storage abstraction (Drizzle + Memory impls, cache repos, audit log, rate-limit repos)
- Admin routes
- Kernel/shell DI seam (`KernelDeps`, etc.) — being dismantled upstream anyway
- Sliding-window rate limiter

**Do NOT salvage (being actively dismantled upstream):**

- `solo-mcp.integration.test.ts` (imports deleted paths; does not compile)

### 2.2 Cherry-pick source: odoo-mcp / odoo-toolbox

`@marcfargas/odoo-mcp` (0.1.4, in `odoo-toolbox` at `targets/odoo-mcp` and published to
npm) is a secondary salvage source. Inspect it when the satellite begins planning —
cherry-pick only where it offers something the odoo-api-proxy design does not. Key
question for charter planning: issue a deliberate deprecate/unpublish decision for
`@marcfargas/odoo-mcp` as part of this satellite's v1.0.

### 2.3 Fresh design: MCP Code Mode

**MCP Code Mode** (Cloudflare/Anthropic pattern, researched 2026-06-01) is folded into
the satellite's design as a complementary direction to the minimalist tool surface. It is
*not* a dependency on an external SDK — it is a server-side design pattern:

- Expose one additional tool: `execute_odoo_code(code: string)`.
- The tool runs agent-authored code against a typed Odoo client API surface in a
  sandboxed subprocess or container.
- Outbound calls from the sandbox route only through the server's internal Odoo RPC
  layer (via `godoo` Python client) — no general network access.
- Skills served as MCP Resources become recipes for what to write in the code block.

Security requirements for Code Mode (non-negotiable): sandbox with no direct network;
calls route through an allowlisted Odoo RPC proxy enforcing RBAC; read-only by default,
writes require explicit capability grant; per-invocation session isolation; rate limiting
and audit logging. The per-user credential header auth model ensures ACL is real (agent
acts as the authenticated user).

Full briefing: `../godoo-hq/.planning/quick/260601-sy2-*/260601-sy2-RESEARCH.md`.

### 2.4 Separate and spike-gated: Odoo server-action Code Mode

The spine holds a prior concept — **Odoo server-action Code Mode** — in
`../godoo-hq/.planning/seeds/spike-code-mode-feasibility.md`. This is a *distinct*
capability: running agent-authored Python *inside an Odoo server action*, in-transaction,
against Odoo's restricted sandbox (no `eval`). Its feasibility is unresolved.

**These are two different levers. Do not conflate them:**

| | MCP Code Mode (§2.3) | Odoo server-action Code Mode |
|---|---|---|
| Where code runs | MCP server sandbox (client/runtime side) | Inside Odoo, in a server action |
| No-`eval` blocker | Not applicable — runs outside Odoo | Unresolved — the spike |
| Transactional atomicity | No | Yes (if feasibility confirmed) |
| Status | Planned for v1.0 | Spike-gated — do not design for until resolved |

Keep the server-action Code Mode gated on `spike-code-mode-feasibility.md`. Plan it only
after the spike confirms feasibility.

---

## 3. Adoption approach

`godoo-mcp-server` is a **greenfield satellite that salvages design**. There is no source
repo being shed; no `godoo-adoption` branch protocol applies (that protocol is for
code-transfer adoptions). The approach:

1. Create the satellite repo (see §5 org bootstrap).
2. Run `/gsd:new-project` with this SEED as input.
3. Plan the satellite's own ROADMAP. Suggested v1.0 scope:
   - Wave 1: Streamable HTTP skeleton (Python MCP server); credential resolution
     (headers → env fallback); basic `record.*` and `discovery.*` tools wired
     end-to-end using `godoo` client; one passing integration test.
   - Wave 2: Full 17-tool surface; `buildCatalogContent` + `buildResourceDescriptors`
     equivalents; ACL probe; skill files served as MCP Resources.
   - Wave 3: MCP Code Mode (`execute_odoo_code`); sandbox integration (subprocess or
     container); typed Odoo API surface; skill-as-recipe pattern.
4. Deprecate/unpublish `@marcfargas/odoo-mcp` as part of v1.0.

`odoo-api-proxy` continues its own v1.2 Stateless Pivot independently. The two repos
are not coupled — `godoo-mcp-server` salvages design patterns, not a shared codebase.

---

## 4. Report-back

On v1.0 completion, `godoo-mcp-server` files a **single terminal report** to the spine:
one `## YYYY-MM-DD — <title>` entry prepended to `dev-log.md` at the `godoo-hq` spine
repo root, naming the satellite, the completion date, and verified outcomes. The spine
verifies by querying this sibling repo directly.

The mechanism — format, location, trigger, verification method — is defined in the spine
note at `../godoo-hq/.planning/notes/report-back-mechanism.md`. Read it when ready to
report.

**At v1.0 completion, godoo-mcp-server reports these outcomes:**

- Streamable HTTP MCP server ships and is connectable by a local `quickdoo` instance
- Minimalist tool surface wired (at minimum: `record.*`, `discovery.*`, `users.whoami`)
- Skill files served as MCP Resources; skill discovery index functional
- Catalog introspection and MCP resource descriptors wired and tested
- ACL probe functional (per-user tool filtering)
- `@marcfargas/odoo-mcp` deprecated/unpublished
- MCP Code Mode status: shipped OR explicitly deferred with rationale
- `godoo-proxy` header-injection integration verified (in SaaS mode) OR direct header/env
  auth verified (in self-host mode)

---

## 5. Org bootstrap

Create the satellite repo under the `godoo-dev` org once the local repo is ready.
Visibility is the satellite's decision (LGPL-3.0 FOSS intent suggests public is
natural; confirm at charter time).

```bash
gh repo create godoo-dev/godoo-mcp-server --private
```

Once the remote is created, wire the local repo and push:

```bash
git remote add origin https://github.com/godoo-dev/godoo-mcp-server.git
git push -u origin develop
```

**CLAUDE.md wiring.** When `godoo-mcp-server` runs `/gsd:new-project`, the generated
`CLAUDE.md` must `@`-import the shared umbrella context so the repo stays
umbrella-aware:

```
@../godoo-hq/UMBRELLA_CLAUDE.md
```

The umbrella file is imported (never copied) via this relative sibling path, so a
freshly-cloned `godoo-mcp-server` immediately picks up the initiative context.

---

## 6. Open questions / discretion areas

The following are left for the satellite's own `/gsd:new-project` pass and charter
planning:

- **Final language confirmation (Python vs TS)** — Python is the leading choice (godoo-py
  will be the more complete Odoo client; godoo-stateman is Python-only). TS remains on
  the table if the maintainer has strong preference. Confirm at satellite planning.
- **v1.0 tool-surface exact list** — which of the 17 odoo-api-proxy tools make it into
  v1.0 vs. deferred? The minimalist philosophy suggests starting with `record.*` +
  `discovery.*` + `users.whoami` and adding mail/attachments in a later wave.
- **Deployment target** — Docker image vs. pip package vs. both. Decide at charter time.
- **Catalog cache TTL and storage** — for a stateless design, in-process LRU (per-process,
  lost on restart) is the natural default. Decide TTL and whether to offer a persistent
  cache option.
- **License confirmation** — probably LGPL-3.0 (house default for godoo family FOSS).
  Confirm at charter time given the SaaS hosting context.
- **Monorepo vs. single package** — single package is simpler for a stateless server with
  one deployment target. Evaluate at charter time.
- **MCP Code Mode sandbox choice** — subprocess (asyncio), Docker sidecar, or another
  isolation mechanism? Each has different security/complexity/portability tradeoffs.
  Decide during Wave 3 planning. (TS note: `isolated-vm`/Deno apply only if TS is chosen.)
- **Odoo server-action Code Mode** — gated on `spike-code-mode-feasibility.md`. Do not
  plan until the spike resolves.
- **`godoo` version pinning** — pin to a specific godoo-py minor version and upgrade
  deliberately. Confirm at charter time once godoo-py v1.1 stabilises.
