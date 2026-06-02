# Phase 2: Skeleton Server - Context

**Gathered:** 2026-06-02
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 2 delivers a FULL VERTICAL skeleton: a stateless Streamable HTTP MCP endpoint that a generic MCP client can connect to, list tools from, and invoke against a real Odoo instance. Per-request credential resolution (X-Odoo-* headers → env fallback → HTTP 401 with missing-creds enumeration) and a fresh per-request OdooClient with no cross-user bleed are the core runtime deliverables. The integration-test infrastructure (real Odoo via godoo-testcontainers) is itself an explicit Phase 2 deliverable — the full connect→list→call→Odoo vertical is verified against a live Odoo container.

</domain>

<decisions>
## Implementation Decisions

### Tool Surface / Scope

- **D-1:** Phase 2 registers ONE throwaway validation tool: a minimal read-only Odoo probe (e.g. `whoami` or server-version check) that performs a real Odoo round-trip. Purpose: prove the full connect→list→call→Odoo path end-to-end (satisfies TRANS-02) and exercise the entire credential→OdooClient→RPC chain. This is scaffolding, NOT a Phase 3 raw primitive — it is replaced/removed when Phase 3 adds the real minimal toolset (search/read/create/write/call/introspect). Establishing the integration-test infrastructure is an explicit Phase 2 deliverable.

### Auth-Missing Error Shape (AUTH-03)

- **D-2:** When no credentials resolve, reject at the TRANSPORT layer with HTTP 401 from a Starlette middleware, BEFORE the request reaches MCP processing. The 401 response body carries a human-readable message that ENUMERATES which credential inputs were missing (which X-Odoo-* headers and/or env vars). This resolves the ROADMAP's ambiguous "401-style" to a real HTTP 401.

### Credential Extraction and Injection (AUTH-01/02/04)

- **D-3:** Extract X-Odoo-* headers in a Starlette Middleware class (NOT FastAPI on top of fastmcp). Resolution precedence: `X-Odoo-Url` / `X-Odoo-Database` / `X-Odoo-Username` / `X-Odoo-Password` headers take precedence; env-var fallback `ODOO_URL` / `ODOO_DATABASE` / `ODOO_USERNAME` / `ODOO_PASSWORD`; neither → 401 (D-2). The middleware stashes resolved credentials on the per-request scope/state; tool handlers read them via fastmcp's `Context` object. No module-global state, no contextvars. Each request constructs a FRESH OdooClient from its resolved credentials — no client/connection shared across requests or users (AUTH-04).

### Test Strategy

- **D-4:** Use `godoo-testcontainers` now for a REAL-Odoo integration test in Phase 2. A session-scoped `TestHarness` (from `godoo.testcontainers`) boots one real Odoo and exposes `url` / `database` / an authenticated client. Concurrent-credential isolation (AUTH-04) and the full-vertical tool call (TRANS-02) are verified against it. Integration tests are marked `@pytest.mark.integration`; the default `pytest` CI gate runs `-m "not integration"` (fast, no Docker); a SEPARATE CI job runs integration tests with Docker available and snapshot caching (`cache_dir` pointed at a GitHub Actions cache) to amortize the cold `odoo:17` image pull.

### testcontainers Dependency

- **D-5:** Add `godoo-testcontainers>=0.2,<0.3` as a DEV dependency, pinned from PyPI (matches `godoo-client` pinning style; honors siblings-are-independent-repos). NO path dependency to `../godoo-py`. Note: local pyproject in godoo-py may lag PyPI (0.2.0 vs 0.2.1) — PyPI 0.2.1 is the target.

### Carried Forward (Locked Upstream — Do NOT Re-litigate)

- Transport: Streamable HTTP only, `stateless_http=True`, no `Mcp-Session-Id` (TRANS-01).
- Framework: `fastmcp` (PrefectHQ 3.3.x); single-process uvicorn (no gunicorn); Starlette middleware for credential extraction (no FastAPI).
- Auth boundary absolute: server consumes credentials, never generates/issues tokens, never implements OAuth.
- `godoo-client>=0.2,<0.3`, Python ≥3.14, `uv_build`, src-layout, mypy --strict, ruff.
- Phase 1 CI (D-04): GitHub Actions, three gates (ruff, mypy --strict, pytest), `uv sync --frozen`, uv.lock committed. Phase 2 adds a separate integration job per D-4.

