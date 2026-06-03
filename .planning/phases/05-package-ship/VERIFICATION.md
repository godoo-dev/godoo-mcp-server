---
phase: 05-package-ship
verified: 2026-06-03T00:00:00Z
status: complete
score: 12/12 must-haves verified
overrides_applied: 0
gaps: []
human_verification: []
---

# Phase 5: Package & Ship — Verification Report

**Phase Goal:** godoo-mcp-server is installable from PyPI and runnable from a Docker image; the README documents the header-trust threat model; `@marcfargas/odoo-mcp` is formally deprecated pointing users here
**Verified:** 2026-06-03
**Status:** COMPLETE — all manual release gates executed and verified (05-05)
**Re-verification:** Yes — updated 2026-06-03 after 05-05 manual gate completion

---

## Goal Achievement

### Observable Truths (Phase 5 Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| SC-1 | `pip install godoo-mcp-server` installs and `python -m godoo_mcp_server` starts the server | VERIFIED | `uv run python -m godoo_mcp_server --version` prints `godoo-mcp-server 0.1.0`; wheel in `dist/godoo_mcp_server-0.1.0-py3-none-any.whl`; `entry_points.txt` confirms `godoo-mcp-server = godoo_mcp_server.__main__:main` |
| SC-2 | `docker build` produces a `python:3.14-slim` image; `docker run` starts server with env-var credentials | VERIFIED | Automated via `tests/e2e/test_docker_image.py` (commit `b223ffa`): builds image, runs against Odoo testcontainer, asserts `/healthz` healthy + `record_search` MCP tool returns non-error result. `uv run pytest -m e2e` → 2 passed. |
| SC-3 | README contains "Security: Header Trust Model" section naming godoo-proxy as SaaS-safe guard | VERIFIED | `grep -c "Security: Header Trust Model" README.md` = 1; `grep -c "godoo-proxy" README.md` = 2; impersonation risk explicitly stated |
| SC-4 | `npm deprecate @marcfargas/odoo-mcp ...` has been run and is visible on npm | VERIFIED | `npm view @marcfargas/odoo-mcp` shows `DEPRECATED ⚠️ — Deprecated: use godoo-mcp-server (PyPI) as successor — https://pypi.org/project/godoo-mcp-server/`; package still at 0.1.4 (not unpublished). Evidence in `05-05-RUNBOOK.md § outome`. |

**Score:** 12/12 must-haves verified — Phase 5 complete

---

## Plan-by-Plan Verdicts

### 05-01: pyproject.toml console script + TestPyPI index + uv.lock sync

**Verdict: PASS**

| Check | Result |
|-------|--------|
| `[project.scripts]` present | `godoo-mcp-server = "godoo_mcp_server.__main__:main"` confirmed via tomllib |
| `[[tool.uv.index]]` stanza | `name=testpypi`, `url=https://test.pypi.org/simple/`, `publish-url=https://test.pypi.org/legacy/`, `explicit=true` — all confirmed |
| Entry point target exists | `src/godoo_mcp_server/__main__.py` contains `def main() -> None:` at module level |
| uv.lock in sync | `uv lock --check` exits 0 (98 packages, no drift) |
| Wheel builds | `uv build` produces `dist/godoo_mcp_server-0.1.0-py3-none-any.whl` |
| Skills bundled | Wheel contains `godoo_mcp_server/skills/SKILL.md` and sibling skill files |
| Console script in METADATA | `entry_points.txt`: `[console_scripts]\ngodoo-mcp-server = godoo_mcp_server.__main__:main` |
| Commit 530b21f exists | Confirmed in git log |

Key link verified: `pyproject.toml [project.scripts]` → `src/godoo_mcp_server/__main__.py:main` — the `main()` function exists and is callable.

---

### 05-02: Dockerfile multi-stage build

**Verdict: PASS (structure); SC-2 live smoke-test deferred to 05-05**

