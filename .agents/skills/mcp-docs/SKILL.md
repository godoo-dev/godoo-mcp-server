---
name: mcp-docs
description: Retrieve, author and maintain canonical operational MCP documentation, including proposed guidance before implementation and reconciliation after verification; routes served guidance to its distinct authoring procedure.
---

# Maintain operational MCP knowledge

Use the explicitly selected checkout's `AGENTS.md`, `README.md`, `docs/api.md`
and `docs/development.md`. These are canonical project content; no HQ checkout or
online organization-profile fetch is needed. See [ownership](../../../docs/ownership.md)
for product boundaries. Ignored checkout-local `.mafe-si.toml` can bind machine
paths/categories; keep them out of tracked text. Relative project routes remain
usable without local private configuration.

## Retrieve and answer

Start with a supplied file/reference and its selected revision; otherwise use
`rg --files docs .agents/skills src/godoo_mcp_server/skills` and scoped
`rg -n 'term' README.md docs` before reading matches in context. Follow only
useful linked sources. Cite the path/section and source revision or dirty-state
qualification; identify missing/inaccessible coverage. Retrieval/freshness
assessment is read-only, including config and observation files. A discrepancy
does not authorize an edit. Available `explain-system` can research a bounded
mechanism; this procedure retains the selected knowledge operation.

## Author or revise

Search existing coverage before adding a page. Use available `technical-writing`
for composition. Without it, lead with the reader's task, exact interface/example
and prerequisites; keep proposed, inspected, tested, published and deployed claims
distinct. Preserve sources, licenses, version limits, dates and uncertainty.

- `README.md`: orientation, setup and navigation.
- `docs/api.md`: public protocol/tool/resource contracts.
- `docs/development.md`: native checks, packaging and release mechanics.
- `docs/ownership.md`: ownership, work and cross-product boundaries.
- `.agents/skills/`: maintainer procedures, never the served bundle.
- `src/godoo_mcp_server/skills/`: consumer guidance. Read and follow
  [mcp-guidance-authoring](../mcp-guidance-authoring/SKILL.md) for its manifest,
  resources/tool discovery, provenance, CC0 and meaningful validation obligations.

Keep private company policy and business evidence in their authorized private
home. Public content may explain generic Odoo limits, not company roles/visibility
as universal rules. Working research uses owner-paths; unresolved requests or
remaining acceptance go through [mcp-capture](../mcp-capture/SKILL.md) as a distinct
work part, without returning this selected knowledge operation to a router.

Before implementation of a user/operator contract change, prepare the smallest
useful proposed example/guide in the existing page, with open choices explicit.
After verification, compare affected claims/examples/setup with the actual source
and observed result. Promote only supported behavior to current; retain limits
and linked remaining work. A no-impact change needs no invented documentation edit.

Read target files and dirty state before editing; preserve unrelated bytes and
use an isolated checkout when needed. Make the scoped edit with ordinary file
tools, inspect `git diff -- PATH`, and read the real destination back. Commits/PRs
follow project integration policy; an edit grants no publication or deployment.

## Move, consolidate or assess freshness

Inspect incoming references with `rg -n 'old-path|old-heading' README.md docs .agents`
and the relevant served bundle when affected. Preserve stable paths/anchors where
practical; repair affected links/indexes within scope. Combine genuinely equivalent
claims while preserving version and audience differences. Keep contradictory
evidence qualified until settled; never rewrite a dated proposal as though it
had always reflected a later decision. For report-only maintenance, return the
finding and source without writing anything.

For docs-only edits, check affected relative links/anchors, examples against
the declared interface, and `git diff --check`. No product/container/model suite
is required merely for prose. For skill changes, run skill-creator's structural
validator and inspect discovery/resources. Served content and changed executable
contracts use their specific authoring/verifier checks. A link/syntax pass is not
behavioral, package, runtime or client-acceptance proof. Return changed paths,
retrievable references, actual checks, inherited findings and remaining limits.
