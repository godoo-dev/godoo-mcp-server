"""Attachment tool handlers.

Provides: attachments_list, attachments_upload, attachments_download.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from fastmcp import Context  # noqa: TC002
from fastmcp.server.dependencies import get_http_request
from godoo.client.client import OdooClient, OdooClientConfig
from godoo.client.errors import OdooError

from godoo_mcp_server.artifacts import deliver_artifact
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
    name="attachments_list",
    annotations={"readOnlyHint": True},
    description=(
        "List ir.attachment records. Optionally filter by res_model and/or res_id"
        " to get attachments for a specific record."
        " domain: additional Odoo domain filter (merged with model/id filters)."
        " res_model: Odoo model name to filter by. res_id: numeric record id to filter by."
        " limit: max results (default 80)."
    ),
)
async def attachments_list(
    ctx: Context,
    domain: list[Any] | None = None,
    limit: int = 80,
    res_model: str | None = None,
    res_id: int | None = None,
) -> dict[str, object]:
    """List ir.attachment records with optional resource filters."""
    request = get_http_request()
    creds: OdooCredentials = request.state.odoo_creds
    try:
        async with managed_odoo_client(OdooClient(_make_config(creds))) as client:
            effective_domain: list[Any] = list(domain or [])
            if res_model is not None:
                effective_domain.append(["res_model", "=", res_model])
            if res_id is not None:
                effective_domain.append(["res_id", "=", res_id])
            records = await client.search_read(
                "ir.attachment",
                effective_domain,
                fields=[
                    "id",
                    "name",
                    "mimetype",
                    "file_size",
                    "res_model",
                    "res_id",
                    "create_date",
                ],
                limit=limit,
            )
            return {"attachments": records, "count": len(records)}
    except OdooError as e:
        raise safe_tool_error(e) from None


@mcp.tool(
    name="attachments_upload",
    annotations={"readOnlyHint": False},
    description=(
        "Upload a file as an ir.attachment linked to an Odoo record."
        " name: filename for the attachment."
        " content_base64: base64-encoded file content."
        " res_model: Odoo model name of the linked record."
        " res_id: numeric id of the linked record."
        " mimetype: MIME type (default 'application/octet-stream')."
        " Returns the new attachment id."
    ),
)
async def attachments_upload(
    ctx: Context,
    name: str,
    content_base64: str,
    res_model: str,
    res_id: int,
    mimetype: str | None = None,
) -> dict[str, object]:
    """Create an ir.attachment record with base64-encoded content."""
    request = get_http_request()
    creds: OdooCredentials = request.state.odoo_creds
    try:
        async with managed_odoo_client(OdooClient(_make_config(creds))) as client:
            new_id = await client.create(
                "ir.attachment",
                {
                    "name": name,
                    "datas": content_base64,
                    "res_model": res_model,
                    "res_id": res_id,
                    "mimetype": mimetype or "application/octet-stream",
                },
            )
            return {"id": new_id}
    except OdooError as e:
        raise safe_tool_error(e, write_may_have_dispatched=True) from None


@mcp.tool(
    name="attachments_download",
    annotations={"readOnlyHint": False, "destructiveHint": False, "idempotentHint": False},
    description=(
        "Download an ir.attachment by id through a private signed URL."
        " Returns filename, MIME type, byte size, SHA-256 and expiry/cleanup metadata;"
        " never returns binary content or base64. Requires configured artifact storage."
        " Odoo is only read; delivery creates a temporary stored copy."
        " If the attachment has no binary content (empty datas field),"
        " returns an error dict."
        " attachment_id: numeric id of the ir.attachment record."
    ),
)
async def attachments_download(
    ctx: Context,
    attachment_id: int,
) -> dict[str, object]:
    """Download attachment binary via read_binary. Guards against empty datas field."""
    request = get_http_request()
    creds: OdooCredentials = request.state.odoo_creds
    try:
        async with managed_odoo_client(OdooClient(_make_config(creds))) as client:
            data = await client.read_binary("ir.attachment", attachment_id, "datas")
            if not data:
                return {"error": "attachment_has_no_content", "id": attachment_id}
            records_meta = await client.read(
                "ir.attachment", [attachment_id], fields=["name", "mimetype"]
            )
            meta: dict[str, Any] = records_meta[0] if records_meta else {}
    except OdooError as e:
        raise safe_tool_error(e) from None
    name = meta.get("name") or "attachment"
    mimetype = meta.get("mimetype") or "application/octet-stream"
    receipt = await deliver_artifact(
        data,
        source={"tool": "attachments_download", "model": "ir.attachment"},
        filename=name,
        mimetype=mimetype,
    )
    return {**receipt, "id": attachment_id, "name": name, "mimetype": mimetype}
