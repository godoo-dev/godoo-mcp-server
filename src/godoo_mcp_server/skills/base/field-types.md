# Odoo field formats

Inspect the model with `discovery_get_fields`. To obtain selection choices, include
`selection` explicitly in `attributes`, alongside needed fields such as `type`,
`relation`, `required` and `readonly`. The defaults omit selection choices.

## Read versus write

<!-- atlas: base/field-types-many2one-asymmetry -->

- A many2one normally reads as `[id, display_name]` or `false`. Write its numeric
  ID, or `false` to clear when the field allows it; do not write the read tuple.
- A many2many/one2many normally reads as a list of IDs. Visibility, field context
  and domains can limit those IDs; do not infer hidden membership. Updates use command lists,
  not the plain read value. See [record changes](record-changes.md), available as
  `guidance_get(path="base/record-changes.md")`.
  <!-- atlas: base/relations-rpc-commands -->
- A selection writes its stored key, not its translated label. For example,
  a priority may be a string such as `"1"`; inspect the actual choices.
- Empty representations depend on the field type. Inspect actual raw values and
  distinguish `false`, zero, empty strings/lists and omitted fields. Do not turn
  every `false` into `null`; use JSON booleans rather than quoted strings.

<!-- atlas: base/field-types-taxonomy -->

Dates use `YYYY-MM-DD`. Datetimes use UTC `YYYY-MM-DD HH:MM:SS`; interpret the
user's intended timezone before conversion. A deadline stored as a date should
remain the intended calendar date rather than be shifted as if it were a timestamp.
Decimal hours, amounts and currency rounding are model-specific; do not infer units
from a generic float type.

<!-- atlas: base/field-types-computed-readonly -->
Readonly/computed metadata helps choose fields, but is not a universal RPC
writability rule: computed fields may have inverse methods, and access/business
rules still apply. Prefer supported source fields and task-specific operations;
do not attempt writes simply to discover whether they bypass UI restrictions.

<!-- atlas: base/properties-type-taxonomy -->
A field of type `properties` has a different read representation and replacement
semantics. Load [dynamic properties](dynamic-properties.md) through
`guidance_get(path="base/dynamic-properties.md")` before changing one.
