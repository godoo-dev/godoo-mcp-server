"""Record operation tools.

Provides: record_search, record_read, record_create, record_update, record_delete.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from fastmcp import Context  # noqa: TC002
from fastmcp.server.dependencies import get_http_request
from godoo.client.client import OdooClient, OdooClientConfig
from godoo.client.errors import OdooError

from godoo_mcp_server.odoo_runtime import managed_odoo_client, safe_tool_error
from godoo_mcp_server.server import mcp

if TYPE_CHECKING:
    from godoo_mcp_server.credentials import OdooCredentials


def _make_config(creds: OdooCredentials) -> OdooClientConfig:
    return OdooClientConfig(
        url=creds.url,
        database=creds.database,
        username=creds.username,
        password=creds.password,
    )


@mcp.tool(
    name="record_search",
    description=(
        "Search records of any Odoo model using a domain filter. Returns matching records"
        " with the requested fields in a single call. domain uses raw Odoo domain syntax:"
        " list of triples, e.g. [['active','=',True]]. Pagination: pass limit + offset."
        " Default limit=80. Pass limit=None to let Odoo apply its server-side default."
    ),
)
async def record_search(
    ctx: Context,
    model: str,
    domain: list[Any] | None = None,
    fields: list[str] | None = None,
    limit: int = 80,
    offset: int = 0,
    order: str | None = None,
) -> dict[str, object]:
    """Search records using search_read (one-shot: search + read in a single RPC call)."""
    request = get_http_request()
    creds: OdooCredentials = request.state.odoo_creds
    try:
        async with managed_odoo_client(OdooClient(_make_config(creds))) as client:
            records = await client.search_read(
                model,
                domain or [],
                fields=fields,
                limit=limit,
                offset=offset,
                order=order,
            )
            return {"records": records, "count": len(records)}
    except OdooError as e:
        raise safe_tool_error(e) from None


@mcp.tool(
    name="record_read",
    description="Read fields of specific records by id list.",
)
async def record_read(
    ctx: Context,
    model: str,
    ids: list[int],
    fields: list[str] | None = None,
) -> dict[str, object]:
    """Read specific records by their ids."""
    request = get_http_request()
    creds: OdooCredentials = request.state.odoo_creds
    try:
        async with managed_odoo_client(OdooClient(_make_config(creds))) as client:
            records = await client.read(model, ids, fields)
            return {"records": records}
    except OdooError as e:
        raise safe_tool_error(e) from None


@mcp.tool(
    name="record_create",
    description="Create a new record. Returns the new record id.",
)
async def record_create(
    ctx: Context,
    model: str,
    values: dict[str, Any],
) -> dict[str, object]:
    """Create a new record with the given field values."""
    request = get_http_request()
    creds: OdooCredentials = request.state.odoo_creds
    try:
        async with managed_odoo_client(OdooClient(_make_config(creds))) as client:
            new_id = await client.create(model, values)
            return {"id": new_id}
    except OdooError as e:
        raise safe_tool_error(e, write_may_have_dispatched=True) from None


@mcp.tool(
    name="record_update",
    description="Update fields on existing records by id list.",
)
async def record_update(
    ctx: Context,
    model: str,
    ids: list[int],
    values: dict[str, Any],
) -> dict[str, object]:
    """Update records using client.write (maps record_update -> write per D-03)."""
    request = get_http_request()
    creds: OdooCredentials = request.state.odoo_creds
    try:
        async with managed_odoo_client(OdooClient(_make_config(creds))) as client:
            ok = await client.write(model, ids, values)
            return {"success": ok}
    except OdooError as e:
        raise safe_tool_error(e, write_may_have_dispatched=True) from None


@mcp.tool(
    name="record_delete",
    description="Delete records by id list.",
)
async def record_delete(
    ctx: Context,
    model: str,
    ids: list[int],
) -> dict[str, object]:
    """Delete records using client.unlink (maps record_delete -> unlink per D-03)."""
    request = get_http_request()
    creds: OdooCredentials = request.state.odoo_creds
    try:
        async with managed_odoo_client(OdooClient(_make_config(creds))) as client:
            ok = await client.unlink(model, ids)
            return {"success": ok}
    except OdooError as e:
        raise safe_tool_error(e, write_may_have_dispatched=True) from None
