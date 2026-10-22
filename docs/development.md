# Develop the operational MCP server

Use Python 3.14+, `uv` and the committed `uv.lock`. From the checkout root:

```sh
uv sync --frozen --all-groups
uv run --frozen ruff check .
uv run --frozen ruff format --check .
uv run --frozen mypy --strict src/
uv run --frozen pytest --tb=short
node --test .github/scripts/notify-adapter.test.cjs
```

Default pytest excludes both `integration` and `e2e`. Unit/transport checks use
doubles and do not establish real Odoo effects or client acceptance. For
documentation-only changes, inspect the documented source, check affected links
and run `git diff --check`; product tests are not needed merely for wording.

## Verification routes

Use [mcp-verification](../.agents/skills/mcp-verification/SKILL.md) for maintained
commands, isolation and evidence. Choose the smallest relevant boundary:

| Boundary | Path |
| --- | --- |
| MCP discovery, envelope errors and static guidance without Odoo | [Lightweight HTTP recipe](../.agents/skills/mcp-verification/references/http-smoke.md) |
| Real Odoo identities, ACLs, effects and interrupted writes | `uv run --frozen pytest -m integration tests/integration/test_vertical.py --tb=short` |
| Built image and real Odoo | `ODOO_VERSION=18.0 uv run --frozen pytest -m e2e tests/e2e/test_docker_image.py --tb=short` |
| Authorized billable Claude Code write trial | `ODOO_VERSION=18.0 uv run --frozen pytest -m e2e tests/e2e/test_agent_write_flow.py --tb=short` |

The latter three need Docker and disposable Odoo/Postgres; the agent trial also
needs an authenticated `claude` CLI and incurs model calls. Inspect fixture skips
before interpreting results. Run heavy suites serially within current resource
limits; the image test uses a shared tag. Retain safe evidence outside disposable
state and stop only trial-owned resources. Lost write replies require independent
readback before retry; never retry solely to obtain a successful response.

## Source map

Under `src/godoo_mcp_server/`:

| Path | Responsibility |
| --- | --- |
| `server.py` | FastMCP registration, HTTP app, request IDs and tool telemetry |
| `credentials.py` | Header/environment resolution and request-scoped credential state |
| `odoo_runtime.py` | Bounded client cleanup and safe public errors |
| `tools/` | Odoo calls and result envelopes |
| `resources.py`, `catalog.py` | Bundled guidance and target/user-scoped model catalog |
| `links.py` | Odoo browser links added to record results |
| `skills/` | Packaged consumer Markdown, provenance and CC0 notice |
| `__main__.py` | CLI version and uvicorn startup |

Tool registration uses side-effect imports after constructing the FastMCP
instance; preserve that order. The `_SKILL_TOPICS` manifest in `resources.py`
drives guidance loading, discovery and allowed tool paths. Adding a Markdown file
alone does not expose it. Use the
[authoring procedure](../.agents/skills/mcp-guidance-authoring/SKILL.md) for served
content and preserve the bundle's distinct documentation license.

## Packaging and release configuration

`pyproject.toml` declares a single `uv_build` package and the console entrypoint
`godoo-mcp-server = godoo_mcp_server.__main__:main`. `uv build` creates distributions;
inspect the installed wheel when changing packaged resources. The Dockerfile
installs non-editably and copies the virtual environment into a non-root runtime
stage, so guidance must load without the source tree.

The [CI workflow](../.github/workflows/ci.yml) runs lint, formatting, strict typing,
default pytest and sender guards, plus separate package/container and Odoo
integration jobs. The [publish workflow](../.github/workflows/publish.yml) builds
distributions: manual dispatch selects TestPyPI, while `v*` tags select PyPI and
GHCR. Registry publishing uses Trusted Publisher/OIDC with the matching `testpypi`
or `pypi` GitHub environment; GHCR uses the workflow token. These describe
configuration, not proof of a release or a ready registry/environment.

Release, registry setup and deployment require the owning task's authority.
Check actual refs, artifact contents and outcomes rather than inferring
availability from the changelog or configured workflows.

## Adapter update proposals

After `CI` succeeds for a push to the current `develop` head,
`.github/workflows/notify-adapter.yml` validates the source repository, workflow,
run attempt and all three required CI jobs. It sends `repository_dispatch` to
`godoo-dev/godoo-cf-sudo-mcp` with event type `mcp-source-update` and payload:

```json
{"source_sha":"<40 lowercase hex>","ci_run_id":123,"ci_run_attempt":1}
```

The adapter's trusted `.github/workflows/update-mcp.yml` independently validates
that evidence and owns the source manifest and deduplicated update PR. This sender
never checks out the candidate, executes its artifacts, creates an adapter PR or
uses Cloudflare credentials. A race with a newer upstream commit is rechecked by
the receiver; stale evidence is not permission to promote it. Review, adapter CI
and its test-only deployment guards remain on the adapter side.

Provision repository variable `MCP_UPDATE_APP_ID` and secret
`MCP_UPDATE_APP_PRIVATE_KEY` in this repository and the adapter repository for a
GitHub App installed **only on the adapter repository**, with Contents and Pull
requests write permissions. The sender requests only an adapter Contents write
token (required for repository dispatch); the receiver requests the permissions
needed to create its PR. Tokens are short-lived and revoked by the token action.
Activation requires the receiver on adapter `main` and this sender on MCP
`develop`, as well as App provisioning in both repositories. Missing provisioning
fails explicitly; there is no PAT fallback. Configuration and offline checks do
not establish a successful hosted dispatch or deployment.

Run the dependency-free sender checks with
`node --test .github/scripts/notify-adapter.test.cjs`; ordinary CI includes them.
