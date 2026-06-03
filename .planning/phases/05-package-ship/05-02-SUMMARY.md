---
phase: 05-package-ship
plan: 02
subsystem: packaging/docker
tags: [docker, multi-stage, packaging, release]
dependency_graph:
  requires: [pyproject.toml console script from 05-01]
  provides: [Dockerfile for Docker image builds]
  affects: [.github/workflows/publish.yml (05-04 will reference this Dockerfile)]
tech_stack:
  added: []
  patterns: [multi-stage Docker build, uv --no-editable install, non-root container user, urllib HEALTHCHECK]
key_files:
  created: [Dockerfile]
  modified: []
decisions:
  - D-06 applied: CMD ["godoo-mcp-server"] uses the console script from [project.scripts]
  - D-05 applied: HEALTHCHECK uses urllib.request against /healthz (no curl dependency)
  - D-03 applied: build from source with --no-editable; runtime copies only .venv
  - D-04 applied: python:3.14-slim base (NOT alpine)
  - Non-root godoo user added (T-05-10 discretion recommendation)
  - uv pinned to 0.7.12 (T-05-12 supply-chain mitigation)
metrics:
  duration: "~1 min"
  completed: "2026-06-03T06:23:27Z"
  tasks_completed: 1
  files_created: 1
  files_modified: 0
---

# Phase 5 Plan 2: Dockerfile — Multi-Stage Build Summary

**One-liner:** Multi-stage `python:3.14-slim` Dockerfile with uv `--no-editable` build, non-root godoo user, urllib HEALTHCHECK on `/healthz`, and `CMD ["godoo-mcp-server"]` console script entrypoint.

## Tasks Completed

| # | Task | Commit | Files |
|---|------|--------|-------|
| 1 | Write Dockerfile — multi-stage build from source | cfcdc9f | Dockerfile |

## Decisions Made

| Decision | Rationale |
|----------|-----------|
| uv binary pinned to `ghcr.io/astral-sh/uv:0.7.12` | T-05-12: supply-chain integrity; exact version prevents silent upstream mutation |
| `--no-editable` in second builder RUN | RESEARCH Pitfall 2: without this, `importlib.resources.files("godoo_mcp_server")` breaks in runtime stage because editable link points to src/ which is absent |
| Runtime stage copies only `/app/.venv` | T-05-11: no source tree, no uv binary, no build cache in final image |
| Non-root `godoo` user via `groupadd -r + useradd -r` | T-05-10: least-privilege; security best practice per RESEARCH Open Question 3 |
| HEALTHCHECK via `urllib.request` stdlib | No curl installation needed; free in any Python slim image; avoids ~3 MB addition |
| `--start-period=15s` on HEALTHCHECK | T-05-13: gives uvicorn time to complete startup before health checks begin |
| Layer-cache: bind-mount uv.lock + pyproject.toml before COPY . | Cache-friendly ordering: dependency layer (which changes less) cached separately from source copy |
| Port hardcoded to 8000 in HEALTHCHECK | HEALTHCHECK must use a fixed port; runtime PORT override requires custom health probe — documented in comment |

## Deviations from Plan

None — plan executed exactly as written. Pattern 3 from RESEARCH.md used as the direct template; all must_haves verified by grep checks before commit.

## Verification Results

All acceptance criteria passed:

| Check | Result |
|-------|--------|
| `grep -c "FROM python:3.14-slim" Dockerfile` | 2 |
| `grep -c "uv sync --frozen --no-dev --no-editable" Dockerfile` | 1 |
| `grep -c "uv sync --frozen --no-dev --no-install-project" Dockerfile` | 1 |
| `grep "CMD" Dockerfile` contains `["godoo-mcp-server"]` | pass |
| `grep "HEALTHCHECK"` contains `urllib.request.urlopen` and `localhost:8000/healthz` | pass |
| `grep "USER godoo"` returns match | pass |
| No `COPY.*src/` in runtime stage | pass |
| No uv binary reference after runtime stage | pass |
| Unit test suite (63 tests) | 63 passed, 0 failed |

## Known Stubs

None — the Dockerfile is a complete build artifact with no placeholder values.

## Threat Flags

No new threat surface introduced. Dockerfile implements mitigations for all STRIDE threats documented in the plan's threat model (T-05-10 through T-05-13).

## Self-Check: PASSED

- `Dockerfile` exists at repo root: confirmed
- Commit `cfcdc9f` exists: confirmed (`git log --oneline -1` shows `cfcdc9f feat(05-02): add multi-stage Dockerfile`)
