# Phase 1: Foundations - Context

**Gathered:** 2026-06-01
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 1 delivers a buildable, lintable, CI-green Python package skeleton with the godoo dependency conflict resolved. No runtime or MCP server code — just scaffold, packaging, tooling, and CI. The phase is complete when `uv build` succeeds, `ruff`, `mypy --strict`, and `pytest` all pass in CI, and the chosen godoo pin is confirmed against PyPI.

</domain>

<decisions>
## Implementation Decisions

### godoo Dependency (FOUND-01 Blocker)

- **D-01:** Pin to the latest-published godoo client release at execution time, then re-confirm the exact package name, version pin, and Python floor against PyPI at the END of Phase 1 before phase close. The `godoo-client` package is the real importable package — the `godoo` meta-package ships no importable code and MUST NOT be used as a dependency. Record the chosen pin in `pyproject.toml`. The FOUND-01 "confirmed in writing" requirement is satisfied by this CONTEXT decision plus the end-of-phase PyPI re-confirmation.
- **D-02:** Python floor follows whatever the chosen `godoo-client` version requires. Current CLAUDE.md research indicates `>=3.14` — verify against actual PyPI metadata at execution time. The "FOUND-01 blocker" is resolved by this confirm-at-end strategy; Marc is actively cutting a new version so the exact pin is a moving target during the phase, and the Phase 1 scaffold only imports godoo for `--version`.

### Packaging Stack

- **D-03:** Build backend: `uv_build` (zero-config, tightest uv integration for a fresh pure-Python package). Layout: src-layout (`src/godoo_mcp_server/`). Entry: `__main__.py` that invokes a thin CLI printing `__version__` from `__init__.py`, satisfying ROADMAP success criterion 2 (`python -m godoo_mcp_server --version` runs). Console_scripts entrypoint is DEFERRED until there is a real entrypoint beyond `--version`.

### CI Scope & Python Strategy

- **D-04:** GitHub Actions workflow uses a version matrix axis containing only `["3.14"]` today — structured so adding `3.15+` later is a one-line change. Three gates run per matrixed job: `ruff` (lint + format check), `mypy --strict`, `pytest` (empty/placeholder suite). Dependency install via `uv sync --frozen`; `uv.lock` committed to repo. Satisfies FOUND-03.

### Tooling Config & Pre-commit

- **D-05:** All ruff and mypy configuration consolidated in `pyproject.toml` (`[tool.ruff]`, `[tool.mypy]`). A `.pre-commit-config.yaml` running ruff + ruff-format is added for local pre-commit enforcement. CI enforces the same gates independently. Single config file avoids drift between local and CI.

### Claude's Discretion

No areas were deferred to Claude's discretion — all four areas were decided explicitly by Marc.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase Definition & Requirements
- `.planning/ROADMAP.md` — Phase 1 definition and success criteria (buildable skeleton, `--version`, CI green)
- `.planning/REQUIREMENTS.md` — FOUND-01 (godoo dependency blocker), FOUND-02, FOUND-03 (CI requirement)

### Project Constraints & Locked Decisions
- `.planning/PROJECT.md` — locked decisions, constraints, godoo pin status, language/license/deployment targets
- `.planning/STATE.md` — current blockers and last session record

### Technology Research
- `.planning/research/STACK.md` — technology stack research including godoo-client PyPI findings (version, Python floor, importability)
- `.planning/research/PITFALLS.md` — known scaffold-decision traps (meta-package trap, Alpine libc, gunicorn antipattern, etc.)

### Build & Tooling Guidance
- `CLAUDE.md` — tech-stack table, "What NOT to Use" section, build-backend guidance (`uv_build` vs hatchling), godoo-client vs godoo meta-package distinction

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

Nothing exists in the repository yet beyond `.planning/` docs and `CLAUDE.md`. Phase 1 creates from scratch:
- `pyproject.toml` — package metadata, build backend, tool config
- `src/godoo_mcp_server/__init__.py` — `__version__` literal
- `src/godoo_mcp_server/__main__.py` — `--version` CLI entry
- `LICENSE` — LGPL-3.0 text
- `.github/workflows/ci.yml` — matrix CI workflow
- `.pre-commit-config.yaml` — local ruff gates
- `uv.lock` — committed lockfile

### Established Patterns

- No prior code patterns to inherit. Phase 1 establishes the conventions all subsequent phases follow.
- Prior locked decisions (carried forward from project inception, not re-decided here): Python language; LGPL-3.0 license; pip + Docker deployment targets; single package, no monorepo; `uv` as package manager throughout.

### Integration Points

- Phase 1 has no upstream code integrations. It is the foundation all subsequent phases build upon.

</code_context>

<specifics>
## Specific Ideas

No specific requirements beyond the decisions captured above — open to standard approaches for file layout, ruff rule selection, and mypy strictness settings within the `--strict` envelope.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 1-Foundations*
*Context gathered: 2026-06-01*
