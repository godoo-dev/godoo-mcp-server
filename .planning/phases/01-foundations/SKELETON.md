# Walking Skeleton — godoo-mcp-server

**Phase:** 1
**Generated:** 2026-06-01

## Capability Proven End-to-End

A `uv`-installable `godoo_mcp_server` Python package prints its version via
`python -m godoo_mcp_server --version`, passes lint (ruff), type-check (mypy --strict),
and a smoke import test (pytest) — both locally and in GitHub Actions CI on Python 3.14.

## Architectural Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Language | Python 3.14 | Hard floor set by `godoo-client>=0.2,<0.3` (async Odoo RPC client); `>=3.14` is the published requirement |
| Package manager | `uv` 0.11.x | Zero-config lockfiles, 10-100x faster than pip, tightest `uv_build` integration; house standard for godoo family |
| Build backend | `uv_build` (locked D-03) | Zero-config src-layout; native `uv publish` integration; no separate hatchling dep |
| Directory layout | src-layout (`src/godoo_mcp_server/`) | Prevents accidental import of uninstalled package; standard for installable Python packages |
| Odoo RPC client | `godoo-client>=0.2,<0.3` (locked D-01) | The only importable PyPI package in the godoo family; `godoo` meta-package has no code |
| MCP framework | `fastmcp>=3.3,<4` | Included in lockfile now; active in Phase 2+ for Streamable HTTP + stateless_http=True |
| Linter + formatter | `ruff` | Single binary replacing black + flake8 + isort; configured in pyproject.toml (D-05) |
| Type checker | `mypy --strict` | Strict mode from day one; prevents async `Any` leaks in later phases |
| Test runner | `pytest` + `pytest-asyncio>=1.4` with `asyncio_mode="auto"` | Standard; auto mode avoids per-test decorator boilerplate in all async phases |
| CI | GitHub Actions, `astral-sh/setup-uv@v5`, matrix `["3.14"]` (D-04) | uv-native Python install avoids tool-cache gaps; one-line matrix expansion for 3.15+ |
| License | LGPL-3.0-or-later | House default for godoo family FOSS libraries (confirmed D-03) |
| Config consolidation | All tool config in `pyproject.toml` (locked D-05) | No separate mypy.ini / .ruff.toml / pytest.ini drift |

## Stack Touched in Phase 1

- [x] Project scaffold (uv_build, src-layout, pyproject.toml, uv.lock)
- [x] Routing — N/A (no HTTP server yet; Phase 2 adds FastMCP Streamable HTTP)
- [x] Database — N/A (stateless; no DB in this project)
- [x] UI — N/A (MCP server; no browser UI)
- [x] CLI entrypoint — `python -m godoo_mcp_server --version` (Phase 1 only)
- [x] CI — GitHub Actions three-gate workflow (ruff / mypy / pytest) on Python 3.14

## Out of Scope (Deferred to Later Slices)

- FastMCP server startup and Streamable HTTP transport — Phase 2
- Per-request credential resolution (X-Odoo-* headers, env var fallback) — Phase 2
- Any Odoo RPC calls — Phase 3+
- MCP tool registration (record primitives, discovery, whoami) — Phase 3+
- Catalog introspection, in-process LRU+TTL cache — Phase 4
- Skill Markdown files as MCP Resources — Phase 4
- Per-user ACL probing — Phase 4
- PyPI publish + Docker image — Phase 5
- MCP Code Mode (execute_odoo_code + OS-level sandbox) — Phase 6
- `console_scripts` entrypoint (deferred per D-03 until real MCP server exists)
- Docker image — Phase 5

## Subsequent Slice Plan

Each later phase adds one thin slice on top of this skeleton without altering its stack choices:

- Phase 2: Stateless FastMCP Streamable HTTP endpoint + per-request credential resolution middleware
- Phase 3: Wave 1 MCP tool surface (search, read, create, update, delete, whoami, list_models, get_fields) end-to-end against a real Odoo instance
- Phase 4: Full 17-tool surface + catalog cache + MCP resource descriptors + skill files + per-user ACL + list_changed notifications
- Phase 5: PyPI publish + Docker image (`python:3.14-slim`) + README header-trust threat model + npm deprecation notice
- Phase 6: `execute_odoo_code` MCP tool behind OS-level sandbox (isolation mechanism decided at Phase 6 entry)
