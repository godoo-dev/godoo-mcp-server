# Lightweight real-HTTP trial

The maintained executable is:

```sh
scripts/http_probe.py --python "$PWD/.venv/bin/python" --evidence-dir "$evidence/http"
```

`check.py offline` and `check.py package` invoke this same driver. It clears
ambient Odoo fallbacks and records responses/server logs before reaping its PID.
The raw recipe below supports focused diagnosis.

This exercises an owned server process with the current environment. It needs no
Docker, Odoo instance, model call or external account. Use this path for protocol
and bundled-resource checks; use Testcontainers for authenticated tools and writes.

## Start and check readiness

From the checkout root, create a unique retained evidence directory according to
owner-paths. Record the revision/environment and select an unused loopback port.
Clear Odoo fallback variables for this process so a missing-header check cannot
silently use a real configured account:

```bash
env -u ODOO_URL -u ODOO_DATABASE -u ODOO_DB -u ODOO_USERNAME -u ODOO_USER \
    -u ODOO_PASSWORD HOST=127.0.0.1 PORT="$port" \
    .venv/bin/python -m godoo_mcp_server >"$evidence/server.log" 2>&1 &
mcp_pid=$!
base="http://127.0.0.1:$port"
```

Install cleanup for this PID before driving. Poll `GET $base/healthz` with a short
request timeout and an overall 30-second deadline. Require HTTP 200 and
`{"status":"ok"}`; record the selected URL and PID. Early exit or deadline expiry
requires the server log, not another unbounded launch. Health establishes listener
readiness only; the next requests establish MCP behavior.

## Drive and observe

Use `curl --max-time 5 -i` or a real HTTP client; retain status, relevant response
headers and body. Each modern request has:

```text
Content-Type: application/json
Accept: application/json, text/event-stream
MCP-Protocol-Version: 2026-07-28
MCP-Method: <exact JSON method>
```

Use throwaway credential headers for discovery/static resources only:
`X-Odoo-Url: http://127.0.0.1:1`, `X-Odoo-Database: probe`,
`X-Odoo-Username: probe`, `X-Odoo-Password: probe`.
Those values satisfy presence validation and intentionally cannot authenticate Odoo.
A normal modern body, without any prior initialization, is:

```json
{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{"_meta":{"io.modelcontextprotocol/protocolVersion":"2026-07-28","io.modelcontextprotocol/clientCapabilities":{}}}}
```

For another method change both the header and body. `tools/call` also requires
`MCP-Name` matching `params.name`; `resources/read` requires it to match `params.uri`.
For non-ASCII names use the SDK's `mcp.shared.inbound.encode_header_value`, as in the
existing resource tests.

Exercise the relevant rows; a representative basic trial uses all of these:

| Action | Required observation |
| --- | --- |
| Fresh `tools/list`, then another independent request | HTTP 200; includes `users_whoami`; neither response has `mcp-session-id`. No initialization/session ID was sent. |
| `server/discover` with modern metadata | HTTP 200; supported version 2026-07-28 and fixed catalog capabilities (`subscribe`/`listChanged` disabled). |
| `resources/read` for `skill://odoo/SKILL.md` | HTTP 200 with nonempty Markdown content, not a `Not Found` fallback. |
| `tools/call` for `guidance_get` with empty arguments | HTTP 200 with the same bundled index Markdown. This tool does not connect to Odoo. |
| Read `skill://index.json`, then retrieve each topic through resource and tool paths | Every declared topic returns identical nonempty Markdown through both interfaces; unknown tool paths fail and unknown resources return Not Found. |
| Inspect `tools/list` annotations | `guidance_get` is read-only and closed-world; Odoo reads are read-only and mutating tools remain explicitly writable. Annotations do not grant approval. |
| Send a UUID in `X-Request-ID` | Same UUID returned in `x-request-id`. Also observe a generated UUID on a request without that header. |
| Valid envelope with Odoo headers omitted | HTTP 401, `missing_credentials`, with field names only. |
| Valid metadata/credentials but `MCP-Method: resources/list` with body `tools/list` | HTTP 400, JSON-RPC error; no tool dispatch. |
| Valid credentials with `_meta` omitted | HTTP 400, JSON-RPC invalid-params error code -32602. |
| POST malformed JSON `{` | HTTP 400, JSON-RPC parse error code -32700, ID null. |
| `GET /mcp` with throwaway credentials | HTTP 405 rather than an idle subscription stream. |

Responses may be JSON or SSE (`data: {JSON}`); parse accordingly. Discovery and
`guidance_get` do not call Odoo. Avoid other `tools/call` requests and authenticated
`odoo://model/...` resources in this no-Odoo trial. Real user/ACL and write outcomes
remain unverified here.

## Retain and stop

Retain the request method/metadata, response status/header/body, revision and server
log; record which rows actually ran. Stop and wait for the exact process started
above, using a bounded graceful shutdown and force only that owned PID if needed.
Confirm it exited and the retained evidence remains readable. On failure, preserve
the first response/log, check readiness again and classify the failure before a
bounded retry. A failed or interrupted observation is not a pass.
