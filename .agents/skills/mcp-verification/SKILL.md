---
name: mcp-verification
description: Verify godoo-mcp-server over real Streamable HTTP, installed wheels and exact candidate images against disposable Odoo18, or maintain those proof paths. Covers caller permissions, credential isolation and interrupted writes; excludes hosted gateway acceptance.
---

# Verify godoo-mcp-server

Use the selected checkout's native checks. This skill owns MCP verification;
consumer workflow guidance stays in `src/godoo_mcp_server/skills/` with its separate
manifest, provenance and license. Gateway identity/OAuth and deployment acceptance
remain with their owners. Passing local checks grants no publication authority.

## Prepare and identify

Read current resource authority before starting Docker. Use Python3.14.8, uv0.12.5
and committed `uv.lock`; checks call `uv sync --frozen --all-groups`. No model login
or real Odoo credential is needed. Keep evidence and candidates outside the checkout
using owner-paths/current task guidance. Use a new directory for each candidate.
All native scripts resolve their project from their own path, so an absolute
invocation works from another CWD.

Record source SHA, tracked patch and untracked input identity, lock/tool versions,
command exits and test selection. `candidate.json` records these plus wheel hash,
metadata version, tested image ID/archive hash and Odoo proof hashes. A local dirty
candidate is reproducible only with its retained patch and untracked files. Later
source changes invalidate it; rerun package and Odoo checks for the new candidate.

## Choose and drive the boundary

From the checkout root, substitute your external paths:

```sh
scripts/check.py offline --evidence-dir "$evidence/offline"
scripts/check.py package --candidate-dir "$evidence/candidate"
ODOO_VERSION=18.0 scripts/check.py odoo18 --candidate-dir "$evidence/candidate"
```

- `offline`: full Ruff lint/format, strict source mypy, default pytest, and a real
  loopback HTTP subprocess trial. Default pytest excludes integration and E2E.
- `package`: build one wheel, install frozen runtime dependencies and that wheel
  into an isolated consumer outside source, check import origin/metadata/CLI,
  bundled topics/provenance/license and absence of editable dependencies. Drive
  real HTTP with the installed interpreter, then discard only that consumer.
- `odoo18`: require the preceding candidate's unchanged source/lock/wheel; fail
  missing Docker. Build one unique image from that wheel, verify actual Odoo18,
  run the full vertical suite and the exact prebuilt image's HTTP tool test.
  Reject zero tests, skips, failures and wrong majors. Export that tested image
  to `image.tar`, record hashes and remove only the invocation's unique image tag.

The offline/installed HTTP driver is `scripts/http_probe.py`; its public requests
and observations are described in [the HTTP recipe](references/http-smoke.md).
It clears Odoo fallback credentials, checks health with a deadline, then exercises
independent discovery, all bundled resource/tool topics, caller request IDs,
missing credentials and invalid envelopes. `http.json` retains responses and
`server.log` survives exact-PID teardown. Canonical POST is `/mcp`; `/mcp/` redirects.
Health alone is not MCP readiness. No-Odoo HTTP trials prove no authenticated tool
effects. For focused source regressions the equivalent `uv run --frozen pytest`
commands remain available; they do not replace the required check family.

## Real Odoo, permissions and interrupted writes

Only use owned disposable Docker resources. `tests/odoo_proof.py` selects18
explicitly and queries `common.version`; never trust an image tag as an observation.
Both required harnesses install `base,mail` without shared snapshots and record
actual Odoo/Postgres container IDs, image IDs/digests and network IDs in
`odoo-facts.jsonl`. Distinct containers isolate each `test_odoo` database.
The required check clears ambient Odoo/seed credentials and runs suites serially.
An explicit17 is rejected before provisioning.

`tests/integration/test_vertical.py` covers real tools, CRUD/readback, mail,
attachments, admin/portal identities and ACL differences, safe public errors and
request-correlated telemetry. The owned process path checks actual HTTP requests
and per-request credentials. The real-Odoo commit relay withholds or drops only
the reply: it never replaces the Odoo write with a fake operation. For drop,
client disconnect, process kill/restart and SSE keepalive, preserve independent
readback of exactly one committed row and exactly one forwarded write. Never retry
a possibly committed mutation merely to get a successful reply. A killed process
cannot emit a finished event.

The image fixture requires `MCP_CANDIDATE_IMAGE` (an exact prebuilt image) and
`MCP_EXPECTED_VERSION`. The native caller supplies both. It never builds/deletes
a caller's image; it checks the running image ID, non-root UID, installed version,
health and a nonempty real `record_search` result against observed18.

After surprising failures, inspect retained MCP/relay logs and recheck the owned
instance's health/Odoo readiness before classifying environment, harness or product
failure. Preserve failed evidence. Do not weaken expected behavior to pass.

## CI, promotion and optional coverage

`.github/workflows/ci.yml` is both authoritative PR/push validation on develop/main
(no path filter) and the release workflow's same-run reusable validator. Job
`required` runs always and requires `offline,package,odoo18`, each success.
It waits for19: requested19 must succeed and unrequested19 must be skipped.
`tested-candidate` contains the tested wheel, image archive and manifest. The
manual publish workflow resolves a version-matching tag reachable from main,
validates that exact SHA, checks candidate identities before credentials and again
before promotion, and loads/pushes the tested image rather than rebuilding it.
`publish` defaults false. Both PyPI and TestPyPI are external publication.
Hosted runs, branch protections, environment protections and registry acceptance
require separate readback; source configuration/local predicates do not prove them.

Optional19 is explicit: manual `qualify19=true` depends on successful offline/package/18
and consumes the same wheel/image/archive/lock. Locally `scripts/check.py odoo19`
rejects candidates without successful18; it needs separate resource authority.
It is outside the ordinary18 gate, fails honestly when requested, and remains
unqualified until actually executed. Never start19 in parallel with18.

Billable Claude remains a separate explicitly authorized trial:

```sh
ODOO_VERSION=18.0 uv run --frozen pytest -m e2e tests/e2e/test_agent_write_flow.py --tb=short
```

It requires runnable/authenticated Claude Code, temporary strict MCP config and
independent readback. Authentication skips are unverified client coverage. It is
never part of required CI, and proves no other client's acceptance.

## Cleanup and upkeep

Fixtures stop only their own PIDs/containers/networks; the native image builder
removes only its UUID tag. The candidate archive/wheel and external logs remain.
After interruption, use recorded IDs for cleanup; never prune the daemon or touch
another run's tags/worktrees. Confirm owned IDs are gone and evidence is readable.

For interface/check changes, inspect affected recipes, source, fixtures and
workflow callers. Repair proven instruction drift or owned harness gaps and
re-exercise the actual native caller. Preserve product regressions and return
findings through the project's work procedure within the task's write authority.
Run skill-creator validation and inspect references/discovery after authoring.
Provenance acknowledgment follows mafe-si-update only after final review, real
public-boundary trials and safe ignored local config/runtime prerequisites.
Report exercised, skipped, unreachable and externally unverified coverage separately.
