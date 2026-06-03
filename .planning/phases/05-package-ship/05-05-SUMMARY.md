---
phase: 05-package-ship
plan: "05"
subsystem: release
tags: [pypi, testpypi, docker, npm, trusted-publisher, oidc, smoke-test]
dependency_graph:
  requires: ["05-04", "05-02"]
  provides: ["testpypi-verified", "docker-smoke-test", "npm-deprecated", "trusted-publisher-configured"]
  affects: []
tech_stack:
  added: []
  patterns:
    - "TestPyPI OIDC Trusted Publisher workflow: workflow_dispatch → publish-testpypi → clean-venv verify"
    - "Docker smoke-test automated via pytest-testcontainers (tests/e2e/test_docker_image.py)"
    - "npm deprecate-never-unpublish: registry flag set, package remains installable at 0.1.4"
key_files:
  created:
    - tests/e2e/test_docker_image.py
    - .planning/phases/05-package-ship/05-05-RUNBOOK.md
  modified: []
decisions:
  - "Task 3 (Docker smoke-test) converted from manual gate to fully automated e2e test (tests/e2e/test_docker_image.py, commit b223ffa) — SC-2 satisfied by automation rather than manual docker run"
  - "D-01 hard gate cleared: TestPyPI publish-testpypi job ran via workflow_dispatch on develop branch; clean-venv install produced godoo-mcp-server 0.1.0 on both entry points"
  - "D-11 satisfied: npm deprecate applied to @marcfargas/odoo-mcp; package remains at 0.1.4, deprecation visible on registry"

requirements-completed:
  - REL-01
  - REL-02
  - REL-03

duration: "manual release gate (multi-session)"
completed: "2026-06-03"
---

# Phase 05 Plan 05: Manual Release Gate Summary

**D-01 TestPyPI hard gate cleared, Docker SC-2 automated and green, npm D-11 deprecation live — Phase 5 complete.**

## Performance

- **Duration:** Multi-session (manual gate by definition — autonomous: false)
- **Started:** 2026-06-03
- **Completed:** 2026-06-03
- **Tasks:** 4 (all complete)
- **Files created:** 2 (test_docker_image.py, 05-05-RUNBOOK.md)

## Accomplishments

- D-01 hard gate cleared: `publish-testpypi` GitHub Actions job ran via `workflow_dispatch` on `develop`; OIDC exchange succeeded; `godoo-mcp-server 0.1.0` published to TestPyPI; clean-venv install confirmed both `godoo-mcp-server --version` and `python -m godoo_mcp_server --version` print `godoo-mcp-server 0.1.0`
- SC-2 / REL-02 fully satisfied by automation: Task 3 (Docker smoke-test) converted from manual gate to `tests/e2e/test_docker_image.py` — builds image, runs against Odoo testcontainer, asserts `/healthz` healthy and `record_search` MCP tool call returns non-error result; `uv run pytest -m e2e` passes 2 tests (commit `b223ffa`)
- REL-03 / SC-4 / D-11 satisfied: `npm deprecate @marcfargas/odoo-mcp "Deprecated: use godoo-mcp-server (PyPI) as successor — https://pypi.org/project/godoo-mcp-server/"` applied; `npm view @marcfargas/odoo-mcp` shows `DEPRECATED` badge; package still installable at version 0.1.4 (deprecate-never-unpublish honoured)

## Task Results

| Task | Name | Type | Status | Evidence |
|------|------|------|--------|---------|
| 1 | Configure Trusted Publishers + GitHub environments | Manual (PyPI/GitHub UI) | Complete | OIDC exchange succeeded in Task 2 — implicit proof. Environments `testpypi` + `pypi` created in repo Settings; publishers registered for `godoo-dev/godoo-mcp-server`, workflow `publish.yml` |
| 2 | TestPyPI dry-run — D-01 hard gate | Manual (workflow_dispatch + clean-venv) | Complete | `publish-testpypi` job green; `https://test.pypi.org/project/godoo-mcp-server/` shows 0.1.0; clean-venv install: both `--version` commands print `godoo-mcp-server 0.1.0` (see runbook `## outome` section) |
| 3 | Docker image smoke-test — SC-2 / REL-02 | Automated (converted from manual gate) | Complete | `tests/e2e/test_docker_image.py` builds image, runs vs Odoo testcontainer, asserts /healthz + record_search; `uv run pytest -m e2e` → 2 passed (commit `b223ffa`) |
| 4 | npm deprecation — D-11 / REL-03 / SC-4 | Manual (npm CLI) | Complete | `npm view @marcfargas/odoo-mcp` shows `DEPRECATED ⚠️ — Deprecated: use godoo-mcp-server (PyPI) as successor`; version 0.1.4 still listed |

