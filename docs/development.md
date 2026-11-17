# Develop the operational MCP server

Use Node 24.22.2 with corepack, uv and the committed lockfiles. pnpm 11.1.3
comes from `packageManager` through corepack and `just` from the `rust-just`
devDependency; after `corepack pnpm install --frozen-lockfile`, run recipes with
`corepack pnpm exec just <recipe>`.
The independent Odoo acceptance driver uses Python 3.14.7 and uv 0.12.5;
its separate frozen project lives in `tests/acceptance/`. Python is not part of
the deployed MCP runtime.

```sh
pnpm install --frozen-lockfile
pnpm check
node --test .github/testing/candidate.test.mjs
```

`pnpm check` runs strict TypeScript, Biome, runtime builds and Vitest. `just lint`
adds Ruff format and lint for `tests/acceptance`. Complexity is blocking: Biome
`noExcessiveCognitiveComplexity` at its default 15, Ruff `C901` at 10.
`just setup-nav` sets up semantic navigation (Claude Code TypeScript LSP plugin,
Serena for Codex); see the verification skill.
Tests cover public schemas, friendly properties, storage signatures and rollback,
request isolation and the actual built Worker in Miniflare without `nodejs_compat`.
`just r2` selects storage/artifact/native Worker checks. OpenSSL is required by
the disposable TLS S3 adapter. Live provider permissions and expiry remain rollout
acceptance. For documentation-only edits, check affected links and `git diff --check`.

## Full check

The full check needs Docker and an empty directory outside the checkout:

```sh
just check "$dir"
```

It runs these stages in order and stops at the first failure; each stage can
also be run on its own while diagnosing:

```sh
just offline "$dir/offline"
just package "$dir/candidate" local "$dir/offline"
just image "$dir/candidate"
just odoo "$dir/candidate" 18
just odoo "$dir/candidate" 19
just archive "$dir/candidate"
```

`offline` runs the commands above plus the real-HTTP probe against the built
server. The package step consumes that build, packs one npm tarball, installs it
in a consumer outside source and drives real Streamable HTTP. The Dockerfile
installs that exact tarball into a pinned non-root Node image. Each Odoo major
runs the full external acceptance suite through source, installed package and
the same candidate image, provisioning only disposable Odoo and Postgres
containers. The archive stage checks hashes, reports, observed majors and
teardown, then reloads the same image archive. Empty or skipped suites, wrong
majors and unavailable Docker fail.

The candidate manifest records version, lock and tool identities, and bundle,
tarball and image hashes; later source changes invalidate it, and release
promotion uses only the candidate built from the selected tagged commit. Stage
commands live in `justfile`; compiler, fixture and candidate support lives under
`.github/`. See [mcp-verification](../.agents/skills/mcp-verification/SKILL.md)
for choosing a tier, focused HTTP diagnosis and cleanup. Never prune the shared
Docker daemon or delete another run's resources.

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
| `.github/testing/candidate.mjs` | Candidate identity, proof gates and promotion checks |
| `.github/build/` | Runtime bundling, guest SDK assets and WASM metering |
| `justfile`, `.github/workflows/` | Check and stage commands, and CI orchestration |

Adding a guidance file alone does not expose it. Use the
[authoring procedure](../.agents/skills/mcp-guidance-authoring/SKILL.md) and preserve
its manifest, package paths, provenance and distinct documentation license.
Repository maintenance skills are not served to consumers.

## Packaging and client dependency

`package.json` defines `@godoo-dev/mcp-server`, the `godoo-mcp-server` CLI and
portable core/Worker exports. `.github/build/build.mjs` bundles runtime dependencies into
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
to main and manual/reusable invocations. One `validation` job runs the stages of
`just check` in the same order, one step per stage so timings and failures show
per stage; the stable `required` aggregate rejects any non-success result. A newer push to a
PR cancels that PR's older run; runs on main, manual runs and publish
revalidation each get their own concurrency group and are never cancelled by
another run. Local runs do not establish hosted permissions, protections or
registry acceptance.

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
[mcp-capture](../.agents/skills/mcp-capture/SKILL.md); project knowledge and its
placement use [mcp-docs](../.agents/skills/mcp-docs/SKILL.md).

Local `.mafe-si.toml` (machine-specific agent bindings) and `.scratch/` (agent
working material) are git-ignored.

## Code Mode build and verification

`.github/build/code-assets.mjs` bundles the real portable SDK into a guest source string
and indexes exact supplied declarations for progressive reference. The qualified
unreleased SDK archives and hashes live in `vendor/godoo-ts-1ff8868/`; the lockfile
and override bind client and introspection to the same client bytes. The existing
request-local-fetch patch is rebased onto that client. Replace this source pin only
with a qualified published release containing the portable/effect/reference APIs.

`.github/build/meter-wasm.mjs` instruments the hash-pinned QuickJS module with
Binaryen 125.0.0. It charges function/loop entries and bulk memory bytes, rejects
unrecognized expression shapes or changed coverage, preserves imports/exports and
emits `dist/quickjs-metering.json`. No optimizer runs after instrumentation. Ship
`dist/code-LICENSES.txt` with the package for the sandbox and portable SDK licenses.
Keep these proof fixtures when changing either tool or the WASM input: native BigInt,
repeated large `copyWithin`, regex, typed-array operations, SDK helpers and recovery.
A JavaScript interrupt handler alone does not bound QuickJS native algorithms.

Node launches `dist/code-node-isolate.mjs` in a fresh worker thread and keeps the
RPC gate on the parent. Library embedders supply `Runtime.executeCode`; the Node
adapter is exported from `@godoo-dev/mcp-server/code-node`. An absent executor fails
closed. Node child bundles embed the metered WASM bytes and compile lazily. Native Workers
import `dist/quickjs.wasm` as a compiled WASM module; Wrangler and Miniflare must
include it alongside `worker.mjs`, without `nodejs_compat`. Candidate identity
checks cover the server bundles, both Node executor modules and these exact WASM bytes. Never copy
only the Worker JavaScript module.

`tests/ts/code-mode.test.ts` exercises native SDK objects, policy enforcement,
resource recovery and final artifact behavior; `code-policy.test.ts` covers per-RPC
authority and frozen outcomes. Native Worker tests drive Code Mode through actual
MCP HTTP and repeated hostile programs. `tests/acceptance/test_code_mode.py` adds
real client/introspection/custom-method reads, portal ACLs, private artifact download
and commit/lost-reply/disconnect cases with independent disposable-Odoo readback.
The normal candidate suites run these through source, installed package and exact
image on both supported Odoo majors. External client confirmation UI and billable
model trials require their own commissioned acceptance.
