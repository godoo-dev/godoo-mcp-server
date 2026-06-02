"""Throwaway probe tool: validates the full credential→OdooClient→RPC chain.

This tool is a Phase 2 scaffolding artifact — it will be removed in Phase 3
when the real minimal toolset (search/read/create/write/call/introspect) is added.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from fastmcp import Context  # noqa: TC002  # required at runtime for pydantic schema generation
from fastmcp.server.dependencies import get_http_request
from godoo.client.client import OdooClient, OdooClientConfig

from godoo_mcp_server.server import mcp

if TYPE_CHECKING:
    from godoo_mcp_server.credentials import OdooCredentials


@mcp.tool(
    name="odoo_whoami",
    description="[Probe] Authenticate and return uid + db. Throwaway — Phase 3 removes this.",
)
async def odoo_whoami(ctx: Context) -> dict[str, object]:
    """Validates the full credential->OdooClient->RPC chain against a live Odoo instance."""
    request = get_http_request()
    creds: OdooCredentials = request.state.odoo_creds
    config = OdooClientConfig(
        url=creds.url,
        database=creds.database,
        username=creds.username,
        password=creds.password,
    )
    async with OdooClient(config) as client:
        session = client.get_session()
        assert session is not None
        return {"uid": session.uid, "db": session.db, "url": creds.url}
