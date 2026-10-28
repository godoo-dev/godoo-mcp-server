"""Mail/chatter tool handlers.

Provides: mail_post_message, mail_log_note, mail_list_messages,
          mail_schedule_activity, mail_list_activities, mail_mark_activity_done.
"""

from __future__ import annotations

import re
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
    name="mail_post_message",
    annotations={"readOnlyHint": False},
    description=(
        "Post a message to any Odoo record's chatter (mail.thread mixin)."
        " Calls message_post on the given model/res_id."
        " model: Odoo model name (e.g. 'res.partner')."
        " res_id: numeric record id."
        " body: message body text or HTML."
        " is_internal: True to post as internal note (visible only to internal users)."
        " partner_ids: list of partner ids to notify."
        " attachment_ids: list of existing ir.attachment ids to link."
    ),
)
async def mail_post_message(
    ctx: Context,
    model: str,
    res_id: int,
    body: str,
    is_internal: bool = False,
    partner_ids: list[int] | None = None,
    attachment_ids: list[int] | None = None,
) -> dict[str, object]:
    """Post a message on any record's chatter. Calls message_post on mail.thread mixin."""
    request = get_http_request()
    creds: OdooCredentials = request.state.odoo_creds
    try:
        async with managed_odoo_client(OdooClient(_make_config(creds))) as client:
            html_body = body if "<" in body else f"<p>{body}</p>"
            subtype_xmlid = "mail.mt_note" if is_internal else "mail.mt_comment"
            kwargs: dict[str, Any] = {
                "body": html_body,
                "message_type": "comment",
                "subtype_xmlid": subtype_xmlid,
                "is_internal": is_internal,
                "partner_ids": partner_ids or [],
                "attachment_ids": attachment_ids or [],
            }
            result = await client.call(model, "message_post", [res_id], kwargs)
            result_id = result[0] if isinstance(result, list) else int(result)
            return {"message_id": result_id}
    except OdooError as e:
        raise safe_tool_error(e, write_may_have_dispatched=True) from None


@mcp.tool(
    name="mail_log_note",
    annotations={"readOnlyHint": False},
    description=(
        "Post an internal note on any Odoo record's chatter."
        " Calls message_post with is_internal=True and subtype_xmlid='mail.mt_note'."
        " model: Odoo model name. res_id: numeric record id. body: note text or HTML."
    ),
)
async def mail_log_note(
    ctx: Context,
    model: str,
    res_id: int,
    body: str,
) -> dict[str, object]:
    """Log an internal note on a record's chatter. Calls message_post with mt_note subtype."""
    request = get_http_request()
    creds: OdooCredentials = request.state.odoo_creds
    try:
        async with managed_odoo_client(OdooClient(_make_config(creds))) as client:
            html_body = body if "<" in body else f"<p>{body}</p>"
            kwargs: dict[str, Any] = {
                "body": html_body,
                "message_type": "comment",
                "subtype_xmlid": "mail.mt_note",
                "is_internal": True,
                "partner_ids": [],
                "attachment_ids": [],
            }
            result = await client.call(model, "message_post", [res_id], kwargs)
            result_id = result[0] if isinstance(result, list) else int(result)
            return {"message_id": result_id}
    except OdooError as e:
        raise safe_tool_error(e, write_may_have_dispatched=True) from None


@mcp.tool(
    name="mail_list_messages",
    annotations={"readOnlyHint": True},
    description=(
        "List chatter messages for an Odoo record."
        " Calls search_read on mail.message with domain filtered by model and res_id."
        " Returns messages ordered by date descending."
        " model: Odoo model name. res_id: numeric record id."
        " limit: max messages to return (default 80). offset: pagination offset."
    ),
)
async def mail_list_messages(
    ctx: Context,
    model: str,
    res_id: int,
    limit: int = 80,
    offset: int = 0,
) -> dict[str, object]:
    """List chatter messages for a record via search_read on mail.message."""
    request = get_http_request()
    creds: OdooCredentials = request.state.odoo_creds
    try:
        async with managed_odoo_client(OdooClient(_make_config(creds))) as client:
            domain: list[Any] = [["model", "=", model], ["res_id", "=", res_id]]
            records = await client.search_read(
                "mail.message",
                domain,
                fields=[
                    "id",
                    "body",
                    "author_id",
                    "date",
                    "message_type",
                    "subtype_id",
                    "is_internal",
                ],
                limit=limit,
                offset=offset,
                order="date desc",
            )
            return {"messages": records, "count": len(records)}
    except OdooError as e:
        raise safe_tool_error(e) from None


