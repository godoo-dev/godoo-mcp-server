# Phase 4: Full Surface + Catalog + ACL + Skills - Context

**Gathered:** 2026-06-02
**Status:** Ready for planning

<domain>
## Phase Boundary

Complete the 17-tool MCP surface (add mail_*, action_*, attachments_*, users_search_users, discovery_list_menus to the 8 existing tools), build lazy schema-hashed introspection exposed as MCP resources, serve skill Markdown files as MCP Resources. Proven by a two-user cross-isolation integration test (re-scoped — credential routing + cache-key isolation, NOT ACL filtering). Stateless, per-request target Odoo.

</domain>

<decisions>
## Implementation Decisions

### Catalog Strategy
- **D-10:** Catalog = lazy, as-needed introspection. NO upfront full-catalog build. A small CORE set of models (mail.thread/mail.message, res.users, res.partner, ir.attachment, ir.actions, ir.ui.menu) is checked early on first request to a target; every other model is introspected on demand when a tool first touches it ("just like skills" discovery). Rejects odoo-api-proxy's eager Promise.all(modules+models+fields+actions+menus) as a poor fit for a stateless per-request-target server. Catalog cache stays in-process LRU+TTL, key = (url, database, schema_hash), never credentials.

### Schema-Hash Strategy
- **D-11:** Schema-hash = one generation token per target. Compute a cheap per-(url,db) schema hash via 3 write_date probes on ir.model / ir.model.fields / ir.module.module (the odoo-api-proxy schema-hash.ts design). The hash gates the WHOLE lazy introspection store for that target: schema change -> hash flips -> all lazy entries stale. Satisfies CAT-02. Not per-model (rejected: more probing/bookkeeping); not TTL-only (rejected: conflicts with CAT-02).

### ACL Strategy
- **D-12:** ACL = rely fully on Odoo; NO replication, NO probe, NO acl.py module. Enforcement is Odoo's concern and cannot/should not be replicated. Every call already runs as the requesting user's own credentials, so Odoo enforces. Unauthorized calls return sanitized ToolError (per D-07/D-08). NO check_access_rights probing, NO ACL-driven tool-surface filtering, NO ACL-driven notifications/tools/list_changed. **REQUIREMENTS-REVISION FLAG (planner must action):** ACL-01 and ACL-02 -> remove or revise (no ACL replication); ROADMAP Phase 4 success criterion #5 (tools/list_changed on ACL probe change) -> remove; ROADMAP Phase 4 success criterion #4 (two-user isolation) -> RE-SCOPE to verify per-user credential routing + cache-key isolation (catalog cache key never includes creds; no cross-user data leak), NOT ACL filtering.

### Resource URI Scheme
- **D-13:** Resource URI scheme = odoo-api-proxy scheme. Adopt: odoo://model/{name}, odoo://action/{id}, odoo://menu/{id}, odoo://module/installed, skill://index.json, skill://odoo/{path}. Schema-level addressing; resolver closure over the lazy catalog so resources need NO re-registration on schema-hash change. **SPEC-RECONCILE FLAG:** RES-01 currently reads odoo://{model}/record/{id} (record-instance addressing) — reconcile REQUIREMENTS toward the odoo-api-proxy schema scheme. (Record-instance addressing is NOT in scope for Phase 4.)

### Skills Packaging
- **D-14:** Skills = packaged + adapt now. Skill .md files live under src/godoo_mcp_server/skills/, shipped inside the pip wheel (add hatchling/uv_build force-include so non-.py files are packaged); index.json generated at startup from a filesystem glob rooted there (per SKILL-02 / PITFALL-10). Port the odoo-api-proxy skills (SKILL.md, mail/chatter.md, mail/activities.md, base/properties.md) but ADAPT NOW to PITFALL-13 procedural-guide form (no literal field names) before shipping — not verbatim-then-fix.

### Claude's Discretion
- Exact mail tool verb granularity (e.g., how to split chatter vs activity methods)
- Attachments upload/download payload encoding (base64 vs streaming)
- Exact membership of the "core" pre-warmed model set (beyond the named examples in D-10)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Planning Artifacts
- `.planning/ROADMAP.md` — Phase 4 entry (goal, success criteria, requirement mapping). NOTE: success criteria #4 and #5 are flagged for revision per D-12 (D-12 requirements-revision flag above takes precedence).
- `.planning/REQUIREMENTS.md` — Phase 4 requirements: MAIL-01, ACT-01, ATT-01, USER-02, DISC-03, CAT-01, CAT-02, RES-01, ACL-01, ACL-02, SKILL-01, SKILL-02. NOTE: ACL-01/ACL-02 flagged for removal/revision and RES-01 flagged for reconcile per D-12/D-13.

