# Bounded queries and domains

`record_search` uses Odoo `search_read`: it already returns matching records with
requested fields. `count` counts only that response's page, not all matches.
The default limit is 80; use a positive bounded integer and explicit fields.
For a small exact lookup, for example:

```json
{"model":"res.partner","domain":[["name","=","Example Company"]],"fields":["id","name"],"limit":10,"order":"id asc"}
```

Do not assume a name is unique. Resolve ambiguity before a mutation. For pagination,
keep the same domain/fields and deterministic order such as `id asc`, then advance
`offset` by the page length. Finish on an empty/short page or the task's chosen bound;
report truncation when stopping early. Offset pagination is not a snapshot: concurrent
changes can move rows between pages. No exact-count/aggregate tool is exposed.

## JSON domain syntax

Conditions are triples `[field, operator, value]`, implicitly ANDed. `|` and `&`
are binary prefix operators; `!` is unary. Examples:

```json
[["active","=",true],["name","ilike","example"]]
```

```json
["|",["state","=","draft"],["state","=","sent"]]
```

```json
["&","|",["state","=","draft"],["state","=","sent"],["user_id","=",11]]
```

Use `in`/`not in` with arrays. For a many2one ID compare to a number, not a read
`[id,label]` tuple. `ilike` is useful for a case-insensitive substring query; use
`=like`/`=ilike` only when the intended pattern and wildcard behavior are known.
Do not paste Python expressions or domain strings into the JSON list.

Dotted relation domains such as `stage_id.fold` are passed unchanged to Odoo.
A stage's `fold` is a Kanban display setting, not a universal completion flag.
Inspect the model's state/selection fields and actual stage records to establish
open/closed semantics. Names such as Done/Cancelled alone do not establish field
values; do not infer a server domain bug merely from those names.

For date ranges, use stored date strings and selection keys from this target.
Convert datetime boundaries to UTC; prefer half-open ranges (`>=` start, `<` next
boundary) when selecting a whole day. For overdue work, establish the relevant
user date/timezone before choosing the cutoff.

No general RPC context input exists. Default Odoo active-record, language and
company context still apply; an `active=false` or company domain cannot override
those context defaults or the caller's ACLs. Do not claim exhaustive archived or
multi-company results from an ordinary page.
