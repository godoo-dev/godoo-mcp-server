---
name: odoo
description: Query and change Odoo through godoo MCP, using the current target's schema, model methods and supported record, chatter and activity tools.
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
- [Dynamic properties](base/dynamic-properties.md): discover, read, change and search friendly property names.
- [Chatter](mail/chatter.md): messages, notes, recipients and mentions.
- [Activities](mail/activities.md): numeric type discovery, scheduling and completion.
- [Discuss](mail/discuss.md): channel discovery, membership and authorized posting.
- [Module workflows](modules/workflows.md): inspect installed schemas and verify scoped changes.
- [MIS Builder](oca/mis-builder.md): inspect report instances and templates, compute and read back.

## Select guidance for this target

Use `users_whoami` to confirm the authenticated UID, login, database and configured
URL when establishing the connection or changing target. These are connection facts:
no hostname or database name establishes test/production status or write authority.
This reports the current authenticated session and configuration, rather than
performing an independent health check. On failure, inspect the returned sanitized
text; do not assume it includes a typed error category.

Inspect relevant fields with `discovery_get_fields(model=...)` rather than loading
an entire catalog for every request. Use actual selection keys, relational targets
and permitted records from this caller's instance to parameterize the chosen topic.
<!-- atlas: base/introspect-list-models -->
`discovery_list_models` lists at most 500 accessible models; absence from that page
or an ACL denial does not prove a feature is uninstalled. If a required capability
is unknown, state that and make the smallest useful authorized read.

`record_search` returns the selected page; request explicit fields and bounded
limits. Search/read results above `max_return_bytes` (default 500 UTF-8 JSON bytes)
return an artifact receipt with a signed URL. Download it directly in calculation
code to obtain the same `records`, search page `count` and `web_urls` object without
putting the dataset in model context. `0` forces artifact delivery; `null` explicitly
allows unlimited inline output. Read again when missing fields or changed data
require it. The `odoo://model/...` resource may be cold;
`discovery_get_fields` returns current fields directly and does not warm that cache.

## Tool boundaries

Use `model_call(model, method, args=None, kwargs=None)` for installed Odoo methods
beyond the record, chatter, activity and attachment convenience tools. Pass native
positional arguments in `args`. In Odoo 18 native dispatch, recordset methods
receive record IDs first, for example `args=[[42]]`; methods decorated with
`@api.model` instead take their model-level arguments without that ID prefix.
Use the installed signature to choose the form. Pass request context in
`kwargs.context`, for example `{"context":{"allowed_company_ids":[1,2],"lang":"es_ES"}}`.
<!-- atlas: base/multi-company-allowed-company-ids -->
<!-- atlas: base/translations-context-lang-read-write -->
The native return value is in `result`; returned actions are not executed.
Obtain the installed method's argument contract from a trusted source: field
discovery does not describe method signatures. Methods can change/delete data
or cause external effects; context does not grant permission. No caller-supplied
`safetyLevel` override, timers or state-manager plan/apply interface is provided.

A server action can change data: `action_execute_action` takes an action ID only,
without target record IDs or execution context. Do not substitute it for a missing
scoped workflow unless its configured behavior fits the authorized operation.

Guidance and tool annotations describe behavior; they do not grant authorization
or override client approval policy. `readOnlyHint`, `destructiveHint`,
`idempotentHint` and `openWorldHint` help clients describe tools; they are neither
an Odoo risk classification nor a confirmation gate. `model_call` carries
conservative mutation hints even for read methods. Reads that produce artifacts
can also have non-read-only hints. Stop on a denied write. Do not disguise it as
a read or reroute it to evade the denial. If a dispatched write loses its reply,
its result may already be committed: inspect the outcome independently before
considering a retry. Keep mutation and notification scope within the user's request.

## Navigation

Record search/read result objects (inline or downloaded) contain `web_urls` keyed by ID;
successful updates return
`web_urls`, and creates return `web_url`; deletes have no link. Odoo field values
are unchanged outside the explicit `properties.` projection of friendly names and
choices. This tool currently generates links from the configured base URL using
`/web#model=…&id=…`. Treat that as the tool's output convention, not a stable
backend route or a promise of redirection on every Odoo version.
Browser access and a model's form availability are separate; no portal token is minted.