@mcp.tool(
    name="mail_schedule_activity",
    annotations={"readOnlyHint": False},
    description=(
        "Schedule an activity on any Odoo record."
        " Calls activity_schedule on the mail.activity.mixin."
        " model: Odoo model name. res_id: numeric record id."
        " activity_type_id: numeric id from this instance's mail.activity.type records."
        " date_deadline: due date in YYYY-MM-DD format."
        " note: optional activity note. user_id: optional assignee user id."
    ),
)
async def mail_schedule_activity(
    ctx: Context,
    model: str,
    res_id: int,
    activity_type_id: int,
    date_deadline: str,
    note: str | None = None,
    user_id: int | None = None,
) -> dict[str, object]:
    """Schedule one activity and normalize Odoo's singleton recordset RPC result."""
    request = get_http_request()
    creds: OdooCredentials = request.state.odoo_creds
    try:
        async with managed_odoo_client(OdooClient(_make_config(creds))) as client:
            kwargs: dict[str, Any] = {
                "activity_type_id": activity_type_id,
                "date_deadline": date_deadline,
            }
            if note is not None:
                kwargs["note"] = note
            if user_id is not None:
                kwargs["user_id"] = user_id
            result = await client.call(model, "activity_schedule", [res_id], kwargs)
            # Odoo18 serializes a recordset as text; Odoo19 returns its IDs.
            # Accept only the single activity returned for this single record;
            # an unrecognized result remains an unknown write, never a retry.
            if (
                isinstance(result, list)
                and len(result) == 1
                and type(result[0]) is int
                and result[0] > 0
            ):
                result = result[0]
            if isinstance(result, str):
                recordset = re.fullmatch(r"mail\.activity\(([1-9][0-9]*),?\)", result)
                if recordset is not None:
                    result = int(recordset.group(1))
            return {"activity_id": int(result)}
    except OdooError as e:
        raise safe_tool_error(e, write_may_have_dispatched=True) from None


@mcp.tool(
    name="mail_list_activities",
    annotations={"readOnlyHint": True},
    description=(
        "List pending activities for an Odoo record."
        " Calls search_read on mail.activity filtered by model and res_id."
        " model: Odoo model name. res_id: numeric record id."
        " limit: max activities to return (default 80)."
    ),
)
async def mail_list_activities(
    ctx: Context,
    model: str,
    res_id: int,
    limit: int = 80,
) -> dict[str, object]:
    """List activities for a record via search_read on mail.activity."""
    request = get_http_request()
    creds: OdooCredentials = request.state.odoo_creds
    try:
        async with managed_odoo_client(OdooClient(_make_config(creds))) as client:
            domain: list[Any] = [["res_model", "=", model], ["res_id", "=", res_id]]
            records = await client.search_read(
                "mail.activity",
                domain,
                fields=[
                    "id",
                    "activity_type_id",
                    "date_deadline",
                    "note",
                    "user_id",
                    "state",
                    "summary",
                ],
                limit=limit,
            )
            return {"activities": records, "count": len(records)}
    except OdooError as e:
        raise safe_tool_error(e) from None


@mcp.tool(
    name="mail_mark_activity_done",
    annotations={"readOnlyHint": False},
    description=(
        "Mark an activity as done with optional feedback."
        " Calls action_feedback on mail.activity."
        " activity_id: numeric id of the activity to complete."
        " feedback: optional feedback text posted to the chatter."
    ),
)
async def mail_mark_activity_done(
    ctx: Context,
    activity_id: int,
    feedback: str = "",
) -> dict[str, object]:
    """Mark an activity done and post feedback. Calls action_feedback on mail.activity.

    # [ASSUMED A2] action_feedback — standard Odoo 16/17 API.
    """
    request = get_http_request()
    creds: OdooCredentials = request.state.odoo_creds
    try:
        async with managed_odoo_client(OdooClient(_make_config(creds))) as client:
            result = await client.call(
                "mail.activity",
                "action_feedback",
                [activity_id],
                {"feedback": feedback},
            )
            return {"success": bool(result)}
    except OdooError as e:
        raise safe_tool_error(e, write_may_have_dispatched=True) from None
