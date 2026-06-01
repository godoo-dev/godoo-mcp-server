---
phase: 01-foundations
reviewed: 2026-06-01T00:00:00Z
depth: standard
files_reviewed: 7
files_reviewed_list:
  - pyproject.toml
  - src/godoo_mcp_server/__init__.py
  - src/godoo_mcp_server/__main__.py
  - tests/__init__.py
  - tests/test_placeholder.py
  - .pre-commit-config.yaml
  - .github/workflows/ci.yml
findings:
  critical: 2
  warning: 3
  info: 1
  total: 6
status: issues_found
---

# Phase 1: Code Review Report

**Reviewed:** 2026-06-01T00:00:00Z
**Depth:** standard
**Files Reviewed:** 7
**Status:** issues_found

## Summary

Seven scaffold files reviewed. The package structure, license, Python floor (`>=3.14`),
build backend (`uv_build`), and dependency pins (`godoo-client>=0.2,<0.3`) are correct.
The ruff and mypy configs are functionally solid. Two critical issues stand out: the CI
workflow uses floating action versions and an unpinned `uv` installer, creating a
supply-chain attack surface; additionally, `pytest-asyncio` in `pyproject.toml` is pinned
to `>=1.4` which does not exist yet (current release is 1.1.0), causing a guaranteed CI
dependency resolution failure. Three warnings cover the missing `uv.lock` commit
instruction in CI, a silent-failure exit path in `__main__.py`, and ruff missing the `S`
(bandit/security) ruleset for a security-facing project.

---

## Critical Issues

### CR-01: `pytest-asyncio` pinned to non-existent version — CI will fail to resolve

**File:** `pyproject.toml:23`
**Issue:** The dev dependency is `pytest-asyncio>=1.4`. The latest released version of
`pytest-asyncio` as of 2026-06-01 is **1.1.0** (confirmed in CLAUDE.md stack table).
No `>=1.4` release exists. `uv sync --frozen` in CI will fail with an unsatisfiable
dependency error the first time the lockfile is generated, and any fresh install without a
lockfile will also fail. This blocks every CI gate.
**Fix:**
```toml
# pyproject.toml — [dependency-groups] dev
"pytest-asyncio>=1.1,<2",
```

---

### CR-02: Unpinned/mutable GitHub Actions — supply-chain risk

**File:** `.github/workflows/ci.yml:17,21,25`
**Issue:** Three actions use floating major-version tags (`@v4`, `@v5`) rather than
pinned SHA digests. Additionally, `setup-uv` is configured with `version: "latest"`,
meaning the uv binary fetched in CI is unversioned and can change between runs.

- `actions/checkout@v4` — mutable tag, any pushed commit to that tag rewrites the
  action code executed against this repo's secrets
- `astral-sh/setup-uv@v5` with `version: "latest"` — doubly unpinned: the action tag
  AND the uv binary version float
- `actions/setup-python@v5` — mutable tag

For a project whose CLAUDE.md explicitly calls out supply-chain discipline, floating
action tags are a blocker: a compromised tag can exfiltrate PYPI_TOKEN or
GITHUB_TOKEN at publish time.
**Fix:**
```yaml
# Pin each action to a specific commit SHA, e.g.:
- uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683  # v4.2.2
- uses: astral-sh/setup-uv@f0ec1fc3b38f5e7cd731bb6ce540c5af426746bb  # v5.4.0
  with:
    version: "0.7.8"   # pin uv binary version explicitly
- uses: actions/setup-python@a26af69be951a213d495a4c3e4e4022e16d87065  # v5.6.0
```
Use `gh api repos/{owner}/{repo}/git/refs/tags/{tag}` to resolve current SHAs.

---

## Warnings

### WR-01: `uv.lock` not staged/committed in CI — lockfile discipline breach

**File:** `.github/workflows/ci.yml:30`
**Issue:** The workflow runs `uv sync --frozen --dev` which requires a committed
`uv.lock`. The `--frozen` flag will abort if the lockfile is absent or out of sync — that
is correct behaviour. However, neither the CI workflow nor any documented step ensures the
`uv.lock` file is generated and committed before CI runs. If a developer adds a
dependency and forgets to commit `uv.lock`, CI fails with a cryptic resolver error rather
than a clear message. Per project rule (`lockfile-discipline.md`), `uv.lock` must be
committed alongside `pyproject.toml` changes. There is no CI check asserting the lockfile
is present and consistent. A `uv lock --check` step before `uv sync` would surface the
mismatch explicitly.
**Fix:**
```yaml
- name: Verify lockfile is up to date
  run: uv lock --check
```
Add this step immediately before the "Install dependencies" step.

---

### WR-02: `__main__.py` exits with code 1 on bare invocation — unfriendly and potentially test-breaking

**File:** `src/godoo_mcp_server/__main__.py:13-14`
**Issue:** When invoked as `python -m godoo_mcp_server` with no arguments, the process
prints a guidance message then exits with code **1** (error). Exit code 1 on a
"help/informational" path is semantically wrong: exit code 1 conventionally means a
runtime error, not "no arguments provided". Any script or CI step that probes the
entrypoint without `--version` will interpret the non-zero exit as a build failure. The
correct exit code for "no action requested" is **0**, or alternatively the code should
print proper `--help` output.
**Fix:**
```python
# Option A — exit 0 for the informational path
print("godoo-mcp-server: use --version or start the MCP server (Phase 2+)")
sys.exit(0)

# Option B — raise SystemExit with argparse in Phase 2;
# for now, just drop the sys.exit(1) or replace with sys.exit(0)
```

---

### WR-03: Ruff lint ruleset omits security rules (`S`) for a security-sensitive project

**File:** `pyproject.toml:31`
**Issue:** The selected ruff rule groups are `["E", "F", "I", "UP", "B", "SIM", "TCH"]`.
The `S` ruleset (flake8-bandit equivalents: hardcoded passwords, `assert` misuse,
subprocess injection, `eval` usage, etc.) is absent. For a project whose CLAUDE.md
explicitly calls out security constraints (no direct network in sandbox, audit logging,
allowlisted Odoo RPC only), omitting `S` means security anti-patterns will not be caught
at lint time in future waves when actual server/sandbox code is added. Adding it now to
the scaffold ensures the gate is in place before it matters.
**Fix:**
```toml
# pyproject.toml [tool.ruff.lint]
select = ["E", "F", "I", "UP", "B", "SIM", "TCH", "S"]
```

---

## Info

### IN-01: `pre-commit` config covers only ruff — mypy not enforced pre-commit

**File:** `.pre-commit-config.yaml:1-8`
**Issue:** The pre-commit config runs `ruff` (lint + format) but not `mypy`. CI runs
`mypy --strict src/` as a gate, but a developer can commit code that fails mypy without
local feedback until CI runs. For a project with `strict = true` mypy config, adding a
pre-commit mypy hook aligns local dev with CI. This is a quality-of-life gap, not a
blocker, since CI is the authoritative gate.
**Fix:**
```yaml
  - repo: https://github.com/pre-commit/mirrors-mypy
    rev: v1.16.0   # pin to match installed mypy>=2.1 when available
    hooks:
      - id: mypy
        args: [--strict, src/]
        additional_dependencies: ["godoo-client>=0.2,<0.3"]
```
Note: `mirrors-mypy` lags behind upstream releases; evaluate whether running mypy via
`repo: local` with `uv run mypy` is more reliable.

---

_Reviewed: 2026-06-01T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
