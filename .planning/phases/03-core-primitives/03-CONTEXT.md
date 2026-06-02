# Phase 3: Core Primitives - Context

**Gathered:** 2026-06-02
**Status:** Ready for planning

<domain>
## Phase Boundary

The first real agent-facing toolset. An MCP agent authenticates as a real Odoo
user, discovers models and fields, performs all five record operations
(search / read / create / update / delete), and receives structured errors it can
self-correct from — all verified against a live Odoo instance. This phase also
retires the throwaway `odoo_whoami` probe tool introduced in Phase 2.

**In scope (from ROADMAP):** REC-01..05 (search, read, create, update, delete),
DISC-01/02 (`discovery_list_models`, `discovery_get_fields`), USER-01
(`users_whoami`), ERR-01 (structured MCP errors).

**Out of scope (deferred to later phases):** mail/chatter tools, action/attachment
tools, catalog introspection + cache, MCP Resource descriptors, ACL probe + tool
filtering, skill Markdown resources (all Phase 4); PyPI/Docker packaging (Phase 5);
Code Mode (Phase 6).

</domain>

<decisions>
## Implementation Decisions

### Tool Naming
- **D-01:** Tools use **underscore-namespaced** names (spec-safe `^[a-zA-Z0-9_-]+$`):
  `record_search`, `record_read`, `record_create`, `record_update`,
  `record_delete`, `discovery_list_models`, `discovery_get_fields`, `users_whoami`.
  Keeps the ROADMAP's namespace grouping but avoids the `.` separator the ROADMAP
  wrote literally, which MCP clients/spec may reject.
- **D-02:** Researcher MUST confirm fastmcp 3.3.x accepts/normalizes these tool names
  before planning (no surprise rejection or silent rename).

### Record Verbs
- **D-03:** Record tools use **friendly CRUD verbs** in their public names
  (`record_create`, `record_update`, `record_delete`). Map to Odoo ORM internally:
  `update` → `write`, `delete` → `unlink`. Hides Odoo quirks from agents.

### Search / Read Contract
- **D-04:** `record_search` is a **`search_read` one-shot** — takes a domain + a
  fields list and returns matching records WITH the requested field values in a
  single RPC. `record_read` remains available for fetching specific records by
  explicit IDs.
- **D-05:** `record_search` accepts the **raw Odoo domain format** (list of triples
  plus `&`/`|` operators) — no translation layer. This matches what skill files and
  Odoo docs will teach agents.
- **D-06:** Result-set guardrail: **default `limit = 80`** when the agent omits one;
  agent may pass explicit `limit` + `offset` to paginate or raise the cap. The
  pagination pattern MUST be documented in the tool description. (Mitigates the
  "search without limit OOMs Odoo workers" pitfall.)

### Error Contract (ERR-01)
- **D-07:** On any Odoo RPC failure (bad domain, missing field, access denied,
  validation error), the tool **catches the godoo-client exception, sanitizes it,
  and raises a fastmcp `ToolError`** — so the agent's client sees a proper failed
  tool call, not a fake success. (Researcher confirms the exact fastmcp 3.3.x error
  type / mechanism.)
- **D-08:** Sanitization is mandatory: **never leak Python tracebacks, internal file
  paths, or any credential/session data.** Pass through Odoo's own human-readable
  message.
- **D-09:** **This server does NOT build its own error-categorization taxonomy.**
  Structured categorization (error code, offending model/field/constraint extraction)
  is the **godoo-py client library's** responsibility. This server surfaces whatever
  structure godoo-client already exposes; if godoo-py later adds categorization, the
  server passes it through. (See Deferred Ideas — godoo-py backlog item.)
- **D-10:** Researcher MUST inspect what godoo-client 0.2.1 actually raises on Odoo
  JSON-RPC errors (exception type + attributes) and how much structure it already
  exposes today.

### whoami Output
- **D-11:** `users_whoami` returns **uid + username + database**. uid/username/db all
  come for free from `client.get_session()` → `OdooSessionInfo(uid, session_id, db)`.
- **D-12:** Include **company and language only if godoo-client's session info exposes
  them without an extra RPC.** They typically live on `res.users` (a read) — if not
  free, OMIT them rather than pay a round-trip on an identity call. Researcher verifies.

### Probe Removal Sequencing
- **D-13:** Retire the throwaway `odoo_whoami` probe with **"whoami first, then
  swap"**: build `users_whoami` early, repoint the `test_vertical.py` integration
  test from `odoo_whoami` to `users_whoami`, THEN delete `tools/probe.py` and its
  side-effect import in `server.py`. CI must stay green at every commit — no red
  window. Plan waves should order tasks to preserve this invariant.

