"""Action tool handlers.

Provides: action_list_actions, action_execute_action.
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
    name="action_list_actions",
    annotations={"readOnlyHint": True},
    description=(
        "List available Odoo actions from ir.actions.server and ir.actions.act_window."
        " Each result is tagged with action_type='server' or action_type='window'."
        " domain: optional Odoo domain filter applied to each model independently."
        " limit: max results per action model (default 80). Returns combined list."
    ),
)
async def action_list_actions(
    ctx: Context,
    domain: list[Any] | None = None,
    limit: int = 80,
) -> dict[str, object]:
    """List server and window actions. Unions results from both ir.actions models."""
    request = get_http_request()
    creds: OdooCredentials = request.state.odoo_creds
    try:
        async with managed_odoo_client(OdooClient(_make_config(creds))) as client:
            server_actions = await client.search_read(
                "ir.actions.server",
                domain or [],
                fields=["id", "name", "model_id", "binding_model_id", "code"],
                limit=limit,
            )
            for action in server_actions:
                action["action_type"] = "server"

            window_actions = await client.search_read(
                "ir.actions.act_window",
                domain or [],
                fields=["id", "name", "res_model", "view_mode"],
                limit=limit,
            )
            for action in window_actions:
                action["action_type"] = "window"

            combined: list[Any] = list(server_actions) + list(window_actions)
            return {"actions": combined, "count": len(combined)}
    except OdooError as e:
        raise safe_tool_error(e) from None


@mcp.tool(
    name="action_execute_action",
    annotations={"readOnlyHint": False},
    description=(
        "Execute an ir.actions.server action by its id."
        " Calls the 'run' method on ir.actions.server with the given action_id."
        " Returns the action result dict (or empty dict if the action returns None)."
        " action_id: numeric id of the ir.actions.server record to execute."
    ),
)
async def action_execute_action(
    ctx: Context,
    action_id: int,
) -> dict[str, object]:
    """Execute an ir.actions.server record by id through its run method."""
    request = get_http_request()
    creds: OdooCredentials = request.state.odoo_creds
    try:
        async with managed_odoo_client(OdooClient(_make_config(creds))) as client:
            result = await client.call("ir.actions.server", "run", [action_id], {})
            return {"result": result if result is not None else {}}
    except OdooError as e:
        raise safe_tool_error(e, write_may_have_dispatched=True) from None
