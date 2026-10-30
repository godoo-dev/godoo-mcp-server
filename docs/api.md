# MCP API in this checkout

The app exposes Streamable HTTP at `/mcp` and unauthenticated `GET /healthz`.
[Credentials](../README.md#credentials-and-network-boundary) apply to every other
HTTP path. This source targets MCP `2026-07-28`, with independent requests and no
session ID. For raw HTTP, send `Content-Type: application/json`,
`Accept: application/json, text/event-stream`, `MCP-Protocol-Version: 2026-07-28`
and `MCP-Method` matching the JSON-RPC method. `tools/call` and `resources/read`
also need `MCP-Name` matching the tool name or resource URI, respectively.
Include the modern protocol/capabilities `_meta` envelope shown in the
[HTTP recipe](../.agents/skills/mcp-verification/references/http-smoke.md).
Responses can be JSON or SSE. Use a compatible SDK or the recipe's exact examples.

Discover the connected server's schemas before calling it: other refs or deployed
versions may differ. Python's injected `ctx` is not a consumer argument. The table
follows this checkout's handlers; IDs are numeric Odoo IDs, `values` is a field-value
object and domains use Odoo domain syntax. Optional `None` means omitted. `count`
counts returned rows, not the total matching population.

## Tools

`guidance_get(path="SKILL.md")` returns bundled Markdown without contacting Odoo.
The allowed topic paths come from the same manifest as `skill://index.json`.
An unknown tool path raises `ToolError`.

| Tool | Arguments | Result fields |
| --- | --- | --- |
| `action_list_actions` | `domain=None`, `limit=80` | `actions`, `count` |
| `action_execute_action` | `action_id` | `result` |
| `attachments_list` | `domain=None`, `limit=80`, `res_model=None`, `res_id=None` | `attachments`, `count` |
| `attachments_upload` | `name`, `content_base64`, `res_model`, `res_id`, `mimetype=None` | `id` |
| `attachments_download` | `attachment_id` | private binary artifact receipt with `id`, `name`, `mimetype`, `size_bytes`, `sha256`, `download_url` and expiry/cleanup metadata; or `error` |
| `discovery_list_models` | none | `models` |
| `discovery_get_fields` | `model`, `attributes=None`, `record_id=None`, `property_field=None`, `parent_id=None` | `model`, `fields`; optional friendly `properties` |
| `discovery_list_menus` | `domain=None`, `limit=80` | `menus`, `count` |
| `mail_post_message` | `model`, `res_id`, `body`, `is_internal=False`, `partner_ids=None`, `attachment_ids=None`, `body_format="md"` | `message_id` |
| `mail_log_note` | `model`, `res_id`, `body`, `body_format="md"` | `message_id` |
| `mail_list_messages` | `model`, `res_id`, `limit=80`, `offset=0` | `messages`, `count` |
| `mail_schedule_activity` | `model`, `res_id`, `activity_type_id`, `date_deadline`, `note=None`, `user_id=None` | `activity_id` |
| `mail_list_activities` | `model`, `res_id`, `limit=80` | `activities`, `count` |
| `mail_mark_activity_done` | `activity_id`, `feedback=''` | `success` |
| `record_search` | `model`, `domain=None`, `fields=None`, `limit=80`, `offset=0`, `order=None`, `max_return_bytes=500` | `records`, `count`, `web_urls`; or artifact receipt |
| `record_read` | `model`, `ids`, `fields=None`, `max_return_bytes=500` | `records`, `web_urls`; or artifact receipt |
| `record_create` | `model`, `values` | `id`, `web_url` |
| `record_update` | `model`, `ids`, `values=None`, `properties=None` | `success`, `web_urls` |
| `record_delete` | `model`, `ids` | `success` |
| `users_whoami` | none | `uid`, `username`, `database`, `url` |
| `users_search_users` | `domain=None`, `fields=None`, `limit=80`, `offset=0` | `users`, `count` |

Record search/read result objects (inline or downloaded) and update results add
`web_urls`, keyed by record ID; create adds
`web_url`. Raw Odoo record fields are unchanged outside the explicit `properties.` projection. Links use the configured Odoo base
URL, need browser access and do not guarantee a standalone form. Delete has no link.
`users_whoami.url` omits userinfo, query and fragment; it does not classify the
instance as test or production.

Reads and mutations use the caller's Odoo permissions. Tool annotations describe
behavior, not permission. Authentication, access, validation and connection errors
are mapped to safe public errors. A write that may have dispatched can return
"Odoo write outcome is unknown; do not retry automatically". Inspect actual
Odoo state before deciding to retry. `attachments_download` returns
`{"error":"attachment_has_no_content","id":...}` when binary data is absent.
For nonempty attachments it always returns a private artifact receipt in both text
and `structuredContent`, with the same URL and retention fields as record artifacts.
There is no inline opt-out: bytes, base64, previews and automatically dereferenced
resources are excluded. The signed GET returns the original binary with its MIME
type and an attachment download disposition carrying the filename. The shared
100 MiB cap, sanitized storage failures and 60 + 30 minute defaults apply. Odoo
permissions still govern both binary and metadata reads; no stored copy is created
on access denial. Its annotations account for the temporary storage write.

For read-only exploration, confirm `users_whoami`, inspect fields for the chosen
model, then search with an explicit domain, field list and bound. Example MCP
arguments for `discovery_get_fields` and `record_search`, respectively:

```json
{"model":"res.partner","attributes":["string","type","required"]}
```

```json
{"model":"res.partner","domain":[["name","ilike","Example"]],"fields":["id","name"],"limit":10}
```

These are argument examples, not an observed Odoo transcript. Discover actual
models/fields and review requested effects before invoking mutation tools.

## Friendly dynamic properties

Property definitions depend on a record's parent. Discover them with
`discovery_get_fields(model="project.task", record_id=42)`, or before a task exists
with `property_field="task_properties", parent_id=7`. The response adds
`properties`, keyed by container field, with ordered definitions containing
`name`, `label`, `type`, optional `comodel`, and selection/tag `values` as
`{"name":"high","label":"High"}` choices. Separators are omitted.

Use the same friendly names in reads, changes and search domains. These are
illustrative arguments; IDs refer to ordinary records, never property definitions:

```json
{"model":"project.task","ids":[42],"fields":["name","properties.task_properties"],"max_return_bytes":null}
```

Each result record contains `properties.task_properties`, for example
`{"priority":"high","estimated_effort":3.5,"channels":["email"]}`. A field path
such as `properties.task_properties.priority` selects one value. Search results
and downloaded artifacts have the same projection. Calls without a `properties.`
field path retain their raw representation.

```json
{"model":"project.task","ids":[42],"properties":{"task_properties":{"priority":"normal","estimated_effort":null}}}
```

`record_update` accepts this `properties` argument alongside optional ordinary
`values`. Supplied property keys are sparse changes; omitted keys remain unchanged,
`null` clears, valid false/zero/empty values are preserved, and tag/relation lists
replace that property's list. Property changes initially require exactly one
record and a nonempty change set. Mixed ordinary/property changes must produce one
Odoo write; changing the definition parent in the same call is rejected. No
automatic uncertain-write retry or atomic read/merge guarantee is provided.

```json
{"model":"project.task","domain":[["project_id","=",7],["properties.task_properties.priority","=","high"]],"fields":["name","properties.task_properties.priority"],"limit":20,"max_return_bytes":null}
```

Friendly predicates require a plain conjunction of leaves and one positive parent
equality for each property container. OR/NOT domains are unsupported. MCP resolves
names and option values, then compiles native Odoo
predicates before ordering, offset and limit. Unsupported operators, property
ordering and ambiguous scopes fail rather than filtering a returned page.
`count` remains the returned page length.

Boolean predicates support `=` and `!=`; numbers, dates and datetimes also support
comparisons. Text supports equality and `ilike`/`not ilike`. Selections and many2one
support equality and `in`/`not in`. Tags and many2many predicates are unsupported
because native array semantics differ between Odoo versions.

Names derive from labels using Unicode normalization, case folding and underscores
for punctuation/whitespace. They are scoped to a parent/container, and choices to
their property. Calls use the `en_US` naming context. Renames require rediscovery;
there is no persistent alias registry. Unknown or ambiguous names fail with friendly
diagnostics rather than exposing Odoo's opaque property/option IDs. Readable children
do not grant access to their definition parent. Read/merge/write cannot preserve
hidden stored keys or prevent concurrent lost updates and moves after preflight.

## Private result delivery

`record_search` and `record_read` select data exactly as before. Their
`max_return_bytes` argument controls how the result reaches the caller:

- Default `500`: return the normal result inline if its compact UTF-8 JSON is at
  most 500 bytes; otherwise return only a private JSON artifact receipt.
- `0`: always return an artifact receipt, including for an empty result.
- A higher or lower nonnegative integer: set the inline byte threshold for this call.
- `null`: disable the byte threshold and explicitly return the full result inline.

The threshold counts the entire normal result object, including `records`,
`web_urls`, and search `count`, serialized without optional whitespace and with
UTF-8 characters unescaped. It excludes MCP envelopes and duplicated protocol
representations. Exactly-at-threshold results stay inline. The small artifact
receipt itself may exceed the threshold. It is a delivery switch, not truncation.

For a calculation, use the usual query and keep rows out of context:

```json
{"model":"res.partner","fields":["name","country_id"],"domain":[["active","=",true]],"limit":1000,"order":"id asc","max_return_bytes":0}
```

For an intentionally inline lookup:

```json
{"model":"res.partner","ids":[7],"fields":["name"],"max_return_bytes":null}
```

The downloaded file is exactly the JSON object that would have been returned
inline: `{"records":[...],"count":N,"web_urls":{...}}` for search, and
`{"records":[...],"web_urls":{...}}` for read. Record fields, ordering, IDs,
permissions, `limit`, `offset` and domain semantics do not change. Delivery does
not fetch extra pages, do another read or request extra field metadata. A search
count still counts that selected page, not the entire matching population.

Artifact delivery requires [server storage configuration](exports.md). Small
inline results and `max_return_bytes=null` need no storage. An oversized result
without working storage returns a safe error; it never falls back to inline rows.
Artifact files exceeding 100 MiB fail safely; the explicit inline opt-out has no
artifact size cap. The tools read Odoo only, but can create a temporary stored copy,
so their annotations set `readOnlyHint=false` and `destructiveHint=false`.

Both tool text and `structuredContent` contain only the same artifact receipt,
never rows, base64 or an automatically dereferenced resource:

- `delivery="artifact"`, `artifact_id`: delivery mode and random opaque identity.
- `download_url`, `expires_at`, `expires_in_seconds`: HTTPS GET capability, UTC
  expiry and configured signing lifetime (default 3600 seconds). Signing occurs
  immediately before upload, so upload time consumes part of the lifetime. An
  already-expired upload fails. Credentials or objects can be revoked sooner;
  session credentials must outlast the URL.
- `format="json"`, `encoding="utf-8"`, `schema`: JSON result-envelope schema;
  `records` contains objects with the returned Odoo field values and shapes.
- `row_count`, `size_bytes`, `sha256`: selected row count, exact file length and
  SHA-256 of the stored JSON bytes.
- `retention_seconds`, `cleanup_grace_seconds`, `delete_after`: URL lifetime plus
  cleanup grace (default 5400 seconds), grace alone (default 1800 seconds), and UTC
  deletion eligibility. Retention starts from the completed upload's provider
  timestamp. A background sweep attempts deletion every minute and resumes after
  restart; downtime, errors or a long sweep can delay deletion.
- `source`: originating tool and model. This describes one tool result and does
  not claim that all matching records were extracted or that it is a snapshot.

Signed URLs are reusable bearer capabilities until expiry. Anyone holding one
can download that object without Odoo or MCP credentials. No artifact lookup,
listing or re-sign tool/resource is exposed. Keep receipts out of durable logs
and issue/evidence records. Pass the receipt directly to calculation code, stream
its URL into a workspace file, verify size/checksum and parse the JSON there.
Expose only requested summaries or explicitly bounded records. Do not download
through a tool that returns the response body to model context. The host controls
subsequent downloads/logging; live provider and client acceptance remains open in
[issue #22](https://github.com/godoo-dev/godoo-mcp-server/issues/22).

## Resources and guidance

| URI | Content and limits |
| --- | --- |
| `skill://index.json` | One Odoo skill plus topic paths, titles and descriptions |
| `skill://odoo/{path}` | Bundled topic Markdown; unknown paths return a Markdown not-found message |
| `odoo://model/{name}` | Model metadata from the cache scoped to authenticated Odoo UID, URL and database; absent entries return `model_not_found` |
| `odoo://action/{id}` | Placeholder returning `action_not_found`; use action tools |
| `odoo://menu/{id}` | Placeholder returning `menu_not_found`; use `discovery_list_menus` |

Start at `skill://odoo/SKILL.md` or `guidance_get()`. The curated topics cover schema,
field formats, queries, record changes, dynamic properties, chatter and activities.
The [bundle provenance](../src/godoo_mcp_server/skills/PROVENANCE.md) records adapted
sources and their CC0 dedication. Repository maintenance skills are separate.

The catalog cache is in-process, bounded to 32 entries with a one-hour TTL, keyed
by `(url, database, uid, schema_hash)`. Model-resource reads authenticate the user
and query only matching cached snapshots. Use `discovery_get_fields` for live
field metadata; it does not warm the catalog in this checkout. Restart discards
cache state. A resource miss does not establish that a model or addon is absent.

Guidance retrieval does not install a client-native skill or establish that a
client follows it. Current source, passing tests, published artifacts, hosted
runtime and actual client acceptance each need their own evidence.

## Chatter body format

Both posting tools accept `body_format="md"|"html"|"txt"` (default `md`).
Markdown supports paragraphs, emphasis, lists, links, code, headings, quotes,
tables and strikethrough using basic HTML; line breaks are preserved. Raw HTML
inside Markdown is allowed for compatibility with existing HTML callers.
Use `html` for explicit HTML and structured mention attributes. Odoo sanitizes
HTML; arbitrary tags, styling and attributes are not guaranteed to survive.
Use `txt` to preserve literal tags, Markdown characters and line breaks.
MCP escapes that text into HTML and uses the client's existing HTML posting API.
No format is inferred from the presence of `<`.

For example: `mail_log_note(model="res.partner", res_id=42,
body="**Review**\n\n- Check totals", body_format="md")`.
This changes content formatting only; audience and notification inputs retain
their meaning. No post-then-write workaround or automatic write retry is used.

`partner_ids` contains `res.partner` IDs, not user IDs. Resolve a user's
`partner_id` first. Explicit recipients do not restrict all notification delivery
to that list: followers, subtypes and target customizations can affect it.
`is_internal=true` selects the internal-note subtype intended for internal
audiences; target permissions and Odoo behavior determine visibility. Neither
posting tool guarantees email delivery or zero notifications. `mail_log_note`
has no recipient-list input; choose `mail_post_message(is_internal=true)` when
the authorized note needs explicit partners. A denial does not authorize trying
another tool, and a lost reply needs independent readback before any retry.

Older installations without `body_format` may escape HTML. Inspect the delivered
schema before posting formatted content and report a mismatch; changing a stored
message afterward does not correct notifications already sent.
