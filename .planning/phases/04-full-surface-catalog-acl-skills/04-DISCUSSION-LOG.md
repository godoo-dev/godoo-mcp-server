# Phase 4: Full Surface + Catalog + ACL + Skills - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-02
**Phase:** 04-full-surface-catalog-acl-skills
**Areas discussed:** Catalog cold-start, ACL probe scope, Resource URI scheme, Skill packaging

---

## Catalog Cold-Start Strategy

| Option | Description | Selected |
|--------|-------------|----------|
| Per-namespace lazy slice | Introspect only the namespace(s) a tool touches, on demand | |
| Whole-catalog async on 1st req | Eagerly build full catalog on first request (odoo-api-proxy pattern) | |
| Whole-catalog synchronous | Block on full catalog build synchronously | |
| As-needed with core pre-warm | Check a small CORE set early; discover everything else as needed per tool call | ✓ |

**User's choice:** "fill catalog as-needed depending on tool calls; quick-check core ones (mail, user...), discover everything else as needed, just like skills"
**Notes:** User explicitly rejected the eager Promise.all approach from odoo-api-proxy as a poor fit for a stateless per-request-target server. The "just like skills" framing confirmed the lazy-discovery mental model. Core set named: mail.thread/mail.message, res.users, res.partner, ir.attachment, ir.actions, ir.ui.menu. Decision D-10.

---

## Schema-Hash Granularity

| Option | Description | Selected |
|--------|-------------|----------|
| One hash per target | Single schema hash per (url, db) gates the entire lazy store | ✓ |
| Per-model hash | Separate hash per model; only stale models evicted on schema change | |
| TTL-only | No schema-hash; rely on TTL expiry alone | |

**User's choice:** "One hash per target"
**Notes:** Follow-up question raised after ACL discussion clarified that catalog was still needed. Per-model rejected (more probing and bookkeeping with marginal benefit); TTL-only rejected (conflicts with CAT-02 requirement for schema-change invalidation). Design adopts odoo-api-proxy schema-hash.ts: 3 write_date probes on ir.model, ir.model.fields, ir.module.module. Decision D-11.

---

## ACL Probe Scope

| Option | Description | Selected |
|--------|-------------|----------|
| Curated subset allow-all | Probe ACL for a curated model subset; allow-all if passes | |
| All 17 allow-all | Probe ACL across all 17 tools; allow-all if passes | |
| Curated deny-on-fail | Probe ACL for curated subset; deny access if probe fails | |
| Rely fully on Odoo | No ACL replication at all; Odoo enforces via per-user credentials | ✓ |

**User's choice:** "What ACL? ACL is Odoo concern. We cannot replicate Odoo ACL system." followed by "Rely fully on Odoo"
**Notes:** Initial response was a strong philosophical rejection of ACL replication at the MCP server layer. Follow-up confirmed: rely fully on Odoo enforcement. Every call already runs under the requesting user's credentials — Odoo returns 403/AccessError naturally. Unauthorized calls become sanitized ToolError (per D-07/D-08). Requirements-revision flag raised: ACL-01 and ACL-02 should be removed or revised; ROADMAP Phase 4 success criterion #5 (tools/list_changed on ACL probe change) should be removed; success criterion #4 (two-user isolation) re-scoped to credential routing + cache-key isolation only. acl.py module dropped entirely. Decision D-12.

---

## Resource URI Scheme

| Option | Description | Selected |
|--------|-------------|----------|
| odoo-api-proxy scheme | odoo://model/{name}, odoo://action/{id}, odoo://menu/{id}, odoo://module/installed, skill://index.json, skill://odoo/{path} | ✓ |
| RES-01 literal | odoo://{model}/record/{id} (record-instance addressing) | |
| Both coexist | Serve both schema-level and record-instance URIs | |

**User's choice:** "odoo-api-proxy scheme"
**Notes:** Clean adoption of the salvage-source URI design. Record-instance addressing (RES-01 current text) is out of scope for Phase 4. Spec-reconcile flag raised: REQUIREMENTS.md RES-01 must be updated to reflect the schema-level scheme, not record-instance. Resolver closes over the lazy catalog so no re-registration is needed on schema-hash change. Decision D-13.

---

## Skill Packaging

| Option | Description | Selected |
|--------|-------------|----------|
| Packaged port verbatim | Ship odoo-api-proxy skills verbatim inside wheel; fix PITFALL-13 issues later | |
| Packaged adapt now | Port + adapt to PITFALL-13 procedural-guide form before shipping | ✓ |
| Separate data dir | Ship skills as a separate installable data package, not bundled in wheel | |

**User's choice:** "Packaged, adapt now"
**Notes:** Skills live under src/godoo_mcp_server/skills/, packaged inside the pip wheel via hatchling/uv_build force-include for non-.py files. Index.json generated at startup from filesystem glob (per SKILL-02/PITFALL-10). Porting from odoo-api-proxy: SKILL.md, mail/chatter.md, mail/activities.md, base/properties.md — but adapted NOW to PITFALL-13 procedural-guide form (no literal field names), not verbatim-then-fix. Decision D-14.

---

## Claude's Discretion

- Exact mail tool verb granularity (how to split chatter vs activity methods within the 6 mail tools)
- Attachments upload/download payload encoding (base64 vs streaming)
- Exact membership of the "core" pre-warmed model set (planner may add to the named examples from D-10 as appropriate)

## Deferred Ideas

- Simplified / agent-friendly domain syntax (carried forward from Phase 3 — raw domains ship)
- godoo-py error categorization taxonomy (upstream/godoo-py backlog, not this repo's concern)
- Record-instance resource addressing odoo://{model}/record/{id} (out of scope Phase 4; revisit if needed)
