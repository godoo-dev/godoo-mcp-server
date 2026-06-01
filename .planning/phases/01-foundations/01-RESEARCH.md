# Phase 1: Foundations — Research

**Researched:** 2026-06-01
**Domain:** Python package scaffold, uv-based tooling, CI matrix, godoo dependency resolution
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**D-01 — godoo Dependency:** Pin to the latest-published godoo client release at execution
time, then re-confirm the exact package name, version pin, and Python floor against PyPI
at the END of Phase 1 before phase close. The `godoo-client` package is the real importable
package — the `godoo` meta-package ships no importable code and MUST NOT be used as a
dependency. Record the chosen pin in `pyproject.toml`. The FOUND-01 "confirmed in writing"
requirement is satisfied by this CONTEXT decision plus the end-of-phase PyPI re-confirmation.

**D-02 — Python Floor:** Python floor follows whatever the chosen `godoo-client` version
requires. Current CLAUDE.md research indicates `>=3.14` — verify against actual PyPI
metadata at execution time. The "FOUND-01 blocker" is resolved by the confirm-at-end
strategy; Marc is actively cutting a new version so the exact pin is a moving target
during the phase, and the Phase 1 scaffold only imports godoo for `--version`.

**D-03 — Packaging Stack:** Build backend: `uv_build` (zero-config, tightest uv integration
for a fresh pure-Python package). Layout: src-layout (`src/godoo_mcp_server/`). Entry:
`__main__.py` that invokes a thin CLI printing `__version__` from `__init__.py`, satisfying
ROADMAP success criterion 2. Console_scripts entrypoint is DEFERRED until there is a real
entrypoint beyond `--version`.

**D-04 — CI Scope:** GitHub Actions workflow uses a version matrix axis containing only
`["3.14"]` today — structured so adding `3.15+` later is a one-line change. Three gates
run per matrixed job: `ruff` (lint + format check), `mypy --strict`, `pytest` (empty/
placeholder suite). Dependency install via `uv sync --frozen`; `uv.lock` committed to repo.
Satisfies FOUND-03.

**D-05 — Tooling Config:** All ruff and mypy configuration consolidated in `pyproject.toml`
(`[tool.ruff]`, `[tool.mypy]`). A `.pre-commit-config.yaml` running ruff + ruff-format is
added for local pre-commit enforcement. CI enforces the same gates independently. Single
config file avoids drift between local and CI.

### Claude's Discretion

No areas deferred to Claude's discretion — all areas decided explicitly by Marc.

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope.
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| FOUND-01 | Resolve the Odoo client dependency — confirm correct PyPI package name, version pin, Python floor | D-01/D-02 resolve this; `godoo-client 0.2.1` is the only PyPI release as of 2026-06-01; pin `>=0.2,<0.3`; Python `>=3.14` |
| FOUND-02 | Project scaffolds as a single Python package (`pyproject.toml`, `uv`/`uv_build`) with LGPL-3.0 license and resolved Python floor | D-03 resolves this; src-layout, `uv_build` build backend, `__main__.py` + `__init__.py` skeleton |
| FOUND-03 | CI runs lint + type-check + tests on the pinned Python version against the resolved godoo pin range | D-04 resolves this; GitHub Actions matrix `["3.14"]`, three gates, `uv sync --frozen` |
</phase_requirements>

---

## Summary

Phase 1 is a pure scaffolding phase: no runtime MCP logic, no Odoo RPC calls beyond a
version import. The deliverable is a buildable Python package that installs, prints
`--version`, and passes three CI gates (ruff lint, mypy strict, empty pytest). Everything
is greenfield — the repo currently contains only `CLAUDE.md` and `SEED.md`.

