# godoo-mcp-server

Operational MCP access to Odoo through record, discovery, chatter, activity,
action, attachment and user tools, plus bundled workflow guidance. The Python
server uses the godoo client and each caller's Odoo permissions.

This is the operational Odoo MCP. Odoo Atlas provides a separate read-only
knowledge MCP. `godoo-proxy` owns the broader commercial OAuth/SSO gateway.
The public [organization overview](https://github.com/godoo-dev/.github/blob/main/profile/README.md)
describes the product family. This repository owns its source, documentation and
[GitHub work](https://github.com/godoo-dev/godoo-mcp-server/issues); see
[project ownership](docs/ownership.md). Normal use does not require fetching the
organization overview.

## Run from source

Use Python 3.14+ and `uv`. From the checkout root:

```sh
uv sync --frozen --all-groups
HOST=127.0.0.1 PORT=8000 uv run godoo-mcp-server
```

The Streamable HTTP endpoint is `/mcp`; `/healthz` is an unauthenticated health
check. Supply Odoo credentials on each MCP request, or set the environment
variables below before starting the server. The CLI also accepts `--version`.
Package installation uses `pip install godoo-mcp-server`; confirm the selected
published version separately from this checkout.

## Credentials and network boundary

Each nonempty request header overrides its environment fallback:

| Credential | Header | Environment fallback |
| --- | --- | --- |
| Odoo origin | `X-Odoo-Url` | `ODOO_URL` |
| Database | `X-Odoo-Database` | `ODOO_DATABASE`, then `ODOO_DB` |
| Username | `X-Odoo-Username` | `ODOO_USERNAME`, then `ODOO_USER` |
| Password/API key | `X-Odoo-Password` | `ODOO_PASSWORD` |

Missing credentials produce HTTP 401 with the missing field names. Odoo
authenticates supplied credentials when a tool opens its client. This server
does not authenticate an external identity, issue tokens or implement OAuth.
Any caller reaching it can supply an Odoo target and credentials, or use configured
fallback credentials. Restrict ingress to trusted callers; a managed gateway must
enforce identity and replace caller-supplied credential headers.

`HOST` defaults to `0.0.0.0` and `PORT` to `8000`. The [Dockerfile](Dockerfile)
installs the candidate wheel and runs as a non-root user. Use the
[native candidate checks](docs/development.md#native-candidate-checks) to prepare its
build context. Its health check probes port 8000;
configure a matching probe when overriding the container port.

## Configure artifact storage

Set storage variables in the server process environment (or the deployment's
container environment and secret settings), alongside the Odoo credentials above.
The server does not load a `.env` file automatically.

`record_search` and `record_read` return private JSON download URLs when their
result exceeds `max_return_bytes` (default **500 UTF-8 JSON bytes**). Use `0` to
always request a URL, or `null` to return the full result inline. Small inline
results need no storage; an oversized result without working storage fails safely.
`attachments_download` always uses this storage for nonempty attachments, returning
a signed URL and file metadata instead of inline base64. It uses the same timing
settings and fails safely when storage is unavailable.

For the current **Cloudflare R2** deployment:

```sh
export ODOO_EXPORT_PROVIDER=r2
export ODOO_EXPORT_BUCKET=private-exports
export ODOO_EXPORT_ENDPOINT=https://YOUR_ACCOUNT_ID.r2.cloudflarestorage.com
export ODOO_EXPORT_URL_TTL_MINUTES=60
export ODOO_EXPORT_CLEANUP_GRACE_MINUTES=30
# Supply AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY through deployment secrets.
uv run godoo-mcp-server
```

Create a private bucket and a bucket-scoped R2 S3 API key with object read/write,
delete and list access. Use the account's S3 endpoint; keep public access disabled.
R2 uses region `auto` and path-style addressing automatically.

| Provider | Server configuration | Credentials supplied privately |
| --- | --- | --- |
| R2 | `ODOO_EXPORT_PROVIDER=r2`, `ODOO_EXPORT_BUCKET`, `ODOO_EXPORT_ENDPOINT` | `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` |
| S3 | `ODOO_EXPORT_PROVIDER=s3`, `ODOO_EXPORT_BUCKET`, `AWS_REGION` | AWS key pair, optional `AWS_SESSION_TOKEN`, or supported workload identity |
| GCS | `ODOO_EXPORT_PROVIDER=gcs`, `ODOO_EXPORT_BUCKET` | `GOOGLE_SERVICE_ACCOUNT` pointing to a mounted signing service-account JSON file, or `GOOGLE_SERVICE_ACCOUNT_KEY` containing that JSON |

For S3-compatible services, `ODOO_EXPORT_ENDPOINT` accepts a reachable HTTPS API
endpoint. Downloads must be reachable from the caller's calculation environment.

The timing settings are optional: URL lifetime defaults to **60 minutes** and
cleanup grace to **30 minutes**. Objects become eligible for deletion after
**90 minutes** by default; the server sweeps every minute and resumes after restart.
URLs are reusable bearer links until expiry. Expiring a URL does not delete its
object. See [private result delivery](docs/exports.md) for permissions, cleanup
limits and download examples.

## Use and develop

- [MCP API](docs/api.md): protocol, exact tool arguments and resource limits.
- [Private result delivery](docs/exports.md): R2, S3 and GCS configuration for record and attachment downloads.
- [Development](docs/development.md): checks, source layout, packaging and candidate validation.
- [Bundled Odoo guidance](src/godoo_mcp_server/skills/SKILL.md): consumer workflows,
  also available through `guidance_get()` and `skill://odoo/SKILL.md`.
- [Guidance provenance](src/godoo_mcp_server/skills/PROVENANCE.md): adapted sources and licensing.
- [Changelog](CHANGELOG.md), [license](LICENSE) and [agent instructions](AGENTS.md).

Tool annotations are hints, not write permission. Guidance cannot override client
policy; host/database names do not establish an environment's safety. These docs
describe this checkout's source, not an installed client version, published
artifact, deployed service or user acceptance.
