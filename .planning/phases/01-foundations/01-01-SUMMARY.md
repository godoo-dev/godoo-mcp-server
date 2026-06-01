---
phase: 01-foundations
plan: 01
subsystem: scaffold
tags: [python, uv, packaging, ci, mypy, ruff, pytest]
dependency_graph:
  requires: []
  provides: [package-scaffold, ci-workflow, lockfile]
  affects: [all-future-phases]
tech_stack:
  added:
    - uv_build 0.11.x (build backend)
    - godoo-client>=0.2,<0.3 (Odoo async RPC client)
    - fastmcp>=3.3,<4 (MCP framework — active Phase 2+)
    - mypy>=2.1 (strict type checker)
    - ruff>=0.15 (linter + formatter)
    - pytest>=9 + pytest-asyncio>=1.4 (test runner + async support)
    - pre-commit>=4 (git hook runner)
  patterns:
    - src-layout (src/godoo_mcp_server/)
    - uv.lock committed for deterministic CI installs
    - asyncio_mode="auto" set from day one
    - mypy strict mode from day one
key_files:
  created:
    - pyproject.toml
    - src/godoo_mcp_server/__init__.py
    - src/godoo_mcp_server/__main__.py
    - tests/__init__.py
    - tests/test_placeholder.py
    - LICENSE
    - .pre-commit-config.yaml
    - uv.lock
    - README.md
    - .github/workflows/ci.yml
  modified: []
decisions:
  - "D-01 confirmed: godoo-client>=0.2,<0.3 pinned (PyPI re-confirm at phase close: 0.2.1 still latest; no 0.3.x published)"
  - "D-02 confirmed: requires-python = >=3.14 (hard floor from godoo-client 0.2.x)"
  - "D-03 implemented: uv_build backend + src-layout + __main__.py --version entrypoint"
  - "D-04 implemented: CI matrix [3.14], three named gates, uv sync --frozen"
  - "D-05 implemented: all tool config consolidated in pyproject.toml"
metrics:
  duration: "~15 minutes"
  completed: "2026-06-01"
  tasks_completed: 3
  files_created: 10
---

# Phase 01 Plan 01: Walking Skeleton Summary

uv_build src-layout package scaffold with godoo-client>=0.2,<0.3 pin confirmed, three-gate GitHub Actions CI (ruff/mypy/pytest), and full local gate verification.

## What Was Built

A complete Python package skeleton for `godoo-mcp-server`:

- **`pyproject.toml`** — uv_build backend, godoo-client pin, all tool config consolidated (ruff, mypy, pytest)
- **`src/godoo_mcp_server/__init__.py`** — `__version__ = "0.1.0"` literal
- **`src/godoo_mcp_server/__main__.py`** — `python -m godoo_mcp_server --version` CLI entry
- **`tests/test_placeholder.py`** — `test_package_importable` smoke test (FOUND-02)
- **`LICENSE`** — LGPL-3.0 full text fetched from gnu.org
- **`.pre-commit-config.yaml`** — ruff-pre-commit v0.15.15 (lint + format)
- **`uv.lock`** — committed deterministic lockfile (91 packages resolved)
- **`.github/workflows/ci.yml`** — matrix ["3.14"], three named gates

## Task Outcomes

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Package scaffold | 77ddfad | pyproject.toml, src/, tests/, LICENSE, .pre-commit-config.yaml, uv.lock, README.md |
| 2 | CI workflow | 8a7ee3b | .github/workflows/ci.yml |
| 3 | Phase close verification (auto-approved) | — | no new files — verification + PyPI re-confirm |

## Gate Results (All Green)

| Gate | Command | Result |
|------|---------|--------|
| Install + version | `uv run python -m godoo_mcp_server --version` | `godoo-mcp-server 0.1.0` ✓ |
| Lint | `uv run ruff check .` | 0 violations ✓ |
| Format | `uv run ruff format --check .` | all formatted ✓ |
| Type check | `uv run mypy --strict src/` | no issues ✓ |
| Test | `uv run pytest --tb=short` | 1 passed ✓ |

## D-01 Re-Confirmation (FOUND-01 — written confirmation at phase close)

Command run: `uv tool run --from pip pip index versions godoo-client`

Result: `godoo-client (0.2.1)` — Available versions: `0.2.1, 0.2.0`

**Confirmed:** `godoo-client>=0.2,<0.3` is correct. Latest is `0.2.1`; no `0.2.2+` or `0.3.x` published. Python floor `>=3.14` is correct. No changes needed to pyproject.toml pin.

The `godoo` meta-package is NOT in pyproject.toml dependencies (only `godoo_client.*` appears as a mypy override module pattern — correct).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] README.md missing (required by pyproject.toml)**
- **Found during:** Task 1 — `uv sync` failed with "failed to open file README.md"
- **Issue:** pyproject.toml declares `readme = "README.md"` but no README.md existed
- **Fix:** Created minimal README.md with package name and description
- **Files modified:** README.md (new)
- **Commit:** 77ddfad

**2. [Rule 1 - Bug] ruff format reformatted __main__.py**
- **Found during:** Task 1 verification — `uv run ruff format --check .` failed on `__main__.py`
- **Issue:** Missing blank line after module docstring (ruff E302/blank-line rule)
- **Fix:** Ran `uv run ruff format .` to auto-apply canonical formatting; all checks pass
- **Files modified:** src/godoo_mcp_server/__main__.py
- **Commit:** 77ddfad (reformatted before commit)

## TDD Gate Compliance

- **RED gate:** Package not yet installed — `uv sync` failed before src/__init__.py was created (expected failure confirmed)
- **GREEN gate:** Source files created → all tests pass (1 passed)
- Both gates satisfied within Task 1 (single TDD-marked task)

## Phase Requirements Satisfied

| Req ID | Status | Evidence |
|--------|--------|----------|
| FOUND-01 | SATISFIED | godoo-client>=0.2,<0.3 in pyproject.toml; PyPI re-confirmed 0.2.1 latest at phase close |
| FOUND-02 | SATISFIED | `uv run pytest --tb=short` → 1 passed; test_package_importable passes |
| FOUND-03 | SATISFIED | .github/workflows/ci.yml with matrix ["3.14"], three named gates, uv sync --frozen |

## Known Stubs

None — no stub patterns or placeholder data flows in this scaffold phase.

## Threat Flags

No new security-relevant surface introduced beyond what the plan's threat model covers. Phase 1 is scaffold-only with no network handlers, no credentials processing, and no runtime capability beyond `--version`.

## Self-Check: PASSED

- pyproject.toml: EXISTS ✓
- src/godoo_mcp_server/__init__.py: EXISTS ✓
- src/godoo_mcp_server/__main__.py: EXISTS ✓
- tests/test_placeholder.py: EXISTS ✓
- LICENSE: EXISTS ✓
- uv.lock: EXISTS ✓
- .github/workflows/ci.yml: EXISTS ✓
- Commit 77ddfad: EXISTS ✓
- Commit 8a7ee3b: EXISTS ✓
