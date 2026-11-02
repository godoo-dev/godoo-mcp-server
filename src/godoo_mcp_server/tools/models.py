"""General Odoo model-method invocation."""

from __future__ import annotations

from typing import TYPE_CHECKING, Annotated, Any

from fastmcp import Context  # noqa: TC002
from fastmcp.server.dependencies import get_http_request
from godoo.client.client import OdooClient, OdooClientConfig
from godoo.client.errors import OdooError
from pydantic import Field

from godoo_mcp_server.odoo_runtime import ClassifiedToolError, managed_odoo_client, safe_tool_error
from godoo_mcp_server.server import mcp

if TYPE_CHECKING:
    from godoo_mcp_server.credentials import OdooCredentials

NonemptyString = Annotated[str, Field(strict=True, min_length=1)]


@mcp.tool(
    name="model_call",
    annotations={
        "readOnlyHint": False,
        "destructiveHint": True,
        "idempotentHint": False,
        "openWorldHint": True,
    },
    description=(
        "Call a method on any installed Odoo model using the caller's credentials."
        " model and method are technical names; args is the native positional argument"
        " array and kwargs is the keyword argument object. Omitted/null args and kwargs"
        " default to [] and {}. Pass Odoo context inside kwargs.context as an object."
        " Recordset methods commonly take an ID list as the first positional argument,"
        " e.g. args=[[42]]. Returns result containing the unchanged native JSON value;"
        " returned actions are not executed. Methods can read, change or delete data"
        " and cause external effects: know the method contract and obtain authority for"
        " its effects. This tool adds no confirmation mechanism or privilege elevation."
        " The client's existing safety guard is retained; no safetyLevel override."
        " Do not retry automatically after an unknown outcome; inspect actual state first."
    ),
)
async def model_call(
    ctx: Context,
    model: NonemptyString,
    method: NonemptyString,
    args: list[Any] | None = None,
    kwargs: dict[str, Any] | None = None,
) -> dict[str, object]:
    """Forward one native call without addon-specific dispatch or result normalization."""
    if kwargs is not None and "context" in kwargs and not isinstance(kwargs["context"], dict):
        raise ClassifiedToolError("kwargs.context must be an object", category="invalid_arguments")
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
            result = await client.call(model, method, args or [], kwargs or {})
            return {"result": result}
    except OdooError as error:
        raise safe_tool_error(error, write_may_have_dispatched=True) from None
