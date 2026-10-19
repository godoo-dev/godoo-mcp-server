---
name: mcp-guidance-authoring
description: Create or revise consumer-facing Odoo workflow guidance bundled by this MCP server, including discovery, delivery and behavioral verification. Use for the served skills bundle, rather than repository maintenance skills.
---

# Author MCP consumer guidance

Use the available **skill-creator** when authoring. This project procedure makes
its output concrete for the server's consumers. Authoring instructions live here;
consumer instructions live in `src/godoo_mcp_server/skills/`. Do not serve this
maintenance skill to consumers or require them to have the author's skill toolbelt.

## Ground the workflow

Start from a realistic consumer request and its observable result. Inspect the
existing bundle entrypoint and relevant topic before adding another. Prefer a
focused reference under the existing Odoo skill when it shares that entrypoint's
purpose; a topic Markdown file does not need separate skill frontmatter.

Resolve these paths from the checkout root. Check the current implementation,
not predecessor CLI examples:

- `src/godoo_mcp_server/tools/`: actual tool arguments, defaults, results and errors.
- `src/godoo_mcp_server/resources.py`: `_SKILL_TOPICS`, discovery index, resource and `guidance_get` routes.
- `tests/`: existing contract checks and disposable Odoo journeys.
- `src/godoo_mcp_server/skills/PROVENANCE.md`: upstream source pins, licenses and adopted/deferred scope.

Resolve which models, fields, selection values and permissions vary by target.
Tell the consumer how to discover these through supported MCP tools using the
current caller's schema and records. Do not assume modules, stage names, numeric
IDs, company/language context or administrative access. A missing catalog entry
or access denial does not prove a module is absent. Keep adaptation request-scoped:
no saved target profiles, credentials, personalized guidance cache or new addons.

Identify unsupported steps before writing a recipe. CLI commands, arbitrary RPC
methods/context, timers and installation/state workflows do not become available
because an upstream guide describes them. Explain the meaningful limit or defer
that workflow; do not invent tools or broaden server architecture to fit it.
For salvaged material, retain source revision, attribution, license and meaningful
semantic changes in the bundle's provenance. Do not copy implementation code under
the documentation's license without checking its own license.

## Write and connect the consumer procedure

Keep `skills/SKILL.md` a short entrypoint with selective links. Write consumer
steps in MCP terms, with supported tool calls and concrete interpretation of
results. Include only relevant prerequisites, ambiguity handling and stopping
conditions. Avoid host paths, CLI prerequisites and repository authoring machinery.

For a new topic, update `_SKILL_TOPICS` in `resources.py` and its link in the bundle
entrypoint. The manifest drives loading, discovery metadata and the tool path enum;
file creation alone does not expose a topic. Preserve existing resource paths.
For a separate skill entrypoint, inspect and update the discovery index explicitly;
the present implementation advertises one Odoo skill, not arbitrary skill roots.
Check affected descriptions, README guidance and other callers for stale routes.
Do not add routing where the existing topic already covers the request.

Guidance is retrievable content, not guaranteed client-native installation or
execution. Resources and tools are supported delivery paths; which path a client
shows or reads needs client evidence. Do not promise instructions override client
policy, label writes as reads, or infer write authority from URL/database names.
A denied write stops; a dispatched write with a lost reply needs independent
outcome inspection before retry. Preserve notification scope and relation values.

## Verify the generated guidance

Read [mcp-verification](../mcp-verification/SKILL.md) for commands, isolation,
resource restrictions and evidence handling. Select proof for the changed claim:

- **Structure and delivery:** run skill-creator's `quick_validate.py` on the bundle
  entrypoint directory (resolve the script from the installed creator). Check
  relative links and changed topic paths. Run
  `uv run --frozen pytest tests/test_guidance_feedback.py tests/test_resources.py --tb=short`.
  Follow the verifier's lightweight real-HTTP recipe for changed delivery routes:
  retrieve the affected topic through resource and tool paths and compare contents.
  These checks prove availability, not correct workflow decisions.
- **Workflow semantics:** follow a representative user request using the delivered
  guidance and actual tool schemas. Observe the intended outcome and a meaningful
  failure/stop case when relevant. A fresh agent trial can reveal missing decisions;
  give it the request and served artifacts without the intended call sequence.
  A fictional dry run proves only the proposed decisions, not Odoo execution.
- **Odoo effects:** use the existing integration fixtures in
  `tests/integration/conftest.py` and journeys in `test_vertical.py`. Extend a relevant
  journey or add a focused one when the guidance introduces a consequential claim
  not already exercised. Use MCP calls for the recipe and independent harness
  readback for outcomes: e.g. adding one relation preserves an existing relation,
  a bounded query selects the seeded records, or a message has the intended
  recipients. Seed owned disposable records, retain relevant before/after evidence,
  and let fixtures discard the containers. Use fixture IDs, never live-record IDs.
  Run `uv run --frozen pytest -m integration tests/integration/test_vertical.py`
  with `-k '<selected test>' --tb=short` when resources permit, or inspect
  exact-revision remote CI logs. The selection must name an
  actual test; the generic CRUD journey does not validate every guidance topic.
- **Packaging/client:** changed package content must remain covered by the CI
  installed-wheel checks; image execution follows the existing verifier. The
  opt-in `test_agent_write_flow.py` names `record_create` directly: it proves that
  client's write path, not that it discovered or followed guidance. Actual guidance
  adoption requires a bounded client trial retrieving the topic, a realistic request
  without the answer supplied, and independent outcome readback. Keep model calls
  within current authority; no automatic billable trials or client-policy bypass.

Resolve current owner resource limits before Docker builds, pulls or parallel runs.
When local heavy work is restricted, use lightweight checks and permitted remote CI.
For instruction-only edits, structural checks plus a representative walkthrough
can suffice; do not rerun container suites merely to validate wording. For a new
recipe whose effects need Odoo evidence, use permitted remote CI or leave that
specific claim unverified. Never replace a failed effect check with a wording test.

Retain revision/diff, commands, pass/skip results, observed outcomes and unresolved
limits through the project's capture procedure and owner paths. Keep guidance
retrieval, simulated reasoning, real Odoo behavior and actual client acceptance
separate. Update tests or verification instructions only for demonstrated gaps.
Authoring and tests grant no merge, publication, deployment or live-record authority.
