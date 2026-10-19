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
