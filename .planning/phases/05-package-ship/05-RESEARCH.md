# Phase 05: Package & Ship — Research

**Researched:** 2026-06-02
**Domain:** Python packaging (PyPI/TestPyPI), Docker multi-stage builds, GitHub Actions OIDC, npm deprecation
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** First publish is a TestPyPI dry-run at `0.1.0` to de-risk the first-ever release. A successful TestPyPI install is a gate — production publish does not happen until the dry-run is verified.
- **D-02:** The production version number is DEFERRED. Do NOT hardcode a production version in the plan.
- **D-03:** Multi-stage Dockerfile, built from source (not from the published wheel). Builder stage runs `uv sync --frozen --no-dev` producing a `.venv`; runtime stage is `python:3.14-slim` copying only the `.venv` + `src`. No `uv` in the final image.
- **D-04:** Base image is `python:3.14-slim` (NOT alpine).
- **D-05:** Dockerfile must include a `HEALTHCHECK` hitting the existing `/healthz` route.
- **D-06:** Container entrypoint uses the console script: `CMD ["godoo-mcp-server"]`.
- **D-07:** PyPI publish via GitHub Actions using PyPI Trusted Publisher (OIDC) — no stored API token.
- **D-08:** `workflow_dispatch` (manual button) → publishes to TestPyPI. Pushing a `v*` tag → publishes to production PyPI. Two clear paths, two Trusted Publisher configs. `uv.lock` MUST be committed in sync.
- **D-09:** Add `[project.scripts] godoo-mcp-server = "godoo_mcp_server.__main__:main"`.
- **D-10:** README gains a "Security: Header Trust Model" section.
- **D-11:** Run `npm deprecate @marcfargas/odoo-mcp "..."` — manual maintainer action, deprecate-never-unpublish.

### Claude's Discretion

- CHANGELOG format/existence, Docker non-root user, base-image digest pinning, image registry (GHCR vs Docker Hub) — not discussed; planner may propose sensible defaults but these are NOT locked.

### Deferred Ideas (OUT OF SCOPE)

- Production version number — deferred within Phase 5 until TestPyPI dry-run passes.
- CHANGELOG, non-root container user, base-image digest pinning, image registry choice.
- Repo public flip / FOSS announcement — gated on v1.0, not mechanically part of this phase.
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| REL-01 | Package publishable to PyPI (`pip install`) once godoo dependency is publicly resolvable | D-07/D-08 publish workflow; `uv build` verified to produce correct wheel; TestPyPI install pattern documented |
| REL-02 | Docker image (`python:3.14-slim` base) builds and runs with parity to pip install | Multi-stage Dockerfile pattern; D-03/D-04/D-05/D-06; HEALTHCHECK pattern; skills confirmed in wheel |
| REL-03 | `@marcfargas/odoo-mcp` (npm 0.1.4) deprecated with message pointing to godoo-mcp-server | npm deprecate command; scoped package support confirmed; verification via `npm view` |
| REL-04 | README documents the header-trust threat model | D-10 content shape defined; FOSS/godoo-proxy boundary documented |
</phase_requirements>

---

## Summary

Phase 5 is pure packaging, automation, and documentation — zero new server logic. All the gaps are mechanical: a Dockerfile, a publish workflow, a README section, a console-script entry, and one npm command. The research confirms every decision in CONTEXT.md is executable as specified with current 2026 tooling.

The most important verified finding is that `uv build` already works correctly against the current `pyproject.toml` — the wheel bundles all four skill `.md` files (confirmed by inspection) and the `[tool.uv_build] include` syntax in the existing `pyproject.toml` is the correct form for `uv_build` (not `[tool.uv.build-backend]`, which is a different, experimental API). The package is essentially ready to ship; this phase is about adding the delivery plumbing.

The publish workflow uses `uv publish --trusted-publishing` (not `pypa/gh-action-pypi-publish`), which is the 2026 Astral-recommended approach. TestPyPI routing requires a `[[tool.uv.index]]` stanza in `pyproject.toml` pointing at `test.pypi.org`; the `--index testpypi` flag on `uv publish` routes to it. Separate Trusted Publisher configurations must be created manually on both pypi.org and test.pypi.org before any workflow runs.

The Docker HEALTHCHECK does not require `curl` — Python's stdlib `urllib.request` is available in `python:3.14-slim` and is the correct lightweight approach. The D-03 build-from-source strategy avoids the chicken-and-egg dependency on PyPI being published first, which is the right call given the TestPyPI-first sequence.

