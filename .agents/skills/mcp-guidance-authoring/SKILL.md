---
name: mcp-guidance-authoring
description: Create or revise what this MCP server tells its consumers about Odoo workflows, in served guidance topics and tool descriptions, including discovery, delivery, Atlas markers and behavioural verification. Repository maintenance skills and other project docs use mcp-docs.
---

# Author MCP consumer guidance

Use **mafe-si:skill-creator** for authoring craft. Consumer instructions live in
`src/godoo_mcp_server/skills/` and in tool descriptions in
`src/ts/tool-contracts.json`; this maintenance skill is never served, and
consumers must not need the author's tools.

## Tool description or served topic

Every claim a consumer reads has one place:

- **Tool description** (`tool-contracts.json`): sent with every `tools/list`.
  State what the tool does, its required inputs, hazards (writes, notifications,
  external effects, uncertain outcomes) and hard limits, in a few sentences.
- **Served topic** (`skills/**/*.md`): read on demand through `guidance_get` or
  `skill://odoo/...`. Holds procedures that span several calls, choosing between
  tools, interpreting results, and when to stop or ask.

If an agent needs it on every call to use the tool safely, it is description.
Otherwise it is a topic. Do not restate a description in a topic or a topic in a
description; a one-line pointer (`see guidance_get(path="mail/chatter.md")`) is
enough. Editing a description changes the advertised contract: update
`docs/api.md` and the tests that pin `tool-contracts.json` in the same change.
Other project docs and the surface table are in [mcp-docs](../mcp-docs/SKILL.md).

## Odoo behaviour and Atlas markers

Odoo server behaviour is owned by Atlas. Guidance reflects it for consumers in
this project's own words; never copy Atlas fact text or paths, and never
generate topic text from Atlas. Where a topic step depends on behaviour that
can change between Odoo versions, editions or modules, add the fact marker next
to it:

```markdown
<!-- atlas: base/create-record-basic -->
```

Fact IDs are public. Mark only version-sensitive Odoo behaviour, not this
server's conventions or library behaviour. For a description, mark the TSDoc or
code that implements the behaviour (`@see atlas:<fact-id>`). An Odoo finding
with no fact yet goes to Atlas intake through
[mcp-capture](../mcp-capture/SKILL.md); add the marker once the ID exists.

## Ground the workflow

Start from a realistic consumer request and its observable result. Read the
bundle entrypoint and the closest topic before adding another; prefer extending
a topic under the existing Odoo skill. Topic files need no frontmatter.

Check the current implementation:

- `src/ts/tools.ts`: actual arguments, defaults, results and errors.
- `src/ts/tool-contracts.json`: advertised descriptions and schemas.
- `src/ts/guidance.ts`: topic manifest, discovery index, resources and `guidance_get` routes.
- `tests/`: existing contract checks and disposable Odoo journeys.
- `src/godoo_mcp_server/skills/PROVENANCE.md`: upstream pins, licenses, adopted and deferred scope.

Models, fields, selection values and permissions vary by target. Tell the
consumer how to discover them with supported tools and the caller's schema and
records; never assume modules, stage names, numeric IDs, company or language
context, or administrative access. A missing catalog entry or an access denial
does not prove a module is absent. Keep adaptation request-scoped: no saved
target profiles, credentials or guidance caches.

Unsupported steps stay unsupported: CLI commands, arbitrary RPC context, timers
and install/state workflows do not exist because an upstream guide describes
them. Explain the limit or defer the workflow; do not invent tools. For salvaged
material, record source revision, attribution, license and semantic changes in
`PROVENANCE.md`; check an upstream's code license separately from its docs.

## Write and connect

Keep `skills/SKILL.md` a short entrypoint with selective links. Write steps in
MCP terms: supported tool calls and how to read their results, with only the
relevant prerequisites, ambiguity handling and stopping conditions. No host
paths, CLI prerequisites or repository machinery.

A new topic needs an entry in the manifest in `src/ts/guidance.ts` (it drives
loading, discovery metadata and the `guidance_get` path enum in
`tool-contracts.json`) and a link in the entrypoint; the file alone is not
served. Keep existing resource paths. The discovery index advertises one Odoo
skill; a separate entrypoint needs an explicit index change.

Guidance is retrievable content, not client-native installation. Do not promise
it overrides client policy, label writes as reads or infer write authority from
URL or database names. A denied write stops; a write whose reply was lost needs
an independent outcome read before any retry.

## Verify

Commands and isolation are in [mcp-verification](../mcp-verification/SKILL.md).
Choose by the claim that changed:

- **Structure and delivery:** run the skill-creator validator on
  `src/godoo_mcp_server/skills`, check changed links and topic paths, and run
  `just test tests/ts/server.test.ts tests/ts/worker.test.ts` after `just build`.
  A new or moved topic also needs the HTTP probe (`just offline`), which
  retrieves every topic through the resource and tool paths. These prove
  availability, not correct workflow decisions.
- **Workflow semantics:** walk a representative request through the served
  guidance and actual tool schemas, including a stop case where relevant. A
  fresh-agent trial gets the request and served artifacts, not the intended
  call sequence. A dry run proves the decisions, not Odoo execution.
- **Odoo effects:** a consequential new claim needs a journey in
  `tests/acceptance/test_vertical.py` using its fixtures in `conftest.py`: MCP
  calls for the recipe, harness reads for the outcome, fixture-owned records.
  Run it with `just odoo` (see mcp-verification) or rely on CI on the PR.
- **Client adoption:** a bounded client trial with a realistic request; only when
  the owner asks, and never with automatic billable model runs.

For wording-only edits, structural checks plus a walkthrough suffice. Never
replace a failed effect check with a wording test. Authoring and tests grant no
merge, publication, deployment or live-record authority.
