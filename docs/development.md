# Develop the operational MCP server

Use Python 3.14+, `uv`, `just` and the committed `uv.lock`. From the checkout root:

```sh
just lint
just test
just r2  # Also needs Node24+ and OpenSSL; installs locked test-only npm dependencies.
```

Run `just` to list recipes. `just r2` reruns the compact record-delivery contract
suite against a disposable Miniflare R2 bucket, including uploads, signed downloads,
unsigned/tampered URL rejection, pagination and timed cleanup. A small test-only
S3 adapter bridges obstore to Miniflare's R2 binding and verifies SigV4 signatures;
Miniflare has no native S3 listener. This checks local R2 semantics and the server's
storage path. Live Cloudflare signing, permissions and expiry still need rollout
acceptance. Ordinary `just test` uses obstore's memory backend and needs no Node.

Default pytest excludes both `integration` and `e2e`. Unit/transport checks use
doubles and do not establish real Odoo effects or client acceptance. For
documentation-only changes, inspect the documented source, check affected links
and run `git diff --check`; product tests are not needed merely for wording.

## Guidance workflow acceptance

The required testcontainers suite supplies the client, loopback MCP server and
disposable Odoo connection. No deployed endpoint, owner credentials or model
subscription is needed. `test_sdk_guidance_chatter_workflow` uses the locked
FastMCP SDK over real Streamable HTTP, retrieves guidance through resource and
tool paths, resolves the recipient's partner ID, posts a formatted note and
independently reads back its body and audience in Odoo. The SDK denial test
checks a real portal ACL refusal, correlated telemetry and absence of a write.
These tests run on both configured Odoo majors through `just odoo` and CI.

