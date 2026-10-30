# Work with dynamic Odoo properties

Use the existing discovery and record tools with readable names under
`properties.<container>.<name>`. The server resolves Odoo's internal property,
selection and tag IDs. Do not copy raw property arrays into an update.

## Discover names and choices

For an existing task, use the real record ID:

```json
{"model":"project.task","record_id":42}
```

Pass these arguments to `discovery_get_fields`. Its `properties.task_properties`
list describes each value with `name`, `label`, `type` and, for selections/tags,
`values` such as `[{"name":"high","label":"High"}]`. Use the returned `name`
for both property keys and choices. For definitions before a task exists, use
`property_field="task_properties", parent_id=7` instead of `record_id`.

These names and IDs are illustrative. Discover the actual container field and
parent on the target. Definitions depend on the parent: two projects can have
different task properties. Reading a child does not grant access to its parent.
Missing access is an error, not an empty definition set.

Names derive from labels using Unicode normalization, case folding and underscores
for punctuation/whitespace. The property path uses a fixed English naming context.
A rename requires rediscovery. Ambiguous names are rejected; the server never adds
opaque IDs or positional suffixes. Ask for distinct source labels when ambiguity
prevents the intended operation; changing shared definitions is a separate action
requiring its own authorization.

## Read and change values

Use `record_read` with the discovered container or a particular property:

```json
{"model":"project.task","ids":[42],"fields":["name","properties.task_properties"],"max_return_bytes":null}
```

Each returned record contains a plain object, for example
`"properties":{"task_properties":{"priority":"high","estimated_effort":3.5}}`.
Use `properties.task_properties.priority` in `fields` to select just Priority.
The ordinary read representation remains available outside the friendly namespace.
The usual byte threshold and private artifact delivery apply to the entire result.

For an authorized change, call `record_update` with one record:

```json
{"model":"project.task","ids":[42],"properties":{"task_properties":{"priority":"normal","estimated_effort":null}}}
```

Supplied keys are sparse changes; omitted keys remain unchanged. `null` clears a
value. Valid zero, false, empty strings and lists are preserved according to the
property type; use `null`, rather than false, to clear a nonboolean scalar. Tags
and many2many values replace that property's entire list, without relation commands.
Relational properties use ordinary numeric record IDs, like other relational fields.

Ordinary `values` can accompany `properties` in the same call. The server validates
and composes one Odoo write. Do not combine a parent change or a raw write to the
same container with friendly properties. Batch property writes are unsupported.
Read back the affected and preserved values when verification is needed.

Read/merge/write is non-atomic: it cannot prevent concurrent lost updates, preserve
hidden stored keys or prevent parent moves after preflight. A positive write reply
is acknowledgement, not readback verification. If dispatch loses its reply, inspect
actual state before deciding to retry; never retry automatically.

## Create with friendly properties

Before creating a record, discover its properties with `discovery_get_fields`
using the container field and intended parent ID. For an authorized task creation,
call `record_create` with the discovered names and ordinary fields together:

```json
{"model":"project.task","values":{"name":"Plan launch","project_id":7},"properties":{"task_properties":{"priority":"high","estimated_effort":0,"channels":[]}}}
```

Supply each container's positive definition-parent ID explicitly in `values`;
friendly creation cannot infer it from Odoo defaults. Nonempty property containers
are validated before one create. Omitted properties keep server defaults; `null`
clears. Valid false, zero, empty strings and lists are sent without substitution,
although Odoo may normalize them on storage (an empty char reads back as `null`).
Do not mix raw property containers with friendly properties. Creation supports one
record and returns `id` and `web_url`; use that ID to read back the intended fields.
Definitions can change after preflight. A denied call stops, and a lost create
reply requires independent state inspection before any retry to avoid duplicates.

## Search using the same vocabulary

Constrain the query to one definition parent and use friendly paths in the domain:

```json
{"model":"project.task","domain":[["project_id","=",7],["properties.task_properties.priority","=","high"]],"fields":["name","properties.task_properties.priority"],"limit":20,"order":"id asc","max_return_bytes":null}
```

The server translates predicates before ordering, offset and limit. Search `count`
still means returned page length. Start with a conjunction of parent equality and
property comparisons; complex scopes and unsupported property operators fail rather
than producing an approximate filtered page. Ordering by properties is unsupported.
Search results use the same nested values as reads. This is not a database snapshot;
records and definitions may change between search and projection.
