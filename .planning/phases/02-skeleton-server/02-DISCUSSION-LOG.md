# Phase 2: Skeleton Server - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-02
**Phase:** 02-skeleton-server
**Areas discussed:** Tool surface, Auth-missing error shape, Credential injection, AUTH-04 test strategy, CI gating, testcontainers dependency

---

## Area Selection

Gray areas presented: Tool surface, Auth-missing error shape, Credential injection, AUTH-04 test strategy.

User selected: ALL FOUR, and flagged that `godoo-testcontainers` (in `../godoo-py`) is available to facilitate proper testing.

---

## Tool Surface

| Option | Description | Selected |
|--------|-------------|----------|
| One static stub tool | Register a tool that returns a hardcoded string — no real Odoo call | |
| Empty tool list | No tools registered in Phase 2; just prove the server starts | |
| Stub tool hitting live Odoo | Minimal read-only probe performing a real Odoo round-trip via testcontainers | ✓ |

**User's choice:** Stub tool hitting live (testcontainers) Odoo.
**Notes:** "Testing infra is part of the skeleton — this validates all test infra." The stub tool is scaffolding only; it is replaced/removed when Phase 3 adds the real minimal toolset.

---

## Auth-Missing Error Shape

| Option | Description | Selected |
|--------|-------------|----------|
| HTTP 401 + missing-creds list | Real HTTP 401 from Starlette middleware; body enumerates which headers/env-vars were absent | ✓ |
| HTTP 401 plain message | Real HTTP 401 but with a generic "unauthorized" message only | |
| MCP-level JSON-RPC error | Return an MCP protocol error rather than an HTTP-layer rejection | |

**User's choice:** HTTP 401 + missing-creds list.
**Notes:** Resolves the ROADMAP's ambiguous "401-style" to a real HTTP 401. The enumeration of missing inputs is a hard UX requirement.

---

## Credential Injection

| Option | Description | Selected |
|--------|-------------|----------|
| fastmcp Context injection | Middleware stashes resolved credentials on request scope/state; tool handlers read via fastmcp `Context` | ✓ |
| contextvars.ContextVar | Use Python contextvars to propagate credentials across async call stack | |
| Explicit context object param | Pass a credentials object as an explicit parameter to every tool handler | |

**User's choice:** fastmcp Context injection.
**Notes:** No module-global state, no contextvars. Aligned with fastmcp idiomatic patterns and keeps tool handler signatures clean.

---

## Test Strategy (AUTH-04)

| Option | Description | Selected |
|--------|-------------|----------|
| Mock now + testcontainers Phase 3 | Unit tests with mocked OdooClient in Phase 2; defer real Odoo integration to Phase 3 | |
| Real Odoo via testcontainers now | Session-scoped TestHarness boots a real Odoo container; full vertical verified in Phase 2 | ✓ |
| Defer to Phase 3 | No meaningful integration tests in Phase 2 at all | |

**User's choice:** Real Odoo via testcontainers now.
**Notes:** godoo-testcontainers (available in `../godoo-py`) provides `TestHarness` as an async context manager. Testing infra is an explicit Phase 2 deliverable.

---

## CI Gating

| Option | Description | Selected |
|--------|-------------|----------|
| Mark integration, gate separately | `@pytest.mark.integration`; default pytest gate runs `-m "not integration"`; separate CI job with Docker + snapshot caching | ✓ |
| Run in main pytest gate | Integration tests run in the same CI job as unit tests | |
| Integration job nightly | Integration tests run on a nightly schedule, not on every push | |

**User's choice:** Mark integration, gate separately.
**Notes:** Fast gate stays fast (no Docker required); integration gate gets Docker-available runner with `odoo:17` snapshot caching via GitHub Actions cache.

---

## testcontainers Dependency

| Option | Description | Selected |
|--------|-------------|----------|
| PyPI pin `>=0.2,<0.3` | Add `godoo-testcontainers>=0.2,<0.3` as dev dependency from PyPI | ✓ |
| Path dep to `../godoo-py` | Use a local path dependency pointing to the sibling repo | |
| PyPI + optional path override | PyPI primary with an optional `[tool.uv.sources]` path override for local dev | |

**User's choice:** PyPI pin `>=0.2,<0.3`.
**Notes:** Matches `godoo-client` pinning style; honors siblings-are-independent-repos. PyPI 0.2.1 is the target. Local pyproject in godoo-py may show 0.2.0 — use PyPI.

---

## Claude's Discretion

Items deferred to Claude's judgment during research and planning:

1. **godoo-client async lifecycle** — whether `OdooClient` requires `async with` / explicit `.close()` call. Researcher determines before planning.
2. **fastmcp ASGI wiring details** — use `http_app()` to obtain the ASGI app; `FastMCP` server object must live in `server.py` (importable module), NOT inline in `__main__.py`.
3. **Stub validation tool identity** — exact Odoo call (`whoami` vs version probe vs `res.users` read); planner picks the cheapest read-only round-trip.
4. **Config/env loading shape, server-start CLI design, logging** — not discussed; planner uses sensible defaults consistent with Phase 1 conventions.

## Deferred Ideas

None raised — no scope creep during discussion. The real raw-primitive toolset (search/read/create/write/call/introspect) is Phase 3 per ROADMAP.
