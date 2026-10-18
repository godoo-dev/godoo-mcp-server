---
name: mcp-verification
description: Verify godoo-mcp-server over Streamable HTTP, real Odoo Testcontainers and built packages/images, or maintain the affected verification instructions. Use for MCP protocol, Odoo tools, credential isolation and interrupted-write evidence.
---

# Verify godoo-mcp-server

Choose the smallest path that reaches the requested behavior. This repository owns
MCP and Odoo tool behavior; hosted OAuth, gateway credential lifecycle and platform
idle/sleep acceptance belong to the adapter. Keep those results separate.

## Prepare and identify the run

Work from the selected checkout root. Record `git rev-parse HEAD`,
`git status --short`, the command, exit status and selected/skipped tests. A dirty
checkout needs its diff with the evidence; an ancestor's checks do not verify a
changed source tree. Resolve evidence placement through owner-paths or the project's
local guidance. Keep credentials and record contents out of shared transcripts.

Use Python 3.14+ and the lockfile: `uv sync --frozen --all-groups` when dependencies
need preparation. An existing environment can be identified cheaply with
`.venv/bin/godoo-mcp-server --version` and `importlib.metadata.version` for `fastmcp`
and `mcp`. The console command and `python -m godoo_mcp_server` run the same entrypoint.
`HOST` and `PORT` select the listener; use an owned loopback port for local trials.

Read current owner resource restrictions before launching Docker or builds. With a
restricted host, exercise the lightweight HTTP path and reuse attributable CI
results; leave deferred real-Odoo/container/client trials explicitly unexecuted.

## Choose the proof

| Requested behavior | Supported path and observation |
| --- | --- |
| Fresh independent requests, discovery, metadata errors, request IDs, bundled skill resources | Follow [the lightweight HTTP trial](references/http-smoke.md). This runs the actual server process without Odoo and does not prove tool authentication or writes. |
| Odoo primitives, per-request users/ACLs, safe errors, cancellation and ambiguous writes | `uv run --frozen pytest -m integration tests/integration/test_vertical.py --tb=short`. Integration fixtures force Odoo18, query its actual major version and use disposable `TestHarness` containers. |
| Installed package and built-image operation | Follow the package/container commands below and inspect both imports/resources and an actual tool result. |
| Claude Code actually invokes a write | The opt-in agent test below requires runnable/authenticated Claude Code and incurs a model call. Discovery alone does not establish invocation. |

For source-level regression checks use the existing suite:

```bash
uv run --frozen ruff check .
uv run --frozen ruff format --check .
uv run --frozen mypy --strict src/
uv run --frozen pytest --tb=short
```

Default pytest excludes both integration and E2E; its pass count is not real-Odoo
or client acceptance. `tests/conftest.py` also supplies protocol metadata/headers
for convenience: use raw HTTP or `AsyncClient.post` directly when checking malformed
or absent envelopes, as the transport tests do.

## Real Odoo and interrupted writes

Docker CLI/daemon and image access are prerequisites. `tests/integration/conftest.py`
owns Odoo18 plus PostgreSQL, an administrator and a portal user. Distinct containers
isolate its `test_odoo` database from other runs. Server process fixtures use
independent ports and logs under pytest's temporary directory.

Use `-k` to select affected journeys when a full integration run adds no evidence.
Inspect `tests/integration/test_vertical.py` for the current test names. Its real
Odoo commit relay forwards actual RPC and withholds/drops only the marked reply;
it is not a replacement Odoo server. Lost replies, keepalive, caller disconnect
and process kill/restart are distinct checks. Preserve independent database
readback showing one committed row, exactly one forwarded write, cleanup, later
two-user identity/ACL calls and correlated uncertainty telemetry where the process
survives. A killed process cannot emit a finished event. Never retry a possibly
committed write merely to obtain a successful response.

After an unexpected failure, inspect the owned server/container logs and recheck
health and Odoo readiness before interpreting a timeout. Retain failed evidence;
classify an environment or harness failure separately from a product regression.

## Packages, containers and optional client

When builds are permitted, `.github/workflows/ci.yml` is the maintained packaging
path: `uv build`, install the wheel into an isolated target, verify the import and
bundled `skills/SKILL.md`, build the Dockerfile, check `/healthz`, then run:

```bash
ODOO_VERSION=18.0 uv run --frozen pytest -m e2e tests/e2e/test_docker_image.py --tb=short
```

This test builds an image and calls `record_search` through real HTTP against a
real Odoo Testcontainer. It needs no Claude login. If the exact Odoo version matters,
retain the server version observation as well as the requested image/version.
The E2E image tag is shared (`godoo-mcp-server:e2e-test`): serialize this module on
one Docker daemon so one run cannot remove another's image.

For an authorized, billable Claude Code write trial:

```bash
ODOO_VERSION=18.0 uv run --frozen pytest -m e2e tests/e2e/test_agent_write_flow.py --tb=short
```

The test uses a temporary MCP config, `--strict-mcp-config`, scoped allowed tools
and independent Odoo readback of the unique created category. Record client version,
actual result and skips; absent authentication is unverified coverage. This path
does not establish Claude.ai/Desktop OAuth or managed adapter onboarding.

## Evidence, cleanup and upkeep

Retain commands, revision, results and relevant process/relay logs before temporary
state disappears (`--basetemp` can place pytest logs in a unique owned evidence
subdirectory). For CI, verify `headSha`, event, job conclusions and actual test
summaries, not a green badge alone. Wheel SHA256 and image ID/digest need their
source revision; an ephemeral CI image ID is not a published artifact.

Fixtures normally stop their processes and discard the disposable Odoo/PostgreSQL
state; the image test stops its own container and removes its test tag. After an
interruption, inspect only this run's recorded PIDs/container IDs and clean up those
resources. Preserve evidence outside the discarded database/container. Confirm it
is still readable after teardown. Builds and tests do not authorize publication,
merging, deployment, external credentials or Cloudflare resources.

For changed interfaces or a requested coverage audit, compare the affected recipe,
fixture, entrypoint and CI step. Correct proven instruction drift; repair an owned
harness gap and exercise that path; preserve/capture a product regression through
`~~capture` without weakening its expected behavior. Report exercised, skipped and
unreachable paths separately. Keep verification routing in project agent guidance
and any private `~~verification` binding pointed here.
