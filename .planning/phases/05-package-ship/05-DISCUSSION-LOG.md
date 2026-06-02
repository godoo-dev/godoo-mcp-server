# Phase 5: Package & Ship - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-02
**Phase:** 05-package-ship
**Areas discussed:** Ship version, Dockerfile strategy, Publish trigger, CLI entrypoint

---

## Ship Version

| Option | Description | Selected |
|--------|-------------|----------|
| A | "0.x now, 1.0 after Code Mode" — publish 0.2.0/0.1.0 now pre-1.0, reserve 1.0 for after Phase 6 | |
| B | "1.0.0 now" — ship 1.0.0 at end of Phase 5, Code Mode becomes 1.1 | |
| C | "0.1.0 → TestPyPI first" — dry-run the pipeline to TestPyPI as 0.1.0, verify install, decide production version as a follow-up | ✓ |

**User's choice:** (C) 0.1.0 → TestPyPI first
**Notes:** Production version number DEFERRED pending successful dry-run. TestPyPI install is a gate before production publish — the dry-run must succeed before committing to a production version number.

---

## Dockerfile Strategy

| Option | Description | Selected |
|--------|-------------|----------|
| A | "Multi-stage, from source" — builder runs `uv sync --frozen --no-dev` into .venv, runtime `python:3.14-slim` copies .venv+src, no uv in final image, no PyPI dependency | ✓ |
| B | "Single-stage, from source" | |
| C | "Install published wheel" — `pip install` from PyPI; tests real artifact but chicken-and-egg with TestPyPI-first | |

**User's choice:** (A) Multi-stage, from source
**Notes:** HEALTHCHECK wired to existing `/healthz` endpoint (carry-forward from Phase 4.1 D-06). CMD form follows from the CLI-entrypoint decision (see Area 4 below).

---

## Publish Trigger

### Q3a — Primary publish mechanism

| Option | Description | Selected |
|--------|-------------|----------|
| A | "Tag-triggered + Trusted Publisher" — on push of `v*` tag, Actions publishes via PyPI Trusted Publisher OIDC; no stored token | ✓ |
| B | "Manual workflow_dispatch" | |
| C | "Local-only uv publish" | |

**User's choice:** (A) Tag-triggered + Trusted Publisher

### Q3b — TestPyPI dry-run routing

| Option | Description | Selected |
|--------|-------------|----------|
| A | "Dispatch → TestPyPI, tag → PyPI" — `workflow_dispatch` publishes to TestPyPI, `v*` tag publishes to production; two Trusted Publisher configs | ✓ |
| B | "Pre-release tag → TestPyPI" | |
| C | "Separate test job, manual for now" | |

**User's choice:** (A) Dispatch → TestPyPI, tag → PyPI
**Notes:** Mental model: button = rehearse, tag = ship. `uv.lock` must be committed (lockfile-discipline rule). Two separate Trusted Publisher configurations required — one for TestPyPI, one for production PyPI.

---

## CLI Entrypoint

| Option | Description | Selected |
|--------|-------------|----------|
| A | "Add `godoo-mcp-server` script" — `[project.scripts]` entry `godoo-mcp-server = "godoo_mcp_server.__main__:main"`; additive; `main()` already exists; `python -m` keeps working | ✓ |
| B | "`python -m` only" | |

**User's choice:** (A) Add `godoo-mcp-server` script
**Notes:** Consequence: Docker `CMD` becomes `["godoo-mcp-server"]`. The `main()` function already exists so this is purely additive — no logic changes required.

---

## Locked Deliverables (Not Open Choices)

These items are success-criteria-driven and were not open to discussion:

- **README "Security: Header Trust Model" section** (SC-3) — must be written as part of Phase 5.
- **npm deprecate `@marcfargas/odoo-mcp`** (SC-4) — deprecate, never unpublish.

---

## Claude's Discretion

Marc kept scope tight. The following items were not discussed and are left to the planner's judgment:

- **CHANGELOG format/existence** — whether to introduce a CHANGELOG, what format (Keep a Changelog, conventional-commits auto-gen, etc.)
- **Docker non-root user** — whether to add a dedicated non-root user in the Dockerfile
- **Base-image digest pinning** — whether to pin `python:3.14-slim` by digest for reproducibility
- **Image registry** — GHCR vs Docker Hub (or both)

---

## Deferred Ideas

- **Production version number** — deferred within Phase 5; decision blocked on successful TestPyPI dry-run. Planner should include a dry-run-gate task before the production publish task.
- **CHANGELOG / non-root user / digest pinning / registry choice** — unlocked; planner may propose these as optional tasks or include them at discretion.
- **Repo public flip** — gated on v1.0 milestone, not Phase 5. No cross-phase scope creep occurred.
