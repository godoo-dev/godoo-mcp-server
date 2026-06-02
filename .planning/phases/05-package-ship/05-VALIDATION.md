---
phase: 5
slug: package-ship
status: draft
nyquist_compliant: true
wave_0_complete: true
created: 2026-06-02
---

# Phase 5 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | pytest 9.0.3 (existing — `pyproject.toml [tool.pytest.ini_options]`) |
| **Config file** | `pyproject.toml` |
| **Quick run command** | `uv run pytest --tb=short` |
| **Full suite command** | `uv run pytest -m 'integration or not integration' --tb=short` |
| **Estimated runtime** | ~30 seconds (unit suite); ~2 min (integration suite) |

> Note: Phase 5 adds no new unit tests. All success-criterion validations are
> operational (wheel build, container run, registry checks, static grep assertions)
> rather than pytest-runnable unit tests. `uv run pytest --tb=short` is still the
> correct regression gate after each task to confirm no existing tests regressed.

---

## Sampling Rate

- **After every task commit:** Run `uv run pytest --tb=short` (unit suite — confirms no regressions from pyproject.toml or README changes)
- **After every plan wave:** Run `uv run pytest -m 'integration or not integration' --tb=short` (full suite via CI on push to develop — automatic)
- **Before `/gsd:verify-work`:** Full suite must be green; all SC-1..SC-4 operational checks must also be green
- **Max feedback latency:** ~30 seconds (unit suite quick run)

---

## Per-Task Verification Map

> Phase 5 validations are primarily operational (wheel build, container health, registry
> state, static file assertions). The "Automated Command" column shows the exact command
> from each plan's `<verify><automated>` block or the RESEARCH Validation Architecture
> table. Manual-only rows are marked accordingly and expanded in the Manual-Only section.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|--------|
| 05-01-T1 | 01 | 1 | REL-01 | T-05-02 | `explicit=true` on testpypi index prevents TestPyPI from polluting production dependency resolution | structural | `uv run python -c "import tomllib; data = tomllib.load(open('pyproject.toml', 'rb')); assert 'godoo-mcp-server' in data['project']['scripts']; assert any(idx.get('name') == 'testpypi' for idx in data.get('tool', {}).get('uv', {}).get('index', [])); print('pyproject.toml: all assertions pass')"` | ⬜ pending |
| 05-01-T2 | 01 | 1 | REL-01 | T-05-01 | Locked uv.lock prevents tampered dependency substitution in CI `--frozen` builds | build | `uv build && python -c "import zipfile, glob; whl = glob.glob('dist/*.whl')[0]; contents = zipfile.ZipFile(whl).namelist(); assert any('godoo_mcp_server/skills/SKILL.md' in f for f in contents), 'SKILL.md not in wheel'; print('wheel OK:', whl)"` | ⬜ pending |
| 05-02-T1 | 02 | 1 | REL-02 | T-05-10, T-05-11 | Runtime stage contains no uv binary or src/ tree (build-secret isolation); container runs as non-root godoo user | structural | `grep -c "FROM python:3.14-slim" Dockerfile` (must return 2) | ⬜ pending |
| 05-03-T1 | 03 | 1 | REL-04 | T-05-20 | README explicitly states full Odoo user impersonation risk when no proxy is present | static | `python -c "txt = open('README.md').read(); assert 'Security: Header Trust Model' in txt; assert 'godoo-proxy' in txt; assert 'Phase 1 scaffold' not in txt; assert '## Installation' in txt; print('README assertions: all pass')"` | ⬜ pending |
| 05-03-T2 | 03 | 1 | REL-03 | — | N/A (documentation file) | static | `python -c "txt = open('CHANGELOG.md').read(); assert '# Changelog' in txt; assert '[0.1.0]' in txt; assert 'Unreleased' in txt; print('CHANGELOG OK')"` | ⬜ pending |
| 05-04-T1 | 04 | 2 | REL-01, REL-02 | T-05-30, T-05-32 | Publish jobs use OIDC only (no stored API token); publish-pypi gated to v* tags (prevents accidental production publish) | structural | `python -c "import yaml; w = yaml.safe_load(open('.github/workflows/publish.yml')); jobs = w.get('jobs', {}); assert 'build' in jobs; assert 'publish-testpypi' in jobs; assert 'publish-pypi' in jobs; assert 'publish-docker' in jobs; tp = jobs['publish-testpypi']; assert tp.get('environment') == 'testpypi'; assert tp.get('permissions', {}).get('id-token') == 'write'; print('publish.yml structure: all assertions pass')"` | ⬜ pending |
| 05-05-T1 | 05 | 3 | REL-01, REL-02 | T-05-43 | Trusted Publisher environment names match exactly — OIDC exchange will fail on mismatch | manual | See Manual-Only Verifications table | ⬜ pending |
| 05-05-T2 | 05 | 3 | REL-01 | T-05-41 | TestPyPI install in a clean venv confirms no editable-install breakage and skills bundled correctly | manual | See Manual-Only Verifications table | ⬜ pending |
| 05-05-T3 | 05 | 3 | REL-02 | T-05-44 | Odoo credentials passed via env vars only — not embedded in image; container runs as non-root | manual | See Manual-Only Verifications table | ⬜ pending |
| 05-05-T4 | 05 | 3 | REL-03 | T-05-42 | npm deprecate (not unpublish) — existing installs remain functional; deprecation warning is visible | manual | See Manual-Only Verifications table | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Existing infrastructure covers all phase requirements.

