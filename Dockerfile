# Multi-stage build — builder installs deps + project into .venv; runtime copies only .venv.
# D-03: build from source (independent of PyPI publish status).
# D-04: python:3.14-slim base (NOT alpine — musl breaks httpx/anyio).
# Source: docs.astral.sh/uv/guides/integration/docker/ + hynek.me/articles/docker-uv/

# ---- builder ----
FROM python:3.14-slim@sha256:a2b82f3c48559aa0a8446d9af49826b6e2b2016f4cd2afabfe6013ec53729170 AS builder

# Copy uv binary from official image (T-05-12: pinned version for supply-chain integrity)
COPY --from=ghcr.io/astral-sh/uv:0.12.5@sha256:e85be844203885286c60ffad8a858d48afb6c5a5c237ca0e67f12e74b8f174b1 /uv /bin/uv

WORKDIR /app

# Layer-cache: install dependencies first (deps change less often than source).
# mount-bind uv.lock + pyproject.toml without copying them into the layer.
RUN --mount=type=cache,target=/root/.cache/uv \
    --mount=type=bind,source=uv.lock,target=uv.lock \
    --mount=type=bind,source=pyproject.toml,target=pyproject.toml \
    uv sync --frozen --no-dev --no-install-project

# Copy full source tree, then install project non-editable.
# --no-editable embeds the package (+ skill .md files) into .venv/lib/python3.14/site-packages/
# so importlib.resources.files("godoo_mcp_server") resolves correctly in the runtime stage
# (RESEARCH Pitfall 2: omitting --no-editable breaks importlib.resources in multi-stage builds).
COPY . /app
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev --no-editable

# ---- runtime ----
# T-05-11: runtime stage copies only .venv — no uv binary, no source tree, no build cache.
FROM python:3.14-slim@sha256:a2b82f3c48559aa0a8446d9af49826b6e2b2016f4cd2afabfe6013ec53729170

WORKDIR /app

# Copy the fully self-contained venv (installed package + bundled skill .md files).
COPY --from=builder /app/.venv /app/.venv

# T-05-10: run as non-root godoo user (least-privilege).
RUN groupadd -r godoo && useradd -r -d /app -g godoo -N godoo
USER godoo

# .venv/bin/godoo-mcp-server is the console script installed from [project.scripts].
ENV PATH="/app/.venv/bin:$PATH"
# HOST/PORT are read by main() in __main__.py; set defaults here for clarity.
ENV HOST="0.0.0.0"
ENV PORT="8000"

# D-05: HEALTHCHECK using Python stdlib urllib — no curl needed in slim image (T-05-13).
# --start-period=15s gives uvicorn time to start up.
# NOTE: if PORT is overridden at container run time, this HEALTHCHECK still targets 8000.
# Override via HEALTHCHECK instruction or a custom health probe in that case.
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/healthz')" || exit 1

# D-06: console script entrypoint installed from [project.scripts] in pyproject.toml.
CMD ["godoo-mcp-server"]
