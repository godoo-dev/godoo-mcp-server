# godoo-mcp-server

Stateless MCP server for Odoo — raw primitives + skill resources.

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
