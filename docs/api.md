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
versions may differ. The table
follows this checkout's handlers; IDs are numeric Odoo IDs, `values` is a field-value
object and domains use Odoo domain syntax. Optional `None` means omitted. `count`
counts returned rows, not the total matching population.

## Server-side Code Mode

`code_execute(code, effects=["read"], max_return_bytes=500)` executes an async
JavaScript function body in a fresh QuickJS/WASM sandbox. Use `return` for the final
JSON value. TypeScript syntax and imports are unsupported. The actual portable
Godoo client and introspection implementations run inside the guest:

```json
{"code":"return await client.searchRead('res.partner', [], {fields:['id','name'],limit:5});","max_return_bytes":null}
```

Globals are `client`, `sdk` (portable client exports), `introspect` (an Introspector
bound to that client), `introspection`, `formatters` and bounded `console` logging.
Maps, caches, property scopes/bindings and iterators stay native within one
execution. Convert Maps to entries before returning JSON. Credentials, transport,
filesystem, environment and arbitrary network access remain outside the guest.
`client.getSession()` contains only the authenticated UID. `getServerInfo()` has
no supplied snapshot and returns null. The guest has pure `structuredClone` and
`URLSearchParams` implementations; browser APIs and timers are otherwise absent.
Helpers requiring timers, including delayed module lifecycle retries, are outside
this initial surface. Module operations can also exceed the execution deadline.
Stateman is deferred.

Start with `code_reference(section="index")`, then a family such as
`introspection`, `properties`, `accounting` or `cdc`. The index lists exact SDK
declaration names; `code_reference(section="type/BoundClientConfig")` returns a
focused signature. The same JSON is available at `skill://sdk/index` and
`skill://sdk/type/BoundClientConfig`, without authenticating with Odoo. Ordinary
credential headers are still required by the HTTP boundary. Model discovery runs
through `introspect.getModels()`, `getFields(model)` and `getFieldAttributes(model)`
under the same host RPC policy as other SDK calls.

### Authorize actual RPCs

Without `ODOO_CODE_POLICY`, programs can compute locally but dispatch no Odoo RPCs.
Set this **server-side** JSON configuration for the reviewed installation. This
illustrative policy permits one user to run a specific read method; replace the
URL, database, UID and manifest provenance with verified installation facts:

```json
{
  "schemaVersion": 1,
  "targets": [{
    "url": "https://odoo.example",
    "database": "example",
    "uids": [7],
    "effective": {
      "schemaVersion": 1,
      "source": "reviewed-installed-addons-revision",
      "declarations": [{"model":"res.partner","method":"search_read","effects":["read"]}]
    },
    "grants": [{"model":"res.partner","method":"search_read","effects":["read"],"maxCalls":10}]
  }]
}
```

The target matches the normalized URL including its base path, exact database and
**authenticated** UID. Duplicate matching target entries fail closed. An effective
manifest attests the installed implementation including overrides; familiar method
names alone do not prove reads are harmless. Update that attestation when addons
change. Optional `addons` manifests only add effects. Library minima prevent
downgrading deletion, module hooks, notification or token-disclosure effects.
Missing effective coverage resolves to every effect, including `unknown`.

Every actual RPC requires both the caller's requested effects and an exact
model/method grant to cover its resolved effects. Effects are `read`, `mutate`,
`destructive`, `external`, `schema`, `disclose` and `unknown`. Requests cannot supply
manifests, select a permissive policy or grant their own authority. SDK safety
options do not affect the host gate. An outer tool approval grants no inner write
permission. There is no interactive approval protocol in this first implementation:
operators explicitly preauthorize dangerous operations using target/user/method
grants, and clients still apply their own confirmation policy before requesting
them. To approve only an exact operation, include complete `args` and/or `kwargs`
in a grant; JSON equality ignores object key order. Omitting them explicitly grants
all arguments for that method and user. `maxCalls` limits that grant per execution
(default 64). There are no wildcard grants. SDK helpers can issue several RPCs;
every one needs coverage. Guest parallel calls are queued, with one upstream RPC
in flight per execution.

### Inspect results and outcomes

The result envelope has `status` (`success`, `failed` or `uncertain`), `ledger`,
`logs`, `elapsed_ms`, optional `error` and optional `result`. Ledger entries include
sequence `id`, `model`, `method`, resolved `effects`, `outcome` and optional safe
`category`; they omit arguments, credentials and returned records. Outcomes are
`acknowledged`, `rejected`, `policy_refused`, `not_dispatched` and `unknown`.
A guest catch or returned success value does not override the host ledger. A failed
execution remains an ordinary tool result with this inspectable envelope;
authentication and argument-validation errors use the usual MCP tool error.
Telemetry records failed/uncertain envelopes as errors/unknown writes.

Each Odoo RPC is a separate transaction. Earlier acknowledged writes remain applied
when later code fails. A lost reply to a potentially effectful RPC makes it unknown,
closes dispatch, aborts transport and cancels queued work. Never replay the program
automatically or infer rollback from an execution/storage error. Inspect actual
Odoo state before deciding what to do next. Caller disconnects can prevent delivery
of any envelope; the same independent readback rule applies. The ledger is
request-local, not a durable recovery journal.

Only the completed program's JSON value is measured for delivery. It returns
inline up to `max_return_bytes`; `null` keeps it inline and `0` requests private
storage. Larger results use the existing signed artifact machinery. The ledger
and bounded logs stay inline. Intermediate SDK values never become artifact
receipts. Storage failure returns `result_delivery_failed` with the ledger and
never reruns the program. The final value must be JSON-serializable; Map/Set values
need explicit conversion, cyclic values and BigInt fail serialization.

