# Develop the operational MCP server

Use Python 3.14+, `uv` and the committed `uv.lock`. From the checkout root:

```sh
uv sync --frozen --all-groups
uv run --frozen ruff check .
uv run --frozen ruff format --check .
uv run --frozen mypy --strict src/
uv run --frozen pytest --tb=short
```

Default pytest excludes both `integration` and `e2e`. Unit/transport checks use
doubles and do not establish real Odoo effects or client acceptance. For
documentation-only changes, inspect the documented source, check affected links
and run `git diff --check`; product tests are not needed merely for wording.

Retain requests and remaining acceptance through
[mcp-capture](../.agents/skills/mcp-capture/SKILL.md). Before a user/operator
contract change, use [mcp-docs](../.agents/skills/mcp-docs/SKILL.md) to prepare the
smallest useful proposed guide or example. After verification, reconcile affected
documentation with observed behavior before handback. Canonical knowledge and
work belong to this project; see [ownership](ownership.md).

## Native candidate checks

Use an external evidence directory and a new candidate directory:

```sh
scripts/check.py offline --evidence-dir "$evidence/offline"
scripts/check.py package --candidate-dir "$evidence/candidate"
ODOO_VERSION=18.0 scripts/check.py odoo18 --candidate-dir "$evidence/candidate"
```

The package command builds one wheel, installs frozen runtime dependencies and
that exact wheel in an isolated consumer, verifies origin/version/CLI/resources,
and drives real HTTP. The Odoo command checks the unchanged candidate identity,
builds one unique image from that wheel, exercises real Odoo18 identities/ACLs and
interrupted writes, then the exact image's real HTTP tool result. It records
observed majors, container/image IDs, wheel/archive hashes and suite reports.
Empty/skipped required suites, unavailable Docker and wrong majors fail.
No Claude login is needed. Native scripts work by absolute path from another CWD.

Use [mcp-verification](../.agents/skills/mcp-verification/SKILL.md) for boundary
selection, focused HTTP diagnosis, evidence and cleanup. Default pytest is
Docker-free. Docker suites need disposable resource authority; the separate
`test_agent_write_flow.py` is an explicitly authorized billable Claude trial,
excluded from required checks. Lost write replies need independent readback
before retry. Stop only trial-owned resources; retain failed evidence.

Optional Odoo19 is available through manual CI `qualify19=true`, or the native
`odoo19` mode after successful18 for the same candidate. It consumes the same
wheel/image/lock, never runs in parallel with18, and is unqualified until executed.

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

`pyproject.toml` declares one `uv_build` package and console entrypoint
`godoo-mcp-server = godoo_mcp_server.__main__:main`. Version assertions derive
from metadata/candidate manifest. Packaged consumer guidance keeps its own
manifest, provenance and CC0 notice; repository maintenance skills are not served.

The Dockerfile installs the candidate wheel into locked runtime dependencies and
copies only the virtual environment into a pinned, non-root Python3.14 runtime.
`check.py odoo18` prepares its minimal build context (metadata, lock and wheel),
builds once, tests that ID and exports the same image bytes for later promotion.

The [CI workflow](../.github/workflows/ci.yml) runs on all develop/main PRs and
pushes, plus manual/reusable invocations. Its stable `required` aggregate rejects
anything except success from exactly `offline`, `package`, `odoo18` and `archive`. All
installs/checks are frozen. Candidate reports keep source, patch/untracked
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
