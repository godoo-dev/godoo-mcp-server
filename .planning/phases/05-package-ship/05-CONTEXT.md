# Phase 5: Package & Ship - Context

**Gathered:** 2026-06-02
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 5 makes `godoo-mcp-server` distributable. It delivers: a PyPI-installable
package, a published `python:3.14-slim` Docker image, a README "Security: Header
Trust Model" section, and the formal deprecation of the predecessor npm package
`@marcfargas/odoo-mcp`. No new MCP tool logic, no behavior changes — this is pure
packaging, documentation, and release plumbing.

Requirements covered: REL-01, REL-02, REL-03, REL-04.

</domain>

<decisions>
## Implementation Decisions

### Versioning & Publish Sequence
- **D-01:** First publish is a **TestPyPI dry-run at `0.1.0`** to de-risk the
  first-ever release (in particular, confirm `godoo-client>=0.2,<0.3` resolves on
  the index). A successful TestPyPI install is a **gate** — production publish does
  not happen until the dry-run is verified.
- **D-02:** The **production version number is DEFERRED** pending the dry-run.
  Do NOT hardcode a production version in the plan. Milestone framing (ROADMAP
  "v1.0" milestone also contains Phase 6 Code Mode) means the production number is
  a deliberate later call — likely a `0.x` release now with `1.0.0` reserved until
  Code Mode lands, but this is explicitly left open for Marc to set at ship time.

### Docker Image
- **D-03:** **Multi-stage Dockerfile, built from source** (not from the published
  wheel). Builder stage runs `uv sync --frozen --no-dev` producing a `.venv`;
  runtime stage is `python:3.14-slim` and copies only the `.venv` + `src`. No `uv`
  in the final image. Building from source (not the wheel) means the image has no
  dependency on PyPI being published first — avoids the chicken-and-egg with the
  TestPyPI-first sequence.
- **D-04:** Base image is `python:3.14-slim` (NOT alpine — musl breaks httpx/anyio,
  per CLAUDE.md). Carry-forward, locked.
- **D-05:** Dockerfile must include a `HEALTHCHECK` hitting the existing `/healthz`
  route (implemented in Phase 4.1, designed as this exact seam — see 04.1 D-06).
- **D-06:** Container entrypoint uses the console script: `CMD ["godoo-mcp-server"]`
  (follows from D-09).

### Release Automation
- **D-07:** PyPI publish is via a **GitHub Actions workflow using PyPI Trusted
  Publisher (OIDC)** — no stored API token / secret in CI. Requires one-time
  Trusted Publisher configuration on both PyPI and TestPyPI.
- **D-08:** Trigger routing within the publish workflow:
  - `workflow_dispatch` (manual button) → publishes to **TestPyPI** (the dry-run).
  - pushing a `v*` tag → publishes to **production PyPI**.
  Two clear paths, two Trusted Publisher configs. Mental model: button = rehearse,
  tag = ship. `uv.lock` MUST be committed in sync with `pyproject.toml`
  (lockfile-discipline; CI uses `--frozen`).

### CLI Entrypoint
- **D-09:** Add a console script:
  `[project.scripts] godoo-mcp-server = "godoo_mcp_server.__main__:main"`.
  `main()` already exists in `__main__.py`, so this is additive and low-risk. The
  existing `python -m godoo_mcp_server` path keeps working (satisfies SC-1).

### Locked Deliverables (success-criteria-driven, not open choices)
- **D-10:** README must gain a **"Security: Header Trust Model"** section (SC-3)
  explaining that this server grants full Odoo user impersonation power when no
  header-stripping proxy is in front of it, and naming `godoo-proxy` as the
  SaaS-safe guard. This is the FOSS/commercial boundary made explicit to operators.
- **D-11:** Run `npm deprecate @marcfargas/odoo-mcp "Deprecated: use
  godoo-mcp-server (PyPI) as successor"` (SC-4). **Deprecate, never unpublish**
  (carry-forward, locked). This is a manual maintainer action, not CI-automated.

### Claude's Discretion
- CHANGELOG format/existence, Docker non-root user, base-image digest pinning, and
  image registry (GHCR vs Docker Hub) were NOT discussed — Marc chose to keep scope
  tight. Planner/researcher may propose sensible defaults for these but they are not
  locked decisions; surface them as plan choices rather than assuming.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase scope & requirements
