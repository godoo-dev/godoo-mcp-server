"""users_whoami tool — returns authenticated identity from session."""

from __future__ import annotations

from typing import TYPE_CHECKING

from fastmcp import Context  # noqa: TC002  # required at runtime for pydantic schema generation
from fastmcp.exceptions import ToolError
from fastmcp.server.dependencies import get_http_request
from godoo.client.client import OdooClient, OdooClientConfig
from godoo.client.errors import OdooError

from godoo_mcp_server.server import mcp

if TYPE_CHECKING:
    from godoo_mcp_server.credentials import OdooCredentials


@mcp.tool(
    name="users_whoami",
    description=(
        "Return the authenticated Odoo user identity (uid, username, database)."
        " username is the Odoo login value from the X-Odoo-Username header."
    ),
)
async def users_whoami(ctx: Context) -> dict[str, object]:
    """Return uid, username, and database for the authenticated Odoo user."""
    request = get_http_request()
    creds: OdooCredentials = request.state.odoo_creds
    config = OdooClientConfig(
        url=creds.url,
        database=creds.database,
        username=creds.username,
        password=creds.password,
    )
    try:
        async with OdooClient(config) as client:
            session = client.get_session()
            assert session is not None
            return {
                "uid": session.uid,
                "username": creds.username,
                "database": session.db,
            }
    except OdooError as e:
        raise ToolError(str(e)) from e