| Check | Result |
|-------|--------|
| `FROM python:3.14-slim` count | 2 (builder + runtime) — confirmed |
| `uv sync --frozen --no-dev --no-install-project` | Present in builder first RUN |
| `uv sync --frozen --no-dev --no-editable` | Present in builder second RUN |
| `COPY . /app` only in builder | No `COPY src/` in runtime stage — confirmed |
| No uv binary in runtime stage | uv only in builder `COPY --from=ghcr.io/astral-sh/uv:0.7.12` |
| `USER godoo` | `groupadd -r godoo && useradd -r -d /app -g godoo -N godoo` present |
| `CMD ["godoo-mcp-server"]` | Present — matches `[project.scripts]` entry from 05-01 |
| HEALTHCHECK | `urllib.request.urlopen('http://localhost:8000/healthz')` present |
| `/healthz` route exists | `server.py:37` — `@mcp.custom_route("/healthz", methods=["GET"])` returns `JSONResponse({"status": "ok"})` |
| CredentialMiddleware carve-out | `credentials.py:59-61` — `/healthz` path bypasses credential check |
| Commit cfcdc9f exists | Confirmed in git log |

Key link verified: `Dockerfile HEALTHCHECK` → `/healthz` route in `server.py` — the route exists, is unauthenticated, and the middleware correctly bypasses it.

Key link verified: `Dockerfile CMD ["godoo-mcp-server"]` → `.venv/bin/godoo-mcp-server` — the console script is installed non-editable into .venv via `uv sync --no-editable`.

The HEALTHCHECK hardcodes port 8000 even when `PORT` env is overridden. This is documented both in the Dockerfile comment (`NOTE: if PORT is overridden...`) and in `README.md` ("If you override `PORT`, you must also update the Docker `HEALTHCHECK`"). Acknowledged as known limitation, not a defect.

---

### 05-03: README.md + CHANGELOG.md

**Verdict: PASS with WARNING**

| Check | Result |
|-------|--------|
| `## Security: Header Trust Model` present | count = 1 |
| Impersonation risk stated | "any caller who can impersonate any Odoo user by setting these headers" — present |
| godoo-proxy named as SaaS-safe guard | count = 2 (body + link) |
| `## Installation` section | Present with `pip install godoo-mcp-server` and `docker run` example |
| `## Configuration` section | Present with credential table (X-Odoo-* headers and ODOO_* env vars) |
| Phase 1 scaffold stub removed | `grep -c "Phase 1 scaffold" README.md` = 0 |
| E2E section preserved | `## Running E2E tests locally` intact |
| Auth boundary accuracy | README correctly documents server CONSUMES headers, never issues tokens; godoo-proxy is the issuer |
| No confidential company names | BGBL / BLEGAL / BGA / ACM — not found in README.md |
| CHANGELOG.md exists | Present at repo root |
| Keep-a-Changelog format | `# Changelog`, `## [Unreleased]`, `## [0.1.0] - Unreleased` all present |
| No confidential company names | Clean in CHANGELOG.md |
| Commits 4938d4b, 2fc229e exist | Confirmed in git log |

**WARNING — CHANGELOG inaccuracy:** `CHANGELOG.md` line 25 reads:

```
- Per-user ACL probe for curated tool filtering
```

This feature was **explicitly removed** in Phase 4 by decision D-12 (ACL-01/ACL-02 removed; ACL enforcement fully delegated to Odoo). No `check_access_rights` call or ACL-probe code exists anywhere in `src/`. The CHANGELOG documents a feature the server does not implement.

This is a documentation accuracy issue, not a functional defect. The server operates correctly. A human must decide whether to correct the CHANGELOG before the 0.1.0 release (recommended) or accept the inaccuracy.

---

### 05-04: .github/workflows/publish.yml

**Verdict: PASS**