Existing interrupted-write cases independently establish exactly one committed
row after dropped replies, disconnects and process replacement. Together these
are deterministic acceptance for the server-owned contract in
[issue #18](https://github.com/godoo-dev/godoo-mcp-server/issues/18).

### Optional product-specific client trials

[Issue #18](https://github.com/godoo-dev/godoo-mcp-server/issues/18) retains
historical client-policy observations separately from server acceptance.
Testcontainers cannot establish whether an external model chooses to read
guidance or how a particular product renders confirmation UI. When reproducing
one of those observations is commissioned, the MCP/Odoo endpoint can still use
the disposable harness. For that product-specific trial,
record the client product/version, connection surface, exact server revision or
artifact identity, advertised posting schemas and delivered chatter topic. Keep
credentials and business content out of retained traces and public updates.

In a fresh client conversation, use an owned disposable record and ask to prepare
an internal review note with a named recipient and formatted text. Do not supply
the tool sequence. Observe whether the client retrieves `guidance_get` or the
equivalent resource, resolves a user to their partner ID and selects a format
present in the advertised schema. The expected preparation stops for an ambiguous
recipient or unsupported format. Retrieval alone does not establish consumption.

If disposable posting is within the trial's authority, observe the client's
confirmation flow, then independently read the resulting message body, partner,
attachment and subtype fields. Retain sanitized request IDs and corresponding
server events to distinguish a denial before dispatch from a dispatched write
with a lost reply. Observe a declined confirmation separately: it should stop
without switching posting tools. Do not retry historical writes or force a client
policy denial. A completed post proves neither email delivery nor browser
rendering; record those only when independently observed within scope.

Retain requests and remaining acceptance through
[mcp-capture](../.agents/skills/mcp-capture/SKILL.md). Before a user/operator
contract change, use [mcp-docs](../.agents/skills/mcp-docs/SKILL.md) to prepare the
smallest useful proposed guide or example. After verification, reconcile affected
documentation with observed behavior before handback. Canonical knowledge and
work belong to this project; see [ownership](ownership.md).

## Native candidate checks

Use an external evidence directory and a new candidate directory:

```sh
just offline "$evidence/offline"
just package "$evidence/candidate"
just image "$evidence/candidate"
just odoo "$evidence/candidate" 18
just odoo "$evidence/candidate" 19
just archive "$evidence/candidate"
```

The package command builds one wheel, installs frozen runtime dependencies and
that exact wheel in an isolated consumer, verifies origin/version/CLI/resources,
and drives real HTTP. The image command builds one unique image from that wheel.
Each Odoo command checks the unchanged candidate identity and exercises real Odoo identities/ACLs and
interrupted writes, then the exact image's real HTTP tool result. It records
observed majors, container/image IDs, wheel/archive hashes and suite reports.
Empty/skipped required suites, unavailable Docker and wrong majors fail.
No Claude login is needed. From another CWD, use `just --justfile /path/to/justfile`.

Use [mcp-verification](../.agents/skills/mcp-verification/SKILL.md) for boundary
selection, focused HTTP diagnosis, evidence and cleanup. Default pytest is
Docker-free. Docker suites need disposable resource authority; the separate
`test_agent_write_flow.py` is an explicitly authorized billable Claude trial,
excluded from required checks. Lost write replies need independent readback
before retry. Stop only trial-owned resources; retain failed evidence.

CI runs a version matrix over `odoo_majors` in `justfile` (currently `18 19`).
Each entry loads the same wheel/image/archive and keeps separate reports. Add a
major to that list when extending compatibility; no new job or command branch
is needed. A failed matrix entry fails the required aggregate.

## Source map

Under `src/godoo_mcp_server/`:

| Path | Responsibility |
| --- | --- |
| `server.py` | FastMCP registration, HTTP app, request IDs and tool telemetry |
| `credentials.py` | Header/environment resolution and request-scoped credential state |
| `odoo_runtime.py` | Bounded client cleanup and safe public errors |
| `tools/` | Odoo calls and result envelopes |
| `properties.py` | Request-local friendly property names, projections, sparse write preparation and scoped domains |
| `resources.py`, `catalog.py` | Bundled guidance and target/user-scoped model catalog |
| `links.py` | Odoo browser links added to record results |
| `artifacts.py` | Byte-limited record delivery, private R2/S3/GCS JSON artifacts and timed cleanup |
| `skills/` | Packaged consumer Markdown, provenance and CC0 notice |
| `__main__.py` | CLI version and uvicorn startup |

Tool registration uses side-effect imports after constructing the FastMCP
instance; preserve that order. The `_SKILL_TOPICS` manifest in `resources.py`
drives guidance loading, discovery and allowed tool paths. Adding a Markdown file
alone does not expose it. Use the
[authoring procedure](../.agents/skills/mcp-guidance-authoring/SKILL.md) for served
content and preserve the bundle's distinct documentation license.

## Packaging and release configuration

`pyproject.toml` declares one `uv_build` package and console entrypoint
`godoo-mcp-server = godoo_mcp_server.__main__:main`. Version assertions derive
from metadata/candidate manifest. Packaged consumer guidance keeps its own
manifest, provenance and CC0 notice; repository maintenance skills are not served.

The Dockerfile installs the candidate wheel into locked runtime dependencies and
copies only the virtual environment into a pinned, non-root Python3.14 runtime.
`just image` prepares its minimal build context (metadata, lock and wheel),
builds once and exports the same image bytes tested by every matrix entry for
later promotion. `scripts/candidate.py` retains substantive identity, archive and
proof validation; `scripts/http_probe.py` and `installed_probe.py` drive real
protocol/package checks. Command orchestration lives in `justfile`.

The [CI workflow](../.github/workflows/ci.yml) runs on all PRs targeting main and
pushes to main, plus manual/reusable invocations. Its stable `required` aggregate rejects
anything except success from exactly `offline`, `r2`, `package`, `image`, `odoo` and `archive`.
All installs/checks are frozen. Candidate reports keep source, patch/untracked
identity, version, lock/tool identities and hashes. Local dirty checks are valid
only for those exact input bytes; publication requires a clean tagged commit.

The [manual publish workflow](../.github/workflows/publish.yml) must be dispatched
from main with a `v<metadata-version>` tag reachable from main. It resolves an
immutable SHA and invokes the same validator in that run. `publish=false` is the
default. Credential-free preflight verifies the source/ref/version, wheel and
image archive hashes and the loaded tested image identity. Docker's classic
store reports the config digest; its containerd store can report the OCI manifest
digest. Both must be derived from the exact hash-verified single-image archive,
including its config linkage. The verified unique tag is used for promotion;
a mutable or unrelated tag fails identity verification. CI also downloads and
loads the tested archive in a separate required job without publication. Final promotion repeats
verification and consumes that wheel and image without any rebuild. Production
container tags use the immutable package version. TestPyPI is also publication;
its choice does not publish a production container.

PyPI/TestPyPI use protected environments and Trusted Publisher/OIDC; GHCR uses
the workflow token only in the final promotion job. These are prepared source
controls, not proof of a hosted run, branch/environment protection, configured
Trusted Publisher or registry acceptance. This work does not authorize publishing,
credentials, deployment or remote settings changes.

## Properties client source dependency

The friendly properties adapter consumes godoo-py PR #10 from its immutable
`59e838012e6da1ebb40247775c9b1c670e10386b` archive with a SHA-256 pin.
The released `godoo-client 0.3.0` predates that API. Frozen exports retain the
archive hash, allowing the native hash-required installed-wheel and image checks
to consume the same source without Git. This direct dependency is temporary:
PyPI does not accept direct URL dependencies, so a registry publication first
needs a client release containing PR #10 and a corresponding specifier/lock update.
No registry publication is part of this change.

The integration harness installs `base,mail,project` to qualify parent-specific
task properties; the image harness retains `base,mail`. Candidate facts validate
those distinct module sets and actual observed Odoo majors.

## Integration branch and release finish

`main` is the sole long-lived integration and release branch. Start temporary
feature branches from current `origin/main` and target their pull requests at
`main`. Dependabot follows the repository default branch. Publication remains a
separate, explicitly authorized manual operation using the exact candidate gates
above; a merge, branch change or cleanup does not authorize a release.

At the finish of an authorized release, assess retained worktrees and local/remote
branches against the released commit and current main. Inspect each checkout's
tracked and untracked changes, ancestry and patch equivalence, linked thread
activity/pins, process references and container mounts. Keep primary, active,
pinned, in-use and ambiguous worktrees, unique or unmerged work, tags and required
release evidence. A failed ownership/status check means unknown.

When cleanup is authorized and a disposable checkout is demonstrably clean,
completed, integrated and unused, remove it with `git worktree remove` without
force. Delete its branch only when that branch's retirement is also authorized
and integration is established; retain unresolved refs and unique work for later
review. Never delete main. Read back remaining local/remote refs and worktree
registrations, and report actual removals and preserved work. This is a
release-finish assessment, not automatic deletion on every release.
