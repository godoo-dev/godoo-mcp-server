# Changing records

Confirm the intended records, fields and effect within the user's request. Read
only the current data/schema needed to choose the operation. Existing authorization
is not a reason to ask again, and generic guidance does not authorize extra writes.

- `record_create(model, values, properties=None)` returns `id` and `web_url`.
  Optional friendly properties require their definition-parent IDs in `values`;
  see [dynamic properties](dynamic-properties.md).
- `record_update(model, ids, values)` writes the same values to every listed ID and
  returns `success` and `web_urls`.
- For one record, `record_update` also accepts `properties={container:{name:value}}`
  using discovered friendly names. This is a sparse change, not a full replacement.
  Ordinary `values` can accompany it in one write; see [dynamic properties](dynamic-properties.md).
- `record_delete(model, ids)` deletes records and returns `success`.

Use a list of numeric IDs for read/update/delete, even for one record. A successful
response is not proof of the intended business outcome: read the affected fields
back when needed. Avoid redundant updates. Archive via an actual `active` field
when that matches the requested outcome; do not silently replace deletion with an
unrequested business operation. Generic CRUD may not perform a model's business
transition correctly; absent specialized methods remain a limitation.

## Relation commands

Many2many/one2many values use command lists in `values`. To add an existing category
without replacing other categories, for a known permitted partner and category:

```json
{"model":"res.partner","ids":[42],"values":{"category_id":[[4,7,0]]}}
```

`[6,0,[7]]` would replace all categories with exactly `[7]`. Do not use replacement
for an additive request. Other commands:

- `[0,0,{...}]`: create and link a related record.
- `[1,id,{...}]`: update a related record.
- `[2,id,0]`: delete the related record, not just its link.
- `[3,id,0]`: unlink the relation; for one2many, inverse-field deletion rules can
  also delete the child. Inspect the relation before using it.
- `[5,0,0]`: unlink all relations; the same one2many caveat applies.
- `[6,0,[ids...]]`: replace relations; removing old one2many links can delete children.

Resolve relation IDs on the correct model. Changes to a definition or parent can
affect many records; do not turn a single-record request into shared configuration.
For properties fields, first load `guidance_get(path="base/dynamic-properties.md")`.

## Scope, side effects and uncertainty

Writes can trigger tracking, automations or notifications in Odoo. Do not add a
chatter message or suppress auditing merely because a record was updated. Recipient
and message intent are separate from a generic field change.

If the client denies a call before dispatch, stop; use its supported approval flow
rather than another tool to evade it. If transport fails after possible dispatch,
the outcome is unknown. Inspect the record independently before deciding whether
another attempt is needed and authorized. Repeating a create or message can duplicate
it; a fresh successful response does not prove the earlier attempt had no effect.
A read-then-write sequence is not atomic and is not a compare-and-swap operation.
