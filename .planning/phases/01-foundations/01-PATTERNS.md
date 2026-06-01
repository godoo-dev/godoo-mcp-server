# Phase 1: Foundations - Pattern Map

**Mapped:** 2026-06-01
**Files analyzed:** 8 (all new — greenfield phase)
**Analogs found:** 0 / 8 (no source code exists in repo yet)

---

## Greenfield Notice

This repository contains only `.planning/` docs, `CLAUDE.md`, and `SEED.md`. There are no
existing source files to use as analogs. Every pattern below is a **reference shape** drawn
from `01-RESEARCH.md` and `CLAUDE.md` — the authoritative sources the planner must follow.

---

## File Classification

| New File | Role | Data Flow | Closest Analog | Match Quality |
|----------|------|-----------|----------------|---------------|
| `pyproject.toml` | config | n/a | none in repo | no analog — use RESEARCH Pattern 1 |
| `src/godoo_mcp_server/__init__.py` | package | n/a | none in repo | no analog — use RESEARCH Code Examples |
| `src/godoo_mcp_server/__main__.py` | utility/entrypoint | request-response (CLI) | none in repo | no analog — use RESEARCH Pattern 2 |
| `tests/__init__.py` | test | n/a | none in repo | no analog — empty file |
| `tests/test_placeholder.py` | test | n/a | none in repo | no analog — use RESEARCH Code Examples |
| `LICENSE` | config | n/a | none in repo | no analog — use LGPL-3.0 canonical text |
| `.github/workflows/ci.yml` | config/CI | n/a | none in repo | no analog — use RESEARCH Pattern 3 |
| `.pre-commit-config.yaml` | config | n/a | none in repo | no analog — use RESEARCH Pattern 4 |

`uv.lock` is a generated artifact — not authored manually; `uv sync` produces it.

---

## Pattern Assignments

### `pyproject.toml` (config)

**No in-repo analog.** Use RESEARCH.md Pattern 1 verbatim.

**Reference shape** (RESEARCH.md lines 245-290):

```toml
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

**Critical decisions enforced here:**
- D-03: `build-backend = "uv_build"` — NOT hatchling, NOT poetry-core
- D-01: `godoo-client>=0.2,<0.3` — NOT `godoo` (meta-package, no importable code)
- D-05: All tool config (`[tool.ruff]`, `[tool.mypy]`, `[tool.pytest.ini_options]`) consolidated here
- D-04: `asyncio_mode = "auto"` set now — avoids per-test decorator boilerplate in all future phases

**mypy override to add if godoo-client 0.2.x lacks stubs** (RESEARCH.md lines 512-515):
```toml
[[tool.mypy.overrides]]
module = "godoo_client.*"
ignore_missing_imports = true
```
Add this block only if `uv run mypy --strict src/` fails with `Cannot find implementation or library stub for module named "godoo_client"`.

---

### `src/godoo_mcp_server/__init__.py` (package)

**No in-repo analog.** 3-line file — copy verbatim from RESEARCH.md Code Examples (lines 488-491):

```python
"""godoo-mcp-server — Stateless MCP server for Odoo."""

__version__ = "0.1.0"
__all__ = ["__version__"]
```

---

### `src/godoo_mcp_server/__main__.py` (utility/entrypoint, CLI)

**No in-repo analog.** Use RESEARCH.md Pattern 2 (lines 294-312):

```python
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

**Note:** D-03 defers `console_scripts` entry point — `__main__.py` is the only CLI surface in Phase 1. `python -m godoo_mcp_server --version` invokes this directly.

---

### `tests/__init__.py` (test)

Empty file. Marks `tests/` as a Python package so pytest discovers it under src-layout.

---

### `tests/test_placeholder.py` (test)

**No in-repo analog.** Use RESEARCH.md Code Examples (lines 498-507):

```python
"""Phase 1 placeholder test — ensures pytest collects and runs."""


def test_package_importable() -> None:
    """Verify the package imports without error."""
    import godoo_mcp_server  # noqa: F401

    assert godoo_mcp_server.__version__ is not None
```

