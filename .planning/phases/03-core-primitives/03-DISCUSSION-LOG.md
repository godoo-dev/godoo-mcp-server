# Phase 3: Core Primitives - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-02
**Phase:** 3-Core Primitives
**Areas discussed:** Tool naming scheme, Search/read contract, Error contract (ERR-01), Tool surface & whoami

---

## Tool Naming Scheme

| Option | Description | Selected |
|--------|-------------|----------|
| Underscore namespaced | `record_search`, `discovery_list_models`, `users_whoami` — spec-safe underscores, keeps namespace grouping, matches Phase 2's `odoo_whoami` | ✓ |
| Dotted namespaces | `record.search`, `users.whoami` — exactly as ROADMAP writes, risks client/spec rejection of `.` | |
| Flat verb-first | `search_records`, `list_models`, `whoami` — no prefix, loses grouping | |

**User's choice:** Underscore namespaced.
**Notes:** Researcher to confirm fastmcp 3.3.x accepts/normalizes the names.

---

## Search / Read Contract — return mode

| Option | Description | Selected |
|--------|-------------|----------|
| search_read one-shot | domain + fields → records with values in one RPC; `record_read` for explicit IDs | ✓ |
| IDs only, then read | `record_search` returns IDs; agent calls `record_read` separately | |
| Both modes | IDs by default, optional fields param triggers search_read | |

**User's choice:** search_read one-shot.

## Search / Read Contract — domain format

| Option | Description | Selected |
|--------|-------------|----------|
| Raw Odoo domain | native triples + `&`/`|` operators, no translation | ✓ |
| Simplified form | friendlier key/value abstraction translated to domains | |

**User's choice:** Raw Odoo domain now.
**Notes:** Add to backlog — consider providing a simplified domain syntax for agents (maybe), future phase.

## Search / Read Contract — result-set limit

| Option | Description | Selected |
|--------|-------------|----------|
| Default + override | default limit (80) when omitted; agent can pass explicit limit + offset | ✓ |
| Required limit | agent MUST pass a limit, no default | |
| Default, hard cap | default 80 AND an unbreakable max (e.g. 500) | |

**User's choice:** Default + override (default 80).

---

## Error Contract (ERR-01) — surface mechanism

| Option | Description | Selected |
|--------|-------------|----------|
| Raised MCP error | catch exception, raise fastmcp `ToolError` with sanitized message; client sees failed call | ✓ |
| Structured result dict | always return success; failure carried in `{"error": {...}}` payload | |
| You decide | Claude picks per fastmcp conventions | |

**User's choice:** Raised MCP error.

## Error Contract (ERR-01) — content & sanitization

| Option | Description | Selected |
|--------|-------------|----------|
| Categorized + detail | error code + model/field/constraint + Odoo message; strip tracebacks/paths/creds | |
| Odoo message, sanitized | pass through Odoo's message (sanitized), no imposed taxonomy | ✓ |
| You decide | Claude picks categorization granularity post-research | |

**User's choice:** Odoo message → sanitized; categorization and detail belong to the godoo-py client library, not this server.
**Notes:** Strong architecture boundary — server sanitizes and forwards; godoo-py owns structured categorization (cross-repo backlog).

---

## Tool Surface & whoami — record verbs

| Option | Description | Selected |
|--------|-------------|----------|
| Friendly CRUD verbs | `record_create/update/delete`, map update→write, delete→unlink internally | ✓ |
| Odoo-native verbs | `record_write`, `record_unlink` — exact ORM names | |
| You decide | Claude picks per skill-file teaching consistency | |

**User's choice:** Friendly CRUD verbs.

## Tool Surface & whoami — whoami output

| Option | Description | Selected |
|--------|-------------|----------|
| uid + username | minimal, no extra RPC | |
| uid + username + context | also database, possibly company/lang | |
| You decide | at least uid+username; add fields only if free | ✓ |

**User's choice:** uid + username + database (all free from session); company/language included only if godoo-client's session info exposes them without an extra RPC, else omitted.
**Notes:** User amended the minimal answer — "if company+language are cheap to get, that might be useful." Researcher verifies whether they are free (no extra RPC).

## Tool Surface & whoami — probe removal sequencing

| Option | Description | Selected |
|--------|-------------|----------|
| whoami first, then swap | build `users_whoami`, repoint `test_vertical.py`, then delete `probe.py` — CI green every commit | ✓ |
| Delete with first real tool | remove `probe.py` in the same commit as the first record tool | |
| You decide | sequence in plan to keep CI green | |

**User's choice:** whoami first, then swap.

---

## Claude's Discretion

- Inclusion of company/language in `users_whoami` — gated on what godoo-client exposes for free.
- Exact fastmcp `ToolError` mechanism and tool-name normalization — researcher-gated implementation details.

## Deferred Ideas

- Simplified / agent-friendly domain syntax over raw Odoo domains — future phase.
- Error categorization (codes + model/field/constraint extraction) in godoo-client — godoo-py satellite backlog.