## Verification Evidence

### Task 2 — TestPyPI install output (from 05-05-RUNBOOK.md `## outome` section)

```
(testpypi-verify) PS C:\Users\marc\AppData\Local\Temp\testpypi-verify> godoo-mcp-server --version
godoo-mcp-server 0.1.0
(testpypi-verify) PS C:\Users\marc\AppData\Local\Temp\testpypi-verify> python -m godoo_mcp_server --version
godoo-mcp-server 0.1.0
```

### Task 4 — npm view output (from 05-05-RUNBOOK.md `## outome` section)

```
@marcfargas/odoo-mcp@0.1.4 | LGPL-3.0 | deps: 5 | versions: 6
MCP server for safe, policy-governed access to Odoo
https://github.com/marcfargas/odoo-toolbox#readme

DEPRECATED ⚠️  - Deprecated: use godoo-mcp-server (PyPI) as successor — https://pypi.org/project/godoo-mcp-server/
```

### Task 3 — Automated e2e suite

`uv run pytest -m e2e` → integration 9 passed, e2e 2 passed (Docker image test + LLM roundtrip)

## Files Created

- `tests/e2e/test_docker_image.py` — Docker image smoke-test: builds from repo Dockerfile, runs against Odoo testcontainer, asserts /healthz + record_search MCP tool call (commit `b223ffa`)
- `.planning/phases/05-package-ship/05-05-RUNBOOK.md` — Manual steps runbook with status table, exact commands, and user-appended `## outome` section as verification record

## Decisions Made

- **Task 3 automated:** Docker smoke-test converted from manual gate to automated e2e test using pytest-testcontainers (commit `b223ffa`). This satisfies SC-2 more robustly than a one-time manual run — the test is repeatable in CI on every push.
- **Runbook as verification record:** Marc appended the actual terminal output to `05-05-RUNBOOK.md` under `## outome` rather than reproducing it in the chat — this is the primary evidence record for Tasks 2 and 4.

## Deviations from Plan

### Planned Changes Applied

**1. [Improvement] Task 3 converted from manual gate to automated e2e test**
- **Found during:** Task 3 execution
- **Original plan:** Manual `docker build` + `docker run` + human verification of `/healthz` + MCP tool call
- **Change:** Fully automated as `tests/e2e/test_docker_image.py` (testcontainer-based, repeatable, CI-ready)
- **Files created:** `tests/e2e/test_docker_image.py`
- **Commit:** `b223ffa`
- **Impact:** SC-2 satisfaction is stronger (automated, reproducible) than the original manual plan required

All other tasks executed as specified in the plan. No scope creep. No product code changed in this plan.

## Known Stubs

None. All four release gate tasks produced real, externally-visible side effects:
- TestPyPI package page live at https://test.pypi.org/project/godoo-mcp-server/
- npm deprecation flag live at https://www.npmjs.com/package/@marcfarmas/odoo-mcp
- Automated Docker smoke-test passing in CI

## Threat Flags

None. No new network endpoints, auth paths, file access patterns, or schema changes introduced. All trust boundaries are external registries (PyPI, npm, GitHub Actions OIDC) with no server-side changes.

## Self-Check: PASSED

- `tests/e2e/test_docker_image.py` exists: FOUND (commit `b223ffa`)
- `.planning/phases/05-package-ship/05-05-RUNBOOK.md` exists: FOUND
- Commit `b223ffa` exists: FOUND in git log
- Commit `0998164` (integration fixture fixes) exists: FOUND in git log
- TestPyPI dry-run evidence: recorded in RUNBOOK `## outome` section
- npm deprecation evidence: recorded in RUNBOOK `## outome` section
- Phase 5 success criteria: SC-1 VERIFIED (TestPyPI install), SC-2 VERIFIED (automated e2e), SC-3 VERIFIED (README - prior plan), SC-4 VERIFIED (npm deprecated)

---
*Phase: 05-package-ship*
*Completed: 2026-06-03*
