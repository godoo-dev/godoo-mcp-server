---
phase: 05-package-ship
plan: "01"
subsystem: packaging
tags: [pyproject, console-script, testpypi, lockfile]
dependency_graph:
  requires: []
  provides: [console-script-entry, testpypi-index-stanza]
  affects: [uv.lock, dist/]
tech_stack:
  added: []
  patterns: [uv-build, pyproject-toml-scripts, uv-index-stanza]
key_files:
  modified:
    - pyproject.toml
decisions:
  - "D-09 console script wired: godoo-mcp-server = godoo_mcp_server.__main__:main"
  - "D-08 TestPyPI index stanza added with explicit=true; uv.lock unchanged (no new deps)"
metrics:
  duration: "~8 minutes"
  completed: "2026-06-03"
  tasks: 2
  files: 1
---

# Phase 05 Plan 01: Console Script + TestPyPI Index Summary

**One-liner:** Added `godoo-mcp-server` console script entry and named `testpypi` uv index stanza to `pyproject.toml`, enabling `CMD ["godoo-mcp-server"]` Docker entrypoint and `uv publish --index testpypi` workflow routing.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Add [project.scripts] and [[tool.uv.index]] to pyproject.toml | 530b21f | pyproject.toml |
| 2 | Regenerate uv.lock and verify wheel builds correctly | 530b21f (same — uv.lock unchanged, pyproject.toml only) | pyproject.toml |

## What Was Built

Two additive insertions to `pyproject.toml`:

**Insertion 1 — console script (D-09):**
```toml
[project.scripts]
godoo-mcp-server = "godoo_mcp_server.__main__:main"
```

**Insertion 2 — TestPyPI index stanza (D-08):**
```toml
[[tool.uv.index]]
name = "testpypi"
url = "https://test.pypi.org/simple/"
publish-url = "https://test.pypi.org/legacy/"
explicit = true
```

`uv.lock` was verified in sync via `uv lock` (resolved 98 packages in 1ms, no changes — `[project.scripts]` and `[[tool.uv.index]]` add no new package dependencies).

## Verification Results

- `pyproject.toml` tomllib assertions: PASS — `godoo-mcp-server` script entry and `testpypi` index both confirmed
- `uv build`: PASS — produces `dist/godoo_mcp_server-0.1.0-py3-none-any.whl`
- Wheel inspection: PASS — `godoo_mcp_server/skills/SKILL.md` bundled, `entry_points.txt` contains `[console_scripts] godoo-mcp-server = godoo_mcp_server.__main__:main`
- `uv run python -m godoo_mcp_server --version`: PASS — prints `godoo-mcp-server 0.1.0`
- `uv run pytest --tb=short`: PASS — 63 passed, 10 deselected

## Deviations from Plan

None — plan executed exactly as written.

The only notable point: `uv.lock` showed no file change (the lock was already up to date). This is expected — the plan explicitly noted that `[project.scripts]` and `[[tool.uv.index]]` do not add new package dependencies so "the lock content change should be minimal (metadata/hash update only)." In this case it was zero change. Per `lockfile-discipline`, both files were staged together; `git add uv.lock` is a no-op when the file is already tracked and unchanged.

## Known Stubs

None.

## Threat Flags

None. No new network endpoints, auth paths, file access patterns, or schema changes introduced. The `[[tool.uv.index]]` stanza includes `explicit = true` as required by T-05-02 (prevents TestPyPI from contaminating normal `uv sync` resolution).

## Self-Check: PASSED

- `pyproject.toml` contains `[project.scripts]` and `[[tool.uv.index]]`: FOUND
- Commit `530b21f` exists: FOUND
- `dist/godoo_mcp_server-0.1.0-py3-none-any.whl` produced: CONFIRMED by uv build
- 63 unit tests pass: CONFIRMED
