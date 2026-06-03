---
phase: 05-package-ship
plan: "04"
subsystem: ci-cd
tags: [github-actions, publish, pypi, docker, ghcr, oidc, trusted-publisher]
dependency_graph:
  requires: ["05-01", "05-02"]
  provides: ["publish-workflow"]
  affects: []
tech_stack:
  added: []
  patterns:
    - "Two-path GitHub Actions routing: workflow_dispatch → TestPyPI; v* tag → PyPI + Docker"
    - "Trusted Publisher OIDC for both PyPI environments (no stored API tokens)"
    - "docker/metadata-action semver tag generation"
key_files:
  created:
    - .github/workflows/publish.yml
  modified: []
decisions:
  - "D-08 two-path routing implemented: workflow_dispatch = rehearse (TestPyPI), v* push = ship (PyPI + Docker)"
  - "D-07 Trusted Publisher OIDC: id-token: write on both publish-testpypi and publish-pypi jobs"
  - "publish-docker does not consume dist artifact — builds from source via docker/build-push-action (D-03)"
metrics:
  duration: "65s"
  completed: "2026-06-03"
  tasks: 1
  files: 1
---

# Phase 05 Plan 04: Publish Workflow Summary

Two-path GitHub Actions publish workflow using Trusted Publisher OIDC — workflow_dispatch triggers TestPyPI rehearsal, v* tag push triggers production PyPI and Docker GHCR push.

## What Was Built

`.github/workflows/publish.yml` with four jobs implementing the D-08 two-path mental model:

- **build** — `uv build` produces `dist/` artifacts uploaded via `actions/upload-artifact@v4`
- **publish-testpypi** — fires on `workflow_dispatch` only; uses `environment: testpypi` + `id-token: write`; runs `uv publish --index testpypi --trusted-publishing always`
- **publish-pypi** — fires on `push tags v*` only; uses `environment: pypi` + `id-token: write`; runs `uv publish --trusted-publishing automatic`
- **publish-docker** — fires on `push tags v*`; depends on build job (serialization only, no artifact consumed); builds from source via `docker/build-push-action@v6`; pushes to `ghcr.io/${{ github.repository }}` using `GITHUB_TOKEN`

## Task Results

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Write .github/workflows/publish.yml | 7c372e3 | .github/workflows/publish.yml |

## Verification Results

All automated assertions passed:
- `yaml.safe_load` succeeds (valid YAML)
- Four jobs present: build, publish-testpypi, publish-pypi, publish-docker
- `publish-testpypi`: `environment: testpypi`, `id-token: write`
- `publish-pypi`: `environment: pypi`, `id-token: write`
- `workflow_dispatch` trigger present (5 occurrences)
- `id-token: write` on exactly 2 jobs (both PyPI publish jobs)
- `testpypi` referenced 6 times (job name + environment + uv publish flag)
- `ghcr.io` referenced 2 times (login-action registry + metadata-action images)
- All 63 unit tests still pass after workflow addition

## Threat Mitigations Applied

| Threat ID | Mitigation |
|-----------|-----------|
| T-05-30 | `if: github.event_name == 'push' && startsWith(github.ref, 'refs/tags/v')` on publish-pypi and publish-docker |
| T-05-31 | `environment: testpypi` and `environment: pypi` match intended Trusted Publisher configs; 05-05 validates before first run |
| T-05-32 | No API token stored; OIDC Trusted Publisher used exclusively |
| T-05-34 | `uv build` reads committed `uv.lock`; `--frozen` implicit in uv_build backend |

## Deviations from Plan

None — plan executed exactly as written. Pattern 1 from RESEARCH.md used verbatim as the template; all PATTERNS.md conventions followed.

## Known Stubs

None. The workflow is complete and self-contained. It cannot successfully run until the manual registry setup (05-05) completes, but all YAML is production-ready.

## Threat Flags

None. No new network endpoints, auth paths, or schema changes introduced. All trust boundaries are GitHub-managed (OIDC tokens, GITHUB_TOKEN).

## Self-Check: PASSED

- `.github/workflows/publish.yml` exists: FOUND
- Commit `7c372e3` exists: FOUND
- 63 tests pass: CONFIRMED
