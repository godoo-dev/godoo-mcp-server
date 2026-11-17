---
name: mcp-docs
description: Retrieve, author and maintain godoo-mcp-server knowledge, decide which surface a claim belongs on (code, TSDoc, docs, tool descriptions, served topics, maintainer skills) and apply Atlas fact markers. Served guidance content uses mcp-guidance-authoring; work records use mcp-capture.
---

# Maintain godoo-mcp-server knowledge

Work in the selected checkout. Everything here is public: never add private
paths, hosts, identities, company policy or text copied from private knowledge
bases. Machine-specific bindings stay in the ignored local `.mafe-si.toml`.

## What this project owns

Each claim has one canonical home. This repository owns:

- the MCP protocol surface: tools, arguments, results, errors, resources,
  limits and telemetry of this server;
- what an agent should do with these tools: workflow guidance served to MCP
  consumers;
- this server's runtime, packaging, verification and release mechanics;
- maintainer procedures for this repository.

It does not own Odoo server behaviour, Godoo client-library behaviour or
Stateman semantics. Text here may reflect those for its own readers but cites
their owner instead of becoming a second source. Route new findings of those
kinds through [mcp-capture](../mcp-capture/SKILL.md).

## Choose the surface

| Surface | Path | Holds |
| --- | --- | --- |
| Code comment | `src/ts/` | Why non-obvious code exists, including a workaround for Odoo behaviour |
| TSDoc | `src/ts/` | Contract a caller of an exported function relies on |
| README | `README.md` | Orientation, setup, configuration and navigation |
| Docs | `docs/api.md`, `docs/exports.md` | Public protocol, tool, resource and delivery contracts |
| Docs | `docs/development.md` | Checks, source map, packaging, CI and release |
| Docs | `docs/ownership.md` | Ownership, work homes and cross-product boundaries |
| Tool description | `src/ts/tool-contracts.json` | Per-call minimum for an agent |
| Served topic | `src/godoo_mcp_server/skills/` | Multi-step procedures and choices between tools |
| Maintainer skill | `.agents/skills/` | Repository procedures; never served |

**Tool descriptions versus served topics.** A tool description is sent with
every `tools/list`, so every client pays for it on every session. It says what
the tool does, its required inputs, its hazards (writes, external effects,
uncertain outcomes) and its hard limits, in a few sentences. A served topic is
read on demand through `guidance_get` or `skill://odoo/...`; it holds
procedures that span several calls, how to choose between tools, how to
interpret results and when to stop. Put each claim on one of them. A
description may point to a topic by path; a topic may name a tool and rely on
its description rather than restate it. Moving a claim between them changes
what clients see; treat it as a contract change and check `docs/api.md` and the
tests that pin `tool-contracts.json`. Served-topic content follows
[mcp-guidance-authoring](../mcp-guidance-authoring/SKILL.md).

When the same fact matters to several readers (a tool description, a topic and
`docs/api.md`), write each reflection for its reader by hand. Never generate
consumer text from another knowledge base.

## Atlas markers

Odoo server behaviour, by version, edition and module, is owned by Atlas as
facts with executable checks. When text here depends on Odoo behaviour that can
change between versions, mark the Atlas fact it depends on:

- TSDoc: `@see atlas:base/create-record-basic`
- Code comment: `// atlas: base/create-record-basic`
- Markdown, including served topics and docs: `<!-- atlas: base/create-record-basic -->`
- `tool-contracts.json` descriptions have no comment syntax; mark the TSDoc or
  code that implements the behaviour instead.

Rules:

- Fact IDs are public and may be cited. Fact text, verification records and
  Atlas file paths are private: write the reflection in this project's own
  words and never copy them.
- Mark only version-sensitive Odoo behaviour, not every mention of Odoo, and
  never this server's own conventions or Godoo library behaviour.
- A marker records a dependency, not that the text is still correct; this
  project's tests remain the first signal of breakage.
- A marker naming an unknown fact ID is an error to fix here. If the fact does
  not exist yet, send it to Atlas intake through mcp-capture and add the marker
  once the ID exists; until then leave the text unmarked.

## Retrieve and answer

Start from a supplied file or reference. Otherwise search:

```sh
rg --files docs .agents/skills src/godoo_mcp_server/skills
rg -n 'term' README.md docs src/godoo_mcp_server/skills src/ts/tool-contracts.json
rg -n 'atlas:' src docs README.md      # existing fact dependencies
```

Cite the path and heading, and qualify uncommitted or branch-only content. Say
what is not covered. Queries are read-only; a discrepancy found while answering
does not authorize an edit. Use **explain-system** for an explanation that needs
research.

## Author or revise

1. Classify the claim with "What this project owns". A claim owned elsewhere
   goes to mcp-capture, not into these files.
2. Pick the surface from the table and search existing coverage there first;
   amend before adding a page. Name a new page for its lasting subject.
3. Write with **technical-writing** when available. Keep proposed, tested,
   released and deployed claims distinct, and keep version limits and dates.
4. In the same change, fix or remove every statement the edit contradicts,
   including the other surfaces that reflect the same claim.
5. Add or update Atlas markers per the rules above.

Before implementing a user-visible contract change, the docs can carry the
proposed contract with open choices marked; after the change, describe only
what the source supports. Delivery follows **mafe-si:deliver-change**; the PR
updates the docs whose described behaviour changed.

## Move or consolidate

Find incoming references first:

```sh
rg -n 'old-path|old-heading' README.md docs .agents src/godoo_mcp_server/skills src/ts
```

Merge only equivalent claims; keep version and audience differences distinct.
Keep stable paths and anchors where practical and repair every reference. Moving
a served topic changes `src/ts/guidance.ts`, the `guidance_get` path enum and
the bundle index; follow mcp-guidance-authoring.

## Assess freshness

Compare claims with the current source (`src/ts/tools.ts`,
`src/ts/tool-contracts.json`, `src/ts/guidance.ts`, `justfile`,
`.github/workflows/`) and report each as supported, contradicted or unresolved.
A correction needs edit scope.

## Check

For prose: check changed relative links and anchors, examples against the
declared interface, and `git diff --check`. For skills: run the skill-creator
validator. Served topics and tool descriptions also need the checks in
mcp-guidance-authoring and [mcp-verification](../mcp-verification/SKILL.md).
