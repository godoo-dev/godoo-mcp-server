# Phase 5: Package & Ship - Pattern Map

**Mapped:** 2026-06-02
**Files analyzed:** 5 new/modified files
**Analogs found:** 4 / 5 (1 has no in-repo analog)

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `.github/workflows/publish.yml` | config/CI | request-response (OIDC + artifact upload) | `.github/workflows/ci.yml` | role-match |
| `pyproject.toml` (edit) | config | CRUD (table additions) | `pyproject.toml` itself | exact (self-analog) |
| `Dockerfile` | config/infra | batch (build pipeline) | none in-repo | no analog |
| `README.md` (edit) | docs | n/a | `README.md` itself | exact (self-analog) |
| `uv.lock` (commit) | lockfile | n/a | existing committed `uv.lock` (if present) | exact |

---

## Pattern Assignments

### `.github/workflows/publish.yml` (config/CI, request-response)

**Analog:** `.github/workflows/ci.yml`

**Job structure pattern** (lines 1-72 of ci.yml — full file is 72 lines):

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
        python-version: ["3.14"]

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
```

**Key conventions to carry forward into publish.yml:**
- `actions/checkout@v4` — already the version in use; keep it.
- `astral-sh/setup-uv@v5` — the version used in ci.yml. RESEARCH.md recommends v6; use v6 in publish.yml (upgrade from v5 is additive and non-breaking).
- `ubuntu-latest` — all jobs use this runner; continue the pattern.
- `uv sync --frozen` — mandatory per CLAUDE.md `lockfile-discipline` and `uv sync --frozen` directives; the publish workflow uses `uv build` (no sync needed), but the convention of never using bare `pip install` carries.
- `actions/setup-python@v5` — present in ci.yml but NOT required in publish.yml jobs that only run `uv build` / `uv publish` (uv manages its own Python). Omit from build and publish jobs; only include if a smoke-test step needs a bare `python`.

**Two-path routing pattern** (from RESEARCH.md Pattern 1 — no in-repo analog exists; copy verbatim):

```yaml
# publish.yml trigger block — two paths: button = rehearse, tag = ship
on:
  workflow_dispatch:          # manual button → TestPyPI
  push:
    tags:
      - "v*"                  # git tag push → production PyPI + Docker
```

**OIDC permissions pattern** (required for Trusted Publisher; no analog in ci.yml — ci.yml uses no id-token):

```yaml
permissions:
  id-token: write    # required for uv publish --trusted-publishing
```

**Artifact pass-through pattern** (build once, publish twice — from RESEARCH.md Pattern 1):

```yaml
# In build job:
- uses: actions/upload-artifact@v4
  with:
    name: dist
    path: dist/

# In publish jobs:
- uses: actions/download-artifact@v4
  with:
    name: dist
    path: dist/
```

**Critical: checkout required in publish jobs** (RESEARCH.md Pitfall 1):
`uv publish --index testpypi` reads `pyproject.toml` for the index URL. Every publish job must include `actions/checkout@v4` even though it downloads a pre-built artifact.

**Conditional job pattern** (from RESEARCH.md Pattern 1):

```yaml
publish-testpypi:
  if: github.event_name == 'workflow_dispatch'
  needs: build
  environment: testpypi        # must match TestPyPI Trusted Publisher config exactly

publish-pypi:
  if: github.event_name == 'push' && startsWith(github.ref, 'refs/tags/v')
  needs: build
  environment: pypi            # must match PyPI Trusted Publisher config exactly

publish-docker:
  if: github.event_name == 'push' && startsWith(github.ref, 'refs/tags/v')
  needs: build
  permissions:
    contents: read
    packages: write            # required for GHCR push
```

**Docker GHCR pattern** (from RESEARCH.md Pattern 1; no in-repo analog):

```yaml
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

---

### `pyproject.toml` (edit — two additive table insertions)

**Analog:** `pyproject.toml` itself (lines 1-61)

**Existing table layout to preserve** (lines 1-61 — full file):

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
    "cachetools>=7,<8",
]

[dependency-groups]
dev = [ ... ]

[tool.ruff]
...

[tool.mypy]
...

[tool.pytest.ini_options]
...

[tool.uv_build]
include = ["src/godoo_mcp_server/skills/**"]
```

**Insertion 1 — console script** (D-09; insert after `[project]` block, before `[dependency-groups]`):

```toml
[project.scripts]
godoo-mcp-server = "godoo_mcp_server.__main__:main"
```

Target function signature confirmed at `src/godoo_mcp_server/__main__.py` line 15:
```python
def main() -> None:
    """Start the MCP server or print version."""
