# Project ownership and work

This repository owns the operational MCP protocol, Odoo tools, correlated tool
telemetry, generic workflow guidance, verification and native releases. Odoo 18
is the supported baseline; later majors require explicit qualification.

The [organization overview](https://github.com/godoo-dev/.github/blob/main/profile/README.md)
provides public family orientation. Its availability is not a prerequisite for
normal work. The Python and TypeScript libraries own their language-native client
contracts. Atlas's read-only Odoo knowledge interface and the commercial gateway
are separate products. Delegating operational guidance to a knowledge service is
a possible direction, not an implemented integration or a selected task.

## Canonical homes

- [GitHub issues](https://github.com/godoo-dev/godoo-mcp-server/issues) retain
  requests, decisions, remaining work and acceptance. Search closed issues and
  pull requests before creating coverage. PRs remain canonical for their delivered
  source; do not recreate completed engineering as an open migration task.
- [README](../README.md), [API](api.md) and [development](development.md) own
  product/developer knowledge. Amend existing coverage before adding a page.
- [Maintainer skills](../.agents/skills/) own repository procedures. Packaged
  [consumer guidance](../src/godoo_mcp_server/skills/SKILL.md) has separate
  discovery, manifest, provenance and license obligations.
- Private research, exact source identities, patches and detailed evidence use
  owner-paths or an explicit task destination outside source. Public records must
  carry enough sanitized meaning to be useful without access to those files.

Use [mcp-capture](../.agents/skills/mcp-capture/SKILL.md) for work and
[mcp-docs](../.agents/skills/mcp-docs/SKILL.md) for knowledge. The ignored
checkout-local `.mafe-si.toml` binds `capture`, `docs`, `project tracker` and
`verification`. Local bindings take precedence over inherited routes. A fresh
checkout can use these relative skills and public URLs directly; no HQ checkout,
shared tracker, legacy engine or live organization-profile fetch is required.
Machine paths and private values never belong in tracked skills.

## Intake and status

GitHub open/closed state alone does not express readiness. Keep the actual
disposition in the current body: for example, untriaged, open, testing, deferred,
or waiting for a specified input. Retain original authority, material decisions,
remaining acceptance and next actor. Capture neither accepts implementation nor
starts a worker, schedule, release or resource claim. Do not infer readiness from
an old assignee or a retained worktree.

Use linked issues or checklists for independently useful pieces. Preserve an
original request's outcome when the breakdown changes. A completed PR does not
close separate operational acceptance. Update only consequential current claims;
routine progress belongs in the session. Preserve dated completion evidence.
There is no standing cross-agent dispatch or notification workflow. Report real
ownership/resource conflicts and cross-project decisions to Marc in conversation.

Company workflows, roles, visibility policy and identity conventions belong to
the consuming application's validated procedures. Generic guidance can explain
partner/user IDs, Odoo permission limits and uncertain-write handling. It must
not turn a company observation into universal Odoo policy or recommend direct
business-record cleanup as a workaround. Public issues omit private identities,
hosts, thread/local paths and original source keys, including metadata and links.

## Chatter body-format contract

The retained 27 October 2026 implementation target is `body_format=md|html|txt`
on both posting tools, defaulting to Markdown. MCP alone converts Markdown to
basic Odoo HTML; explicit HTML retains structured mentions subject to Odoo
sanitization. Literal text is escaped before using the existing client HTML
helper. Formatting does not change recipients or authorize retry after an
uncertain write. No post-then-write fallback is selected.

The client helpers' separate additive `bodyIsHtml`/`body_is_html` options preserve
their HTML default; clients do not interpret Markdown. MCP's target can use the
existing released Python helper and does not require publishing a new client
version. At migration, the local patches and reported package/disposable-Odoo18
checks are evidence of work awaiting source integration and candidate gates.
They do not establish published, deployed, browser-rendered or email-delivery
acceptance. Check [the API](api.md) and the exact selected source before treating
this target as available in an installation.

## Source, release and consumer boundaries

The [verifier](../.agents/skills/mcp-verification/SKILL.md) remains the concrete
native proof procedure. Preserve frozen tools/locks, exact candidate identity,
installed-wheel checks, Odoo18 and exact-image proof, and the `required` CI
aggregate. Source declarations, a green hosted run and applied branch protection
are different facts. Documentation maintenance does not commission gate repairs.

Projects retain independent versions. Before an authorized publication, reconcile
registry history/reserved versions, prepare versioned source and qualify immutable
wheel/image bytes through the native publisher. Resume only missing objects after
a partial publication; accept existing objects only if their bytes match. A
collision stops that object and its dependents. Keep source integration,
publication, runtime and consuming acceptance separate; passing checks supplies
no release/deployment authority.

Historical notifier PR [#8](https://github.com/godoo-dev/godoo-mcp-server/pull/8)
delivered a sender and recorded a successful authenticated dispatch on 19 October.
PR [#11](https://github.com/godoo-dev/godoo-mcp-server/pull/11) subsequently removed
the workflow and sender coupling. Current source has CI and manual publication,
not an active adapter notifier. Neither history establishes current receiver or
deployment state, and migration selects no notifier restoration.