| Check | Result |
|-------|--------|
| File exists | `.github/workflows/publish.yml` present |
| YAML valid | `yaml.safe_load` succeeds — no parse errors |
| Four jobs | `build`, `publish-testpypi`, `publish-pypi`, `publish-docker` — all present |
| `workflow_dispatch` trigger | Present |
| `push tags v*` trigger | Present |
| `publish-testpypi` if-condition | `github.event_name == 'workflow_dispatch'` |
| `publish-testpypi` environment | `testpypi` — matches `[[tool.uv.index]]` name in pyproject.toml |
| `publish-testpypi` permissions | `id-token: write` |
| `publish-testpypi` publish command | `uv publish --index testpypi --trusted-publishing always` |
| `publish-pypi` if-condition | `github.event_name == 'push' && startsWith(github.ref, 'refs/tags/v')` |
| `publish-pypi` environment | `pypi` |
| `publish-pypi` permissions | `id-token: write` |
| `publish-pypi` publish command | `uv publish --trusted-publishing automatic` |
| `publish-docker` if-condition | `github.event_name == 'push' && startsWith(github.ref, 'refs/tags/v')` |
| `publish-docker` permissions | `contents: read, packages: write` |
| GHCR push target | `ghcr.io/${{ github.repository }}` via `docker/metadata-action@v5` |
| Docker actions | `docker/login-action@v3`, `docker/metadata-action@v5`, `docker/build-push-action@v6` |
| `actions/checkout@v4` in all publish jobs | Present in all three publish jobs (Pitfall 1 guard) |
| Index name consistency | pyproject.toml `name = "testpypi"` matches `--index testpypi` in workflow |
| Commit 7c372e3 exists | Confirmed in git log |

Key link verified: `publish-testpypi` → `environment: testpypi` → matches `[[tool.uv.index]] name = "testpypi"` in pyproject.toml — the workflow can resolve the named index from the checked-out pyproject.toml.

---

## Required Artifacts

| Artifact | Plan | Status | Details |
|----------|------|--------|---------|
| `pyproject.toml` | 05-01 | VERIFIED | `[project.scripts]` + `[[tool.uv.index]]` both present; `[tool.uv_build]` intact |
| `uv.lock` | 05-01 | VERIFIED | `uv lock --check` passes; 98 packages resolved |
| `Dockerfile` | 05-02 | VERIFIED | Two-stage build; all structural assertions pass |
| `README.md` | 05-03 | VERIFIED | Security section + Installation + Configuration present; scaffold stub removed |
| `CHANGELOG.md` | 05-03 | VERIFIED (WARNING) | Keep-a-Changelog format correct; contains inaccurate ACL probe entry (see WARNING above) |
| `.github/workflows/publish.yml` | 05-04 | VERIFIED | Four jobs, two-path routing, OIDC, valid YAML |
| `src/godoo_mcp_server/__main__.py` | pre-existing | VERIFIED | `main()` function at module level; `HOST`/`PORT` env support; `--version` flag |
| `src/godoo_mcp_server/server.py` | pre-existing | VERIFIED | `/healthz` route at line 37; `create_app()` factory present |

---

## Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `pyproject.toml [project.scripts]` | `__main__.py:main` | entry-point resolution | WIRED | Function exists and is callable; `uv run python -m godoo_mcp_server --version` = `godoo-mcp-server 0.1.0` |
| `pyproject.toml [[tool.uv.index]]` | `test.pypi.org/legacy/` | `uv publish --index testpypi` | WIRED | `name=testpypi` matches `--index testpypi` in publish.yml |
| `Dockerfile CMD ["godoo-mcp-server"]` | `.venv/bin/godoo-mcp-server` | `uv sync --no-editable` install | WIRED | `--no-editable` embeds package into .venv; console script present in wheel `entry_points.txt` |
| `Dockerfile HEALTHCHECK` | `/healthz` in `server.py` | `urllib.request.urlopen` | WIRED | Route at `server.py:37`; CredentialMiddleware carve-out at `credentials.py:59-61` |
| `publish-testpypi` job | `testpypi` GitHub environment | `environment: testpypi` | WIRED (workflow only) | YAML declares env; actual environment must be created in GitHub Settings (05-05 manual gate) |
| `publish-pypi` job | `pypi` GitHub environment | `environment: pypi` | WIRED (workflow only) | Same — requires 05-05 manual gate |
| `publish-docker` job | `ghcr.io/godoo-dev/godoo-mcp-server` | `docker/build-push-action@v6` + `GITHUB_TOKEN` | WIRED | Workflow correctly scoped; `packages: write` permission present |

---

## Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Console entry point works | `uv run python -m godoo_mcp_server --version` | `godoo-mcp-server 0.1.0` | PASS |
| uv.lock in sync with pyproject.toml | `uv lock --check` | exit 0, "Resolved 98 packages in 1ms" | PASS |
| Wheel builds successfully | `uv build` | `dist/godoo_mcp_server-0.1.0-py3-none-any.whl` | PASS |
| Skills bundled in wheel | zipfile check for `godoo_mcp_server/skills/SKILL.md` | Present | PASS |
| Console script in wheel | `entry_points.txt` check | `godoo-mcp-server = godoo_mcp_server.__main__:main` | PASS |
| publish.yml YAML validity | `yaml.safe_load` | No parse errors | PASS |
| Unit test suite | `uv run pytest --tb=short -q` | 63 passed, 10 deselected | PASS |