This is deliberately synchronous — no `async def` — so it passes without triggering the `asyncio_mode = "auto"` machinery. It validates FOUND-02 (package importable, `__version__` accessible).

---

### `LICENSE` (config)

LGPL-3.0 canonical full text. Fetch from https://www.gnu.org/licenses/lgpl-3.0.txt — do not hand-write. Marc's house default for the godoo family (confirmed in CLAUDE.md and CONTEXT.md).

---

### `.github/workflows/ci.yml` (CI config)

**No in-repo analog.** Use RESEARCH.md Pattern 3 (lines 318-361):

```yaml
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

**D-04 enforced:** Three gates (ruff, mypy, pytest) as separate named steps; matrix with `["3.14"]`; `uv sync --frozen --dev`; `uv run <tool>` prefix (not bare tool names).

**Pitfall avoided (RESEARCH Pitfall 5):** Use `astral-sh/setup-uv@v5` — this lets uv handle Python installation rather than relying on the `actions/setup-python` tool-cache for 3.14, which may not be pre-cached.

---

### `.pre-commit-config.yaml` (config)

**No in-repo analog.** Use RESEARCH.md Pattern 4 (lines 365-374):

```yaml
repos:
  - repo: https://github.com/astral-sh/ruff-pre-commit
    rev: v0.15.15
    hooks:
      - id: ruff
        args: [--fix]
      - id: ruff-format
```

**D-05 enforced:** mirrors the CI ruff gates locally; single hook source for both lint and format.

---

## Shared Patterns

### Build backend declaration
**Apply to:** `pyproject.toml`
**Rule:** Always `uv_build`, never `hatchling`. Decision D-03 is locked.
```toml
[build-system]
requires = ["uv_build>=0.11,<0.12"]
build-backend = "uv_build"
```

### Dependency naming
**Apply to:** `pyproject.toml`, any future `uv add` commands
**Rule:** `godoo-client>=0.2,<0.3` — the `godoo` meta-package MUST NOT appear as a dependency. Decision D-01 is locked. See RESEARCH Pitfall 1.

### Tool config location
**Apply to:** All tooling configuration
**Rule:** Decision D-05 — all ruff, mypy, and pytest config goes in `pyproject.toml`. No separate `mypy.ini`, `.ruff.toml`, `pytest.ini`, or `setup.cfg`.

### Lockfile discipline
**Apply to:** `uv.lock`, CI workflow
**Rule:** `uv.lock` committed in the same commit as `pyproject.toml`. CI always uses `uv sync --frozen`. Never `uv sync` without `--frozen` in CI. See RESEARCH Pitfall 2.

---

## No Analog Found

All 8 files have no in-repo analog — this is the first phase of a greenfield project.

| File | Role | Reason | Pattern Source |
|------|------|--------|----------------|
| `pyproject.toml` | config | No existing Python packages in repo | RESEARCH.md Pattern 1 |
| `src/godoo_mcp_server/__init__.py` | package | No existing src/ tree | RESEARCH.md Code Examples |
| `src/godoo_mcp_server/__main__.py` | entrypoint | No existing source modules | RESEARCH.md Pattern 2 |
| `tests/__init__.py` | test | No existing tests/ | Empty file (stdlib convention) |
| `tests/test_placeholder.py` | test | No existing tests | RESEARCH.md Code Examples |
| `LICENSE` | config | No existing LICENSE | LGPL-3.0 canonical text |
| `.github/workflows/ci.yml` | CI | No existing workflows | RESEARCH.md Pattern 3 |
| `.pre-commit-config.yaml` | config | No existing pre-commit | RESEARCH.md Pattern 4 |

---

## Metadata

**Analog search scope:** Entire repository (`C:\dev\godoo-dev\godoo-mcp-server`)
**Files scanned:** `.planning/` docs, `CLAUDE.md`, `SEED.md` (only non-git files present)
**Source code files found:** 0
**Pattern extraction date:** 2026-06-01
