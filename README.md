# godoo-mcp-server

Stateless MCP server for Odoo — raw primitives + skill resources.

> Phase 1 scaffold — full documentation coming in later phases.

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
