# godoo-mcp-server

Stateless MCP server for Odoo — raw primitives + skill resources.

## Guidance and client support

Bundled Odoo guidance is served as `skill://index.json` and
`skill://odoo/{path}` MCP resources. Clients decide whether and how to surface
resources; a resource URI does not install a client-native skill. Clients that
expose tools can call the read-only `guidance_get()` tool for the same index and
select a detailed guide using its `path` parameter. Server instructions point to
both interfaces; actual client selection/loading still requires client testing.

The curated bundle covers schema discovery, field formats, queries, record changes,
dynamic-property replacement risks, chatter and activities. `skill://index.json`
lists topic paths and descriptions from the same manifest used by the tool.
Guidance adapts to a target through the caller's current schema observations;
it does not save generated server profiles or infer environment/approval policy.
The [provenance record](src/godoo_mcp_server/skills/PROVENANCE.md) identifies the
revision-pinned toolbox material adapted for MCP and its CC0 dedication.

Tool annotations describe read/write behavior and remain hints, not permission.
Guidance cannot override a client's approval policy. `users_whoami` includes the
configured target `url` (without userinfo, query or fragment) alongside database
and identity; it does not infer a test/production label from either name.

Record search/read/update results include a `web_urls` mapping keyed by record ID;
create includes `web_url`. Raw Odoo record fields remain unchanged. Links use the
configured Odoo base URL, require browser access, and do not guarantee a model has
a standalone form. Delete results have no link.

## Installation

```bash
pip install godoo-mcp-server
```

Or with Docker:

```bash
docker run -e ODOO_URL=https://your.odoo.instance \
           -e ODOO_DATABASE=mydb \
           -e ODOO_USERNAME=admin \
           -e ODOO_PASSWORD=secret \
           -p 8000:8000 \
           ghcr.io/godoo-dev/godoo-mcp-server:latest
```

## Configuration

The server resolves Odoo credentials from request headers or environment variables. Headers take precedence over environment variables.

| Credential | Header | Environment Variable |
|-----------|--------|---------------------|
| Odoo URL | `X-Odoo-Url` | `ODOO_URL` |
| Database | `X-Odoo-Database` | `ODOO_DATABASE` |
| Username | `X-Odoo-Username` | `ODOO_USERNAME` |
| Password | `X-Odoo-Password` | `ODOO_PASSWORD` |

If neither headers nor environment variables are set, the server returns a credential error.

**Server bind address:** Defaults to `0.0.0.0:8000`. Override with `HOST` and `PORT` environment variables.

> **Note:** If you override `PORT`, you must also update the Docker `HEALTHCHECK` to match the new port.

## Security: Header Trust Model

`godoo-mcp-server` authenticates Odoo users via `X-Odoo-Username` and
`X-Odoo-Password` request headers (or `ODOO_USERNAME` / `ODOO_PASSWORD`
environment variables). **This means any caller who can reach the server
can impersonate any Odoo user by setting these headers.**

This is intentional for self-hosted / trusted-network deployments. In
production, you MUST deploy a header-stripping reverse proxy in front of
the server that enforces identity. [`godoo-proxy`](https://github.com/godoo-dev/godoo-proxy)
is the SaaS-safe gateway for this role — it implements OAuth 2.1 / SSO
and injects verified per-user credentials before forwarding to
`godoo-mcp-server`.

If you expose `godoo-mcp-server` directly on a public network without a
trusted proxy, any network peer gains full Odoo impersonation capability.

## Running E2E tests locally

**Prerequisites:**

- Docker (for the Odoo testcontainer)
- `claude` CLI on PATH (Claude Code)
- Claude auth (API key or active OAuth session)
- Python 3.14 + `uv`

**Command:**

```bash
uv run pytest -m e2e -s -v
```

> **Cost warning:** Each run makes a real, billable Claude API call.
> Keep the suite small and only run when needed.

The test skips automatically when Docker or the `claude` CLI is absent — this is a clean skip, not an error.

The default `uv run pytest` excludes e2e tests automatically via the `not e2e` `addopts` filter.

## Adapter update proposals

After `CI` succeeds for a push to the current `develop` head,
`.github/workflows/notify-adapter.yml` validates the source repository, workflow,
run attempt and all three required CI jobs. It sends `repository_dispatch` to
`godoo-dev/godoo-cf-sudo-mcp` with event type `mcp-source-update` and payload:

```json
{"source_sha":"<40 lowercase hex>","ci_run_id":123,"ci_run_attempt":1}
```

The adapter's trusted `.github/workflows/update-mcp.yml` independently validates
that evidence and owns the source manifest and deduplicated update PR. This sender
never checks out the candidate, executes its artifacts, creates an adapter PR or
uses Cloudflare credentials. A race with a newer upstream commit is rechecked by
the receiver; stale evidence is not permission to promote it. Review, adapter CI
and its test-only deployment guards remain on the adapter side.

Provision repository variable `MCP_UPDATE_APP_ID` and secret
`MCP_UPDATE_APP_PRIVATE_KEY` in this repository and the adapter repository for a
GitHub App installed **only on the adapter repository**, with Contents and Pull
requests write permissions. The sender requests only an adapter Contents write
token (required for repository dispatch); the receiver requests the permissions
needed to create its PR. Tokens are short-lived and revoked by the token action.
Activation requires the receiver on adapter `main` and this sender on MCP
`develop`, as well as App provisioning in both repositories. Missing provisioning
fails explicitly; there is no PAT fallback. Configuration and offline checks do
not establish a successful hosted dispatch or deployment.

Run the dependency-free sender checks with
`node --test .github/scripts/notify-adapter.test.cjs`; ordinary CI includes them.
