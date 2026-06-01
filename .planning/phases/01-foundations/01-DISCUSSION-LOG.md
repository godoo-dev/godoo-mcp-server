# Phase 1: Foundations - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-01
**Phase:** 1-foundations
**Areas discussed:** godoo dependency pin, Build backend & layout, CI scope & Python strategy, Tooling config & pre-commit

---

## godoo Dependency Pin

| Option | Description | Selected |
|--------|-------------|----------|
| `godoo-client >=0.2,<0.3` / Python ≥3.14 | Pin to current known published version per CLAUDE.md research | |
| `godoo >=1.1,<1.2` | Use the meta-package version scheme from PROJECT.md | |
| Check latest at end of phase | Query PyPI at execution time; re-confirm at phase close | ✓ |

**User's choice:** Neither verbatim option — "I am developing new version, so we check current latest release at end of phase; for now pin to latest published."
**Notes:** Marc is the author of `godoo-client` and is actively cutting a new version. The scaffold only uses godoo for `--version`, so deferring the exact pin to phase-end is safe. `godoo-client` is confirmed as the importable package; the `godoo` meta-package ships no code.

---

## Build Backend & Layout

| Option | Description | Selected |
|--------|-------------|----------|
| `uv_build` + src + `__main__` | Zero-config backend, src-layout, `__main__.py` for `python -m` entry | ✓ |
| `hatchling` + src + `__main__` | More configurable backend, same layout | |
| `uv_build` + flat layout | Simpler but non-standard for published packages | |

**User's choice:** `uv_build` + src + `__main__`
**Notes:** Console_scripts entrypoint deferred until there is a real entrypoint beyond `--version`.

---

## CI Scope & Python Strategy

| Option | Description | Selected |
|--------|-------------|----------|
| Single 3.14, three gates (flat) | One job: ruff, mypy, pytest | |
| Single 3.14, split jobs | Separate jobs per gate for parallel feedback | |
| 3.14 + future matrix | Matrix axis `["3.14"]` now; adding 3.15+ is one-line change | ✓ |

**User's choice:** 3.14 + future matrix
**Notes:** godoo-client floors at Python 3.14, so no lower version is testable. Matrix structure hedges future Python support without testing phantom versions. Three gates (ruff, mypy --strict, pytest) run per matrixed job. `uv sync --frozen` + committed `uv.lock`.

---

## Tooling Config & Pre-commit

| Option | Description | Selected |
|--------|-------------|----------|
| `pyproject.toml` + CI only | Ruff + mypy config in pyproject.toml; no local pre-commit | |
| `pyproject.toml` + pre-commit | Config in pyproject.toml; `.pre-commit-config.yaml` for local enforcement | ✓ |
| Separate config files | `ruff.toml`, `mypy.ini`, etc. separate from pyproject.toml | |

**User's choice:** `pyproject.toml` + pre-commit
**Notes:** Single config file avoids drift. CI enforces the same gates independently of pre-commit.

---

## Claude's Discretion

No areas were deferred to Claude's discretion. All four areas were decided explicitly by Marc.

## Deferred Ideas

None — discussion stayed within phase scope. No scope creep or ideas surfaced for future phases.
