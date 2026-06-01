# Stack Research

**Domain:** FOSS, stateless, Python MCP server with Streamable HTTP transport — Odoo primitive toolset + skill resources + sandboxed code execution
**Researched:** 2026-06-01
**Confidence:** HIGH (core stack); MEDIUM (sandbox section — deliberately comparative per project decision)

---

## Recommended Stack

### Core Technologies

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| `fastmcp` (PrefectHQ standalone) | 3.3.1 | MCP server framework — tools, resources, Streamable HTTP | The original FastMCP (v1) was incorporated into the official `mcp` SDK in 2024; the standalone PrefectHQ project then diverged to v2/v3 with a richer feature set: composition, middleware, proxy, auth hooks, resource templating, MCP Apps. It powers ~70% of MCP servers across all languages and is downloaded 1M times/day. For this project's resource-heavy pattern (skill Markdown files, per-user catalog, ACL-gated tools), the higher-level decorator surface justifies the standalone. Requires Python ≥3.10. |
| `mcp` (official Anthropic SDK) | 1.27.2 | MCP protocol primitives — used by `fastmcp` internally or as fallback | Authoritative Anthropic/Linux Foundation SDK. Released 2026-05-29. Ships FastMCP (v1 lineage) bundled. Use directly only if low-level session/lifecycle control is required that standalone `fastmcp` cannot expose. Pulls in starlette ≥0.27, uvicorn ≥0.31.1, httpx ≥0.27.1, pydantic ≥2.11, anyio ≥4.5 as hard transitive deps — understanding these is important for Docker image sizing. |
| `uvicorn` | 0.48.0 | ASGI server — runs the Starlette ASGI app produced by `fastmcp` | `fastmcp`/`mcp` already declare `uvicorn>=0.31.1` as a dependency. No separate version pin needed; pulled transitively. Used directly for `uvicorn godoo_mcp_server.main:app` entrypoint or inside a `Dockerfile CMD`. Do NOT use gunicorn+uvicorn workers — stateless design means single-process uvicorn is correct; adding gunicorn adds complexity with no benefit. |
| `starlette` | 1.2.1 | ASGI framework — mounted internally by `fastmcp`; used for custom middleware (credential header extraction) | Pulled transitively by `mcp`/`fastmcp`. You interact with it only for middleware (extracting `X-Odoo-*` headers per request) and potentially ASGI `Mount` for multi-server compositions. Do not add FastAPI on top — it adds unnecessary weight; Starlette alone is sufficient for the credential middleware layer. |
| `godoo-client` | 0.2.1 | Async Odoo JSON-RPC client — all Odoo RPC calls | Internal godoo-dev project. Current PyPI release is 0.2.1 (2026-05-22). Requires Python ≥3.14 and `httpx>=0.27`. Fully async (AsyncIO). The `godoo` meta-package (0.2.1) ships no importable code — depend directly on `godoo-client`, not `godoo`. **Pin:** `godoo-client>=0.2,<0.3` to track the minor series (PROJECT.md calls this `>=1.1,<1.2` but the PyPI package uses 0.x semver; resolve with Marc at Wave 1 start). |
| Python | 3.14 | Runtime | `godoo-client` requires `>=3.14`; this is the hard floor set by the primary dependency. Official `python:3.14-slim` Docker image is available. `fastmcp` supports ≥3.10 — the godoo-client constraint dominates. |

### Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `cachetools` | 7.1.4 | In-process LRU + TTL catalog cache with schema-hash invalidation | Wave 2 catalog cache. Use `TTLCache` (LRU + TTL combined) keyed by `(odoo_url, database, schema_hash)`. Pure-Python, zero deps, thread-safe with explicit locking in async context. **Not** async-native — wrap access in `asyncio.Lock` for concurrent request safety. |
| `pydantic` | ≥2.11 (transitive) | Request/response validation, tool input schemas | Already pulled by `mcp`. Use pydantic models for all tool input/output shapes — `fastmcp` infers JSON Schema from them automatically. Do not define raw JSON Schema dicts. |
| `httpx` | ≥0.27 (transitive) | HTTP client used by `godoo-client` | Pulled by both `godoo-client` and `mcp`. No additional pin needed. |
| `anyio` | ≥4.5 (transitive) | Async primitives, used by `mcp` internals | Pulled by `mcp`. Use `anyio.to_thread.run_sync()` if you need to call any sync code from async context (e.g., schema-hash computation). |

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| `uv` | Package manager, venv, build, publish | Use `uv sync` for development, `uv build` for release artifacts. Replace pip/poetry/hatch CLI entirely. Do not use `pip install` in CI or Dockerfile directly — use `uv sync --frozen`. |
| `hatchling` | Build backend (pyproject.toml) | Best-practice Python build backend for pure-Python packages in 2025-2026. Configured in `[build-system]`. Handles console_scripts, version from `__version__`, includes/excludes. Alternative: `uv_build` (zero-config, tighter uv integration) — choose `uv_build` if no custom file selection or dynamic versioning is needed. |
| `pytest` | 9.0.3 | Test runner | Standard. Configure with `pyproject.toml [tool.pytest.ini_options]`. |
| `pytest-asyncio` | 1.1.0 | Async test support | Required for testing all async tool handlers, catalog cache, credential resolution. Use `asyncio_mode = "auto"` in pyproject.toml to avoid per-test decorator boilerplate. Do NOT mix with anyio's pytest plugin (`anyio_mode = "auto"`) — they conflict. Pick one; use pytest-asyncio since `mcp`'s own test patterns use it. |
| `ruff` | latest | Linter + formatter | Replaces flake8 + black + isort in a single tool. Configure in `[tool.ruff]`. Required for pre-commit. |
| `mypy` | latest | Static type checking | Strict mode (`--strict`). `godoo-client` ships typed stubs (LGPL async SDK). Use `pyproject.toml [tool.mypy]`. |

---

## Sandbox Section (Research-Gated — Wave 3 Decision)

The `execute_odoo_code` Code Mode tool requires sandboxed execution of agent-authored Python. The sandbox mechanism is explicitly deferred to Wave 3 planning. This section is comparative, not prescriptive.

### Option A: Subprocess (asyncio) with OS-level restriction

**Mechanism:** `asyncio.create_subprocess_exec()` spawning a Python child process. The child receives a restricted environment: no network socket access (via seccomp/AppArmor on Linux, or iptables rules), godoo RPC calls intercepted through a local proxy socket that enforces the allowlist.

**Libraries:**
- `asyncio` (stdlib) — subprocess management, timeout enforcement
- `seccomp` (Linux syscall filtering, via `python-libseccomp`) — blocks `socket()`, `execve()` etc.
- No external sandbox library required for the subprocess approach itself

**Security tradeoffs:**
- `+` No Docker daemon dependency in the server process; simpler deployment
- `+` Lower latency per invocation (no container startup)
- `+` Works in Docker-in-Docker-free environments (e.g., managed Kubernetes without privileged mode)
- `-` seccomp/AppArmor is Linux-only; loses security guarantees on macOS dev machines
- `-` Filesystem isolation requires explicit `chroot`/bind mounts or careful `PYTHONPATH` restriction
- `-` Network isolation requires OS-level rules outside the Python process; easy to misconfigure
- `-` RestrictedPython (AST rewriting) is a tempting add-on but is NOT a security boundary — Python's dynamic nature makes AST-level sandboxing escapable; do not use as primary defense
- `-` Per-invocation isolation (no state leakage between agent calls) requires spawning a fresh process each time — adds ~100-300ms cold start

**When appropriate:** Self-hosted deployments where Docker is not available; embedded/library use where adding a Docker sidecar is impractical.

### Option B: Docker Sidecar

**Mechanism:** A long-running (or per-request) Python container with no network interface except a local socket back to the MCP server's godoo RPC proxy. Agent code is sent to the container; output is captured and returned. The container image contains only the restricted godoo surface (no credentials, no raw httpx access).

**Libraries:**
- `docker` Python SDK (`docker>=7`) — communicate with Docker daemon
- OR `aiodocker` — async Docker client (preferable for async server)
- Container image: `python:3.14-slim` with only `godoo-client` installed; no `requests`, no `urllib3` beyond what godoo needs; network policy = no egress except loopback