### Claude's Discretion
- D-12 leaves company/language inclusion to be decided by what godoo-client exposes
  for free (researcher-gated).
- Exact fastmcp error-raising mechanism (D-07) and tool-name normalization (D-02) are
  researcher-gated implementation details, not user decisions.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase definition & requirements
- `.planning/ROADMAP.md` — Phase 3 goal, scope, success criteria, requirement mapping
- `.planning/REQUIREMENTS.md` — REC-01..05, DISC-01/02, USER-01, ERR-01 full text
- `.planning/PROJECT.md` — Key Decisions table, project constraints (stateless, auth
  boundary, godoo pin)

### Pitfalls (research-gated constraints)
- `.planning/research/PITFALLS.md` — P2 cross-user credential bleed (cache key must
  include username), P6 catalog cold-start, P13 field/model variance across Odoo
  versions (no literal field names in tool descriptions; discovery-first), and the
  "search without limit" performance trap (drives D-06)

### Prior-phase patterns to follow (locked)
- `.planning/phases/02-skeleton-server/02-CONTEXT.md` — credential → scope → tool
  handler chain, locked
- `.planning/phases/02-skeleton-server/02-PATTERNS.md` — `OdooClient` async lifecycle
  (`async with OdooClient(config)`), `get_http_request().state.odoo_creds` pattern,
  mypy `--strict` notes (`# type: ignore[attr-defined]` for `request.state`)
- `.planning/phases/02-skeleton-server/VERIFICATION.md` — Phase 2 PASS; one open ruff
  format gap at `tests/integration/test_vertical.py:50` (fix before/early in Phase 3
  so the lint gate stays green)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/godoo_mcp_server/tools/probe.py` — the exact template for every Phase 3 tool
  handler: `get_http_request() → request.state.odoo_creds → async with
  OdooClient(config)`. Copy this pattern, then delete the file per D-13.
- `tests/integration/conftest.py` — `odoo_harness` (TestHarness session fixture),
  `mcp_client_factory`, `mcp_app_with_lifespan` are ready for Phase 3 round-trip tests.
- `tests/conftest.py` — `mcp_client` / `mcp_client_no_creds` fixtures for unit tests.

### Established Patterns
- New tool modules import `from godoo_mcp_server.server import mcp` and register with
  `@mcp.tool()`; `server.py` imports each tool module for its registration side effect.
  Phase 3 edits `server.py`'s import block: remove `tools.probe`, add the new modules.
- Per-request `OdooClient` construction only — NO module-level singleton (Phase 2
  anti-pattern, audit-confirmed). Reinforced by P2 (cross-user bleed).
- godoo-client import path: `from godoo.client.client import OdooClient,
  OdooClientConfig`. Lifecycle: `async with client:` runs `authenticate()`;
  `client.get_session()` → `OdooSessionInfo(uid, session_id, db)`.
- Tests: `asyncio_mode = "auto"` (plain `async def`, no marker); integration tests use
  `@pytest.mark.integration`.

### Integration Points
- `server.py` side-effect import block (tool registration).
- `test_vertical.py` integration test currently asserts via `odoo_whoami` — repoint to
  `users_whoami` (D-13).
- **Primary research gap:** which godoo-client 0.2.1 methods implement
  search_read / read / create / write / unlink / fields_get, and how errors are raised.
  Not documented in planning artifacts — researcher inspects godoo-client source first.

</code_context>

<specifics>
## Specific Ideas

- Raw Odoo domain triples are the search interface now — agents are expected to know
  Odoo domain syntax (reinforced by discovery-first skill knowledge in later phases).
- Error handling boundary is a deliberate godoo-family architecture choice: the MCP
  server sanitizes and forwards; the godoo-py client owns structured categorization.

</specifics>

<deferred>
## Deferred Ideas

- **Simplified / agent-friendly domain syntax** — a friendlier abstraction over raw
  Odoo domains (e.g. key/value form) for naive agents. Maybe worth it, but not now;
  raw domains ship first. Revisit in a later phase.
- **Error categorization in godoo-client (godoo-py backlog)** — structured error codes
  + offending model/field/constraint extraction belong upstream in the godoo-py client
  library, not in this server. Cross-repo item for the godoo-py satellite.

None of these expand Phase 3 scope — discussion stayed within the phase boundary.

</deferred>

---

*Phase: 3-Core Primitives*
*Context gathered: 2026-06-02*