### Prior Phase Context (inherited decisions)
- `.planning/phases/03-core-primitives/03-CONTEXT.md` — locked decisions D-01..D-09 (tool naming, CRUD verbs, raw domain format, error surface) that Phase 4 inherits.
- `.planning/phases/02-skeleton-server/02-CONTEXT.md` — tool module pattern, CredentialMiddleware, per-request OdooClient, fastmcp/Starlette stack, godoo-testcontainers test infra.

### Design-Only Salvage Source (TypeScript, NOT copied as code)
- `C:\dev\odoo-api-proxy\` — Reference only. Specifically:
  - `schema-hash.ts` — 3 write_date probes pattern -> D-11
  - `resources.ts` buildResourceDescriptors — URI scheme -> D-13
  - `catalog-cache.ts` buildCatalogContent — reference only; eager shape REJECTED per D-10
  - `skills/odoo/` (SKILL.md, mail/chatter.md, mail/activities.md, base/properties.md) — port+adapt per D-14
  - `acl-probe.ts` — explicitly NOT used (D-12)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/godoo_mcp_server/server.py` — FastMCP instance + create_app() ASGI factory; has a side-effect import block that MUST be extended for each new tool module added in this phase.
- `src/godoo_mcp_server/credentials.py` — OdooCredentials dataclass + CredentialMiddleware (pure ASGI, sets scope state). Tool handlers read creds via `get_http_request().state.odoo_creds`.
- `src/godoo_mcp_server/tools/records.py` — record_search/read/create/update/delete (5 tools).
- `src/godoo_mcp_server/tools/discovery.py` — discovery_list_models/get_fields (2 tools; +discovery_list_menus added this phase).
- `src/godoo_mcp_server/tools/users.py` — users_whoami (1 tool; +users_search_users added this phase).

### New Modules Phase 4 Creates
- `tools/mail.py` — 6 tools: mail_post_message, mail_log_note, mail_list_messages, mail_schedule_activity, mail_list_activities, mail_mark_activity_done
- `tools/actions.py` — action_execute_action, action_list_actions
- `tools/attachments.py` — attachments_list, attachments_upload, attachments_download
- `catalog.py` — lazy introspection store + TTLCache + schema-hash logic
- `resources.py` — MCP resource registration + resolver (closes over lazy catalog)
- NO `acl.py` — dropped per D-12

### Established Patterns
- Underscore tool names (D-01), friendly CRUD verbs (D-03), raw Odoo domain format (D-05), default limit=80 (D-06)
- ToolError on OdooError + sanitized tracebacks, no server-side error taxonomy (D-07/D-08/D-09)
- Per-request OdooClient: `async with OdooClient(_make_config(creds))` — no singletons
- fastmcp PrefectHQ 3.3.x + Starlette middleware, no FastAPI
- mypy --strict + asyncio_mode=auto

### Integration Points
- New tool modules register via side-effect import in server.py (existing pattern)
- catalog.py keyed by (url, database, schema_hash) — never by credentials (isolation guarantee)
- resources.py resolver closes over catalog instance; no re-registration on schema-hash change
- Skills packaged under src/godoo_mcp_server/skills/ with hatchling force-include for non-.py files

</code_context>

<specifics>
## Specific Ideas

- Catalog "core" pre-warm set named by user: mail.thread/mail.message, res.users, res.partner, ir.attachment, ir.actions, ir.ui.menu — exact membership left to planner's discretion per Claude's Discretion above.
- Schema hash uses 3 write_date probes (ir.model, ir.model.fields, ir.module.module) — exact design from odoo-api-proxy schema-hash.ts.
- Skills ported from odoo-api-proxy but adapted to PITFALL-13 procedural-guide form (no literal field names) before shipping.

</specifics>

<deferred>
## Deferred Ideas

- Simplified / agent-friendly domain syntax (deferred from Phase 3 — raw domains ship in Phase 4 as well).
- godoo-py error categorization taxonomy (upstream/godoo-py backlog).
- Record-instance resource addressing odoo://{model}/record/{id} (out of scope for Phase 4; revisit if needed).

</deferred>

---

*Phase: 4-Full Surface + Catalog + ACL + Skills*
*Context gathered: 2026-06-02*
