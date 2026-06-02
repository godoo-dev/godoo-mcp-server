"""FastMCP server instance and ASGI application factory.

Provides:
  mcp       — the FastMCP instance; imported by tool modules to register tools
  create_app — ASGI factory: returns a StarletteWithLifespan for uvicorn or testing
"""

from __future__ import annotations

from fastmcp import FastMCP
from starlette.middleware import Middleware

from godoo_mcp_server.credentials import CredentialMiddleware

mcp = FastMCP(
    "godoo-mcp-server",
    instructions="Stateless MCP server for Odoo. Per-request credentials via X-Odoo-* headers.",
)

# Side-effect imports: register @mcp.tool and @mcp.resource decorators on the mcp instance above.
# Must be AFTER mcp is defined. noqa: F401 (unused import), E402 (not at top of file).
from godoo_mcp_server.tools import actions as _actions_module  # noqa: F401, E402
from godoo_mcp_server.tools import attachments as _attachments_module  # noqa: F401, E402
from godoo_mcp_server.tools import discovery as _disc_module  # noqa: F401, E402
from godoo_mcp_server.tools import mail as _mail_module  # noqa: F401, E402
from godoo_mcp_server.tools import records as _records_module  # noqa: F401, E402
from godoo_mcp_server.tools import users as _users_module  # noqa: F401, E402
from godoo_mcp_server import resources as _resources_module  # noqa: F401, E402


def create_app() -> object:  # StarletteWithLifespan is a private fastmcp type; object is mypy-safe
    """Create and return the ASGI application with credential middleware.

    Returns a StarletteWithLifespan ASGI app suitable for uvicorn.run() or
    httpx.ASGITransport in tests. Always call app.router.lifespan_context(app)
    before sending requests in tests.
    """
    return mcp.http_app(
        stateless_http=True,
        middleware=[Middleware(CredentialMiddleware)],
    )
