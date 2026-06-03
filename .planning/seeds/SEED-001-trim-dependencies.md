---
id: SEED-001
status: dormant
planted: 2026-06-03
planted_during: Phase 05 — package-ship
trigger_when: when optimizing Docker image size, or before a packaging/performance milestone
scope: medium
---

# SEED-001: Trim dependencies

## Why This Matters

The `pip install` closure for `godoo-mcp-server` pulls ~70 transitive packages. That's
heavy for a deliberately minimal, stateless FOSS server — it inflates the Docker image,
widens the attack/supply-chain surface, and slows cold installs. A leaner dependency tree
is more in keeping with the project's "deliberate minimalism" design philosophy.

## When to Surface

**Trigger:** when optimizing Docker image size, or at the start of a packaging /
performance / supply-chain-hardening milestone.

This seed will surface during `/gsd:new-milestone` when the milestone scope matches.

## Scope Estimate

**Medium** — needs investigation + a dependency decision, not a quick edit. Likely a phase:
audit the tree, identify what's pulled and why, decide on a lighter framework path, verify
no functional regression against the integration + e2e suites.

## Breadcrumbs

- `pyproject.toml` — the declared direct dependencies (root of the tree).
- `CLAUDE.md` → "Recommended Stack" / "Alternatives Considered": already documents
  **`fastmcp` standalone (PrefectHQ 3.3.x)** vs the official **`mcp` SDK's built-in FastMCP
  (1.27.2)** as a real alternative — the standalone is the heavier choice.
- **Strong lead — auth machinery this server doesn't use:** several heavy transitive deps
  (`authlib`, `joserfc`, `pyjwt`, `cryptography`, `keyring`, `openapi-pydantic`, `cyclopts`,
  `rich`/`rich-rst`, `email-validator`) appear to come from `fastmcp` standalone's auth /
  OpenAPI / CLI feature surface. Per the project's **absolute auth boundary** (OAuth/SSO is
  `godoo-proxy`'s job, NOT this server — see CLAUDE.md), this server consumes credential
  headers and never issues tokens, so most of that auth stack should be dead weight.
- Candidate moves to evaluate: switch to the official `mcp` SDK's bundled FastMCP, or use
  `fastmcp-slim` directly, or pin `fastmcp` with auth extras excluded — measure the image
  delta and confirm tools/resources/Streamable-HTTP still work.

## Notes

Captured via one-shot seed capture during Phase 05. Original observation: the install list
(`pywin32, pyperclip, websockets, … fastmcp-slim, cyclopts, authlib, fastmcp,
godoo-mcp-server` — ~70 packages) prompted "that's a lot of dependencies, we must be able to
cut weight somewhere."

Enrich further with `/gsd:capture --seed --enrich SEED-001` if trigger/scope need refining.
