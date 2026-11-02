# Develop the operational MCP server

Use Node 24.22.2, pnpm 11.1.3, `just` and the committed `pnpm-lock.yaml`.
The independent Odoo acceptance driver uses Python 3.14.7 and uv 0.12.5;
its separate frozen project lives in `tests/acceptance/`. Python is not part of
the deployed MCP runtime.

```sh
pnpm install --frozen-lockfile
pnpm check
node --test scripts/candidate.test.mjs
```

`pnpm check` runs strict TypeScript, Biome, all three builds and Vitest.
Tests cover public schemas, friendly properties, storage signatures and rollback,
request isolation and the actual built Worker in Miniflare without `nodejs_compat`.
`just r2` selects storage/artifact/native Worker checks. OpenSSL is required by
the disposable TLS S3 adapter. Live provider permissions and expiry remain rollout
acceptance. For documentation-only edits, check affected links and `git diff --check`.

## Native candidate checks

Use a new external evidence directory for each candidate. Docker must be available;
these checks provision only disposable Odoo/Postgres resources:

```sh
just offline "$evidence/offline"
just package "$evidence/candidate" local "$evidence/offline"
just image "$evidence/candidate"
just odoo "$evidence/candidate" 18
just odoo "$evidence/candidate" 19
just archive "$evidence/candidate"
```

`just validate "$evidence"` runs the sequence. The package step builds one npm
tarball, installs it in a consumer outside source and drives real Streamable HTTP.
The Dockerfile installs that exact tarball into a pinned non-root Node image.
Each Odoo major runs the full external acceptance suite through source, installed
package and the same candidate image. The archive gate checks hashes, reports,
observed majors and owned-resource teardown, then reloads the same image archive.
Empty/skipped suites, wrong majors and unavailable Docker fail.

Candidate manifests retain source/dirty-input identity, version, lock/tool identities,
bundle/tarball/image hashes and reports. Later source changes invalidate those
proofs. A local dirty proof applies only to its retained exact inputs; release
promotion requires the selected clean tagged commit. Use
[mcp-verification](../.agents/skills/mcp-verification/SKILL.md) for boundary selection,
focused HTTP diagnosis and cleanup. Keep evidence outside source; never prune the
shared Docker daemon or delete another invocation's resources.

## Guidance workflow acceptance

The external Python MCP SDK drives a loopback MCP process and disposable Odoo.
The suite retrieves all guidance routes, resolves recipient partner IDs, posts
formatted chatter and independently reads back body/audience in Odoo. Admin and
portal callers demonstrate actual permission differences and correlated denials.
The acceptance driver is a separate implementation and imports no production MCP
Python code. It also verifies friendly property creation and real private downloads.

Interrupted-write cases forward real Odoo mutations and withhold only replies.
Dropped replies, caller disconnects, process replacement and SSE keepalive each
require independent readback of exactly one committed row and one forwarded write.
Do not retry a possibly committed mutation to obtain a successful reply.

These checks establish the server-owned behavior from
[issue #18](https://github.com/godoo-dev/godoo-mcp-server/issues/18).
They do not establish whether an external model chooses to consume guidance,
product-specific confirmation UI, email delivery or browser rendering. Such trials
need their own authority, client/version identity and independent observations.
No model subscription or real Odoo credentials are needed for required CI.

## Source map

| Path | Responsibility |
| --- | --- |
| `src/ts/server.ts` | Stateless MCP registration, credentials, request IDs, safe errors and telemetry |
| `src/ts/tools.ts`, `catalog.ts` | Odoo operations and target/user-scoped discovery |
| `src/ts/properties.ts` | Friendly aliases, codecs, projections, preflight and scoped domains |
| `src/ts/artifacts.ts`, `storage.ts` | Private delivery, signing, rollback and durable cleanup |
| `src/ts/node.ts`, `worker.ts` | Node/container and native Workers lifecycle adapters |
| `src/ts/tool-contracts.json` | Advertised contracts retained from the Python implementation |
| `src/ts/guidance.ts` | Guidance manifest, bundling and discovery |
| `src/godoo_mcp_server/skills/` | Preserved consumer Markdown, provenance and CC0 license |
| `tests/acceptance/` | Independent frozen Python SDK/Testcontainers acceptance |
| `scripts/candidate.mjs` | Candidate identity, proof gates and promotion checks |

Adding a guidance file alone does not expose it. Use the
[authoring procedure](../.agents/skills/mcp-guidance-authoring/SKILL.md) and preserve
its manifest, package paths, provenance and distinct documentation license.
Repository maintenance skills are not served to consumers.

## Packaging and client dependency

`package.json` defines `@godoo-dev/mcp-server`, the `godoo-mcp-server` CLI and
portable core/Worker exports. `scripts/build.mjs` bundles runtime dependencies into
`dist/index.mjs`, `dist/node.mjs` and `dist/worker.mjs`; installation needs no runtime
package resolution. The Node bundle includes its AWS credential provider chain.
The Worker bundle uses native Web APIs and the `enable_request_signal`
compatibility flag. A quiet native SSE connection may report peer disconnection
on its next 15-second heartbeat; native tests distinguish that cancellation from
the longer operation timeout. `wrangler.jsonc` schedules cleanup every minute.

The frozen build consumes published `@godoo-dev/client@0.8.0`. A small pnpm patch
adds request-local fetch injection to its transport and types, so timeout/caller
cancellation reaches Odoo without global fetch mutation. Tests exercise the actual
patched client. Friendly property preflight freshly loads definitions, encodes all
containers and only then dispatches the final mutation. This does not make the
preflight reads and write atomic.

## CI and release configuration

The [CI workflow](../.github/workflows/ci.yml) runs on PRs targeting main, pushes
to main and manual/reusable invocations. One validation job runs every substantive
gate above; the stable `required` aggregate rejects any non-success result.
Local `act` executes the same workflow without skipping checks. Local execution
does not establish hosted permissions, protections or registry acceptance.

The [manual publish workflow](../.github/workflows/publish.yml) resolves a
version-matching tag reachable from main and validates that immutable source.
`publish=false` is the default. Promotion verifies candidate identities and checks
registry collisions before writes, then consumes the tested tarball and image
archive without recompilation. Existing registry bytes are accepted only when
identity matches; preserve a partial release's candidate before recovery.
No merge or passing check grants publication, deployment or business-write authority.

`main` remains the sole long-lived integration/release branch. Feature PRs target
main. Preserve unique, dirty, active and ambiguous worktrees; release cleanup needs
separate authority and inspection. Retain work and deferred observations through
[mcp-capture](../.agents/skills/mcp-capture/SKILL.md); canonical operational knowledge
uses [mcp-docs](../.agents/skills/mcp-docs/SKILL.md).
