# Guidance provenance

The core and mail guidance adapts procedural knowledge from Marc Fargas's
[odoo-toolbox skills](https://github.com/marcfargas/odoo-toolbox/tree/01512004814df8887a457e5ed9d6c5769fe3b730/skills/odoo),
revision `01512004814df8887a457e5ed9d6c5769fe3b730`.
The upstream skills are CC0-1.0; the original dedication is retained in
[CC0-1.0.txt](CC0-1.0.txt). The upstream repository's TypeScript code is separately
licensed and is not included here. This does not change the server code's license.

Adapted source families:

- `SKILL.md`, `base/connection.md`, `base/introspection.md`, `base/modules.md`
  → entrypoint and existing schema-discovery reference.
- `base/field-types.md` → field formats.
- `base/domains.md`, `base/search.md` → bounded queries.
- `base/crud.md`, useful CLI record patterns, side-effect cautions from
  `base/context-keys.md` → record changes.
- `base/properties.md` → dynamic-property replacement and concurrency cautions.
- `mail/chatter.md`, `mail/activities.md` → existing mail references.

Examples were rewritten for this server's actual MCP contracts. Legacy CLI setup,
TypeScript helpers, context flags, timer conventions, arbitrary RPC, portal token
creation and module-management/state workflows are not supplied by this bundle.
Specialist accounting, contracts, attendance, timesheets, product configurator,
Discuss and MIS Builder material remains outside this first adoption wave.
Upstream testable examples are source evidence, not verification of these guides.

The query-result delivery guidance is original to this server: inline byte limits,
private JSON artifact receipts and calculation-code downloads are not upstream
CLI capabilities. It follows the same CC0-1.0 dedication as this guidance bundle.

The chatter body-format and schema-compatibility guidance is maintained against
this server's posting tools. Markdown conversion happens in MCP, while Odoo
retains sanitization, visibility and notification behavior. These additions use
the same CC0-1.0 dedication.

The friendly dynamic-properties recipe is original MCP guidance maintained against
the discovery and record interfaces. The implementation consumes the separately
LGPL-licensed [godoo-py properties service](https://github.com/godoo-dev/godoo-py/blob/59e838012e6da1ebb40247775c9b1c670e10386b/docs/services/properties.md);
no library implementation code is copied into this CC0 documentation bundle.
Names, choices and parent scopes replace the earlier raw full-replacement recipe.
