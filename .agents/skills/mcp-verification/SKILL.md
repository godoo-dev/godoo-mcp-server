---
name: mcp-verification
description: Check a godoo-mcp-server change with its check command and drive its real interfaces (Streamable HTTP, the installed npm package, the candidate image, native Workers and disposable Odoo 18/19). Covers which tier a change needs, cleanup and CI. Hosted gateway and client acceptance are out of scope.
---

# Verify godoo-mcp-server

Machine prerequisites: Node 24 with corepack, uv, and Docker for the image and
Odoo tiers. Everything else is a project dependency: pnpm 11.1.3 comes from
`packageManager` through corepack, `just` from the `rust-just` devDependency,
Ruff from the `tests/acceptance` dev group. In a fresh checkout run
`corepack pnpm install --frozen-lockfile` once, then `corepack pnpm exec just ...`
(or put `node_modules/.bin` on PATH). The justfile adds `node_modules/.bin` and a
local corepack pnpm shim to PATH for its recipes. No model login or real Odoo
credentials are needed.

## Check command

```sh
just check "$dir"            # full check; $dir is a new, empty directory outside the checkout
```

It runs every CI stage in order and stops at the first failure: `offline`,
`package`, `image`, `odoo` for each major in the justfile's `odoo_majors`, and
`archive`. Use a fresh directory per run: `package` refuses a directory that
already holds a candidate. Its output is the result.

CI runs the same stages in the same order on GitHub-hosted `ubuntu-latest`, one
workflow step per stage, for every PR to main, pushes to main and the publish
workflow; the stable `required` job fails unless `validation` succeeds. When
`odoo_majors` or the stage list changes, change the `validation` steps in
`.github/workflows/ci.yml` to match. The two Odoo stages take most of the run
time; splitting them into parallel jobs trades runner starts for waiting time
and is the owner's decision. Rely on CI on the
PR for the full run; run `just check` yourself only when no CI run will cover it.

Focused commands while iterating:

```sh
just lint                              # strict TypeScript and Biome
just test [vitest args]                # Vitest plus candidate-control tests
just build
just r2                                # artifact, storage and native Worker tests
just offline "$dir/offline"            # lint, build, all unit tests and the real-HTTP probe
```

`just lint` also runs Ruff format and lint on `tests/acceptance`.

Complexity blocks in `just lint`: Biome `noExcessiveCognitiveComplexity` at its
default limit 15 for TypeScript and build scripts, Ruff `C901` at 10 for the
acceptance suite. Refactor a new violation without changing behaviour, adding
characterization tests where coverage is missing. What cannot be fixed safely
goes to the owner; an approved exception is the narrowest suppression with its
reason and "owner-approved".

## Choose the tier

| Change touches | Run |
| --- | --- |
| Docs or maintainer skills only | Link check, `git diff --check`, `uv run --script <skill-creator>/scripts/validate.py <skill-dir> --host both` |
| TypeScript source, tool contracts, served guidance | `just offline "$dir/offline"`; CI for the rest |
| Packaging, `package.json` files, CLI | then `just package "$dir/candidate" local "$dir/offline"` |
| Dockerfile, image or runtime adapters | then `just image "$dir/candidate"` and `just odoo "$dir/candidate" 18` |
| Odoo calls, permissions, writes, guidance with Odoo effects | the stages above, then `just odoo "$dir/candidate" 18` and `19` |

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

## Semantic navigation

`just setup-nav` installs dependencies, enables the project's Claude Code
TypeScript LSP plugin (`.claude/settings.json`) and checks Serena for Codex
(`.codex/config.toml`, pinned `serena-agent==2.1.0`; Codex loads it only for a
trusted checkout). The plugin runs `typescript-language-server` from PATH, so
start Claude Code with `corepack pnpm exec claude` to use the project's copy.
Use navigation for definitions and references; `rg` for strings and config.

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
