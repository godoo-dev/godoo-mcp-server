# Bounded queries and domains

`record_search` uses Odoo `search_read`: it already returns matching records with
requested fields. `count` counts only that response's page, not all matches.
The default limit is 80; use a positive bounded integer and explicit fields.
For a small exact lookup, for example:

```json
{"model":"res.partner","domain":[["name","=","Example Company"]],"fields":["id","name"],"limit":10,"order":"id asc"}
```

## Result delivery

Both `record_search` and `record_read` default to `max_return_bytes=500`. Results
at or below that many compact UTF-8 JSON bytes appear inline. Larger results
return only a receipt with `delivery="artifact"`, a signed `download_url`, expiry,
row count, byte size and SHA-256. The JSON file contains the same result object:
`records`, `web_urls` and, for searches, the page's `count`. Query arguments and
Odoo access rules are unchanged; delivery does not fetch extra rows.

For bulk calculations, keep the default or use `max_return_bytes=0` to force a
download even for a small page. Pass the receipt directly to calculation code,
stream the URL into a workspace file, verify size/checksum, and parse the JSON
there. Return only the requested summaries or explicitly bounded records. Do not
print the receipt, URL or dataset, or fetch it through a tool that returns its
body to model context. Signed URLs are reusable bearer capabilities until expiry
(default 60 minutes); cleanup follows the configured grace (default 30 minutes).

For an intentionally inline lookup, use a higher positive `max_return_bytes` or
`null` to disable the byte limit. Lowering it sends more responses through artifact
delivery. If storage fails, the tool returns a safe error instead of spilling the
rows inline. Successful inline calls need no object storage. Search/read perform
no Odoo business writes, but may create temporary copies in private object storage.

Do not assume a name is unique. Resolve ambiguity before a mutation. For pagination,
keep the same domain/fields and deterministic order such as `id asc`, then advance
`offset` by the page length from the inline or downloaded result. Finish on an
empty/short page or the task's chosen bound;
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