### Claude's Discretion

- Exact `godoo-client` 0.2.1 async lifecycle — whether OdooClient requires `async with` / explicit close. Researcher determines before planning.
- fastmcp ASGI wiring details: use `http_app()` to obtain the ASGI app; the `FastMCP` server object MUST live in an importable module (e.g. `server.py`) consumable by `__main__.py` and by future phases — NOT defined inline in `__main__.py`.
- Exact identity of the stub validation tool's Odoo call (`whoami` vs version probe) — planner picks the cheapest read-only round-trip.
- Config/env loading shape, server-start CLI command design, logging — not discussed; planner uses sensible defaults.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase Definition & Requirements
- `.planning/ROADMAP.md` — Phase 2 definition, success criteria, requirements mapped
- `.planning/REQUIREMENTS.md` — TRANS-01, TRANS-02, AUTH-01, AUTH-02, AUTH-03, AUTH-04

### Project Constraints & Locked Decisions
- `.planning/PROJECT.md` — Constraints + Key Decisions
- `.planning/phases/01-foundations/01-CONTEXT.md` — prior phase decisions D-01..D-05

### Technology Research
- `.planning/research/STACK.md` — fastmcp / godoo-client / Python stack research
- `.planning/research/PITFALLS.md` — known traps (gunicorn antipattern, alpine libc, etc.)

### Build & Framework Guidance
- `CLAUDE.md` — tech-stack table, "What NOT to Use", Starlette-middleware-for-credentials guidance
- `pyproject.toml` — current dependency pins

### godoo-testcontainers Integration
- `../godoo-py/packages/godoo-testcontainers/` — godoo-testcontainers source + README; API: `godoo.testcontainers` exposes `TestHarness` (async ctx mgr), `OdooTestContainer`, `StartedOdooContainer` (`.url`/`.database`/`.client`). PyPI: `godoo-testcontainers` 0.2.1, requires-python ≥3.14, deps `godoo-client`, `testcontainers[postgres]>=4`. Used via `async with TestHarness(modules=["base"]) as h: ...`.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- `src/godoo_mcp_server/__init__.py` — established `__version__` pattern; Phase 2 does not change this.
- `src/godoo_mcp_server/__main__.py` — CLI shell; the `--version` branch stays, the else branch becomes the real server-start (uvicorn/fastmcp). Must NOT hold the FastMCP server object.

### Established Patterns

- src-layout, `uv_build` build backend, `uv sync --frozen` in CI — all established in Phase 1; Phase 2 must not deviate.
- `pytest-asyncio>=1.4` with `asyncio_mode="auto"` already configured — async tests work without per-test decorators.
- mypy `--strict` with `godoo_client.*` → `ignore_missing_imports` — all new modules must be fully type-annotated.
- ruff lint + format enforced in CI and pre-commit — no new exceptions.

### Integration Points

- Net-new modules expected: `server.py` (FastMCP server/app object + `http_app()` ASGI wiring), a credential-extraction Starlette middleware module, a credentials/config resolver module.
- `pyproject.toml` — `fastmcp>=3.3,<4` and `godoo-client>=0.2,<0.3` already declared; Phase 2 adds `godoo-testcontainers>=0.2,<0.3` to dev deps; registers the `integration` pytest marker and sets default addopts to `-m "not integration"`.
- `.github/workflows/ci.yml` — Phase 2 extends with a separate integration CI job (Docker-available runner, snapshot caching).

</code_context>

<specifics>
## Specific Ideas

- Testing infra is part of the skeleton itself — a Phase 2 that cannot run a real Odoo round-trip is not a complete vertical slice.
- The credential enumeration in the 401 body is a hard UX requirement: the error must tell the caller exactly which headers/env-vars were absent, not just "unauthorized".

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope. The real raw-primitive toolset (search/read/create/write/call/introspect) is Phase 3 per ROADMAP, not a deferred idea from this discussion.

</deferred>

---

*Phase: 2-Skeleton Server*
*Context gathered: 2026-06-02*
