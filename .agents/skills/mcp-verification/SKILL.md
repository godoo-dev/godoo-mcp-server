---
name: mcp-verification
description: Verify godoo-mcp-server over real Streamable HTTP, installed npm packages and exact candidate images against selected disposable Odoo versions, or maintain those proof paths. Covers native Workers, caller permissions, credential isolation and interrupted writes; excludes hosted gateway acceptance.
---

# Verify godoo-mcp-server

Use the selected checkout's native checks. Consumer workflow guidance stays in
`src/godoo_mcp_server/skills/` with its own manifest, provenance and license.
Gateway identity/OAuth and deployment acceptance remain with their owners.
Passing checks grants no publication, deployment or business-write authority.

## Prepare and identify

Read resource authority before starting Docker. Use Node24.22.2, pnpm11.1.3,
Python3.14.7 and uv0.12.5. Production builds use `pnpm-lock.yaml`; the independent
Python acceptance project uses `tests/acceptance/uv.lock`. No model login or real
Odoo credentials are needed. Keep evidence/candidates outside source using
owner-paths and use a new directory per candidate. See
[development](../../../docs/development.md) for the source map and prerequisites.

Record source SHA, dirty input identity, tool/lock versions and selected commands.
The candidate manifest records tarball, built Worker bundle, image/archive hashes
and proof identities. A dirty proof applies only to those exact retained inputs;
subsequent source changes require a fresh candidate.

## Choose and drive the boundary

From the checkout root, substitute external paths:

```sh
just validate "$evidence"
```

This runs the actual CI workflow through `act`, including setup, all stages and
artifact upload. GitHub runs the same workflow remotely. For focused diagnosis,
the workflow's individual stage recipes are also available:

```sh
just offline "$evidence/offline"
just package "$evidence/candidate" local "$evidence/offline"
just image "$evidence/candidate"
just odoo "$evidence/candidate" 18
just odoo "$evidence/candidate" 19
just archive "$evidence/candidate"
```

- `offline`: frozen install, strict TypeScript, Biome, builds, Vitest, candidate
  rejection tests and real loopback HTTP. Native Worker tests execute the built
  bundle in Miniflare without Node compatibility, including R2 and scheduled cleanup.
- `package`: consume the verified build, pack once and install that npm tarball into an isolated external
  consumer. Verify CLI/version and drive real HTTP, including bundled guidance.
- `image`: verify unchanged source/locks/package, build the tarball into one pinned
  non-root Node image and export its exact archive.
- `odoo`: run the full external Python SDK/Testcontainers suite for the selected
  observed major through source, installed package and exact image. Reject zero
  tests, skips, failures, wrong majors and incomplete owned-resource teardown.
- `archive`: require all configured major proofs, verify transferred hashes and
  reload the same image archive to check its actual daemon identity.
- `r2`: focused artifact/storage/native Worker checks, including actual downloads,
  signed URL tamper rejection and cleanup. Live provider acceptance stays separate.

The maintained HTTP driver is `.github/testing/http-probe.mjs`; see
[the HTTP recipe](references/http-smoke.md). It clears ambient Odoo credentials,
starts an owned process with a readiness deadline and retains responses/logs before
bounded exact-process teardown. Canonical POST is `/mcp`; `/mcp/` redirects.
Health alone is not MCP readiness. No-Odoo probes establish no authenticated effects.

## Real Odoo, permissions and interrupted writes

Only use owned disposable Docker resources. `tests/acceptance/odoo_proof.py`
queries `common.version` and records actual Odoo/Postgres/network identities;
image tags alone are not observations. The harness installs `base,mail,project`.
Required suites run serially and clear ambient Odoo/seed credentials.

`test_vertical.py` covers tools, CRUD/readback, mail, attachments, admin/portal
identities and ACL differences, safe errors and request-correlated telemetry.
`test_property_create.py` covers friendly property creation. The separate Python
client drives actual HTTP and imports no production MCP Python code.

The commit relay forwards real Odoo mutations and withholds only the reply.
Drop, caller disconnect, process kill/restart and SSE keepalive cases each require
independent readback of exactly one committed row and one forwarded write.
Never retry a possibly committed mutation to obtain a successful reply. A killed
process cannot emit a finished event.

`MCP_SERVER_COMMAND` selects an installed Node CLI; `MCP_CANDIDATE_IMAGE` selects
an exact prebuilt image. The native candidate command supplies expected version
and artifact identity, checks non-root image execution and retains per-boundary
JUnit/facts. The fixture never rebuilds or deletes a caller's image.

After a surprising failure, preserve MCP/relay logs and recheck owned readiness
before classifying environment, harness or product failure. Do not weaken expected
behavior to pass. External model guidance consumption, confirmation UI, rendering
and email delivery require separately commissioned client acceptance.

## CI and promotion

`.github/workflows/ci.yml` runs every required gate on PRs targeting main, pushes
to main and manual/reusable invocations. The stable `required` job rejects any
validation result except success. `justfile` identifies required Odoo majors.
Use `act` to execute the same workflow locally; no substantive step is skipped.
Hosted permissions, branch/environment protections and registry acceptance need
actual readback and are not established by local execution.

`tested-candidate` retains the tarball, Worker bundle identity, image archive and
proof manifest. Manual publication resolves a matching version tag reachable
from main, revalidates the candidate and promotes tested bytes without rebuilding.
`publish` defaults false. Both npm and GHCR publication need separate authority.

## Cleanup and upkeep

Fixtures stop only owned PIDs/containers/networks. After interruption use recorded
identities, never prune the shared daemon or remove unrelated tags/worktrees.
Confirm owned resources are gone and evidence is readable; retain failed evidence.

For proof-path changes inspect recipes, fixtures, source and workflow callers;
repair supported drift and re-exercise the actual native caller. For skill edits,
run skill-creator structural validation and inspect links/discovery. Report
exercised, skipped, unreachable and externally unverified coverage separately.