- `.planning/ROADMAP.md` (Phase 5 entry) — goal, deliverables, success criteria
  SC-1..SC-4
- `.planning/REQUIREMENTS.md` — REL-01, REL-02, REL-03, REL-04
- `.planning/PROJECT.md` — Key Decisions table (Deployment, Packaging, License,
  Repo visibility rows); Technology Stack (uv + hatchling/uv_build, Docker base,
  godoo-client pin)

### Carry-forward design seam
- `.planning/phases/04.1-e2e-agent-testing-over-real-mcp-transport/04.1-CONTEXT.md`
  §D-06 — `/healthz` route designed explicitly as the Phase 5 Docker HEALTHCHECK probe

### Project instructions (constraints that bind packaging)
- `CLAUDE.md` — Docker base `python:3.14-slim` (not alpine); `uv sync --frozen` in
  CI/Docker; depend on `godoo-client`, never the `godoo` meta-package; SSE not used
- `../godoo-hq/UMBRELLA_CLAUDE.md` — FOSS/public-at-v1.0 intent; godoo-proxy is the
  commercial gateway that injects credential headers (relevant to README D-10)

No additional external ADRs/specs exist for this phase — decisions above are the
authoritative record.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `pyproject.toml` — already valid: `name = "godoo-mcp-server"`, `version = "0.1.0"`,
  `uv_build` backend, `requires-python = ">=3.14"`, LGPL-3.0, skills bundled via
  `[tool.uv_build] include = ["src/godoo_mcp_server/skills/**"]`. Ready for `uv build`.
- `src/godoo_mcp_server/__main__.py` — `main()` exists and is callable; supports
  `--version`, and `HOST`/`PORT` env vars; runs `uvicorn.run(app, ...)`. This is the
  console-script target (D-09) and the Docker CMD target (D-06).
- `src/godoo_mcp_server/__init__.py` — `__version__ = "0.1.0"` (single source of
  version; keep in sync with pyproject).
- `/healthz` route in server.py — unauthenticated 200, the Docker HEALTHCHECK target.
- `py.typed` marker present — package ships as typed.
- `.github/workflows/ci.yml` — existing `ci` (ruff, mypy, pytest) + `integration`
  jobs, Python 3.14, `uv sync --frozen --dev`, ubuntu-latest. The new publish
  workflow is a sibling, not a modification of this.
- `LICENSE` (LGPL-3.0) present at repo root.
- `.pre-commit-config.yaml` present.

### Gaps Phase 5 must fill
- No `Dockerfile` yet.
- No `[project.scripts]` entry (D-09 adds it).
- No publish workflow (`.github/workflows/publish.yml` or similar) — D-07/D-08.
- README is a Phase 1 scaffold stub — needs the Security section (D-10) plus install
  instructions (pip + Docker).
- No `CHANGELOG.md` (Claude's discretion — not locked).

### Integration Points
- Console script → `__main__:main` (existing).
- Docker CMD → console script (D-06) → `__main__:main`.
- HEALTHCHECK → `/healthz` (existing route).
- Publish workflow → `uv build` + Trusted Publisher; consumes committed `uv.lock`.

</code_context>

<specifics>
## Specific Ideas

- "Button = rehearse, tag = ship" is Marc's chosen mental model for the publish
  workflow (D-08) — keep that two-path shape explicit in the workflow file.
- TestPyPI verification is a hard gate, not a formality — the plan should include an
  explicit "install from TestPyPI and smoke-test `godoo-mcp-server` / `python -m`"
  step before any production-publish task is considered done.

</specifics>

<deferred>
## Deferred Ideas

- **Production version number** — not a future phase, but deliberately deferred
  within Phase 5 until the TestPyPI dry-run passes (see D-02). The planner should
  treat the production-publish step as parameterized on a version Marc sets at ship
  time, not a hardcoded value.
- **CHANGELOG, non-root container user, base-image digest pinning, image registry
  choice (GHCR vs Docker Hub)** — surfaced as out-of-discussion-scope. Not deferred
  to another phase; available for the planner to propose as in-phase plan choices,
  but unlocked.
- **Repo public flip / FOSS announcement** — gated on v1.0 per PROJECT.md; happens
  at or after the production v1.0 ship, not mechanically part of this phase.

None of the above is scope creep into another phase — discussion stayed within the
Package & Ship boundary.

</deferred>

---

*Phase: 5-Package & Ship*
*Context gathered: 2026-06-02*