**Security tradeoffs:**
- `+` Strongest isolation: filesystem, network, PID, IPC namespaces
- `+` Memory and CPU limits enforced at kernel level (`--memory`, `--cpus`)
- `+` Network policy enforced by Docker's bridge network; no iptables customization needed in the server itself
- `+` Portable across Linux and macOS (Docker Desktop)
- `+` Compatible with gVisor runtime (`--runtime=runsc`) for defense-in-depth against kernel exploits
- `-` Requires Docker daemon accessible from the MCP server process — complicates pip-only deployments
- `-` Container startup time (cold): 500ms–2s for a fresh container; mitigated by container pooling/warm pool
- `-` Docker-in-Docker for containerized MCP server deployments requires privileged mode or socket mounting — security regression
- `-` More operational complexity: image lifecycle, warm pool management, resource limits per deployment

**When appropriate:** Production self-hosted deployments where Docker is available; security-critical environments; multi-tenant (godoo-proxy) deployments.

### Recommendation for Wave 3 Planning

Both are viable. The key constraint is the deployment model:
- If `godoo-mcp-server` runs as a **bare pip process** (no outer Docker): subprocess + seccomp is simpler
- If `godoo-mcp-server` runs **as a Docker container** (primary target): Docker-in-Docker is problematic; use subprocess + seccomp inside the container, OR restructure as two containers (MCP server + code executor sidecar) with a Docker Compose or Kubernetes sidecar pattern
- A hybrid is common in practice: subprocess for development, Docker sidecar for production — controlled by a `CODE_MODE_SANDBOX=subprocess|docker` env var

**Deeper research needed at Wave 3:** aiodocker vs docker SDK async story; warm pool implementation; seccomp profile for godoo-client's httpx usage (it needs `socket()` for the allowlisted RPC call, so the filter must be selective, not blanket).

---

## Packaging & Docker

### pyproject.toml Build Setup

```toml
[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[project]
name = "godoo-mcp-server"
requires-python = ">=3.14"
dependencies = [
    "fastmcp>=3.3,<4",
    "godoo-client>=0.2,<0.3",
    "cachetools>=7,<8",
]

[project.scripts]
godoo-mcp-server = "godoo_mcp_server.main:run"
```

Use `uv_build` instead of `hatchling` if no dynamic versioning or custom file inclusion is needed — it is zero-config and integrates tighter with `uv publish`.

### Docker Base Image

Use `python:3.14-slim` (Debian-based). Rationale:
- Minimal attack surface vs `python:3.14` (full Debian)
- `godoo-client` and `fastmcp` have no C-extension build requirements that would need `-slim-buster` workarounds
- Do NOT use `python:3.14-alpine` — musl libc causes httpx/anyio issues; not worth the size saving

Multi-stage build pattern (uv-based):
```dockerfile
FROM ghcr.io/astral-sh/uv:latest AS uv
FROM python:3.14-slim AS runtime
COPY --from=uv /uv /usr/local/bin/uv
WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev
COPY src/ ./src/
CMD ["uv", "run", "godoo-mcp-server"]
```

---

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| `fastmcp` standalone (PrefectHQ 3.3.x) | `mcp` SDK built-in FastMCP (1.27.2) | Use official SDK's built-in FastMCP if you need stable Anthropic-backed guarantees with minimal dependency surface; it's less feature-rich but formally maintained by the protocol owners. Both are viable; standalone fastmcp has more active development. |
| `fastmcp` standalone | Custom Starlette + low-level `mcp` | Only if fastmcp's abstractions conflict with a deeply custom session/lifecycle requirement. Not the case here. |
| `uvicorn` (single process) | `gunicorn` + uvicorn workers | Gunicorn multi-worker is for stateful apps sharing memory — adds complexity with no benefit for a stateless server. |
| `hatchling` or `uv_build` | `poetry-core`, `flit-core` | poetry-core ties you to poetry CLI; flit is minimal but lacks the uv ecosystem integration. Both are viable but less recommended for new 2026 projects. |
| `cachetools.TTLCache` | `aiocache`, `dogpile.cache` | `aiocache` adds Redis/memcached deps and async complexity not needed for a single-process in-memory cache. `cachetools` is the right weight. |
| `pytest-asyncio` | `anyio` pytest plugin | They conflict when both installed in auto mode. `pytest-asyncio` is the right choice since `mcp` SDK tests use it; anyio plugin would require explicit `pytest.mark.anyio` on every test. |
| `ruff` | `black` + `flake8` + `isort` | Ruff replaces all three in one binary; black/flake8/isort are legacy for new projects. |

