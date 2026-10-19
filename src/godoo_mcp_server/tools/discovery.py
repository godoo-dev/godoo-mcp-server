"""Discovery tools: discovery_list_models, discovery_get_fields."""

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

_DEFAULT_FIELD_ATTRS: list[str] = [
    "string",
    "type",
    "required",
    "readonly",
    "help",
    "relation",
]


@mcp.tool(
    name="discovery_list_models",
    annotations={"readOnlyHint": True},
    description=(
        "List up to 500 accessible Odoo models (technical name, label, description)."
        " Use discovery_get_fields to inspect a model's fields before operating on it."
    ),
)
async def discovery_list_models(ctx: Context) -> dict[str, object]:
    """Return up to 500 Odoo models accessible to the current user."""
    request = get_http_request()
    creds: OdooCredentials = request.state.odoo_creds
    config = OdooClientConfig(
        url=creds.url,
        database=creds.database,
        username=creds.username,
        password=creds.password,
    )
    try:
        async with managed_odoo_client(OdooClient(config)) as client:
            models = await client.search_read(
                "ir.model",
                [],
                fields=["model", "name", "info"],
                limit=500,
                order="model",
            )
            return {"models": models}
    except OdooError as e:
        raise safe_tool_error(e) from None


@mcp.tool(
    name="discovery_get_fields",
    annotations={"readOnlyHint": True},
    description=(
        "Return field metadata for an Odoo model. Includes type, label, required,"
        " readonly, help text, and relational target model."
    ),
)
async def discovery_get_fields(
    ctx: Context,
    model: str,
    attributes: list[str] | None = None,
) -> dict[str, object]:
    """Return field metadata for the given Odoo model."""
    request = get_http_request()
    creds: OdooCredentials = request.state.odoo_creds
    config = OdooClientConfig(
        url=creds.url,
        database=creds.database,
        username=creds.username,
        password=creds.password,
    )
    try:
        async with managed_odoo_client(OdooClient(config)) as client:
            fields: dict[str, Any] = await client.fields_get(
                model,
                attributes=attributes or _DEFAULT_FIELD_ATTRS,
            )
            return {"model": model, "fields": fields}
    except OdooError as e:
        raise safe_tool_error(e) from None


@mcp.tool(
    name="discovery_list_menus",
    annotations={"readOnlyHint": True},
    description=(
        "List Odoo application menus (ir.ui.menu). Returns menu entries ordered by sequence."
        " Use domain to filter by parent or action type."
    ),
)
async def discovery_list_menus(
    ctx: Context,
    domain: list[Any] | None = None,
    limit: int = 80,
) -> dict[str, object]:
    """Return ir.ui.menu records accessible to the current user, ordered by sequence."""
    request = get_http_request()
    creds: OdooCredentials = request.state.odoo_creds
    config = OdooClientConfig(
        url=creds.url,
        database=creds.database,
        username=creds.username,
        password=creds.password,
    )
    try:
        async with managed_odoo_client(OdooClient(config)) as client:
            menus = await client.search_read(
                "ir.ui.menu",
                domain or [],
                fields=["id", "name", "complete_name", "parent_id", "action", "sequence"],
                limit=limit,
                order="sequence",
            )
            return {"menus": menus, "count": len(menus)}
    except OdooError as e:
        raise safe_tool_error(e) from None
