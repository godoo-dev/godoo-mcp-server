# godoo-mcp-server

Operational MCP access to Odoo through record, discovery, chatter, activity,
action, attachment and user tools, plus bundled workflow guidance. The Python
server uses the godoo client and each caller's Odoo permissions.

This is the operational Odoo MCP. Odoo Atlas provides a separate read-only
knowledge MCP. `godoo-proxy` owns the broader commercial OAuth/SSO gateway.
Portfolio targets belong in [godoo HQ](https://github.com/godoo-dev/godoo-hq).

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

## Use and develop

- [MCP API](docs/api.md): protocol, exact tool arguments and resource limits.
- [Development](docs/development.md): checks, source layout, packaging and candidate validation.
- [Bundled Odoo guidance](src/godoo_mcp_server/skills/SKILL.md): consumer workflows,
  also available through `guidance_get()` and `skill://odoo/SKILL.md`.
- [Guidance provenance](src/godoo_mcp_server/skills/PROVENANCE.md): adapted sources and licensing.
- [Changelog](CHANGELOG.md), [license](LICENSE) and [agent instructions](AGENTS.md).

Tool annotations are hints, not write permission. Guidance cannot override client
policy; host/database names do not establish an environment's safety. These docs
describe this checkout's source, not an installed client version, published
artifact, deployed service or user acceptance.
