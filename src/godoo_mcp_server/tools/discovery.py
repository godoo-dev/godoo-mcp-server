"""Discovery tools: discovery_list_models, discovery_get_fields."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from fastmcp import Context  # noqa: TC002
from fastmcp.exceptions import ToolError
from fastmcp.server.dependencies import get_http_request
from godoo.client.client import OdooClient, OdooClientConfig
from godoo.client.errors import OdooError

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
    description=(
        "List all available Odoo models (technical name, label, description)."
        " Use discovery_get_fields to inspect a model's fields before operating on it."
    ),
)
async def discovery_list_models(ctx: Context) -> dict[str, object]:
    """Return all Odoo models accessible to the current user."""
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
            models = await client.search_read(
                "ir.model",
                [],
                fields=["model", "name", "info"],
                limit=500,  # safe cap above any realistic model count (Open Question 2)
                order="model",
            )
            return {"models": models}
    except OdooError as e:
        raise ToolError(str(e)) from e


@mcp.tool(
    name="discovery_get_fields",
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
        async with OdooClient(config) as client:
            fields: dict[str, Any] = await client.fields_get(
                model,
                attributes=attributes or _DEFAULT_FIELD_ATTRS,
            )
            return {"model": model, "fields": fields}
    except OdooError as e:
        raise ToolError(str(e)) from e