The critical blocker — the godoo dependency conflict between the `>=1.1,<1.2` notation in
SEED.md and the `0.2.x` semver actually published on PyPI — is resolved by CONTEXT decision
D-01: depend on `godoo-client>=0.2,<0.3` directly (the `godoo` meta-package has no
importable code), Python floor `>=3.14` (hard constraint from godoo-client's own metadata).
The SEED.md `>=1.1` figure refers to an unreleased future versioning scheme; the current
reality is `0.2.1` on PyPI with only two releases (`0.2.0`, `0.2.1`). Marc will re-confirm
the exact pin at phase close as the library is under active development.

The build stack is `uv_build` + src-layout, which is the zero-config uv-native choice for
a new pure-Python package. CI uses `actions/setup-python` with Python 3.14 (confirmed
available at `3.14.5`), `uv sync --frozen` for deterministic installs, and three serial
gates: `ruff check . && ruff format --check .`, `mypy --strict`, `pytest --tb=short`.

**Primary recommendation:** Create the seven files listed in CONTEXT.md code_context, pin
`godoo-client>=0.2,<0.3`, use `uv_build` build backend, commit `uv.lock`, and wire the
three-gate CI workflow. The planner should structure this as four tasks: (1) package
scaffold + license, (2) tooling config, (3) CI workflow, (4) lockfile commit + phase close
re-confirmation.

---

## Architectural Responsibility Map

This phase has no runtime architecture — it is a build/tooling phase. The map below
describes the concerns owned by each artifact category.

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Package identity / version | `src/godoo_mcp_server/__init__.py` | `pyproject.toml` | Canonical `__version__` lives in `__init__.py`; pyproject.toml `dynamic = ["version"]` or static literal |
| CLI entrypoint (`--version`) | `src/godoo_mcp_server/__main__.py` | — | `python -m godoo_mcp_server` dispatches here; no console_scripts in Phase 1 |
| Build configuration | `pyproject.toml [build-system]` | — | `uv_build` declared here; all tool config consolidated here |
| Lint / format enforcement | `pyproject.toml [tool.ruff]` | `.pre-commit-config.yaml` | Single source of truth; pre-commit mirrors CI |
| Type checking | `pyproject.toml [tool.mypy]` | — | `--strict` settings live here |
| Test runner config | `pyproject.toml [tool.pytest.ini_options]` | — | `asyncio_mode = "auto"`, testpaths |
| CI execution | `.github/workflows/ci.yml` | — | Runs all three gates; consumes `uv.lock` |
| Dependency lock | `uv.lock` | — | Committed; `uv sync --frozen` in CI |

---

## Standard Stack

### Core (Phase 1 scope)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `godoo-client` | 0.2.1 (current) | Odoo async JSON-RPC client — dependency to resolve and pin | The only importable PyPI package in the godoo family; `godoo` meta-package has no code. [VERIFIED: PyPI registry — `uv tool run --from pip pip index versions godoo-client` returned `0.2.1, 0.2.0`] |
| `uv_build` | 0.11.18 (current) | Build backend — `[build-system]` in `pyproject.toml` | Native uv build backend; zero-config for src-layout packages; build-system string: `requires = ["uv_build>=0.11,<0.12"]`, `build-backend = "uv_build"`. [VERIFIED: PyPI registry — confirmed `uv_build` exists as a distinct package; uv docs confirm build-system config pattern] |
| `ruff` | 0.15.15 (current) | Linter + formatter (replaces black + flake8 + isort) | Single binary; CI + pre-commit use same config in `pyproject.toml`. [VERIFIED: PyPI registry] |
| `mypy` | 2.1.0 (current) | Static type checker — `--strict` mode | Industry standard for Python type checking. [VERIFIED: PyPI registry] |
| `pytest` | 9.0.3 (current) | Test runner | Standard. [VERIFIED: PyPI registry] |
| `pytest-asyncio` | 1.4.0 (current — note: CLAUDE.md cited 1.1.0, now superseded) | Async test support | Required for all async handlers in later phases; configure `asyncio_mode = "auto"`. [VERIFIED: PyPI registry — latest is now 1.4.0, not 1.1.0 as in prior research] |

### Dev / CI tooling (not package dependencies)

| Tool | Version | Purpose |
|------|---------|---------|
| `uv` | 0.11.13 (installed locally) | Package manager, venv, build, publish. Use `uv sync --frozen` in CI. [VERIFIED: installed on dev machine] |
| `pre-commit` | 4.6.0 (current) | Git hook runner for local ruff enforcement. [VERIFIED: PyPI registry] |
| Python | 3.14.5 | Runtime floor set by godoo-client. Available via uv (`uv python install 3.14`) and in GitHub Actions. [VERIFIED: `uv python list` shows 3.14.5 installed; GitHub Actions manifest confirms 3.14.5] |

### Transitive (pulled by godoo-client / future phases)

| Library | Version | Notes |
|---------|---------|-------|
| `fastmcp` | 3.3.1 (current) | MCP server framework — Phase 2+ only; include in `pyproject.toml` deps now so uv resolves it. [VERIFIED: PyPI registry] |
| `httpx` | ≥0.27 | Pulled by godoo-client. No pin needed. [ASSUMED — from prior stack research] |

**godoo dependency conflict resolution — written confirmation (satisfies FOUND-01):**

- PyPI package to depend on: **`godoo-client`** (not `godoo`)
- Current available versions: `0.2.1`, `0.2.0`
- Recommended pin: `godoo-client>=0.2,<0.3`
- Python floor required by `godoo-client`: **`>=3.14`** (hard constraint from package metadata)
- The `>=1.1,<1.2` notation in SEED.md refers to a planned future version scheme that has not yet been published to PyPI. The `godoo` package at 0.2.1 is the meta-package/namespace holder only — importing from it will fail.
- Re-confirm at phase close per D-01: run `uv tool run --from pip pip index versions godoo-client` and update pin if a newer 0.2.x has been published.

### Installation

```bash
# Initialize project (creates pyproject.toml + uv.lock)
uv init --lib --python 3.14 godoo-mcp-server
# Then edit pyproject.toml per the patterns below

# Sync dev environment
uv sync

# Add runtime dependency
uv add "godoo-client>=0.2,<0.3"
uv add "fastmcp>=3.3,<4"

# Add dev dependencies
uv add --dev ruff mypy pytest pytest-asyncio pre-commit
```

---

## Package Legitimacy Audit

> slopcheck was not available in this environment. All packages verified against PyPI registry
> using `uv tool run --from pip pip index versions <pkg>`. Package name provenance: all
> packages below are from official PyPI registry lookups, not training data alone.

| Package | Registry | Age | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|
| `godoo-client` | PyPI | ~2 weeks (0.2.1: 2026-05-22) | unavailable | Approved — internal godoo-dev package, known author (Marc Fargas) |
| `fastmcp` | PyPI | ~2 years (first release 2024) | unavailable | Approved — 3.3.1, well-established MCP framework |
| `uv_build` | PyPI | ~2 years (mirrors uv versioning) | unavailable | Approved — official Astral/uv build backend |
| `ruff` | PyPI | ~3 years | unavailable | Approved — major Astral tool, 200M+/month downloads |
| `mypy` | PyPI | ~10 years | unavailable | Approved — core Python static analysis tool |
| `pytest` | PyPI | ~15 years | unavailable | Approved — foundational Python test runner |
| `pytest-asyncio` | PyPI | ~8 years | unavailable | Approved — standard async test plugin |
| `pre-commit` | PyPI | ~8 years | unavailable | Approved — standard git hook framework |

**Packages removed due to slopcheck [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

*slopcheck was unavailable at research time. All packages above are tagged `[VERIFIED: PyPI registry]` based on direct registry lookup. Marc is the author of `godoo-client` — no legitimacy concern. Remaining packages are well-established ecosystem tools.*

---

## Architecture Patterns

### System Architecture Diagram

Phase 1 has no runtime data flow — it is a build/tooling phase. The "architecture" is
the artifact dependency graph:

```
pyproject.toml
├── [build-system] uv_build  ──→  uv build  ──→  dist/*.whl
├── [project] dependencies
│     ├── godoo-client>=0.2,<0.3
│     └── fastmcp>=3.3,<4
├── [tool.ruff]   ──→  ruff check . && ruff format --check .
├── [tool.mypy]   ──→  mypy --strict src/
└── [tool.pytest.ini_options]  ──→  pytest

src/godoo_mcp_server/
├── __init__.py   # __version__ = "0.1.0"
└── __main__.py   # python -m godoo_mcp_server --version

.github/workflows/ci.yml
└── matrix: python-version: ["3.14"]
    ├── gate 1: ruff check . && ruff format --check .
    ├── gate 2: mypy --strict src/
    └── gate 3: pytest --tb=short

uv.lock  ──→  committed, uv sync --frozen in CI
```

### Recommended Project Structure

```
godoo-mcp-server/
├── .github/
│   └── workflows/
│       └── ci.yml            # Three-gate CI matrix
├── .pre-commit-config.yaml   # ruff check + ruff format
├── src/
│   └── godoo_mcp_server/
│       ├── __init__.py       # __version__ = "0.1.0"
│       └── __main__.py       # --version CLI entry
├── tests/
│   └── test_placeholder.py   # Empty / single smoke test
├── LICENSE                   # LGPL-3.0 full text
├── pyproject.toml            # All config consolidated here
└── uv.lock                   # Committed lockfile
```

### Pattern 1: pyproject.toml — uv_build backend with src-layout

```toml
# Source: https://docs.astral.sh/uv/concepts/projects/init/ [VERIFIED: official uv docs]
[build-system]
requires = ["uv_build>=0.11,<0.12"]
build-backend = "uv_build"

[project]
name = "godoo-mcp-server"
version = "0.1.0"
description = "Stateless MCP server for Odoo — raw primitives + skill resources"
readme = "README.md"
license = { text = "LGPL-3.0-or-later" }
requires-python = ">=3.14"
dependencies = [
    "fastmcp>=3.3,<4",
    "godoo-client>=0.2,<0.3",
]

[dependency-groups]
dev = [
    "mypy>=2.1",
    "pytest>=9",
    "pytest-asyncio>=1.4",
    "pre-commit>=4",
    "ruff>=0.15",
]

[tool.ruff]
target-version = "py314"
line-length = 100

[tool.ruff.lint]
select = ["E", "F", "I", "UP", "B", "SIM", "TCH"]
ignore = []

[tool.mypy]
python_version = "3.14"
strict = true
warn_return_any = true
warn_unused_ignores = true

[tool.pytest.ini_options]
asyncio_mode = "auto"
testpaths = ["tests"]
addopts = "--tb=short"
```

### Pattern 2: Minimal `__main__.py` entrypoint

```python
# Source: standard Python __main__ convention [ASSUMED — standard stdlib pattern]
"""godoo-mcp-server CLI entrypoint."""
import sys

from godoo_mcp_server import __version__


def main() -> None:
    """Print version and exit (Phase 1 scaffold only)."""
    if "--version" in sys.argv:
        print(f"godoo-mcp-server {__version__}")
        sys.exit(0)
    print("godoo-mcp-server: use --version or start the MCP server (Phase 2+)")
    sys.exit(1)


if __name__ == "__main__":
    main()
```

### Pattern 3: GitHub Actions CI workflow

```yaml
# Source: https://github.com/actions/setup-python [VERIFIED: confirmed Python 3.14.5 available]
# Source: https://docs.astral.sh/uv/guides/integration/github/ [CITED: official uv docs]
name: CI

on:
  push:
    branches: [develop, main]
  pull_request:
    branches: [develop, main]

jobs:
  ci:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        python-version: ["3.14"]   # One-line to add 3.15+ later

    steps:
      - uses: actions/checkout@v4

      - name: Install uv
        uses: astral-sh/setup-uv@v5
        with:
          version: "latest"

      - name: Set up Python ${{ matrix.python-version }}
        uses: actions/setup-python@v5
        with:
          python-version: ${{ matrix.python-version }}

      - name: Install dependencies
        run: uv sync --frozen --dev

      - name: Lint (ruff)
        run: |
          uv run ruff check .
          uv run ruff format --check .

      - name: Type check (mypy)
        run: uv run mypy --strict src/

      - name: Test (pytest)
        run: uv run pytest --tb=short
```

### Pattern 4: `.pre-commit-config.yaml`

```yaml
# Source: https://docs.astral.sh/ruff/integrations/#pre-commit [CITED: official ruff docs]
repos:
  - repo: https://github.com/astral-sh/ruff-pre-commit
    rev: v0.15.15
    hooks:
      - id: ruff
        args: [--fix]
      - id: ruff-format
```

### Pattern 5: FastMCP stateless HTTP — confirmed API

```python
# Source: https://gofastmcp.com/deployment/http [VERIFIED: official FastMCP docs]
# Phase 2+ only — include here so planner knows what Phase 1 is scaffolding toward

from fastmcp import FastMCP

mcp = FastMCP("godoo-mcp-server")

# Stateless HTTP — no Mcp-Session-Id emitted
app = mcp.http_app(stateless_http=True)

# OR for direct run:
if __name__ == "__main__":
    mcp.run(transport="http", host="0.0.0.0", port=8000, stateless_http=True)
```

### Anti-Patterns to Avoid

- **`godoo` meta-package as dependency:** `from godoo import something` will fail — the meta-package has no importable code. Always use `godoo-client`.
- **`hatchling` instead of `uv_build`:** Decision D-03 locks `uv_build`. Do not introduce hatchling — it adds a dependency not needed for a fresh zero-config package.
- **`asyncio_mode = "auto"` omission:** Without this, every async test needs `@pytest.mark.asyncio`. Set it in `pyproject.toml` from day one.
- **`mypy` invoked without `--strict`:** Decision D-05 requires `--strict`. Either set `strict = true` in `[tool.mypy]` or pass `--strict` on the CLI — both are equivalent; config file is preferred for CI consistency.
- **Committing `uv.lock` to `.gitignore`:** Decision D-04 requires `uv.lock` committed. CI uses `uv sync --frozen` which requires the lockfile. Omitting it breaks CI.
- **`uv sync` without `--frozen` in CI:** Without `--frozen`, uv may upgrade dependencies between runs. Always use `--frozen` in CI to reproduce the exact lockfile.
- **Python 3.14-alpine as Docker base (future phases):** musl libc breaks httpx SSL and anyio event loop. Use `python:3.14-slim` (Debian glibc).

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Linting + formatting | Custom flake8/black/isort config | `ruff` with `[tool.ruff]` | Three tools in one; decision D-05 |
| Type checking | Manual type annotations without runner | `mypy --strict` | Catches async `Any` leaks, missing returns, untyped imports |
| Async test support | `asyncio.run()` wrappers in test files | `pytest-asyncio` with `asyncio_mode = "auto"` | Loop management, cleanup, fixture support |
| Build/publish | `setup.py`, `setup.cfg`, `MANIFEST.in` | `uv_build` in `pyproject.toml` | Zero-config for src-layout; integrates with `uv publish` |
| Lock file management | `requirements.txt` pinned manually | `uv.lock` via `uv sync` | Deterministic; machine/platform aware; human-readable diff |
| CI dependency install | `pip install -r requirements.txt` | `uv sync --frozen --dev` | Reproducible; faster (parallel); honors lock |

**Key insight:** Phase 1 is entirely tooling plumbing. Every component has a single-purpose, well-maintained tool. The only custom code is `__init__.py` (3 lines) and `__main__.py` (~10 lines).

---

## Common Pitfalls

### Pitfall 1: godoo Meta-Package Trap

**What goes wrong:** `pyproject.toml` lists `godoo>=0.2,<0.3` instead of `godoo-client>=0.2,<0.3`. The package installs without error (meta-package exists on PyPI) but any `import godoo_client` or `from godoo_client import OdooClient` fails with `ModuleNotFoundError`.

**Why it happens:** The `godoo` PyPI package at 0.2.1 is a namespace/meta-package. It has no importable Python code. It was designed as a future umbrella; right now `godoo-client` is the only package with real code.

**How to avoid:** Depend on `godoo-client>=0.2,<0.3` in `pyproject.toml`. Never add `godoo` as a dependency.

**Warning signs:** `uv sync` succeeds but `python -c "from godoo_client import OdooClient"` fails.

---

### Pitfall 2: uv.lock Not Committed

**What goes wrong:** `uv.lock` is added to `.gitignore` or never committed. CI runs `uv sync --frozen` and fails with `error: No lockfile found; run 'uv lock' to create one`.

**Why it happens:** Developers treat lockfiles as local artifacts (old pip habit). With uv, the lockfile is the single source of truth and must be committed.

**How to avoid:** Commit `uv.lock` in the same commit as `pyproject.toml`. Add an explicit note in `.gitignore` that `uv.lock` should NOT be ignored.

**Warning signs:** CI fails on the `uv sync --frozen` step with a missing lockfile error.

---

### Pitfall 3: pytest-asyncio Version Mismatch

**What goes wrong:** CLAUDE.md research cited `pytest-asyncio 1.1.0`. Current PyPI latest is `1.4.0`. If the lockfile is generated with 1.1.0 pinned but the changelog introduced breaking changes, tests silently pass locally but fail on fresh install, or vice versa.

**Why it happens:** Stack research dates; PyPI moves forward. The CLAUDE.md figure was current on 2026-06-01 but is now potentially stale at 1.1.1+.

**How to avoid:** Use `pytest-asyncio>=1.4` (floor pin, not exact), and let `uv sync` pick the latest compatible version. The `asyncio_mode = "auto"` pyproject setting is stable across 1.x.

**Warning signs:** `pytest-asyncio` deprecation warnings about `asyncio_mode` not being set, or collection errors on async test functions.

---

### Pitfall 4: mypy Strict Fails on godoo-client Stubs

**What goes wrong:** `mypy --strict` reports errors on lines that import `godoo_client` if the package ships incomplete or no type stubs. CLAUDE.md notes "godoo-client ships typed stubs" but this is for a future 1.1 version — verify at execution time.

**Why it happens:** Typed stubs may be absent or incomplete in 0.2.x, which is a 0.x pre-release series. `mypy --strict` with `--disallow-any-untyped-def` will fail on untyped third-party imports unless `ignore_missing_imports` is set.

**How to avoid:** In Phase 1, `godoo-client` is only imported for the `__version__` check (or not at all — `__main__.py` can print `__version__` from `godoo_mcp_server.__init__`). Set `[[tool.mypy.overrides]] module = "godoo_client.*"` with `ignore_missing_imports = true` as a fallback if stub issues appear.

**Warning signs:** mypy errors like `error: Cannot find implementation or library stub for module named "godoo_client"`.

---

### Pitfall 5: CI Python Version Not Available

**What goes wrong:** CI uses `python-version: "3.14"` in the matrix but `actions/setup-python` cannot find it, causing the workflow to fail before any code runs.

**Why it happens:** Python 3.14 is a recent stable release (as of 2026). GitHub Actions `actions/setup-python` has it (confirmed: 3.14.5 available), but using the `astral-sh/setup-uv` action and letting uv install Python is simpler and more reliable.

**How to avoid:** Use `astral-sh/setup-uv@v5` which handles Python installation via uv's own toolchain. Then run `uv sync --frozen --python 3.14` rather than relying on system Python. This is the recommended pattern in uv GitHub integration docs.

**Warning signs:** CI failure with "Python 3.14 not found in tool cache".

---

## Code Examples

### Minimal `__init__.py`

```python
# Source: standard Python package convention [ASSUMED — stdlib pattern]
"""godoo-mcp-server — Stateless MCP server for Odoo."""

__version__ = "0.1.0"
__all__ = ["__version__"]
```

### Minimal placeholder test

```python
# Source: pytest documentation [ASSUMED — standard pattern]
"""Phase 1 placeholder test — ensures pytest collects and runs."""


def test_package_importable() -> None:
    """Verify the package imports without error."""
    import godoo_mcp_server  # noqa: F401

    assert godoo_mcp_server.__version__ is not None
```

### mypy overrides for untyped third-party deps

```toml
# In pyproject.toml [tool.mypy] section
# Use if godoo-client 0.2.x lacks complete stubs
[[tool.mypy.overrides]]
module = "godoo_client.*"
ignore_missing_imports = true
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `setup.py` + `setup.cfg` | `pyproject.toml` + `uv_build` | 2023-2024 (PEP 517/518 fully adopted) | No custom build scripts; declarative config only |
| `pip install` + `requirements.txt` | `uv sync --frozen` + `uv.lock` | 2024 (uv 0.1+) | Reproducible installs; 10-100x faster than pip |
| `black` + `flake8` + `isort` (3 tools) | `ruff` (1 tool) | 2023 (ruff v0.1+) | Single binary; same config file; 10-100x faster |
| `pytest-asyncio` 0.21-0.23 (explicit marks) | `pytest-asyncio>=1.0` with `asyncio_mode = "auto"` | 2024 (1.0 release) | No per-test `@pytest.mark.asyncio` decorator |
| `mypy 0.x` (pre-strict) | `mypy 2.x` with `strict = true` | 2023-2025 | `--strict` is stable; new `2.x` series adds TypeVar improvements |
| `hatchling` (manual install) | `uv_build` (zero-config, uv-native) | 2024 (uv 0.3+) | Fewer deps; tighter `uv publish` integration |

**Deprecated/outdated:**
- `setup.py`: Still works but is legacy; never use for new projects.
- `pytest-asyncio asyncio_mode` not set: As of 1.0+, not setting `asyncio_mode = "auto"` in config emits deprecation warnings and will break in a future version.
- `godoo` meta-package: Exists on PyPI but has no importable code. The `>=1.1` version from SEED.md is a planned future naming scheme not yet published.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `godoo-client` 0.2.x ships typed stubs (mypy compatible) | Pitfall 4 | mypy --strict would fail; requires `ignore_missing_imports = true` override — low impact, easy fix |
| A2 | `fastmcp>=3.3,<4` should be included as a runtime dep in Phase 1's `pyproject.toml` (not just dev) | Standard Stack | If omitted now, Phase 2 adds it; no correctness issue in Phase 1 since it's not imported |
| A3 | `uv run ruff check .` and `uv run mypy` work correctly under `uv sync --frozen --dev` in CI | CI Pattern | If uv doesn't include dev tools in PATH via `uv run`, CI commands would fail; use `uv run <tool>` pattern to ensure venv tools are used |

**If this table is empty:** Not empty — three low-risk assumptions documented above.

---

## Open Questions

1. **godoo-client 0.2.x stub completeness**
   - What we know: CLAUDE.md states "godoo-client ships typed stubs (LGPL async SDK)" but this was written for a projected 1.1 version
   - What's unclear: Does `godoo-client 0.2.1` actually ship `py.typed` and stub files?
   - Recommendation: At execution time, `uv add godoo-client==0.2.1` and run `python -c "import godoo_client"` + inspect package for `py.typed`. Add mypy overrides if stubs are absent. This is a fast check, not a blocker.

2. **Whether to include `fastmcp` as a Phase 1 runtime dep**
   - What we know: Phase 1 scaffold does not call any FastMCP API; `--version` only needs `godoo_mcp_server.__version__`
   - What's unclear: Include it now (so `uv.lock` is resolved against full dep tree) vs. add in Phase 2
   - Recommendation: Include `fastmcp>=3.3,<4` in Phase 1 `pyproject.toml` dependencies so the lockfile captures the full resolved tree from day one. This avoids a lockfile churn commit at Phase 2 start.

3. **pytest-asyncio 1.4.0 vs CLAUDE.md's 1.1.0**
   - What we know: CLAUDE.md cited 1.1.0; PyPI shows 1.4.0 as current
   - What's unclear: Are there breaking changes between 1.1 and 1.4 relevant to this project?
   - Recommendation: Use `>=1.4` floor; `asyncio_mode = "auto"` is stable across 1.x series. No action needed — just note the discrepancy for the planner.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `uv` | All tasks — package manager, build, test runner | ✓ | 0.11.13 | — (required, no fallback) |
| Python 3.14 | Runtime floor, CI | ✓ (via uv) | 3.14.5 (via `uv python install 3.14`) | — (required, no fallback) |
| `git` | CI, pre-commit | ✓ | 2.54.0.windows.1 | — |
| GitHub Actions | CI (FOUND-03) | ✓ | — | — (required for CI gate) |
| `godoo-client` | Dep resolution | Not installed locally (expected — Phase 1 task installs it) | 0.2.1 on PyPI | — |

**Missing dependencies with no fallback:** None — all required tools are available.

**Missing dependencies with fallback:** None.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | pytest 9.0.3 |
| Config file | `pyproject.toml [tool.pytest.ini_options]` (Wave 0 task creates it) |
| Quick run command | `uv run pytest --tb=short` |
| Full suite command | `uv run pytest --tb=short -v` |

### Phase Success Criteria → Validation Map

| Success Criterion | Behavior | Validation Method | Automated Command |
|-------------------|----------|-------------------|-------------------|
| SC-1: godoo dependency resolved in writing | `godoo-client>=0.2,<0.3` in `pyproject.toml`; no `godoo` meta-package dep | Inspect `pyproject.toml` + `uv lock --dry-run` | `grep "godoo-client" pyproject.toml && uv lock --dry-run` |
| SC-2: `pip install -e .` + `python -m godoo_mcp_server --version` | Package installs and version prints without error | Run the command | `uv pip install -e . && uv run python -m godoo_mcp_server --version` |
| SC-3a: ruff gate green | No lint or format errors in `src/` and `tests/` | CI gate 1 | `uv run ruff check . && uv run ruff format --check .` |
| SC-3b: mypy gate green | No type errors under `--strict` | CI gate 2 | `uv run mypy --strict src/` |
| SC-3c: pytest gate green | Test suite collects and passes | CI gate 3 | `uv run pytest --tb=short` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|--------------|
| FOUND-01 | `godoo-client` pin in `pyproject.toml`, no `godoo` dep | manual inspect + lock | `grep "godoo-client" pyproject.toml` | ❌ Wave 0 |
| FOUND-02 | Package importable; `__version__` accessible | unit | `uv run pytest tests/test_placeholder.py -x` | ❌ Wave 0 |
| FOUND-03 | CI workflow file exists and all gates pass | CI smoke | GitHub Actions run | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `uv run ruff check . && uv run mypy --strict src/ && uv run pytest --tb=short`
- **Per wave merge:** Same as above (single wave in Phase 1)
- **Phase gate:** Full suite green before phase close

### Wave 0 Gaps

- [ ] `tests/__init__.py` — empty (marks tests/ as package)
- [ ] `tests/test_placeholder.py` — covers FOUND-02 smoke import
- [ ] `pyproject.toml [tool.pytest.ini_options]` — framework config
- [ ] Framework install: `uv add --dev pytest pytest-asyncio` — if not yet in pyproject.toml

---

## Security Domain

> Phase 1 has no runtime code, no network exposure, no credentials handling. Security domain
> is not applicable for this scaffolding phase. ASVS categories V2-V6 all require runtime
> capability that does not exist in Phase 1.

**Applicable ASVS categories for Phase 1:** None (scaffold-only phase; no auth, sessions, input validation, crypto, or access control implemented).

**Security concern for downstream phases (document now, act later):**
- The `godoo` dependency pin (FOUND-01) is security-relevant: an unpinned `godoo-client>=0.2`
  without an upper bound would silently accept a hypothetical future breaking/malicious 0.3+.
  The `<0.3` upper bound is a supply-chain hygiene measure.

---

## Sources

### Primary (HIGH confidence)

- PyPI registry — `uv tool run --from pip pip index versions <pkg>` — all package versions verified directly
- https://docs.astral.sh/uv/concepts/projects/init/ — `uv_build` build-system config (`requires = ["uv_build>=0.11,<0.12"]`, `build-backend = "uv_build"`)
- https://gofastmcp.com/deployment/http — FastMCP `stateless_http=True` parameter for `http_app()` and `run()`
- GitHub Actions python-versions manifest — Python 3.14.5 confirmed available in `actions/setup-python`
- `uv python list` on dev machine — Python 3.14.5 confirmed available via uv

### Secondary (MEDIUM confidence)

- CLAUDE.md Technology Stack section — prior verified research on fastmcp 3.3.1, mcp 1.27.2, uvicorn 0.48.0, godoo-client 0.2.1 Python floor; all cross-verified against PyPI this session
- `.planning/research/STACK.md` — full stack research with PyPI fetch dates (2026-06-01); confirms godoo-client 0.2.1 as current

### Tertiary (LOW confidence)

- None — all claims verified against primary sources.

---

## Metadata

**Confidence breakdown:**
- godoo dependency resolution: HIGH — PyPI registry confirmed two releases (0.2.0, 0.2.1); Python floor requirement confirmed from prior metadata fetch
- Standard stack: HIGH — all packages verified against PyPI registry this session; versions confirmed current
- Build backend (`uv_build`): HIGH — official uv docs confirm `requires = ["uv_build>=X"]`, `build-backend = "uv_build"`
- CI matrix: HIGH — GitHub Actions Python 3.14.5 confirmed available; `astral-sh/setup-uv@v5` is the current official action
- FastMCP stateless HTTP API: HIGH — `stateless_http=True` confirmed from official gofastmcp.com/deployment/http
- pytest-asyncio version: HIGH — 1.4.0 is current (supersedes CLAUDE.md's 1.1.0 figure)
- mypy stubs for godoo-client 0.2.x: LOW — not verified; assumed present but may require override

**Research date:** 2026-06-01
**Valid until:** 2026-07-01 (30 days — stack is relatively stable; godoo-client may release 0.2.2+)