**Primary recommendation:** Execute in four task tracks: (1) pyproject.toml additions (console script + uv index stanza), (2) Dockerfile, (3) publish workflow YAML with two-path routing, (4) README + npm deprecate. These are independent and can be sequenced in a single wave.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| PyPI package build | Local CLI / CI build job | — | `uv build` runs in GitHub Actions; output is dist/* |
| PyPI publish (production) | GitHub Actions (tag trigger) | — | Trusted Publisher OIDC; no token in repo |
| TestPyPI dry-run | GitHub Actions (workflow_dispatch) | — | Separate Trusted Publisher config on test.pypi.org |
| Docker image build + push | GitHub Actions (tag trigger) | — | GHCR via GITHUB_TOKEN; no credential storage |
| Docker runtime | python:3.14-slim container | — | Copies `.venv` from builder; runs console script |
| README documentation | Repo root README.md | — | Static markdown; no runtime concern |
| npm deprecation | npm registry (manual) | — | One-time maintainer action via npm CLI |

---

## Standard Stack

### Core

| Library / Tool | Version | Purpose | Why Standard |
|----------------|---------|---------|--------------|
| `uv build` | 0.7.x (installed) | Build sdist + wheel from source | Native build tool; integrates with `uv_build` backend already in pyproject.toml; produces `dist/` consumed by `uv publish` |
| `uv publish` | same | Publish dist/* to PyPI or TestPyPI | Supports `--trusted-publishing` flag directly; official Astral recommendation for GitHub Actions publish |
| `astral-sh/setup-uv` | v6 | GitHub Action: installs uv in CI | Official Astral action |
| `actions/checkout` | v4 | GitHub Action: checkout source | Current stable version (already used in ci.yml) |
| `python:3.14-slim` | latest | Docker runtime base | Locked by D-04; confirmed available on Docker Hub |
| `ghcr.io/astral-sh/uv` | pin to specific version | Docker builder: copy uv binary into builder stage | Smallest way to get uv into the builder without it in the final image |
| `docker/login-action` | current | Authenticate to GHCR | Uses `GITHUB_TOKEN`, no stored secrets |
| `docker/metadata-action` | current | Generate image tags from git tags | Handles semver + latest tagging automatically |
| `docker/build-push-action` | current | Build and push Docker image | Standard GitHub Actions Docker workflow |

### Supporting

| Library / Tool | Version | Purpose | When to Use |
|----------------|---------|---------|-------------|
| `npm` | 11.x (available locally) | npm deprecate command | One-time manual action for D-11 (REL-03) |
| `pip` (inside CI smoke test) | — | Install from TestPyPI to verify | Smoke-test step inside publish workflow or manual verification |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `uv publish --trusted-publishing` | `pypa/gh-action-pypi-publish` | Both work; `uv publish` is simpler (one tool, same CI already uses uv); `pypa/gh-action-pypi-publish` is the traditional approach and supports more registry options. For this project, `uv publish` is preferred. |
| GHCR (ghcr.io) | Docker Hub | Docker Hub requires separate credentials; GHCR uses `GITHUB_TOKEN` automatically — no secret setup needed. Downside: less discoverability. For a private-now, public-later repo, GHCR is the correct default. |
| `python -c urllib` HEALTHCHECK | Install `curl` in Dockerfile | `curl` adds ~3 MB to slim image. Python stdlib `urllib.request` is free. |

---

## Package Legitimacy Audit

No new packages are installed in this phase. All deliverables are YAML files (workflows), Dockerfile instructions, and documentation edits. The packages already in `pyproject.toml` were audited in prior phases.

**Packages removed due to slopcheck [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

*No new external packages are introduced in Phase 5.*

---

## Architecture Patterns

### System Architecture Diagram

```
Developer / CI
     |
     |-- workflow_dispatch -----> publish.yml (TestPyPI job)
     |                               |
     |                               +--> uv build (dist/)
     |                               +--> uv publish --index testpypi --trusted-publishing always
     |                               +--> TestPyPI registry
     |
     |-- git push v* tag -------> publish.yml (PyPI job)
     |                               |
     |                               +--> uv build (dist/)
     |                               +--> uv publish --trusted-publishing automatic
     |                               +--> PyPI registry
     |
     |-- git push v* tag -------> publish.yml (Docker job)
     |                               |
     |                               +--> docker/build-push-action
     |                               |       Builder: python:3.14-slim + uv binary
     |                               |         uv sync --frozen --no-dev → .venv
     |                               |       Runtime: python:3.14-slim
     |                               |         COPY .venv + src/
     |                               +--> GHCR (ghcr.io/godoo-dev/godoo-mcp-server)
     |
     v
Operator / Agent
     |-- pip install godoo-mcp-server -------> python -m godoo_mcp_server
     |-- docker run ghcr.io/.../godoo-mcp-server --> godoo-mcp-server (console script)
     |-- npm install @marcfargas/odoo-mcp ----> deprecation warning shown
```

### Recommended Project Structure Additions

```
.github/
└── workflows/
    ├── ci.yml              # EXISTING — lint, type-check, test
    └── publish.yml         # NEW — TestPyPI (workflow_dispatch) + PyPI + Docker (v* tag)

Dockerfile                  # NEW — multi-stage build from source

pyproject.toml              # EDIT: add [project.scripts] + [[tool.uv.index]]
README.md                   # EDIT: add Security + install sections
```

### Pattern 1: uv publish with Trusted Publishing (Two-Path Routing)

**What:** A single workflow file handles both the TestPyPI dry-run (manual trigger) and production publish (tag trigger) using `uv publish --trusted-publishing`. Two separate jobs, each with its own GitHub environment, share a common build step via `actions/download-artifact`.

**When to use:** Every publish event.

```yaml
# Source: astral-sh/trusted-publishing-examples + pydevtools.com/handbook

name: Publish

on:
  workflow_dispatch:         # button = rehearse (TestPyPI)
  push:
    tags:
      - "v*"                 # tag = ship (production PyPI + Docker)

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: astral-sh/setup-uv@v6
      - run: uv build
      - uses: actions/upload-artifact@v4
        with:
          name: dist
          path: dist/

  publish-testpypi:
    if: github.event_name == 'workflow_dispatch'
    needs: build
    runs-on: ubuntu-latest
    environment: testpypi          # must match TestPyPI Trusted Publisher config
    permissions:
      id-token: write
    steps:
      - uses: actions/checkout@v4  # required: pyproject.toml must be present for uv publish --index
      - uses: astral-sh/setup-uv@v6
      - uses: actions/download-artifact@v4
        with:
          name: dist
          path: dist/
      - run: uv publish --index testpypi --trusted-publishing always

  publish-pypi:
    if: github.event_name == 'push' && startsWith(github.ref, 'refs/tags/v')
    needs: build
    runs-on: ubuntu-latest
    environment: pypi              # must match PyPI Trusted Publisher config
    permissions:
      id-token: write
    steps:
      - uses: actions/checkout@v4
      - uses: astral-sh/setup-uv@v6
      - uses: actions/download-artifact@v4
        with:
          name: dist
          path: dist/
      - run: uv publish --trusted-publishing automatic

  publish-docker:
    if: github.event_name == 'push' && startsWith(github.ref, 'refs/tags/v')
    needs: build
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write
    steps:
      - uses: actions/checkout@v4
      - uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
      - id: meta
        uses: docker/metadata-action@v5
        with:
          images: ghcr.io/${{ github.repository }}
          tags: |
            type=semver,pattern={{version}}
            type=semver,pattern={{major}}.{{minor}}
            type=raw,value=latest
      - uses: docker/build-push-action@v6
        with:
          context: .
          push: true
          tags: ${{ steps.meta.outputs.tags }}
          labels: ${{ steps.meta.outputs.labels }}
```

**Critical note:** `uv publish --index testpypi` requires `[[tool.uv.index]]` in `pyproject.toml` with `name = "testpypi"`. The checkout step is required in the publish jobs because `uv publish --index` reads `pyproject.toml` to resolve the index URL.

### Pattern 2: TestPyPI Index Stanza (pyproject.toml addition)

**What:** Adds a named index pointing at TestPyPI so `uv publish --index testpypi` resolves correctly.

```toml
# Source: pydevtools.com/handbook/how-to/how-to-publish-to-testpypi-with-uv/
[[tool.uv.index]]
name = "testpypi"
url = "https://test.pypi.org/simple/"
publish-url = "https://test.pypi.org/legacy/"
explicit = true
```

The `explicit = true` flag prevents TestPyPI from being consulted during normal `uv sync` dependency resolution.

### Pattern 3: Multi-Stage Dockerfile (Build from Source)

**What:** Two-stage build. Builder installs deps and project into `.venv` using `--no-editable`. Runtime copies only `.venv` and `src/` — no uv binary in the final image.

**Why build from source (not wheel):** D-03 decision. Avoids chicken-and-egg with TestPyPI-first publish sequence. The image can be built and tested before PyPI is published.

**Why copy `src/`:** With `--no-editable`, the package is installed into `.venv/lib/python3.14/site-packages/godoo_mcp_server/` including the skill `.md` files. However, the console script `godoo-mcp-server` is at `.venv/bin/godoo-mcp-server`. The `src/` directory itself is NOT needed in the runtime image when `--no-editable` is used — the installed package in `.venv` is self-contained. See Pitfall 2.

```dockerfile
# Source: docs.astral.sh/uv/guides/integration/docker/ + hynek.me/articles/docker-uv/
FROM python:3.14-slim AS builder

# Copy uv binary from official image (pin version for reproducibility)
COPY --from=ghcr.io/astral-sh/uv:0.7.12 /uv /bin/uv

WORKDIR /app

# Install dependencies first (layer-caching: deps change less often than source)
RUN --mount=type=cache,target=/root/.cache/uv \
    --mount=type=bind,source=uv.lock,target=uv.lock \
    --mount=type=bind,source=pyproject.toml,target=pyproject.toml \
    uv sync --frozen --no-dev --no-install-project

# Copy source and install project non-editable (embeds skills into .venv)
COPY . /app
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev --no-editable

# ---- runtime ----
FROM python:3.14-slim

WORKDIR /app

# Copy the fully self-contained venv (includes installed package + skill files)
COPY --from=builder /app/.venv /app/.venv

# Non-root user (D-discretion recommendation)
RUN groupadd -r godoo && useradd -r -d /app -g godoo -N godoo
USER godoo

ENV PATH="/app/.venv/bin:$PATH"
ENV HOST="0.0.0.0"
ENV PORT="8000"

# D-05: HEALTHCHECK using stdlib urllib (no curl needed in slim image)
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/healthz')" || exit 1

# D-06: console script entrypoint (installs to .venv/bin/ from [project.scripts])
CMD ["godoo-mcp-server"]
```

**Key insight:** `--no-editable` means the installed package (including bundled `skills/*.md` files) lives entirely inside `.venv/lib/python3.14/site-packages/`. No `src/` needed in runtime image. The `importlib.resources.files("godoo_mcp_server")` call works because the package is properly installed, not editable.

### Pattern 4: Console Script Entry (pyproject.toml)

```toml
# Source: CONTEXT.md D-09
[project.scripts]
godoo-mcp-server = "godoo_mcp_server.__main__:main"
```

`main()` already exists in `__main__.py` and handles `--version`, `HOST`/`PORT` env vars, and `uvicorn.run(app)`. This is additive.

### Pattern 5: TestPyPI Install Verification

```bash
# Source: packaging.python.org/guides/using-testpypi/
# godoo-client lives on real PyPI, not TestPyPI — dual-index install required:
pip install \
  --index-url https://test.pypi.org/simple/ \
  --extra-index-url https://pypi.org/simple/ \
  godoo-mcp-server

# Verify console script works:
godoo-mcp-server --version
python -m godoo_mcp_server --version
```

**Warning:** pip resolves packages by name across both indexes — security note: a malicious package with the same name as a dep could be injected via TestPyPI. For this smoke-test purpose (known dep `godoo-client` is only on real PyPI) the pattern is safe and standard.

### Pattern 6: npm Deprecation (REL-03)

```bash
# Source: docs.npmjs.com/cli/v11/commands/npm-deprecate/
# Requires npm login (or npx login) first — marc must be authenticated as owner
npm whoami
npm deprecate @marcfargas/odoo-mcp "Deprecated: use godoo-mcp-server (PyPI) as successor — https://pypi.org/project/godoo-mcp-server/"

# Verify deprecation is live:
npm view @marcfargas/odoo-mcp
# Output includes: deprecated: "Deprecated: use godoo-mcp-server..."
```

Scoped package deprecation works in npm v11 (confirmed — historical issues were in v2/v3). The command deprecates all versions simultaneously (no version spec = all versions). No `--otp` needed unless 2FA is configured on the npm account. `npm view` confirms the deprecation message is immediately visible on the registry.

### Anti-Patterns to Avoid

- **Copying `src/` into the runtime Docker stage:** With `--no-editable`, the package is self-contained in `.venv`. Copying `src/` adds dead weight and breaks the multi-stage isolation.
- **Adding `uv` to the runtime stage:** uv is only needed at build time. Final image has only `.venv` and the system Python.
- **Using `gunicorn`:** Stateless single-process server; gunicorn adds shared-memory complexity with no benefit (see CLAUDE.md "What NOT to Use").
- **Using `python:3.14-alpine`:** musl libc breaks httpx SSL and anyio event loop behavior (locked by D-04 and CLAUDE.md).
- **Storing a PyPI API token in GitHub Secrets:** Trusted Publisher (OIDC) is the correct approach (D-07). Token-based auth is legacy for this publisher.
- **Using `npm unpublish`:** Deprecate, never unpublish (D-11, CLAUDE.md carry-forward). Unpublish breaks existing installs; deprecate sends a warning.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| PyPI OIDC authentication | custom token rotation, stored secrets | PyPI Trusted Publisher + `uv publish --trusted-publishing` | OIDC tokens are short-lived, scoped to one workflow; no secret rotation needed; supported by uv natively |
| Docker image tag management | manual tag strings in workflow | `docker/metadata-action` | Handles semver pattern extraction from git tags; generates `latest` tag correctly |
| Wheel building | manual `python setup.py bdist_wheel` | `uv build` | Reads `pyproject.toml` + `uv_build` backend; produces correct sdist+wheel including bundled skill files |
| HEALTHCHECK HTTP call | install curl/wget in image | `python -c "import urllib.request; urllib.request.urlopen(...)"` | Python stdlib; zero image size penalty; works in any Python slim image |

---

## Common Pitfalls

### Pitfall 1: Missing pyproject.toml in Publish Job
**What goes wrong:** `uv publish --index testpypi` fails with "no pyproject.toml found."
**Why it happens:** The publish job downloads the built `dist/` artifact but forgot to checkout the repo — `uv publish --index` requires `pyproject.toml` to resolve the named index URL.
**How to avoid:** Always include `actions/checkout` before `uv publish --index`. The pattern in Pattern 1 above includes it.
**Warning signs:** `Error: Index 'testpypi' not found in configuration` in workflow logs.

### Pitfall 2: Editable Install in Docker Runtime Stage
**What goes wrong:** `importlib.resources.files("godoo_mcp_server")` returns the builder's `/app/src/` path — but that path does not exist in the runtime stage.
**Why it happens:** Omitting `--no-editable` from the final `uv sync` call in the builder installs the package as an editable link pointing to the source tree. When only `.venv` is copied, the editable link is broken.
**How to avoid:** Use `uv sync --frozen --no-dev --no-editable` in the second builder RUN step (after COPY . /app). Skills load correctly because they are embedded in `.venv/lib/.../godoo_mcp_server/skills/`.
**Warning signs:** `FileNotFoundError` or `AssertionError` on the SKILL-02 startup assertion when the container starts.

### Pitfall 3: TestPyPI Trusted Publisher Config Mismatch
**What goes wrong:** `uv publish` fails with OIDC authentication error on TestPyPI.
**Why it happens:** TestPyPI Trusted Publisher config requires a SEPARATE registration from the production PyPI config. The workflow filename, repository, and environment name must exactly match what is configured on test.pypi.org/manage/account/publishing/.
**How to avoid:** Register TWO Trusted Publisher configs — one on pypi.org (environment: `pypi`) and one on test.pypi.org (environment: `testpypi`). Workflow filename must match exactly (e.g., `publish.yml`).
**Warning signs:** `403 Forbidden` or `OIDC exchange failed` in the publish job.

### Pitfall 4: godoo-client Not Found on TestPyPI
**What goes wrong:** `pip install --index-url https://test.pypi.org/simple/ godoo-mcp-server` fails because `godoo-client` is not on TestPyPI.
**Why it happens:** TestPyPI is a separate registry from production PyPI. Dependencies not published there cannot be resolved.
**How to avoid:** Always use the dual-index install pattern: `pip install --index-url https://test.pypi.org/simple/ --extra-index-url https://pypi.org/simple/ godoo-mcp-server`.
**Warning signs:** `ERROR: Could not find a version that satisfies the requirement godoo-client>=0.2,<0.3`.

### Pitfall 5: HEALTHCHECK Port Mismatch
**What goes wrong:** HEALTHCHECK always reports unhealthy even though the server is running.
**Why it happens:** The HEALTHCHECK uses port 8000 but the container's PORT env var was overridden to another value, or the server is still starting up.
**How to avoid:** Set `--start-period=15s` to give uvicorn time to start. If users override PORT, the HEALTHCHECK must also be overridden. Document this in the README.
**Warning signs:** Container shows `(unhealthy)` in `docker ps` despite running correctly.

### Pitfall 6: uv_build include Syntax vs uv.build-backend Syntax
**What goes wrong:** Confusing `[tool.uv_build]` (the correct, stable syntax in pyproject.toml) with `[tool.uv.build-backend]` (a different, experimental path found in some uv docs).
**Why it happens:** uv documentation sometimes shows `[tool.uv.build-backend]` for the preview API. The existing pyproject.toml uses `[tool.uv_build]` which IS correct and already verified working.
**How to avoid:** DO NOT change the existing `[tool.uv_build] include = ["src/godoo_mcp_server/skills/**"]` syntax. It was already confirmed to produce a correct wheel with bundled skills (verified by wheel inspection in this research).
**Warning signs:** If changed, `uv build` would fail to include the skill `.md` files in the wheel.

---

## Code Examples

### Verified: Wheel Contains Bundled Skills
```
# VERIFIED by running: uv run python -c "import zipfile; ..."
# Result: wheel contents confirmed to include:
godoo_mcp_server/skills/SKILL.md
godoo_mcp_server/skills/base/properties.md
godoo_mcp_server/skills/mail/activities.md
godoo_mcp_server/skills/mail/chatter.md
```
[VERIFIED: direct wheel inspection, 2026-06-02]

### Verified: uv build produces correct artifacts
```
dist/godoo_mcp_server-0.1.0.tar.gz    (sdist)
dist/godoo_mcp_server-0.1.0-py3-none-any.whl  (wheel)
```
Name, version, dependencies, LGPL-3.0 license, requires-python >=3.14 all correct in METADATA.
[VERIFIED: uv build run, 2026-06-02]

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `python setup.py sdist bdist_wheel` | `uv build` | 2024-2025 | Single command, uses pyproject.toml build backend |
| PyPI API token stored as GitHub Secret | PyPI Trusted Publisher (OIDC) | 2023 (PyPI), stable 2024-2025 | No token rotation, short-lived, workflow-scoped |
| `pypa/gh-action-pypi-publish` | `uv publish --trusted-publishing` | 2025 (uv added trusted publishing) | One tool, same CLI, simpler workflow |
| SSE transport | Streamable HTTP (`stateless_http=True`) | MCP 2024-2025 | Already implemented in server |
| `python:3.12-slim` base | `python:3.14-slim` | Available 2025, required by godoo-client | Required by `godoo-client>=0.2` hard dep |

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | GHCR is the appropriate image registry for this private-now-FOSS-later repo | Standard Stack, Pattern 1 | Low risk — switching to Docker Hub requires adding credentials as secrets; GHCR just works with GITHUB_TOKEN |
| A2 | The uv binary version `0.7.12` in the Dockerfile example — any recent 0.7.x is fine | Pattern 3 (Dockerfile) | Negligible — version should be pinned but the exact patch release is a planner choice |
| A3 | No `index.json` file exists in `skills/` directory (skills loaded from `_SKILL_PATHS` hardcoded list, not filesystem discovery) | Dockerfile, wheel verification | Low — confirmed by `ls skills/`; the SKILL-02 assertion validates the hardcoded list at startup |

**If this table is empty (nearly):** All critical claims were verified or cited — see Source section.

---

## Open Questions (RESOLVED)

1. **Trusted Publisher environment name for testpypi job**
   - What we know: GitHub environment name in the workflow must match what is registered on test.pypi.org Trusted Publisher config.
   - What's unclear: Marc has not yet created a godoo-mcp-server project on PyPI or TestPyPI — both registry registrations must happen BEFORE the first workflow run.
   - Recommendation: Plan must include a Wave 0 task: "Register Trusted Publisher on PyPI and TestPyPI." This is a one-time manual step in the PyPI web UI, not automatable.
   - **RESOLVED:** Environment names are `testpypi` (test.pypi.org) and `pypi` (pypi.org), per 05-04 publish.yml (`environment: testpypi` / `environment: pypi`) and 05-05 Task 1 manual checkpoint. Both must be registered in the PyPI web UI before the first workflow_dispatch run.

2. **Docker image: GHCR vs Docker Hub (Claude's Discretion)**
   - What we know: GHCR works with GITHUB_TOKEN (no stored secrets), is free for public repos, has less discoverability. Docker Hub requires a stored PAT or DOCKER_USERNAME/TOKEN secrets.
   - What's unclear: Marc's preference. The repo is currently private; public flip is at v1.0.
   - Recommendation: GHCR as default (`ghcr.io/godoo-dev/godoo-mcp-server`). Document Docker Hub as an alternative in the workflow comments. Surface as a plan choice, not locked.
   - **RESOLVED:** GHCR chosen per 05-02 Dockerfile and 05-04 publish.yml (`ghcr.io/${{ github.repository }}`). Uses `GITHUB_TOKEN` — no stored secret required.

3. **Non-root user in Docker (Claude's Discretion)**
   - What we know: Security best practice is to run as non-root. Slim images support `groupadd`/`useradd`.
   - What's unclear: Marc did not specify; no external requirement forces it for self-hosted use.
   - Recommendation: Add non-root user (Pattern 3 above). Cost is two lines of Dockerfile. Risk of omitting: container runs as root, violates least-privilege.
   - **RESOLVED:** Non-root `godoo` user added in 05-02 Dockerfile runtime stage (`groupadd -r godoo && useradd -r -d /app -g godoo -N godoo; USER godoo`).

4. **CHANGELOG format (Claude's Discretion)**
   - What we know: No CHANGELOG.md exists. Keep-a-Changelog (keepachangelog.com) is the 2026 standard for Python FOSS projects.
   - What's unclear: Marc's preference.
   - Recommendation: Add a minimal CHANGELOG.md with a `[0.1.0] - Unreleased` section as part of Phase 5 docs work. Keep simple — does not require automation.
   - **RESOLVED:** Minimal Keep-a-Changelog stub added per 05-03 Task 2 (`## [0.1.0] - Unreleased` section; date left as "Unreleased" until TestPyPI dry-run passes per D-01/D-02).

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `uv` | All build/publish steps | Yes | 0.7.x | — |
| `npm` | D-11 npm deprecate | Yes | 11.15.0 | — |
| `docker` (local) | Docker image testing | Not verified (CI only) | — | Build in GitHub Actions |
| Python 3.14 | All local tasks | Yes (via uv managed) | 3.14 | — |

**Missing dependencies with no fallback:** None for CI workflows. Docker image can only be smoke-tested in GitHub Actions or on a machine with Docker installed.

**One-time manual steps required (not automatable):**
- Create `godoo-mcp-server` project on PyPI (pypi.org) — required before first production publish.
- Create `godoo-mcp-server` project on TestPyPI (test.pypi.org) — required before TestPyPI dry-run.
- Configure Trusted Publisher on PyPI: repository `godoo-dev/godoo-mcp-server`, workflow `publish.yml`, environment `pypi`.
- Configure Trusted Publisher on TestPyPI: same fields, environment `testpypi`.
- Create GitHub environments `pypi` and `testpypi` in the repository Settings.

---

## Validation Architecture

Nyquist validation enabled. This phase has no unit tests — all validations are operational/behavioral. Each success criterion has a command that proves it.

### Phase Requirements → Validation Map

| Req ID | Success Criterion | Validation Type | Automated Command | Observable Output |
|--------|------------------|-----------------|-------------------|-------------------|
| REL-01 (SC-1) | `pip install godoo-mcp-server` works from TestPyPI | Behavioral/manual | `pip install --index-url https://test.pypi.org/simple/ --extra-index-url https://pypi.org/simple/ godoo-mcp-server && godoo-mcp-server --version` | Prints `godoo-mcp-server 0.1.0`; no import errors |
| REL-01 (SC-1) | `python -m godoo_mcp_server` starts server | Behavioral/manual | `python -m godoo_mcp_server` (in a clean venv with the package installed) | Server starts; `uvicorn` output on stdout |
| REL-02 (SC-2) | Docker image builds | CI automated | `docker build -t godoo-mcp-server:test .` | Build succeeds; no errors |
| REL-02 (SC-2) | Docker container starts and answers a tool call | Behavioral | `docker run -e ODOO_URL=... -e ODOO_DATABASE=... -e ODOO_USERNAME=... -e ODOO_PASSWORD=... -p 8000:8000 godoo-mcp-server:test` + curl or MCP client call | `/healthz` returns `{"status": "ok"}` |
| REL-02 (SC-2) | HEALTHCHECK passes in container | Docker | `docker inspect <id> --format '{{.State.Health.Status}}'` | Returns `healthy` |
| REL-03 (SC-4) | npm deprecation is live | Manual/registry | `npm view @marcfargas/odoo-mcp` | Shows `deprecated:` field with the message |
| REL-04 (SC-3) | README Security section present | Static | `grep -c "Security: Header Trust Model" README.md` | Returns `1` |
| REL-04 (SC-3) | README mentions godoo-proxy as SaaS guard | Static | `grep -c "godoo-proxy" README.md` | Returns >= 1 |

### Test Framework

| Property | Value |
|----------|-------|
| Framework | pytest 9.0.3 (existing) |
| Config file | `pyproject.toml [tool.pytest.ini_options]` |
| Quick run | `uv run pytest --tb=short` |
| Full suite | `uv run pytest -m 'integration or not integration' --tb=short` |

### Sampling Rate
- **Per task commit:** `uv run pytest --tb=short` (unit suite; excludes integration/e2e by default)
- **Per wave merge:** Full suite via CI (automatic on push to develop)
- **Phase gate:** All SC-1..SC-4 behavioral checks green before `/gsd:verify-work`

### Wave 0 Gaps
- No new test files needed for this phase — validations are operational, not unit-testable.
- Exception: if a CHANGELOG.md is added, a linting step may be desirable (optional).
- `uv.lock` must be committed in sync after any pyproject.toml change (lockfile-discipline rule).

*(No missing test infrastructure — existing pytest suite covers all prior phases; Phase 5 adds only packaging artifacts.)*

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No (no new auth logic) | — |
| V3 Session Management | No | — |
| V4 Access Control | No | — |
| V5 Input Validation | No (no new input paths) | — |
| V6 Cryptography | No (OIDC handled by PyPI/GitHub) | — |

**Security-relevant notes for this phase:**

- **Trusted Publisher (OIDC):** Short-lived OIDC tokens replace long-lived PyPI API tokens. This is a positive security change — no secret rotation needed, tokens are scoped to one workflow run.
- **GITHUB_TOKEN for Docker:** `secrets.GITHUB_TOKEN` is the standard GitHub-managed token; it is not a user secret and is scoped to the workflow job.
- **No stored secrets added to the repository:** This phase adds zero new secrets to GitHub repository settings.
- **Header Trust Model (README D-10):** The README must clearly state: without a header-stripping proxy in front, any caller can set `X-Odoo-Username`/`X-Odoo-Password` to any value, gaining full Odoo user impersonation. This is intentional for the self-hosted/FOSS use case but must be documented for operators. `godoo-proxy` is the named SaaS guard.

---

## Project Constraints (from CLAUDE.md)

| Directive | Impact on Phase 5 |
|-----------|------------------|
| `uv sync --frozen` in CI/Docker | Builder stage uses `uv sync --frozen --no-dev --no-editable`; no bare `pip install` |
| `python:3.14-slim` NOT alpine | D-04 locked; Dockerfile FROM confirmed |
| depend on `godoo-client`, never `godoo` meta-package | Already correct in pyproject.toml |
| Prefer LGPL-3.0 | Already in pyproject.toml |
| SSE transport not used | Not relevant to packaging phase |
| RTK prefix on bash commands | Developer workflow; not a CI concern |
| lockfile-discipline: commit uv.lock with pyproject.toml | MUST run `uv lock` and commit `uv.lock` after adding `[project.scripts]` and `[[tool.uv.index]]` |
| No direct repo edits outside GSD workflow | Phase plan controls all edits |
| Git workflow: commits to `develop`, merge to `main` only for release | publish.yml triggers on `v*` tags from main; develop stays the working branch |

---

## Sources

### Primary (HIGH confidence)
- `docs.astral.sh/uv/guides/integration/docker/` — uv Docker multi-stage pattern, `--no-editable`, cache mounts, uv binary copy
- `github.com/astral-sh/trusted-publishing-examples` (raw workflow YAML) — complete `uv publish --trusted-publishing` workflow; environment names; trigger routing
- `pydevtools.com/handbook/how-to/how-to-publish-to-testpypi-with-uv/` — `[[tool.uv.index]]` stanza for TestPyPI; `uv publish --index testpypi --trusted-publishing always`
- `docs.pypi.org/trusted-publishers/using-a-publisher/` — `permissions: id-token: write`; `pypa/gh-action-pypi-publish` reference (not used; uv publish preferred)
- `docs.npmjs.com/cli/v11/commands/npm-deprecate/` — scoped package deprecation syntax; `npm view` verification
- `hub.docker.com/_/python/tags` (search result) — `python:3.14-slim` confirmed available 2026
- Direct `uv build` execution — wheel contents inspected; skills confirmed bundled; pyproject.toml `[tool.uv_build] include` syntax verified working [VERIFIED: 2026-06-02]
- `docs.github.com/en/actions/use-cases-and-examples/publishing-packages/publishing-docker-images` — GHCR login-action + metadata-action + build-push-action pattern

### Secondary (MEDIUM confidence)
- `packaging.python.org/guides/using-testpypi/` — dual `--index-url` + `--extra-index-url` install pattern for TestPyPI deps not on TestPyPI
- `hynek.me/articles/docker-uv/` — non-root user pattern; `--no-editable` in production multi-stage builds

### Tertiary (LOW confidence — not used in recommendations)
- WebSearch results confirming GHCR vs Docker Hub tradeoffs (multiple sources, consistent)

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — `uv build`/`uv publish` workflow verified; astral official examples retrieved directly
- Architecture: HIGH — Dockerfile pattern from official uv docs; wheel contents verified by direct inspection
- Pitfalls: HIGH — sourced from official docs and verified by testing (uv build run)
- npm deprecation: HIGH — official npm docs; scoped package support confirmed in v11

**Research date:** 2026-06-02
**Valid until:** 2026-09-01 (stable tooling; uv publish API may evolve but major patterns are stable)
