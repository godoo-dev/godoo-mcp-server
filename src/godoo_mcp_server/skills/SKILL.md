---
name: odoo
description: Query and change Odoo records through godoo MCP, using the current target's schema and supported record, chatter and activity tools.
---

# Odoo MCP Server — Skills Index

Read only the topic needed for the task. Each linked path is also a
`guidance_get` argument: for example, `guidance_get(path="base/queries.md")`.
Resource clients can read `skill://odoo/base/queries.md`; `skill://index.json`
lists every bundled topic. Serving this bundle does not install a client-native skill.

- [Schema discovery](base/properties.md): inspect the current model and field metadata.
- [Field formats](base/field-types.md): relation values, selection keys, dates and datetimes.
- [Queries](base/queries.md): domains, bounded pages, date ranges and open/closed semantics.
- [Record changes](base/record-changes.md): create/update/delete, relation commands and readback.
- [Dynamic properties](base/dynamic-properties.md): read before changing any properties field.
- [Chatter](mail/chatter.md): messages, notes, recipients and mentions.
- [Activities](mail/activities.md): numeric type discovery, scheduling and completion.

## Select guidance for this target

Use `users_whoami` to confirm the authenticated UID, login, database and configured
URL when establishing the connection or changing target. These are connection facts:
no hostname or database name establishes test/production status or write authority.
An error can mean authentication, connectivity or other failures; inspect its category.

Inspect relevant fields with `discovery_get_fields(model=...)` rather than loading
an entire catalog for every request. Use actual selection keys, relational targets
and permitted records from this caller's instance to parameterize the chosen topic.
`discovery_list_models` lists at most 500 accessible models; absence from that page
or an ACL denial does not prove a feature is uninstalled. If a required capability
is unknown, state that and make the smallest useful authorized read.

Search returns records already: `record_search` provides `records`, page `count`
and `web_urls`; request explicit fields and bounded limits. Read again when missing
fields or changed data require it. The `odoo://model/...` resource may be cold;
`discovery_get_fields` returns current fields directly and does not warm that cache.

## Tool boundaries

Record tools provide search/read/create/update/delete primitives, not every Odoo
business method. Chatter, activities and attachments have dedicated tools. General
RPC context, arbitrary model methods, aggregates, language/company switching,
module installation, timers and state-manager plan/apply are not exposed.
A server action can change data: `action_execute_action` takes an action ID only,
without target record IDs or execution context. Do not substitute it for a missing
scoped workflow unless its configured behavior fits the authorized operation.

Guidance and tool annotations describe behavior; they do not grant authorization
or override client approval policy. Stop on a denied write. Do not disguise it as
a read or reroute it to evade the denial. If a dispatched write loses its reply,
its result may already be committed: inspect the outcome independently before
considering a retry. Keep mutation and notification scope within the user's request.

## Navigation

Record search/read results return `web_urls` keyed by ID, successful updates return
`web_urls`, and creates return `web_url`; deletes have no link. Odoo field values
are unchanged. Links use the configured base URL and `/web#model=…&id=…` convention.
Browser access and a model's form availability are separate; no portal token is minted.
