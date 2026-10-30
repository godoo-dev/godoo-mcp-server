"""Record operation tools.

Provides: record_search, record_read, record_create, record_update, record_delete.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Annotated, Any

from fastmcp import Context  # noqa: TC002
from fastmcp.server.dependencies import get_http_request
from godoo.client.client import OdooClient, OdooClientConfig
from godoo.client.errors import OdooError
from pydantic import Field, StrictInt

from godoo_mcp_server.artifacts import deliver_record_result
from godoo_mcp_server.links import record_web_urls
from godoo_mcp_server.odoo_runtime import ClassifiedToolError, managed_odoo_client, safe_tool_error
from godoo_mcp_server.properties import compile_domain, prepare_create, prepare_update
from godoo_mcp_server.properties import read as read_properties
from godoo_mcp_server.server import mcp

if TYPE_CHECKING:
    from godoo_mcp_server.credentials import OdooCredentials

ReturnByteLimit = Annotated[int, Field(ge=0, strict=True)]


def _make_config(creds: OdooCredentials) -> OdooClientConfig:
    return OdooClientConfig(
        url=creds.url,
        database=creds.database,
        username=creds.username,
        password=creds.password,
    )


@mcp.tool(
    name="record_search",
    annotations={"readOnlyHint": False, "destructiveHint": False, "idempotentHint": False},
    description=(
        "Search records of any Odoo model using a domain filter. Returns matching records"
        " with the requested fields in a single call. domain uses raw Odoo domain syntax:"
        " list of triples, e.g. [['active','=',True]]. Pagination: pass limit + offset."
        " Default limit=80. Use a bounded positive integer limit."
        " max_return_bytes defaults to 500 UTF-8 JSON bytes: larger results return only a"
        " private JSON artifact receipt with a signed URL (default 60 minutes)."
        " Set 0 to force artifact delivery, null to return the full result inline."
        " Odoo is only read; artifact delivery creates a temporary stored copy."
        " Select friendly properties with fields such as properties.task_properties.priority."
        " The same path and friendly choices work in domain predicates constrained to one"
        " definition parent. Property filtering happens before pagination."
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
    max_return_bytes: ReturnByteLimit | None = 500,
) -> dict[str, object]:
    """Search records, then resolve explicitly selected friendly property values."""
    request = get_http_request()
    creds: OdooCredentials = request.state.odoo_creds
    try:
        async with managed_odoo_client(OdooClient(_make_config(creds))) as client:
            if order and any(part.strip().startswith("properties.") for part in order.split(",")):
                raise ClassifiedToolError(
                    "Ordering by friendly properties is unsupported", category="property_order"
                )
            friendly_fields = fields is not None and any(
                name.startswith("properties.") for name in fields
            )
            compiled = await compile_domain(client, model, domain or [])
            records = await client.search_read(
                model,
                compiled,
                fields=["id"] if friendly_fields else fields,
                limit=limit,
                offset=offset,
                order=order,
            )
            if friendly_fields and fields is not None:
                records = await read_properties(
                    client, model, [row["id"] for row in records], fields
                )
            result: dict[str, object] = {
                "records": records,
                "count": len(records),
                "web_urls": record_web_urls(
                    creds.url, model, [r["id"] for r in records if "id" in r]
                ),
            }
    except OdooError as e:
        raise safe_tool_error(e) from None
    return await deliver_record_result(
        result,
        max_return_bytes=max_return_bytes,
        model=model,
        tool="record_search",
        row_count=len(records),
    )


@mcp.tool(
    name="record_read",
    annotations={"readOnlyHint": False, "destructiveHint": False, "idempotentHint": False},
    description=(
        "Read fields of specific records by id list. max_return_bytes defaults to 500"
        " UTF-8 JSON bytes: larger results return only a private JSON artifact receipt"
        " with a signed URL (default 60 minutes). Set 0 to force artifact delivery,"
        " null to return the full result inline. Odoo is only read; artifact delivery"
        " creates a temporary stored copy."
        " Select properties.<container> or properties.<container>.<name> for friendly"
        " names and choice values discovered through discovery_get_fields."
    ),
)
async def record_read(
    ctx: Context,
    model: str,
    ids: list[int],
    fields: list[str] | None = None,
    max_return_bytes: ReturnByteLimit | None = 500,
) -> dict[str, object]:
    """Read specific records by their ids."""
    request = get_http_request()
    creds: OdooCredentials = request.state.odoo_creds
    try:
        async with managed_odoo_client(OdooClient(_make_config(creds))) as client:
            if fields is not None and any(name.startswith("properties.") for name in fields):
                records = await read_properties(client, model, ids, fields)
            else:
                records = await client.read(model, ids, fields)
            result: dict[str, object] = {
                "records": records,
                "web_urls": record_web_urls(
                    creds.url, model, [r["id"] for r in records if "id" in r]
                ),
            }
    except OdooError as e:
        raise safe_tool_error(e) from None
    return await deliver_record_result(
        result,
        max_return_bytes=max_return_bytes,
        model=model,
        tool="record_read",
        row_count=len(records),
    )


@mcp.tool(
    name="record_create",
    annotations={"readOnlyHint": False},
    description=(
        "Create one record from ordinary values and optional properties, using"
        " {container: {friendly_name: value}} and discovered friendly choices."
        " Supply each container's positive definition-parent ID in values. Omitted"
        " properties retain Odoo defaults; null clears. Do not mix raw containers"
        " with friendly properties. All properties are preflighted before one create."
        " Returns id and web_url. Never retry an unknown write automatically."
    ),
)
async def record_create(
    ctx: Context,
    model: str,
    values: dict[str, Any],
    properties: dict[str, dict[str, Any]] | None = None,
) -> dict[str, object]:
    """Create a new record with the given field values."""
    request = get_http_request()
    creds: OdooCredentials = request.state.odoo_creds
    try:
        async with managed_odoo_client(OdooClient(_make_config(creds))) as client:
            if properties is not None:
                binding, payload = await prepare_create(client, model, properties, values)
            try:
                new_id = (
                    await binding.create(payload, refresh=False)
                    if properties is not None
                    else await client.create(model, values)
                )
            except OdooError as e:
                raise safe_tool_error(e, write_may_have_dispatched=True) from None
            urls = record_web_urls(creds.url, model, [new_id])
            return {"id": new_id, "web_url": urls.get(str(new_id))}
    except OdooError as e:
        raise safe_tool_error(e) from None


@mcp.tool(
    name="record_update",
    annotations={"readOnlyHint": False},
    description=(
        "Update ordinary fields through values. For one record, properties accepts"
        " {container: {friendly_name: value}} sparse changes using discovered names and"
        " choices. Omitted properties remain unchanged; null clears. Lists replace that"
        " property's selected values. Mixed values/properties use one write. Read/merge/write"
        " is non-atomic against concurrent edits. Never retry an unknown write automatically."
    ),
)
async def record_update(
    ctx: Context,
    model: str,
    ids: list[StrictInt],
    values: dict[str, Any] | None = None,
    properties: dict[str, dict[str, Any]] | None = None,
) -> dict[str, object]:
    """Update records using client.write (maps record_update -> write per D-03)."""
    request = get_http_request()
    creds: OdooCredentials = request.state.odoo_creds
    try:
        async with managed_odoo_client(OdooClient(_make_config(creds))) as client:
            payload = values or {}
            if properties is not None:
                if len(ids) != 1 or type(ids[0]) is not int or ids[0] <= 0:
                    raise ClassifiedToolError(
                        "Property updates require exactly one positive record ID",
                        category="property_scope",
                    )
                payload = await prepare_update(client, model, ids[0], properties, values or {})
            elif values is None:
                raise ClassifiedToolError(
                    "Supply values or properties to update", category="update_values"
                )
            try:
                ok = await client.write(model, ids, payload)
            except OdooError as e:
                raise safe_tool_error(e, write_may_have_dispatched=True) from None
            return {
                "success": ok,
                "web_urls": record_web_urls(creds.url, model, ids) if ok else {},
            }
    except OdooError as e:
        raise safe_tool_error(e) from None


@mcp.tool(
    name="record_delete",
    annotations={"readOnlyHint": False},
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