```

**Insertion 2 — TestPyPI index stanza** (D-08; append after `[tool.uv_build]` at end of file):

```toml
[[tool.uv.index]]
name = "testpypi"
url = "https://test.pypi.org/simple/"
publish-url = "https://test.pypi.org/legacy/"
explicit = true
```

`explicit = true` prevents TestPyPI from being consulted during normal `uv sync` resolution — critical to avoid dependency resolution contamination.

**DO NOT TOUCH** (RESEARCH.md Pitfall 6):
`[tool.uv_build] include = ["src/godoo_mcp_server/skills/**"]` — already verified correct and producing proper wheels. The syntax `[tool.uv_build]` (not `[tool.uv.build-backend]`) is the stable API.

**Post-edit mandatory step** (CLAUDE.md `lockfile-discipline`):
After any `pyproject.toml` edit: `uv lock` then stage and commit `uv.lock` in the same commit as `pyproject.toml`.

---

### `Dockerfile` (new — no in-repo analog)

**Analog:** None. Closest external references are RESEARCH.md Pattern 3 (uv multi-stage) and official `docs.astral.sh/uv/guides/integration/docker/`.

**Multi-stage pattern** (from RESEARCH.md Pattern 3 — use as the direct template):

```dockerfile
FROM python:3.14-slim AS builder

# Copy uv binary from official image (pin version for reproducibility)
COPY --from=ghcr.io/astral-sh/uv:0.7.12 /uv /bin/uv

WORKDIR /app

# Layer-cache: install deps first (changes less often than source)
RUN --mount=type=cache,target=/root/.cache/uv \
    --mount=type=bind,source=uv.lock,target=uv.lock \
    --mount=type=bind,source=pyproject.toml,target=pyproject.toml \
    uv sync --frozen --no-dev --no-install-project

# Copy source and install project non-editable (skills embedded in .venv)
COPY . /app
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev --no-editable

# ---- runtime ----
FROM python:3.14-slim

WORKDIR /app

COPY --from=builder /app/.venv /app/.venv

# Non-root user (security best practice — Claude's Discretion)
RUN groupadd -r godoo && useradd -r -d /app -g godoo -N godoo
USER godoo

ENV PATH="/app/.venv/bin:$PATH"
ENV HOST="0.0.0.0"
ENV PORT="8000"

# D-05: HEALTHCHECK using stdlib urllib (no curl in slim image)
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/healthz')" || exit 1

# D-06: console script (installed to .venv/bin/ from [project.scripts])
CMD ["godoo-mcp-server"]
```

**HEALTHCHECK target** confirmed at `src/godoo_mcp_server/server.py` lines 37-40:

```python
@mcp.custom_route("/healthz", methods=["GET"])
async def healthz(request: Request) -> JSONResponse:
    """Unauthenticated health check — carve-out handled in CredentialMiddleware."""
    return JSONResponse({"status": "ok"})
```

**Console script target** confirmed at `src/godoo_mcp_server/__main__.py` lines 15-23:

```python
def main() -> None:
    """Start the MCP server or print version."""
    if "--version" in sys.argv:
        print(f"godoo-mcp-server {__version__}")
        sys.exit(0)
    app: Any = create_app()
    host = os.environ.get("HOST", "0.0.0.0")
    port = int(os.environ.get("PORT", "8000"))
    uvicorn.run(app, host=host, port=port)  # noqa: S104
```

**Critical pitfalls for Dockerfile** (RESEARCH.md):
- Use `--no-editable` in the second builder `uv sync` call — otherwise `importlib.resources.files("godoo_mcp_server")` breaks in the runtime stage (Pitfall 2).
- Do NOT copy `src/` into the runtime stage — with `--no-editable` the package is self-contained in `.venv` (RESEARCH.md anti-patterns).
- Do NOT add `uv` to the runtime stage.

---

### `README.md` (edit — additive sections)

**Analog:** `README.md` itself (lines 1-27 — full file is 27 lines, a Phase 1 scaffold stub)

**Existing content to preserve** (lines 1-27):

```markdown
# godoo-mcp-server

Stateless MCP server for Odoo — raw primitives + skill resources.

> Phase 1 scaffold — full documentation coming in later phases.

## Running E2E tests locally
...
```

**Replacement of scaffold notice:** Remove the `> Phase 1 scaffold — full documentation coming in later phases.` callout. It is no longer accurate once the package ships.

**New section 1 — Install** (REL-01, SC-1; required for a released package):

```markdown
## Installation

