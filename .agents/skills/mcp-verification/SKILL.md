---
name: mcp-verification
description: Check a godoo-mcp-server change with its check command and drive its real interfaces (Streamable HTTP, the installed npm package, the candidate image, native Workers and disposable Odoo 18/19). Covers which tier a change needs, cleanup and CI. Hosted gateway and client acceptance are out of scope.
---

# Verify godoo-mcp-server

Tools: Node 24.22.2, pnpm 11.1.3 via corepack, `just`, Python 3.14.7 and uv
0.12.5 for the acceptance client, and Docker for the image and Odoo tiers. No
model login or real Odoo credentials are needed.

## Check command

```sh
just check "$dir"            # full check; $dir is an empty directory outside the checkout
```

It runs every CI stage in order and stops at the first failure: `offline`,
`package`, `image`, `odoo` for each major in the justfile's `odoo_majors`, and
`archive`. Its output is the result. CI runs the same command on GitHub-hosted
`ubuntu-latest` for every PR to main, pushes to main and the publish workflow;
the stable `required` job fails unless `validation` succeeds. Rely on CI on the
PR for the full run; run `just check` yourself only when no CI run will cover it.

Focused commands while iterating:

```sh
just lint                              # strict TypeScript and Biome
just test [vitest args]                # Vitest plus candidate-control tests
just build
just r2                                # artifact, storage and native Worker tests
just offline "$dir/offline"            # lint, build, all unit tests and the real-HTTP probe
```

Complexity: Biome has no blocking complexity rule yet. Enabling
`noExcessiveCognitiveComplexity` at its default limit flags existing functions;
that work is tracked as an owner decision, so do not add the rule or
suppressions in an unrelated change.

## Choose the tier

| Change touches | Run |
| --- | --- |
| Docs or maintainer skills only | Link check, `git diff --check`, skill-creator validator |
| TypeScript source, tool contracts, served guidance | `just offline` locally; CI for the rest |
| Packaging, `package.json` files, CLI | `just package` after `just offline` |
| Dockerfile, image or runtime adapters | `just image`, then `just odoo` |
| Odoo calls, permissions, writes, guidance with Odoo effects | `just odoo "$dir/candidate" 18` (and 19) |

The image and Odoo tiers start Docker containers; run them when the change
touches what they cover or the owner asks, otherwise leave them to CI. `odoo`
and `archive` need the candidate that `package` and `image` produced in the same
directory.

## Interfaces

- **Streamable HTTP:** `.github/testing/http-probe.mjs` starts an owned server
  process with ambient Odoo credentials cleared, waits for readiness, drives
  protocol, guidance and error cases and stops the process. `just offline` and
  `just package` run it. For manual diagnosis see
  [the HTTP recipe](references/http-smoke.md). POST goes to `/mcp`; `/mcp/`
  redirects. Health alone is not MCP readiness.
- **Installed package:** `just package` packs one tarball, installs it into an
  isolated consumer outside the checkout and drives it over HTTP.
- **Image:** `just image` builds the tarball into the pinned non-root Node image
  without recompiling source.
- **Odoo:** `just odoo DIR MAJOR` runs the external Python SDK and
  Testcontainers suite in `tests/acceptance/` against source, installed package
  and image. `test_vertical.py` covers tools, CRUD, mail, attachments,
  admin/portal ACL differences, safe errors and telemetry;
  `test_property_create.py` covers friendly property creation. Interrupted-write
  cases (dropped reply, caller disconnect, process kill, SSE keepalive) check
  that exactly one write committed; never retry a possibly committed write to get
  a reply. Zero tests, skips or a wrong observed major fail the stage.
- **Native Workers:** Vitest runs the built Worker bundle in Miniflare without
  Node compatibility, including R2 and scheduled cleanup (`just r2`).

`MCP_SERVER_COMMAND` selects an installed CLI and `MCP_CANDIDATE_IMAGE` an
existing image for the acceptance suite; the fixture never rebuilds or deletes a
caller's image.

## Cleanup

Fixtures create and remove their own containers, networks and processes. After
an interrupted run, remove only the containers and processes that run started;
never prune the shared Docker daemon or remove other tags. Delete `$dir` when
done unless you need its logs.

## Release path

`.github/testing/candidate.mjs` records the tarball, Worker bundle and image
hashes of a candidate. The publish workflow uses them: it resolves a version tag
reachable from main, reruns CI on that commit, and promotes the tested bytes from
the `tested-candidate` artifact without rebuilding. `publish` defaults to false;
npm and GHCR publication need the owner's authorization.

For proof-path changes, inspect the recipes, fixtures and workflow callers, then
exercise the changed stage. External model consumption of guidance, confirmation
UI and email delivery need separately commissioned client acceptance.