### Execution limits

Each server process/Worker isolate admits at most two executions; extra calls
fail immediately with `sandbox_busy`. Each uses a fresh WASM instance with a
32 MiB linear-memory maximum, 16 MiB guest heap and 512 KiB guest stack. The wall
deadline is 10 seconds. The metered WASM engine has one 20-million fuel budget
covering setup, every function/loop entry and every byte of bulk memory copies or
fills; it is never reset between RPCs or jobs. Exhaustion traps outside guest
JavaScript catches and discards the instance. This is an operation budget, not a
universal wall-time guarantee. JavaScript interrupt checks also aim for 50 ms bursts
and 500 ms measured execution; native builtins and platform clocks make those
checks best effort. Job pumping yields to the host between batches.

Node additionally runs each program in a fresh worker thread with an empty
environment, 48 MiB V8 heap and 2 MiB thread stack. An external watchdog samples
thread CPU every 20 ms and terminates after 1 second of thread CPU or the wall
deadline; admission remains held until termination. Its internal burst/cumulative
checks also use thread CPU time, so host scheduling delays consume no CPU budget.
Native Workers use the metered
engine in the server isolate, without Node compatibility or a WorkerLoader binding.
Fuel bounds computation there; hosted platform acceptance remains separate. These
limits terminate programs; they do not suspend and resume them.

Code Mode HTTP bodies are limited to 512 KiB before protocol parsing. Source is limited to 64 KiB UTF-8. Up to 64 RPC attempts share 1 MiB of submitted
arguments (256 KiB per attempt), 1 MiB per RPC result and 4 MiB aggregate RPC results.
Raw upstream bodies are capped at 2 MiB before parsing. The final JSON is capped
at 1 MiB; bridge/upstream/final JSON nesting is capped at 64 and structural tokens at 50,000. Logs have a 4 KiB
encoded budget and 128-entry maximum. Limits are host-owned and discoverable in
`code_reference`. Unawaited work is cancelled at program return; a dispatched
write without an acknowledged reply remains unknown.

The current QuickJS version can assert during OOM teardown. The instance is
discarded and the execution fails; subsequent calls use fresh instances. Sustained
recovery and shared-host responsiveness require runtime verification. This source
contract does not establish publication, deployment or acceptance in a selected
external client.

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
| `model_call` | `model`, `method`, `args=None`, `kwargs=None` | `result`: unchanged native JSON value |
| `record_search` | `model`, `domain=None`, `fields=None`, `limit=80`, `offset=0`, `order=None`, `max_return_bytes=500` | `records`, `count`, `web_urls`; or artifact receipt |
| `record_read` | `model`, `ids`, `fields=None`, `max_return_bytes=500` | `records`, `web_urls`; or artifact receipt |
| `record_create` | `model`, `values`, `properties=None` | `id`, `web_url` |
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

## Call an Odoo model method

`model_call` invokes installed model/addon methods using native positional `args`
and keyword `kwargs`. Omitted or `null` values default to `[]` and `{}`. Model and
method must be nonempty strings; `kwargs.context`, when supplied, must be an object.
Recordset methods commonly take an ID list as their first positional argument.
For example, with an accessible OCA MIS Builder instance:

```json
{"model":"mis.report.instance","method":"compute","args":[[42]],"kwargs":{"context":{"mis_pivot_date":"2026-10-31","allowed_company_ids":[1,2],"lang":"es_ES"}}}
```

The response is `{"result": <native JSON value>}`, returned inline without
normalizing false/null/scalar/container values or executing returned actions.
The same tool calls `drilldown` with `args=[[42], <cell.drilldown_arg>]` and the
same context. Method availability, signatures and effects depend on installed addons.

This tool can write/delete data, so its annotations are conservative. It retains
the client guard and caller identity, adds no confirmation or `safetyLevel`
override, and never retries automatically. After an uncertain outcome, inspect
actual state before retrying. Agent-facing usage is delivered in the bundled
[Odoo guidance](../src/godoo_mcp_server/skills/SKILL.md#tool-boundaries).

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

For an authorized creation, supply ordinary values and friendly properties together:

```json
{"model":"project.task","values":{"name":"Plan launch","project_id":7},"properties":{"task_properties":{"priority":"high","estimated_effort":0,"channels":[]}}}
```

`record_create` accepts optional `properties` alongside required ordinary
`values`. Supply each container's positive definition-parent ID in `values`;
implicit parent defaults are unsupported for friendly creation. Nonempty containers
are validated together before one create RPC. Omitted properties retain Odoo's
defaults; `null` clears and valid false/zero/empty values are sent without being
replaced by defaults. Odoo can normalize them on storage (for example, an empty
char property reads back as `null`).
Raw property containers cannot be mixed with friendly creation. Creation remains
single-record and returns the existing `id` and `web_url` envelope. A lost create
reply must never be retried automatically; inspect actual Odoo state first.
Definitions can change after preflight; creation is not an atomic schema snapshot.
On Odoo 19, a subsequent friendly read can fail if other properties are unset
without defaults; the current client rejects omitted `value` entries
([issue #32](https://github.com/godoo-dev/godoo-mcp-server/issues/32)). Verify with
raw `record_read(fields=["task_properties"])` in that case, using the actual
container field. A failed read does not mean creation failed; do not recreate it.

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