```bash
pip install godoo-mcp-server
```

Or with Docker:

```bash
docker run -e ODOO_URL=https://your.odoo.instance \
           -e ODOO_DATABASE=mydb \
           -e ODOO_USERNAME=admin \
           -e ODOO_PASSWORD=secret \
           -p 8000:8000 \
           ghcr.io/godoo-dev/godoo-mcp-server:latest
```
```

**New section 2 — Security: Header Trust Model** (D-10, REL-04, SC-3; must include godoo-proxy reference):

```markdown
## Security: Header Trust Model

`godoo-mcp-server` authenticates Odoo users via `X-Odoo-Username` and
`X-Odoo-Password` request headers (or `ODOO_USERNAME` / `ODOO_PASSWORD`
environment variables). **This means any caller who can reach the server
can impersonate any Odoo user by setting these headers.**

This is intentional for self-hosted / trusted-network deployments. In
production, you MUST deploy a header-stripping reverse proxy in front of
the server that enforces identity. [`godoo-proxy`](https://github.com/godoo-dev/godoo-proxy)
is the SaaS-safe gateway for this role — it implements OAuth 2.1 / SSO
and injects verified per-user credentials before forwarding to
`godoo-mcp-server`.

If you expose `godoo-mcp-server` directly on a public network without a
trusted proxy, any network peer gains full Odoo impersonation capability.
```

**Validation commands** (from RESEARCH.md Validation Architecture):
```bash
grep -c "Security: Header Trust Model" README.md   # must return 1
grep -c "godoo-proxy" README.md                    # must return >= 1
```

---

### `uv.lock` (commit — lockfile discipline)

**Analog:** The existing `uv.lock` file (already tracked in repo if present from prior phases).

No pattern extraction needed — this is a generated file. The only rule is from CLAUDE.md `lockfile-discipline`:

> When running any package manager install/add command, always stage and commit the lockfile together with `pyproject.toml` in the same commit.

Concretely: after adding `[project.scripts]` and `[[tool.uv.index]]` to `pyproject.toml`, run:

```bash
uv lock
```

Then stage both `pyproject.toml` and `uv.lock` in a single commit. CI uses `uv sync --frozen` (confirmed in ci.yml line 30), which requires the lockfile to be in sync.

---

## Shared Patterns

### uv sync --frozen (mandatory everywhere)

**Source:** `.github/workflows/ci.yml` line 30: `run: uv sync --frozen --dev`

**Apply to:** All CI jobs that install dependencies. In publish.yml, `uv build` does not need a `uv sync` step (it reads pyproject.toml directly), but if a smoke-test step is added, use `uv sync --frozen` (never bare `pip install`).

```yaml
- name: Install dependencies
  run: uv sync --frozen --dev    # ci.yml pattern — omit --dev for publish build job
```

### actions/checkout@v4 + astral-sh/setup-uv

**Source:** `.github/workflows/ci.yml` lines 17-22

**Apply to:** All jobs in publish.yml. Every job needs checkout (Pitfall 1 — uv publish --index reads pyproject.toml). setup-uv version: use v6 in publish.yml (upgrade from v5 used in ci.yml; v6 is the RESEARCH.md recommendation).

```yaml
- uses: actions/checkout@v4
- uses: astral-sh/setup-uv@v6
  with:
    version: "latest"
```

### Version single-source

**Source:** `src/godoo_mcp_server/__init__.py` line 3: `__version__ = "0.1.0"`

**Apply to:** Keep `pyproject.toml` version (`version = "0.1.0"`, line 6) in sync with `__init__.py`. Both are currently `0.1.0`. When Marc sets the production version at ship time, both must be updated together. The `main()` function reads from `__version__` (confirmed at `__main__.py` line 18: `print(f"godoo-mcp-server {__version__}")`).

---

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `Dockerfile` | config/infra | batch | No existing Dockerfile in repo. Use RESEARCH.md Pattern 3 verbatim as the starting template. The only in-repo touchpoints are the `/healthz` route and `main()` function (already extracted above). |

---

## Metadata

**Analog search scope:** `.github/workflows/`, `pyproject.toml`, `README.md`, `src/godoo_mcp_server/`
**Files scanned (Read):** 6 (`ci.yml`, `pyproject.toml`, `__main__.py`, `README.md`, `__init__.py`, `server.py` via Grep)
**Pattern extraction date:** 2026-06-02