- No new test files needed for Phase 5 — validations are operational, not unit-testable.
- `uv.lock` must be committed in sync after any `pyproject.toml` change (lockfile-discipline rule; applies after 05-01 Task 1).
- pytest suite is already configured at `pyproject.toml [tool.pytest.ini_options]`; `uv run pytest --tb=short` is runnable from the repo root without any Wave 0 setup.

---

## Manual-Only Verifications

> These validations cannot be automated because they require web UI access (PyPI/TestPyPI),
> GitHub Actions execution, Docker runtime, or npm account authentication. Each has a
> concrete observable assertion that constitutes pass/fail.

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Trusted Publisher configured on TestPyPI + PyPI; GitHub environments testpypi + pypi created | REL-01, REL-02 | PyPI Trusted Publisher registration is web-UI only; no API to create it | Complete 05-05 Task 1. Verify: pending publisher for godoo-mcp-server appears on both test.pypi.org/manage/account/publishing/ and pypi.org/manage/account/publishing/; both GitHub environments listed at repo Settings → Environments |
| TestPyPI dry-run workflow_dispatch succeeds; 0.1.0 installable from TestPyPI | REL-01 (SC-1) | Requires GitHub Actions OIDC exchange against registered Trusted Publisher; network operation | Complete 05-05 Task 2. Verify: GH Actions publish-testpypi job green; `pip install --index-url https://test.pypi.org/simple/ --extra-index-url https://pypi.org/simple/ godoo-mcp-server` in clean venv; `godoo-mcp-server --version` prints `godoo-mcp-server 0.1.0`; `python -m godoo_mcp_server --version` prints same |
| Docker container built locally is healthy and makes a real MCP tool call | REL-02 (SC-2) | Requires Docker daemon; real Odoo instance for credentials | Complete 05-05 Task 3. Verify: `docker build -t godoo-mcp-server:smoke-test .` exits 0; `docker inspect gms-smoke --format '{{.State.Health.Status}}'` returns `healthy` after ~20s; `python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/healthz').read()"` exits 0; one MCP tool call returns non-error result. Fallback if Docker unavailable: attest via CI publish-docker job on first v* tag |
| npm deprecation is live on the registry | REL-03 (SC-4) | Requires npm authentication as @marcfargas account owner | Complete 05-05 Task 4. Verify: `npm whoami` returns `marcfargas`; `npm view @marcfargas/odoo-mcp` includes `deprecated:` field with successor URL; https://www.npmjs.com/package/@marcfargas/odoo-mcp shows deprecated badge; package version 0.1.4 still listed (not unpublished) |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or are Manual-Only with concrete observable assertions documented above
- [x] Sampling continuity: no 3 consecutive tasks without automated verify (05-01-T1, 05-01-T2, 05-02-T1, 05-03-T1, 05-03-T2, 05-04-T1 all have automated commands; 05-05 tasks are manual checkpoints with explicit pass criteria)
- [x] Wave 0 covers all MISSING references — no missing test infrastructure
- [x] No watch-mode flags in any automated command
- [x] Feedback latency < 30s (unit suite quick run `uv run pytest --tb=short`)
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
