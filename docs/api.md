# MCP API in this checkout

The app exposes Streamable HTTP at `/mcp/` and unauthenticated `GET /healthz`.
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
| `attachments_download` | `attachment_id` | `id`, `name`, `mimetype`, `content_base64`, `size_bytes`; or `error` |
| `discovery_list_models` | none | `models` |
| `discovery_get_fields` | `model`, `attributes=None` | `model`, `fields` |
| `discovery_list_menus` | `domain=None`, `limit=80` | `menus`, `count` |
| `mail_post_message` | `model`, `res_id`, `body`, `is_internal=False`, `partner_ids=None`, `attachment_ids=None` | `message_id` |
| `mail_log_note` | `model`, `res_id`, `body` | `message_id` |
| `mail_list_messages` | `model`, `res_id`, `limit=80`, `offset=0` | `messages`, `count` |
| `mail_schedule_activity` | `model`, `res_id`, `activity_type_id`, `date_deadline`, `note=None`, `user_id=None` | `activity_id` |
| `mail_list_activities` | `model`, `res_id`, `limit=80` | `activities`, `count` |
| `mail_mark_activity_done` | `activity_id`, `feedback=''` | `success` |
| `record_search` | `model`, `domain=None`, `fields=None`, `limit=80`, `offset=0`, `order=None` | `records`, `count`, `web_urls` |
| `record_read` | `model`, `ids`, `fields=None` | `records`, `web_urls` |
| `record_create` | `model`, `values` | `id`, `web_url` |
| `record_update` | `model`, `ids`, `values` | `success`, `web_urls` |
| `record_delete` | `model`, `ids` | `success` |
| `users_whoami` | none | `uid`, `username`, `database`, `url` |
| `users_search_users` | `domain=None`, `fields=None`, `limit=80`, `offset=0` | `users`, `count` |

Record search/read/update results add `web_urls`, keyed by record ID; create adds
`web_url`. Raw Odoo record fields are unchanged. Links use the configured Odoo base
URL, need browser access and do not guarantee a standalone form. Delete has no link.
`users_whoami.url` omits userinfo, query and fragment; it does not classify the
instance as test or production.

Reads and mutations use the caller's Odoo permissions. Tool annotations describe
behavior, not permission. Authentication, access, validation and connection errors
are mapped to safe public errors. A write that may have dispatched can return
"Odoo write outcome is unknown; do not retry automatically". Inspect actual
Odoo state before deciding to retry. `attachments_download` returns
`{"error":"attachment_has_no_content","id":...}` when binary data is absent.

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