---

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| `RestrictedPython` as primary sandbox | AST rewriting is not a security boundary — documented escape vectors exist; disallows try/except* as of 8.x; false confidence | OS-level isolation (seccomp subprocess OR Docker) |
| `gunicorn` | Stateless single-process server; gunicorn multi-worker adds shared-memory complexity and worker recycling that fights the stateless design | `uvicorn` single process |
| `FastAPI` on top of `fastmcp` | FastMCP is already an ASGI app; adding FastAPI for one or two credential middleware routes is over-engineering | Starlette `Middleware` class directly |
| `godoo` (meta-package) as dependency | The meta-package ships no importable code; it's a namespace holder. Depending on it installs nothing useful. | `godoo-client>=0.2,<0.3` directly |
| `python:3.14-alpine` Docker base | musl libc breaks httpx SSL and anyio event loop behavior | `python:3.14-slim` (glibc) |
| `aiocache` / `dogpile` | Heavyweight; introduces optional Redis/memcached backends not needed for single-process in-memory catalog cache | `cachetools.TTLCache` |
| SSE transport | Deprecated in favor of Streamable HTTP for remote deployments; SSE is uni-directional and lacks resumability | `transport="streamable-http"` with `stateless_http=True` |

---

## Version Compatibility

| Package | Compatible With | Notes |
|---------|-----------------|-------|
| `fastmcp>=3.3,<4` | `mcp>=1.27` (transitive) | fastmcp 3.x depends on fastmcp-slim which bundles its own mcp protocol impl; check that transitive `mcp` version does not conflict if pinning `mcp` explicitly |
| `godoo-client>=0.2,<0.3` | Python >=3.14 | Hard floor on Python version |
| `cachetools>=7,<8` | Python >=3.8 | No conflicts |
| `pytest-asyncio>=1.1` | `pytest>=9` | 1.x requires pytest >=9; confirmed compatible |
| `python:3.14-slim` (Docker) | All above | As of 2026-06-01, 3.14 is available on Docker Hub (verify `python:3.14-slim` tag exists before Dockerfile commit) |

---

## Sources

- PyPI `mcp` 1.27.2 metadata (fetched 2026-06-01) — versions, deps, Streamable HTTP transport confirmation — HIGH confidence
- PyPI `fastmcp` 3.3.1 metadata (fetched 2026-06-01) — version, Python requirement, relationship to official SDK — HIGH confidence
- PyPI `godoo-client` 0.2.1 metadata (fetched 2026-06-01) — version, Python ≥3.14 requirement, httpx dep, async surface — HIGH confidence
- PyPI `godoo` 0.2.1 metadata (fetched 2026-06-01) — meta-package, no importable code, do not depend on directly — HIGH confidence
- PyPI `cachetools` 7.1.4 metadata (fetched 2026-06-01) — TTLCache confirmed — HIGH confidence
- PyPI `uvicorn` 0.48.0 metadata (fetched 2026-06-01) — HIGH confidence
- PyPI `pytest-asyncio` 1.1.0 metadata (fetched 2026-06-01) — HIGH confidence
- PyPI `pytest` 9.0.3 metadata (fetched 2026-06-01) — HIGH confidence
- GitHub: `modelcontextprotocol/python-sdk` README (fetched 2026-06-01) — Streamable HTTP, stateless_http, ASGI mounting patterns — HIGH confidence
- GitHub: `PrefectHQ/fastmcp` README (fetched 2026-06-01) — v3.3.1, history of FastMCP v1 incorporation, standalone divergence — HIGH confidence
- `gofastmcp.com/deployment/running-server` (fetched 2026-06-01) — `mcp.run(transport="http")`, `http_app()` ASGI method — HIGH confidence
- `dida.do/blog/setting-up-a-secure-python-sandbox-for-llm-agents` — gVisor + jupyter-client architecture — MEDIUM confidence
- WebSearch: subprocess vs Docker sandbox tradeoffs, seccomp, gVisor, RestrictedPython limitations — MEDIUM confidence (corroborated across multiple sources)
- WebSearch: uv + hatchling + Docker multi-stage build patterns 2025-2026 — MEDIUM confidence
- `astral.sh/uv/guides/integration/docker/` — uv Docker integration patterns — HIGH confidence (official docs)

---

*Stack research for: godoo-mcp-server — Python Streamable HTTP MCP server for Odoo*
*Researched: 2026-06-01*