---

## Requirements Coverage

| Requirement | Plans | Description | Status | Evidence |
|-------------|-------|-------------|--------|---------|
| REL-01 | 05-01, 05-04, 05-05 | Package publishable to PyPI (`pip install`) | SATISFIED | `[project.scripts]` + wheel + TestPyPI index stanza + publish.yml; D-01 hard gate cleared: TestPyPI install verified in clean venv (both `--version` commands print `godoo-mcp-server 0.1.0`) |
| REL-02 | 05-02, 05-04, 05-05 | Docker image (`python:3.14-slim` base) builds and runs | SATISFIED | Dockerfile structural assertions pass; live smoke-test automated via `tests/e2e/test_docker_image.py` (commit `b223ffa`): builds, runs vs Odoo testcontainer, /healthz + record_search verified; `uv run pytest -m e2e` → 2 passed |
| REL-03 | 05-03 (docs), 05-05 (action) | `@marcfargas/odoo-mcp` deprecated on npm | SATISFIED | `npm deprecate` applied; `npm view` shows `DEPRECATED ⚠️` badge; package still installable at 0.1.4 |
| REL-04 | 05-03 | README documents header-trust threat model | SATISFIED | `## Security: Header Trust Model` present; impersonation risk and godoo-proxy named |

---

## Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `CHANGELOG.md` | 25 | "Per-user ACL probe for curated tool filtering" — documents a removed feature (D-12) | WARNING | No code defect; documentation inaccuracy could mislead operators reading release notes |

No `TBD`, `FIXME`, or `XXX` markers found in files modified by this phase.

No confidential company names (BGBL, BLEGAL, BGA, ACM) found in README.md, CHANGELOG.md, or wheel METADATA.

---

## Deferred Items — 05-05 Manual Release Gate

All 05-05 manual gates are now complete (2026-06-03). No deferred items remain.

| Item | Required For | Status |
|------|-------------|--------|
| TestPyPI + PyPI Trusted Publisher config + GitHub environments | D-01 / OIDC | DONE — OIDC exchange succeeded in Task 2; environments `testpypi` + `pypi` created |
| `workflow_dispatch` dry-run on TestPyPI | D-01 hard gate | DONE — Actions green; 0.1.0 on TestPyPI; both `--version` commands verified |
| Docker image smoke-test | REL-02 / SC-2 | DONE (automated) — `tests/e2e/test_docker_image.py` passing; commit `b223ffa` |
| `npm deprecate @marcfargas/odoo-mcp` | REL-03 / SC-4 | DONE — deprecation live on npm registry; package still at 0.1.4 |

---

## Human Verification Required

None — all items resolved.

The CHANGELOG.md ACL probe entry (`Per-user ACL probe for curated tool filtering`) was removed in commit `896b66a` (fix(05-03): remove CHANGELOG entry for ACL feature removed by D-12). The WARNING from the initial verification is closed.

---

## Gaps Summary

No gaps. All plans (05-01 through 05-05) are complete. All four success criteria (SC-1 through SC-4) are satisfied. Phase 5 is fully closed.

**Closing note (2026-06-03):** 05-05 manual gates executed and verified this session. SC-2 was satisfied by automation (`tests/e2e/test_docker_image.py`, commit `b223ffa`) rather than a one-time manual docker run — a stronger form of attestation. D-01 hard gate cleared via GitHub Actions `workflow_dispatch` on `develop`; TestPyPI install confirmed in clean venv. REL-03 / D-11 npm deprecation confirmed live on registry. Phase 5 status: COMPLETE.

---

_Initial verification: 2026-06-03 — 11/12, human_needed (SC-2/SC-4 deferred to 05-05)_
_Updated: 2026-06-03 — 12/12, COMPLETE (05-05 manual gates executed and verified)_
_Verifier: Claude (gsd-verifier)_
